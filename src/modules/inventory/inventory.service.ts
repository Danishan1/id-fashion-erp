import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { InventoryTransactionType, Prisma, RelatedModule, StockStatus } from "@prisma/client";
import {
  FinishedGoodsStockBalanceRepository,
  InventoryScopeRepository,
  InventoryTransactionRepository,
  StockBalanceRepository,
} from "./inventory.repository";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

// Decimal(18,4) columns throughout this schema — a small tolerance absorbs
// floating-point drift from UOM conversion (e.g. YDS->MTR) without letting a
// meaningfully negative balance through. Matches the EPSILON idiom already
// used by every other quantity-guard in this codebase (job-order.service.ts,
// job-work-order.service.ts, etc).
const EPSILON = 0.0001;

interface RecordInventoryTransactionInput {
  productId: string;
  warehouseId: string;
  warehouseLocationId?: string | null;
  transactionType: InventoryTransactionType;
  /** Signed: positive for a receipt, negative for a reversal/issue. */
  quantity: number;
  referenceModule: RelatedModule;
  referenceRecordId: string;
  fabricRollId?: string | null;
  notes?: string | null;
  /**
   * Colour-wise raw-material stock (2026-10-21) — the Colors-master colour of
   * the stock moved; null/omitted = "No colour". A coloured posting also
   * moves that colour's StockColorBalance (a coloured decrement can't take
   * more than that colour holds). An uncoloured decrement takes "No colour"
   * stock first, then coloured stock, so coloured stock never exceeds the
   * warehouse total.
   */
  colorId?: string | null;
  /**
   * Finished Goods Inventory module (2026-10-13, FGI-010) — opt-in,
   * additive. When BOTH `productVariantId` and `stockStatus` are supplied,
   * this call ALSO upserts/guarded-decrements the matching
   * `FinishedGoodsStockBalance` row (keyed on companyId/productId/
   * productVariantId/warehouseId/warehouseLocationId/stockStatus — the same
   * `warehouseLocationId` already on this input, reused for both the
   * ledger's own column and the balance row's own location dimension) inside
   * this SAME transaction as the one ledger insert below, so the two caches
   * can never disagree by construction (see
   * docs/FINISHED_GOODS_INVENTORY_IMPLEMENTATION_PLAN.md §4.5).
   *
   * Every existing caller omits both fields entirely and is completely
   * unaffected — the original `StockBalance` branch a few lines down runs
   * unconditionally either way, exactly as it always has.
   */
  productVariantId?: string | null;
  stockStatus?: StockStatus | null;
}

/**
 * The only way any module should write to the stock ledger. `tx` is
 * required, never optional with an internal fallback — a caller can never
 * accidentally start a second, independent transaction and silently break
 * the ledger/stock-balance atomicity this engine exists to protect (the
 * project's ledger discipline: stock_balances is upserted in the SAME
 * transaction as the InventoryTransaction insert that justifies it, always).
 * Called from Purchasing's Goods Receipt service today; Production (5C) and
 * Dispatch (Phase 8) are expected to reuse this same engine later.
 *
 * Returns the created InventoryTransaction row (2026-09-24, Phase 6 of
 * Material Substitution) — additive: every pre-existing caller already
 * discards the return value (`await recordInventoryTransaction(...)`), so
 * this is a non-breaking change. Needed so
 * MaterialSubstitution.inventoryTransactionId can point at the exact real
 * ledger row a substitute material's issue actually posted, inside the same
 * transaction, rather than re-querying "the most recent matching row" —
 * ambiguous under concurrent writes.
 */
export async function recordInventoryTransaction(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  input: RecordInventoryTransactionInput
) {
  const [product, warehouse] = await Promise.all([
    InventoryScopeRepository.findProductCompanyId(input.productId),
    InventoryScopeRepository.findWarehouseCompanyId(input.warehouseId),
  ]);
  if (!product || product.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Product not found.", { id: input.productId });
  }
  if (!warehouse || warehouse.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Warehouse not found.", { id: input.warehouseId });
  }
  // Finished Goods Inventory module (FGI-010) — both fields must be supplied
  // together or not at all; one without the other is a caller bug (an
  // incomplete key would otherwise silently create a FinishedGoodsStockBalance
  // row this project's own StockStatus enum never actually describes).
  if ((input.productVariantId != null) !== (input.stockStatus != null)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "productVariantId and stockStatus must be supplied together for a Finished-Goods-tracked posting, or not at all.",
      {}
    );
  }

  const transaction = await InventoryTransactionRepository.create(tx, {
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    productId: input.productId,
    warehouseId: input.warehouseId,
    warehouseLocationId: input.warehouseLocationId || null,
    transactionType: input.transactionType,
    quantity: input.quantity,
    referenceModule: input.referenceModule,
    referenceRecordId: input.referenceRecordId,
    fabricRollId: input.fabricRollId || null,
    performedByUserId: actor.userId,
    notes: input.notes || null,
    productVariantId: input.productVariantId || null,
    stockStatus: input.stockStatus || null,
    colorId: input.colorId || null,
  });

  // A receipt (quantity >= 0) can never drive the balance negative, so a
  // plain upsert is safe. A decrement (quantity < 0) is the one direction
  // that can — guarded atomically here, the single choke point every module
  // writes through, so no caller can bypass this floor by mistake. This is
  // deliberately the last line of defense: callers should still do their own
  // friendly pre-check with a helpful "Available: X, Requested: Y" message;
  // this guard exists to close the race a pre-check alone can't.
  if (input.quantity >= 0) {
    await StockBalanceRepository.upsertIncrement(tx, actor.companyId, input.productId, input.warehouseId, input.quantity);
  } else {
    const decrementAmount = -input.quantity;
    const guard = await StockBalanceRepository.guardedDecrement(
      tx,
      actor.companyId,
      input.productId,
      input.warehouseId,
      decrementAmount,
      decrementAmount - EPSILON
    );
    if (guard.count === 0) {
      throw new BusinessRuleError(
        "INSUFFICIENT_STOCK_FOR_MOVEMENT",
        `Not enough stock to post this transaction — requested ${decrementAmount}, but the available balance at this warehouse is insufficient.`,
        { productId: input.productId, warehouseId: input.warehouseId, requested: decrementAmount }
      );
    }
  }

  await applyColorBalance(tx, actor.companyId, input);

  // Finished Goods Inventory module (FGI-010) — the new, purely additive
  // branch. Runs AFTER the unconditional StockBalance branch above (so a
  // guard rejection there already threw and rolled back before this ever
  // executes), using the exact same increment-vs-guarded-decrement shape,
  // just against the richer, variant/location/status-keyed cache instead.
  if (input.productVariantId && input.stockStatus) {
    const key = {
      companyId: actor.companyId,
      productId: input.productId,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      warehouseLocationId: input.warehouseLocationId || null,
      stockStatus: input.stockStatus,
    };
    if (input.quantity >= 0) {
      await FinishedGoodsStockBalanceRepository.upsertIncrement(tx, key, input.quantity);
    } else {
      const decrementAmount = -input.quantity;
      const guard = await FinishedGoodsStockBalanceRepository.guardedDecrement(tx, key, decrementAmount, decrementAmount - EPSILON);
      if (guard.count === 0) {
        throw new BusinessRuleError(
          "INSUFFICIENT_STOCK_FOR_MOVEMENT",
          `Not enough Finished Goods stock to post this transaction for this specific variant/location — requested ${decrementAmount}, but the available balance is insufficient.`,
          { productId: input.productId, productVariantId: input.productVariantId, warehouseId: input.warehouseId, requested: decrementAmount }
        );
      }
    }
  }

  return transaction;
}

/** Keeps StockColorBalance in step with one ledger posting (see RecordInventoryTransactionInput.colorId). */
async function applyColorBalance(tx: Prisma.TransactionClient, companyId: string, input: RecordInventoryTransactionInput) {
  const key = { companyId, productId: input.productId, warehouseId: input.warehouseId };

  if (input.colorId) {
    if (input.quantity >= 0) {
      await tx.stockColorBalance.upsert({
        where: { companyId_productId_warehouseId_colorId: { ...key, colorId: input.colorId } },
        create: { ...key, colorId: input.colorId, quantityOnHand: input.quantity },
        update: { quantityOnHand: { increment: input.quantity } },
      });
      return;
    }
    const amount = -input.quantity;
    const guard = await tx.stockColorBalance.updateMany({
      where: { ...key, colorId: input.colorId, quantityOnHand: { gte: amount - EPSILON } },
      data: { quantityOnHand: { decrement: amount } },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError(
        "INSUFFICIENT_STOCK_FOR_MOVEMENT",
        `Not enough stock in this colour to post this transaction — requested ${amount}.`,
        { productId: input.productId, warehouseId: input.warehouseId, colorId: input.colorId, requested: amount }
      );
    }
    return;
  }

  if (input.quantity >= 0) return;
  // Uncoloured decrement: whatever goes past the "No colour" stock comes out
  // of the coloured rows, largest first.
  const [balance, colorRows] = await Promise.all([
    tx.stockBalance.findFirst({ where: key, select: { quantityOnHand: true } }),
    tx.stockColorBalance.findMany({ where: { ...key, quantityOnHand: { gt: 0 } }, orderBy: { quantityOnHand: "desc" } }),
  ]);
  const total = Number(balance?.quantityOnHand ?? 0);
  let overflow = colorRows.reduce((sum, row) => sum + Number(row.quantityOnHand), 0) - total;
  for (const row of colorRows) {
    if (overflow <= EPSILON) break;
    const take = Math.min(overflow, Number(row.quantityOnHand));
    await tx.stockColorBalance.update({ where: { id: row.id }, data: { quantityOnHand: { decrement: take } } });
    overflow -= take;
  }
}

/** Stock of one material at one warehouse in one Colors-master colour. */
export async function getAvailableQuantityByColor(companyId: string, productId: string, warehouseId: string, colorId: string): Promise<number> {
  const row = await prisma.stockColorBalance.findUnique({
    where: { companyId_productId_warehouseId_colorId: { companyId, productId, warehouseId, colorId } },
    select: { quantityOnHand: true },
  });
  return row ? Number(row.quantityOnHand) : 0;
}

export interface StockColorBreakdown {
  onHand: number;
  colors: Array<{ colorId: string; colorName: string; quantity: number }>;
  /** Stock not tagged with any colour. */
  noColorQuantity: number;
}

/** One material's stock at one warehouse, split by colour (plus "No colour"). */
export async function getStockColorBreakdown(companyId: string, productId: string, warehouseId: string): Promise<StockColorBreakdown> {
  const [onHand, rows] = await Promise.all([
    getAvailableQuantity(companyId, productId, warehouseId),
    prisma.stockColorBalance.findMany({
      where: { companyId, productId, warehouseId, quantityOnHand: { gt: EPSILON } },
      select: { colorId: true, quantityOnHand: true, color: { select: { name: true } } },
      orderBy: { color: { name: "asc" } },
    }),
  ]);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const colors = rows.map((r) => ({ colorId: r.colorId, colorName: r.color.name, quantity: round(Number(r.quantityOnHand)) }));
  const colored = colors.reduce((sum, c) => sum + c.quantity, 0);
  return { onHand: round(onHand), colors, noColorQuantity: round(Math.max(0, onHand - colored)) };
}

/** Available quantity for one product at one specific warehouse — what
 * Material Request's issue action checks against, since issuing must
 * decrement a real warehouse's balance, not a company-wide sum. */
export async function getAvailableQuantity(companyId: string, productId: string, warehouseId: string): Promise<number> {
  const balance = await StockBalanceRepository.findOne(companyId, productId, warehouseId);
  return balance ? Number(balance.quantityOnHand) : 0;
}

export interface RawMaterialLocationStock {
  warehouseLocationId: string;
  code: string;
  label: string;
  quantity: number;
}

/**
 * Raw material stock per location within one warehouse (2026-10-21). There is
 * no per-location balance cache for raw material (StockBalance is warehouse-
 * level), so this sums the ledger's own warehouseLocationId per location.
 * A location's figure is capped at the warehouse's real on-hand total (issues
 * posted without a location reduce the warehouse but not a location), and
 * whatever on-hand stock isn't attributed to any location is returned as
 * `unassignedQuantity`.
 */
export async function getRawMaterialStockByLocation(
  companyId: string,
  productId: string,
  warehouseId: string
): Promise<{ onHand: number; locations: RawMaterialLocationStock[]; unassignedQuantity: number }> {
  const [onHand, sums] = await Promise.all([
    getAvailableQuantity(companyId, productId, warehouseId),
    prisma.inventoryTransaction.groupBy({
      by: ["warehouseLocationId"],
      where: { companyId, productId, warehouseId, warehouseLocationId: { not: null }, productVariantId: null },
      _sum: { quantity: true },
    }),
  ]);
  const positive = sums
    .map((r) => ({ id: r.warehouseLocationId!, quantity: Number(r._sum.quantity ?? 0) }))
    .filter((r) => r.quantity > 1e-6);
  const locationRows = positive.length
    ? await prisma.warehouseLocation.findMany({
        where: { id: { in: positive.map((r) => r.id) }, warehouseId, warehouse: { companyId } },
        select: { id: true, code: true, zone: true, rack: true, shelf: true, bin: true },
      })
    : [];
  const byId = new Map(locationRows.map((l) => [l.id, l]));
  const round = (n: number) => Math.round(n * 10000) / 10000;
  const locations = positive
    .filter((r) => byId.has(r.id))
    .map((r) => {
      const l = byId.get(r.id)!;
      const parts = [l.zone, l.rack, l.shelf, l.bin].filter(Boolean).join(" / ");
      return {
        warehouseLocationId: r.id,
        code: l.code,
        label: parts ? `${l.code} (${parts})` : l.code,
        quantity: round(Math.min(r.quantity, onHand)),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const located = positive.reduce((sum, r) => sum + r.quantity, 0);
  return { onHand: round(onHand), locations, unassignedQuantity: round(Math.max(0, onHand - located)) };
}

/**
 * Finished Goods Inventory module (2026-10-13, FGI-010) — the variant/
 * location-aware sibling of getAvailableQuantity above, reading the new
 * FinishedGoodsStockBalance cache. Deliberately takes the same shape (a
 * single, specific key) rather than aggregating — "Available" in the fuller
 * Reserved-aware sense (Saleable minus active reservations) is
 * FGI-011/§4.2's own job, built on top of this primitive, not duplicated
 * here.
 */
export async function getFinishedGoodsSaleableQuantity(
  companyId: string,
  productId: string,
  productVariantId: string,
  warehouseId: string,
  warehouseLocationId?: string | null
): Promise<number> {
  const balance = await FinishedGoodsStockBalanceRepository.findOne({
    companyId,
    productId,
    productVariantId,
    warehouseId,
    warehouseLocationId: warehouseLocationId ?? null,
    stockStatus: "SALEABLE",
  });
  return balance ? Number(balance.quantityOnHand) : 0;
}

/**
 * Dye/shade-scoped stock for a fabric material — the flat StockBalance total
 * above is the material's whole stock across every color/shade combined,
 * which overstates what's actually usable for a request line pinned to one
 * shade (e.g. "Available Stock: 100 Mtr" when none of that 100 is actually
 * the requested shade). Only FabricRoll tracks a shade per physical unit of
 * stock, so this sums remaining roll quantity for rolls of this exact dye at
 * this warehouse — via the roll's own GoodsReceiptItem, which carries a
 * required warehouseId (a roll's own warehouseLocationId is optional and
 * can't be relied on for this). Callers should only use this when the
 * material is genuinely a FABRIC (the only category FabricRoll rows exist
 * for) and the line actually specifies a dye — otherwise this would return 0
 * for materials plainly never tracked by the roll, not because none is
 * actually in stock.
 */
/**
 * Available roll quantity for a fabric material at a warehouse, optionally scoped
 * to a specific color and/or dye.
 */
export async function getFabricRollAvailableQuantity(
  companyId: string,
  productId: string,
  warehouseId: string,
  colorId?: string | null,
  dyeId?: string | null
): Promise<number> {
  const result = await prisma.fabricRoll.aggregate({
    where: {
      companyId,
      status: "IN_STOCK",
      goodsReceiptItem: {
        productId,
        warehouseId,
        ...(colorId ? { purchaseOrderItem: { colorId } } : {}),
      },
      ...(dyeId ? { dyeId } : {}),
    },
    _sum: { remainingQuantity: true },
  });
  return Number(result._sum.remainingQuantity ?? 0);
}

export async function getAvailableQuantityByDye(
  companyId: string,
  productId: string,
  warehouseId: string,
  dyeId: string
): Promise<number> {
  const result = await prisma.fabricRoll.aggregate({
    where: {
      companyId,
      dyeId,
      status: "IN_STOCK",
      goodsReceiptItem: { productId, warehouseId },
    },
    _sum: { remainingQuantity: true },
  });
  return Number(result._sum.remainingQuantity ?? 0);
}

/**
 * Bulk Master Data Import portal's Opening Stock row handler (2026-09-04) --
 * the OPENING_BALANCE transaction type has been reserved and unused since
 * this project's earliest planning; this is its first real caller. Opens
 * its own transaction (one per row, matching this feature's row-level
 * isolation) since recordInventoryTransaction() deliberately requires an
 * external tx and never opens one itself. referenceRecordId is the
 * ImportBatch's own id -- there is no other real document behind an
 * opening-stock entry, so the batch that created it IS the reference.
 */
export async function importOpeningStockRow(
  actor: { companyId: string; userId: string; branchId?: string | null },
  input: { productId: string; warehouseId: string; quantity: number; importBatchId: string }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await recordInventoryTransaction(tx, actor, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      transactionType: "OPENING_BALANCE",
      quantity: input.quantity,
      referenceModule: "IMPORT_BATCH",
      referenceRecordId: input.importBatchId,
      notes: "Opening stock — Bulk Master Data Import",
    });
  });
}

/** Returns a Map of productId -> total quantityOnHand across all warehouses,
 * for use by MRP's needed-vs-available comparison. Products with no
 * StockBalance row at all are simply absent from the map (treat as 0). */
export async function sumAvailableByProductIds(companyId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await StockBalanceRepository.sumByProductIds(companyId, productIds);
  return new Map(rows.map((row) => [row.productId, Number(row._sum.quantityOnHand ?? 0)]));
}

export async function listStockBalances(
  companyId: string,
  query: ListQuery,
  filters: { warehouseId?: string } = {},
  // Off by default and deliberately NOT used by the Excel export route (up
  // to EXPORT_ROW_CAP_EXCEL = 20,000 rows) — the on-screen paginated list
  // (≤100 rows/page) is the only caller that opts in, since this derivation
  // costs one extra ledger query per row (see
  // findLocationBreakdownForPair's own doc comment) and running that N+1
  // pattern against 20,000 rows would be a real performance risk, not a
  // theoretical one.
  options: { includeLocationBreakdown?: boolean } = {}
) {
  const where: Prisma.StockBalanceWhereInput = {
    companyId,
    ...(query.search
      ? {
          product: {
            OR: [
              { styleName: { contains: query.search, mode: "insensitive" as const } },
              { styleCode: { contains: query.search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    StockBalanceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    StockBalanceRepository.count(where),
  ]);

  if (!options.includeLocationBreakdown) {
    return { data: rows, totalCount };
  }

  // Real per-location net quantity, not a "most recently touched" guess —
  // one grouped ledger query per row, run in parallel. Fine at this list's
  // own page size (≤100), not a per-request scan of the whole ledger.
  const data = await Promise.all(
    rows.map(async (row) => {
      const locations = await InventoryTransactionRepository.findLocationBreakdownForPair(companyId, row.productId, row.warehouseId);
      return { ...row, locations };
    })
  );

  return { data, totalCount };
}

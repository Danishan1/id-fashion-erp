import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { InventoryTransactionType, Prisma, RelatedModule } from "@prisma/client";
import { InventoryScopeRepository, InventoryTransactionRepository, StockBalanceRepository } from "./inventory.repository";

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
 */
export async function recordInventoryTransaction(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  input: RecordInventoryTransactionInput
): Promise<void> {
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

  await InventoryTransactionRepository.create(tx, {
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
}

/** Available quantity for one product at one specific warehouse — what
 * Material Request's issue action checks against, since issuing must
 * decrement a real warehouse's balance, not a company-wide sum. */
export async function getAvailableQuantity(companyId: string, productId: string, warehouseId: string): Promise<number> {
  const balance = await StockBalanceRepository.findOne(companyId, productId, warehouseId);
  return balance ? Number(balance.quantityOnHand) : 0;
}

/** Returns a Map of productId -> total quantityOnHand across all warehouses,
 * for use by MRP's needed-vs-available comparison. Products with no
 * StockBalance row at all are simply absent from the map (treat as 0). */
export async function sumAvailableByProductIds(companyId: string, productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await StockBalanceRepository.sumByProductIds(companyId, productIds);
  return new Map(rows.map((row) => [row.productId, Number(row._sum.quantityOnHand ?? 0)]));
}

export async function listStockBalances(companyId: string, query: ListQuery, filters: { warehouseId?: string } = {}) {
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

  const [data, totalCount] = await Promise.all([
    StockBalanceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    StockBalanceRepository.count(where),
  ]);

  return { data, totalCount };
}

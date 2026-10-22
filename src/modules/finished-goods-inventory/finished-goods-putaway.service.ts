import { randomUUID } from "node:crypto";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { FinishedGoodsStockBalanceRepository } from "@/modules/inventory/inventory.repository";
import { ProductVariantRepository } from "@/modules/products/product.repository";
import { WarehouseLocationRepository } from "@/modules/warehouses/warehouse.repository";
import { FinishedGoodsPutawayRepository } from "./finished-goods-putaway.repository";
import type { BulkPutawayInput, PutawayStockInput } from "./finished-goods-putaway.schema";

const EPSILON = 0.0001; // matches createLot()'s own LotVariantBreakdown sum-tolerance exactly

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Finished Goods Inventory module (FGI-030) -- every staging
 * (warehouseLocationId = null, real productVariantId, quantityOnHand > 0)
 * FinishedGoodsStockBalance row, the list a Putaway screen (Phase 5,
 * FGI-054) will show a warehouse user to act on.
 */
export async function listStagingBalances(actor: { companyId: string }, filters: { warehouseId?: string } = {}) {
  return FinishedGoodsPutawayRepository.findManyStaging(actor.companyId, filters);
}

/**
 * Finished Goods Inventory module (FGI-030) -- splits one staging balance
 * across one or more real warehouse locations in a single action. Posts
 * N+1 recordInventoryTransaction() calls inside one transaction (one
 * negative entry draining the staging row by the total being moved, one
 * positive entry per destination location) -- never a StockMovement
 * document (per explicit user decision: Putaway is an internal warehouse-
 * organization step, not a commercial movement).
 *
 * Deliberately NOT gated by PermissionService.assert() here -- matching
 * this codebase's own established convention for this exact class of
 * ledger-writing service function (createStockMovement(),
 * createFinishedGoodsReceiptInTx() -- neither asserts a permission
 * internally either; the route layer that will call this in Phase 5 is
 * where that check belongs, exactly as it already works for Stock
 * Movement's own create route).
 *
 * The header's own id is generated client-side (randomUUID()) BEFORE any
 * ledger row posts, specifically so every one of the N+1
 * recordInventoryTransaction() calls can reference it as referenceRecordId
 * -- unlike FinishedGoodsReceipt (which references the Lot, a real
 * pre-existing parent), a standalone Putaway action has no natural parent
 * document to point at instead.
 */
export async function putawayStock(actor: ActorContext, input: PutawayStockInput) {
  // Every destination location must genuinely belong to the SAME warehouse
  // (and the actor's own company) the staging stock sits in -- chokepoint
  // validation, closing the one gap recordInventoryTransaction()'s own
  // product/warehouse checks don't cover (it has no awareness of
  // warehouseLocationId ownership at all).
  for (const allocation of input.allocations) {
    const location = await WarehouseLocationRepository.findByIdWithWarehouse(allocation.warehouseLocationId);
    if (!location || location.warehouse.companyId !== actor.companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Warehouse location not found.", { id: allocation.warehouseLocationId });
    }
    if (location.warehouseId !== input.warehouseId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "Every destination location must belong to the same warehouse the staging stock sits in.",
        { warehouseLocationId: allocation.warehouseLocationId, warehouseId: input.warehouseId }
      );
    }
  }

  // The selected variant must genuinely belong to the selected style --
  // mirrors assertItemFamilyConsistency()'s own identical check in
  // stock-movement.service.ts, closing the same "a different style's
  // variant slipping through" risk for this function's own caller.
  const [variant] = await ProductVariantRepository.findManyByIds([input.productVariantId]);
  if (!variant) {
    throw new BusinessRuleError("NOT_FOUND", "Colour/size variant not found.", { id: input.productVariantId });
  }
  if (variant.productId !== input.productId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "The selected colour/size variant does not belong to the selected style.",
      { productId: input.productId, productVariantId: input.productVariantId }
    );
  }

  const totalQuantity = input.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);

  // Friendly pre-check -- the real, race-safe floor is
  // recordInventoryTransaction()'s own guardedDecrement below (its negative
  // entry at the staging row); this is just a helpful "Available: X" message
  // before any write, the same tradeoff already accepted project-wide for
  // every other manual, low-frequency stock action (Stock Movement,
  // Dispatch's own FG stock check).
  const staging = await FinishedGoodsStockBalanceRepository.findOne({
    companyId: actor.companyId,
    productId: input.productId,
    productVariantId: input.productVariantId,
    warehouseId: input.warehouseId,
    warehouseLocationId: null,
    stockStatus: input.stockStatus,
  });
  const available = staging ? Number(staging.quantityOnHand) : 0;
  if (totalQuantity > available + EPSILON) {
    throw new BusinessRuleError(
      "INSUFFICIENT_STOCK_FOR_MOVEMENT",
      `Cannot put away ${totalQuantity} units -- only ${available} is available in staging for this variant.`,
      { available, requested: totalQuantity }
    );
  }

  const putawayNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "FG_PUTAWAY",
  });
  const putawayId = randomUUID();

  const putaway = await prisma.$transaction(async (tx) => {
    // The one negative entry -- drains the staging row by the total being
    // moved. This is where the REAL guard lives (recordInventoryTransaction's
    // own guardedDecrement), protecting against a concurrent race the
    // pre-check above can't close on its own.
    await recordInventoryTransaction(tx, actor, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      warehouseLocationId: null,
      transactionType: "STOCK_TRANSFER",
      quantity: -totalQuantity,
      referenceModule: "FINISHED_GOODS_PUTAWAY",
      referenceRecordId: putawayId,
      productVariantId: input.productVariantId,
      stockStatus: input.stockStatus,
    });

    const items: { warehouseLocationId: string; quantity: number; inventoryTransactionId: string }[] = [];
    for (const allocation of input.allocations) {
      const ledgerRow = await recordInventoryTransaction(tx, actor, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        warehouseLocationId: allocation.warehouseLocationId,
        transactionType: "STOCK_TRANSFER",
        quantity: allocation.quantity,
        referenceModule: "FINISHED_GOODS_PUTAWAY",
        referenceRecordId: putawayId,
        productVariantId: input.productVariantId,
        stockStatus: input.stockStatus,
      });
      items.push({ warehouseLocationId: allocation.warehouseLocationId, quantity: allocation.quantity, inventoryTransactionId: ledgerRow.id });
    }

    return FinishedGoodsPutawayRepository.createWithItemsInTx(tx, {
      id: putawayId,
      companyId: actor.companyId,
      branchId: actor.branchId ?? null,
      putawayNumber,
      productId: input.productId,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      stockStatus: input.stockStatus,
      // The validated sum of every destination line, never independently
      // recomputed -- the same "one shared input" discipline already
      // established by FinishedGoodsReceipt.totalQuantity (§4.5 point 2).
      totalQuantity,
      performedByUserId: actor.userId,
      items,
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "finished_goods_putaways",
    recordId: putaway.id,
    action: "CREATE",
    newValues: {
      putawayNumber,
      productId: input.productId,
      productVariantId: input.productVariantId,
      warehouseId: input.warehouseId,
      totalQuantity,
      locationCount: input.allocations.length,
    },
  });

  return putaway;
}

/**
 * Unlocated stock (2026-10-22): sets the location for many not-yet-put-away
 * rows in one go. Each row is its own putawayStock() (own document and
 * transaction), so one bad row never blocks the others; the result says
 * which rows were done and why any failed.
 */
export async function bulkPutawayStock(actor: ActorContext, input: BulkPutawayInput) {
  const results: Array<{ index: number; ok: boolean; putawayNumber?: string; error?: string }> = [];
  for (const [index, row] of input.rows.entries()) {
    try {
      const putaway = await putawayStock(actor, {
        productId: row.productId,
        productVariantId: row.productVariantId,
        warehouseId: row.warehouseId,
        stockStatus: row.stockStatus,
        allocations: [{ warehouseLocationId: row.warehouseLocationId, quantity: row.quantity }],
      });
      results.push({ index, ok: true, putawayNumber: putaway.putawayNumber });
    } catch (error) {
      results.push({
        index,
        ok: false,
        error: error instanceof BusinessRuleError ? error.message : "Could not update this row.",
      });
    }
  }
  return {
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

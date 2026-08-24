import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { getAvailableQuantity, recordInventoryTransaction } from "./inventory.service";
import { StockMovementRepository } from "./stock-movement.repository";
import type { CreateStockMovementInput } from "./stock-movement.schema";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const INVENTORY_TRANSACTION_TYPE_BY_MOVEMENT_TYPE = {
  TRANSFER: "STOCK_TRANSFER",
  ADJUSTMENT: "ADJUSTMENT",
  RETURN_TO_SUPPLIER: "RETURN_TO_SUPPLIER",
} as const;

export async function listStockMovements(companyId: string, query: ListQuery) {
  const where: Prisma.StockMovementWhereInput = {
    companyId,
    ...(query.search ? { movementNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    StockMovementRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    StockMovementRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getStockMovementById(companyId: string, id: string) {
  const movement = await StockMovementRepository.findByIdWithDetails(companyId, id);
  if (!movement) throw new BusinessRuleError("NOT_FOUND", "Stock movement not found.", { id });
  return movement;
}

/**
 * Every StockMovement, regardless of movementType, is one document that
 * posts to the shared ledger via recordInventoryTransaction() — never
 * arithmetic on StockBalance directly (this project's own established
 * discipline). Immutable once created: a mistake is corrected with a new,
 * opposite-direction StockMovement, matching the "no delete column on
 * inventory transactional tables" convention rather than an edit/reversal
 * endpoint on this one.
 */
export async function createStockMovement(actor: ActorContext, input: CreateStockMovementInput) {
  // TRANSFER/RETURN_TO_SUPPLIER always remove stock from `warehouseId`;
  // ADJUSTMENT only removes stock when a line's signed quantity is negative
  // (shrinkage/write-off) — a positive adjustment (stock found) never needs
  // this check. Checked up front, before any write, since this is a manual,
  // low-frequency, reviewed action (the same tradeoff Material Request's own
  // issue-from-stock check already accepted) rather than a hot concurrent
  // path needing a DB-level guard.
  for (const item of input.items) {
    const removesStock = input.movementType !== "ADJUSTMENT" || item.quantity < 0;
    if (!removesStock) continue;
    const removedQuantity = Math.abs(item.quantity);
    const available = await getAvailableQuantity(actor.companyId, item.productId, input.warehouseId);
    if (removedQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_STOCK_FOR_MOVEMENT",
        `Cannot move ${removedQuantity} units of this material out of the selected warehouse — only ${available} is available.`,
        { productId: item.productId, warehouseId: input.warehouseId, available, requested: removedQuantity }
      );
    }
  }

  const movementNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "STOCK_MOVEMENT",
  });

  const inventoryTransactionType = INVENTORY_TRANSACTION_TYPE_BY_MOVEMENT_TYPE[input.movementType];

  const movement = await prisma.$transaction(async (tx) => {
    const created = await StockMovementRepository.createWithItems(
      tx,
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        movementNumber,
        movementType: input.movementType,
        warehouseId: input.warehouseId,
        toWarehouseId: input.movementType === "TRANSFER" ? input.toWarehouseId || null : null,
        supplierId: input.movementType === "RETURN_TO_SUPPLIER" ? input.supplierId || null : null,
        reason: input.reason || null,
        remarks: input.remarks || null,
        performedByUserId: actor.userId,
      },
      input.items.map((item) => ({
        productId: item.productId,
        uomId: item.uomId,
        quantity: item.quantity,
        remarks: item.remarks || null,
      }))
    );

    for (const item of input.items) {
      if (input.movementType === "TRANSFER") {
        // One document, two ledger entries — stock leaves the source and
        // lands at the destination inside the same transaction, so the two
        // sides can never observably disagree (no window where the stock is
        // "nowhere," even under a mid-write crash — the transaction as a
        // whole either commits both or neither).
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: input.warehouseId,
          transactionType: inventoryTransactionType,
          quantity: -item.quantity,
          referenceModule: "STOCK_MOVEMENT",
          referenceRecordId: created.id,
        });
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: input.toWarehouseId!,
          transactionType: inventoryTransactionType,
          quantity: item.quantity,
          referenceModule: "STOCK_MOVEMENT",
          referenceRecordId: created.id,
        });
      } else if (input.movementType === "RETURN_TO_SUPPLIER") {
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: input.warehouseId,
          transactionType: inventoryTransactionType,
          quantity: -item.quantity,
          referenceModule: "STOCK_MOVEMENT",
          referenceRecordId: created.id,
        });
      } else {
        // ADJUSTMENT — the item's own signed quantity carries the meaning
        // (positive = found, negative = written off), posted as-is.
        await recordInventoryTransaction(tx, actor, {
          productId: item.productId,
          warehouseId: input.warehouseId,
          transactionType: inventoryTransactionType,
          quantity: item.quantity,
          referenceModule: "STOCK_MOVEMENT",
          referenceRecordId: created.id,
        });
      }
    }

    return created;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "stock_movements",
    recordId: movement.id,
    action: "CREATE",
    newValues: { movementNumber, movementType: input.movementType, warehouseId: input.warehouseId, itemCount: input.items.length },
  });

  return movement;
}

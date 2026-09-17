import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { StockMovementType, type Prisma } from "@prisma/client";
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

const VALID_STOCK_MOVEMENT_TYPES = new Set<string>(Object.values(StockMovementType));

/**
 * `movementType` (TRANSFER/ADJUSTMENT/RETURN_TO_SUPPLIER) is this model's own
 * status-shaped filter, but it isn't called "status" and ListQuery only
 * parses the generic `?status=` param — so the route reads `?movementType=`
 * itself and passes the raw string through here, validated against the real
 * runtime enum object before it can reach Prisma's `where`, same discipline
 * as every other status/type filter in this codebase.
 */
export async function listStockMovements(
  actor: { companyId: string; userId: string },
  query: ListQuery,
  movementType?: string
) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.StockMovementWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { movementNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(movementType && VALID_STOCK_MOVEMENT_TYPES.has(movementType)
      ? { movementType: movementType as StockMovementType }
      : {}),
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

/** A branch-restricted user gets NOT_FOUND for a movement outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getStockMovementById(actor: { companyId: string; userId: string }, id: string) {
  const movement = await StockMovementRepository.findByIdWithDetails(actor.companyId, id);
  if (!movement) throw new BusinessRuleError("NOT_FOUND", "Stock movement not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!movement.branchId || !allowedBranchIds.has(movement.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Stock movement not found.", { id });
  }

  return movement;
}

/**
 * Converts every line's quantity into its material's own base UOM before it
 * can reach the ledger. Stock Movement previously posted the raw as-entered
 * number regardless of the chosen unit — the one ledger-writing module (with
 * Job Work Order) that skipped this, unlike Purchase Order/Goods
 * Receipt/Material Request, which all convert. A mismatched unit here would
 * silently corrupt StockBalance against every other module's base-UOM
 * assumption. Returns the converted quantities in the same order as
 * `items`; `StockMovementItem.quantity` itself is left in the originally
 * entered unit (the commercial record), matching Goods Receipt's own
 * "document keeps the original unit, ledger keeps base UOM" precedent.
 */
async function convertItemsToBaseUom(companyId: string, items: CreateStockMovementInput["items"]): Promise<number[]> {
  const baseQuantities: number[] = [];
  for (const item of items) {
    const material = await ProductRepository.findMaterialById(companyId, item.productId);
    if (!material) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id: item.productId });
    if (!material.baseUom) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${material.styleName}" has no base unit configured — cannot record stock for it.`,
        { productId: item.productId }
      );
    }
    if (item.uomId === material.baseUom.id) {
      baseQuantities.push(item.quantity);
      continue;
    }
    const chosenUom = await LookupRepository.unit.findUnique({ where: { id: item.uomId } });
    if (!chosenUom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: item.uomId });
    const converted = convertUomQuantity(item.quantity, chosenUom, material.baseUom);
    if (converted === null) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${chosenUom.name}" has no fixed conversion to "${material.styleName}"'s base unit ("${material.baseUom.name}") — pick a convertible unit.`,
        { productId: item.productId, uomId: item.uomId }
      );
    }
    baseQuantities.push(converted);
  }
  return baseQuantities;
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
  // CF-5: a network retry or double-click resubmitting the identical create
  // call must return the ORIGINAL movement, not post a second one — checked
  // before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await StockMovementRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  // Convert every line to its material's base UOM up front (pure
  // computation, no writes yet) — everything downstream (the availability
  // check and every ledger post) must speak base UOM, matching every other
  // ledger-writing module's convention.
  const baseQuantities = await convertItemsToBaseUom(actor.companyId, input.items);

  // TRANSFER/RETURN_TO_SUPPLIER always remove stock from `warehouseId`;
  // ADJUSTMENT only removes stock when a line's signed quantity is negative
  // (shrinkage/write-off) — a positive adjustment (stock found) never needs
  // this check. Checked up front, before any write, since this is a manual,
  // low-frequency, reviewed action (the same tradeoff Material Request's own
  // issue-from-stock check already accepted) rather than a hot concurrent
  // path needing a DB-level guard — the atomic floor guard inside
  // recordInventoryTransaction() is the real backstop against a race.
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const baseQuantity = baseQuantities[i];
    const removesStock = input.movementType !== "ADJUSTMENT" || baseQuantity < 0;
    if (!removesStock) continue;
    const removedQuantity = Math.abs(baseQuantity);
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

  let movement;
  try {
    movement = await prisma.$transaction(async (tx) => {
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
          idempotencyKey: input.idempotencyKey ?? null,
        },
        input.items.map((item) => ({
          productId: item.productId,
          uomId: item.uomId,
          quantity: item.quantity,
          remarks: item.remarks || null,
          warehouseLocationId: item.warehouseLocationId || null,
        }))
      );

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const baseQuantity = baseQuantities[i];
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
            quantity: -baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
            // Source-side only — the destination side of a Transfer has no
            // location field this pass (see the schema's own doc comment).
            warehouseLocationId: item.warehouseLocationId || null,
          });
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: input.toWarehouseId!,
            transactionType: inventoryTransactionType,
            quantity: baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
          });
        } else if (input.movementType === "RETURN_TO_SUPPLIER") {
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: input.warehouseId,
            transactionType: inventoryTransactionType,
            quantity: -baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
            warehouseLocationId: item.warehouseLocationId || null,
          });
        } else {
          // ADJUSTMENT — the item's own signed quantity carries the meaning
          // (positive = found, negative = written off), posted as-is (already
          // base-UOM converted, sign preserved by convertUomQuantity).
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: input.warehouseId,
            transactionType: inventoryTransactionType,
            quantity: baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
            warehouseLocationId: item.warehouseLocationId || null,
          });
        }
      }

      return created;
    });
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical
    // fallback for the full rationale.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await StockMovementRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

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

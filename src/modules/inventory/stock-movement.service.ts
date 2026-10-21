import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository, ProductVariantRepository } from "@/modules/products/product.repository";
import { StockMovementStatus, StockMovementType, type Prisma } from "@prisma/client";
import { getAvailableQuantity, getFinishedGoodsSaleableQuantity, getRawMaterialStockByLocation, recordInventoryTransaction } from "./inventory.service";
import { getFgInventorySettings, adjustmentNeedsApproval } from "@/core/fg-inventory-settings/FgInventorySettingsService";
import { StockMovementRepository } from "./stock-movement.repository";
import type { CreateStockMovementInput, ReceiveStockMovementInput } from "./stock-movement.schema";

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
const VALID_STOCK_MOVEMENT_STATUSES = new Set<string>(Object.values(StockMovementStatus));

export interface StockMovementListFilters {
  movementType?: string;
  /** POSTED / IN_TRANSIT / RECEIVED — the receive page lists IN_TRANSIT. */
  status?: string;
  /** Destination warehouse of a Transfer. */
  toWarehouseId?: string;
}

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
  filters: StockMovementListFilters = {}
) {
  const { movementType, status, toWarehouseId } = filters;
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.StockMovementWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { movementNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(movementType && VALID_STOCK_MOVEMENT_TYPES.has(movementType)
      ? { movementType: movementType as StockMovementType }
      : {}),
    ...(status && VALID_STOCK_MOVEMENT_STATUSES.has(status) ? { status: status as StockMovementStatus } : {}),
    ...(toWarehouseId ? { toWarehouseId } : {}),
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
 * can reach the ledger. Raw-material lines only — a Finished Goods line
 * never reaches this function at all (see createStockMovement()'s own
 * branch), since a Style has no base UOM the way a raw material does;
 * garments are always tracked in whole pieces. Stock Movement previously
 * posted the raw as-entered number regardless of the chosen unit — the one
 * ledger-writing module (with Job Work Order) that skipped this, unlike
 * Purchase Order/Goods Receipt/Material Request, which all convert. A
 * mismatched unit here would silently corrupt StockBalance against every
 * other module's base-UOM assumption. Returns the converted quantities in
 * the same order as `items`; `StockMovementItem.quantity` itself is left in
 * the originally entered unit (the commercial record), matching Goods
 * Receipt's own "document keeps the original unit, ledger keeps base UOM"
 * precedent.
 */
async function convertItemsToBaseUom(
  companyId: string,
  items: Array<Pick<CreateStockMovementInput["items"][number], "productId" | "uomId" | "quantity">>
): Promise<number[]> {
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
 * Finished Goods Inventory module (FGI-014) — the real, DB-backed half of
 * the item-type-family defense (Decision 2/§4.4). Zod's own refine()s in
 * stock-movement.schema.ts can only check the document's SHAPE against
 * whatever itemFamily the caller claims (Zod has no DB access); this is what
 * actually confirms every line's real `Product.itemType` matches that claim
 * — closing the exact risk the schema layer alone can't catch: a forged or
 * simply wrong `itemFamily` value, or a document that genuinely mixes both
 * families (every line must match the SAME expected item type, not just the
 * first one — a naive "check the first line only" implementation would miss
 * a mix). For a Finished Goods document, also confirms every line's
 * `productVariantId` genuinely belongs to that same line's `productId` —
 * a different style's variant slipping through would silently post stock
 * against the wrong SKU.
 */
async function assertItemFamilyConsistency(
  companyId: string,
  itemFamily: CreateStockMovementInput["itemFamily"],
  items: CreateStockMovementInput["items"]
): Promise<void> {
  const productIds = items.map((item) => item.productId);
  const products = await ProductRepository.findManyItemTypesByIds(companyId, productIds);
  const itemTypeById = new Map(products.map((p) => [p.id, p.itemType]));

  const expectedItemType = itemFamily === "FINISHED_GOODS" ? "STYLE" : "RAW_MATERIAL";
  for (const item of items) {
    const itemType = itemTypeById.get(item.productId);
    if (!itemType) {
      throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id: item.productId });
    }
    if (itemType !== expectedItemType) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `This stock movement is marked as ${itemFamily === "FINISHED_GOODS" ? "Finished Goods" : "Raw Material"}, but one of its lines is a different item type. A single stock movement cannot mix raw materials and finished goods.`,
        { productId: item.productId, expectedItemType, actualItemType: itemType }
      );
    }
  }

  if (itemFamily !== "FINISHED_GOODS") return;

  const variantIds = items.map((item) => item.productVariantId).filter((id): id is string => !!id);
  const variants = await ProductVariantRepository.findManyByIds(variantIds);
  const productIdByVariantId = new Map(variants.map((v) => [v.id, v.productId]));
  for (const item of items) {
    const variantProductId = productIdByVariantId.get(item.productVariantId!);
    if (!variantProductId) {
      throw new BusinessRuleError("NOT_FOUND", "Variant not found.", { id: item.productVariantId });
    }
    if (variantProductId !== item.productId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "The selected colour/size variant does not belong to this line's style.",
        { productId: item.productId, productVariantId: item.productVariantId }
      );
    }
  }
}

/**
 * Every StockMovement, regardless of movementType, is one document that
 * posts to the shared ledger via recordInventoryTransaction() — never
 * arithmetic on StockBalance directly (this project's own established
 * discipline). Immutable once created: a mistake is corrected with a new,
 * opposite-direction StockMovement, matching the "no delete column on
 * inventory transactional tables" convention rather than an edit/reversal
 * endpoint on this one.
 *
 * Finished Goods Inventory module (FGI-014) — `input.itemFamily` branches
 * the whole function between the original, byte-for-byte-unchanged
 * raw-material path (UOM conversion via convertItemsToBaseUom(), the flat
 * getAvailableQuantity() pre-check) and a new, parallel finished-goods path
 * (no UOM conversion — garments are always whole pieces; the variant-scoped
 * getFinishedGoodsSaleableQuantity() pre-check). Both paths ultimately post
 * through the SAME recordInventoryTransaction() call, which already knows
 * how to also update FinishedGoodsStockBalance when productVariantId/
 * stockStatus are supplied (FGI-010) — so there is no double-counting risk
 * here the way FGI-012 had to design around: each item posts through
 * exactly one recordInventoryTransaction() call per ledger entry, never two.
 */
export async function createStockMovement(actor: ActorContext, input: CreateStockMovementInput) {
  // CF-5: a network retry or double-click resubmitting the identical create
  // call must return the ORIGINAL movement, not post a second one — checked
  // before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await StockMovementRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  // Finished Goods Inventory module (FGI-014) — the real, DB-backed
  // item-type-family check, before anything else is touched.
  await assertItemFamilyConsistency(actor.companyId, input.itemFamily, input.items);

  const isFinishedGoods = input.itemFamily === "FINISHED_GOODS";

  // Raw material: convert every line to its base UOM up front (pure
  // computation, no writes yet) — everything downstream (the availability
  // check and every ledger post) must speak base UOM, matching every other
  // ledger-writing module's convention. Finished goods: no conversion needed
  // — see convertItemsToBaseUom()'s own doc comment.
  const baseQuantities = isFinishedGoods
    ? input.items.map((item) => item.quantity)
    : await convertItemsToBaseUom(actor.companyId, input.items);

  // TRANSFER/RETURN_TO_SUPPLIER always remove stock from `warehouseId`;
  // ADJUSTMENT only removes stock when a line's signed quantity is negative
  // (shrinkage/write-off) — a positive adjustment (stock found) never needs
  // this check. Checked up front, before any write, since this is a manual,
  // low-frequency, reviewed action (the same tradeoff Material Request's own
  // issue-from-stock check already accepted) rather than a hot concurrent
  // path needing a DB-level guard — the atomic floor guard inside
  // recordInventoryTransaction() is the real backstop against a race.
  // Finished Goods Inventory module (FGI-032) -- for a Finished Goods
  // Adjustment, every line's real current balance is captured here (null
  // for everything else), including a positive ("stock found") line the
  // original availability pre-check never had a reason to fetch -- the new
  // approval-threshold gate right after this loop needs it for both
  // directions, since a suspiciously large "found" adjustment is just as
  // worth a second sign-off as a large write-off.
  const availabilityByIndex: (number | null)[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const baseQuantity = baseQuantities[i];
    const removesStock = input.movementType !== "ADJUSTMENT" || baseQuantity < 0;
    const needsAvailabilityForApprovalCheck = isFinishedGoods && input.movementType === "ADJUSTMENT";
    if (!removesStock && !needsAvailabilityForApprovalCheck) {
      availabilityByIndex.push(null);
      continue;
    }
    const removedQuantity = Math.abs(baseQuantity);
    const available = isFinishedGoods
      ? await getFinishedGoodsSaleableQuantity(
          actor.companyId,
          item.productId,
          item.productVariantId!,
          input.warehouseId,
          item.warehouseLocationId || null
        )
      : await getAvailableQuantity(actor.companyId, item.productId, input.warehouseId);
    availabilityByIndex.push(available);
    if (removesStock && removedQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_STOCK_FOR_MOVEMENT",
        `Cannot move ${removedQuantity} units of this ${isFinishedGoods ? "variant" : "material"} out of the selected warehouse — only ${available} is available.`,
        { productId: item.productId, warehouseId: input.warehouseId, available, requested: removedQuantity }
      );
    }
    // Raw material taken out of a specific location: that location must hold
    // it (2026-10-21 — the Send page lists only locations holding the material).
    if (removesStock && !isFinishedGoods && item.warehouseLocationId) {
      const byLocation = await getRawMaterialStockByLocation(actor.companyId, item.productId, input.warehouseId);
      const atLocation = byLocation.locations.find((l) => l.warehouseLocationId === item.warehouseLocationId);
      const atLocationQty = atLocation?.quantity ?? 0;
      if (removedQuantity > atLocationQty + 1e-6) {
        throw new BusinessRuleError(
          "INSUFFICIENT_STOCK_FOR_MOVEMENT",
          `Cannot move ${removedQuantity} out of location ${atLocation?.code ?? "the selected location"} — only ${atLocationQty} of this material is there.`,
          { productId: item.productId, warehouseLocationId: item.warehouseLocationId, available: atLocationQty, requested: removedQuantity }
        );
      }
    }
  }

  // Finished Goods Inventory module (FGI-032) -- Stock Adjustment approval
  // gate, Finished-Goods-only (per explicit confirmed decision) -- this
  // branch never runs for a raw-material Adjustment or any Transfer/Return
  // to Supplier, so the existing raw-material flow is completely untouched.
  if (isFinishedGoods && input.movementType === "ADJUSTMENT") {
    const settings = await getFgInventorySettings(actor.companyId);
    const lines = input.items.map((_item, i) => ({ quantity: baseQuantities[i], currentAvailable: availabilityByIndex[i] ?? 0 }));
    if (adjustmentNeedsApproval(settings, lines)) {
      // Deliberately NOT self-approval-guarded (no resourceContext.createdBy)
      // -- unlike Dispatch's own two-phase Draft->Packed->Confirm lifecycle
      // (where extraDispatchNeedsApproval's own usage genuinely compares a
      // DIFFERENT confirming actor against the order's own real
      // requestedByUserId, captured at an earlier point in time), a Stock
      // Adjustment is a single, atomic, one-shot create-is-post action with
      // no separate "requester" identity to compare against -- createdBy
      // would always equal the CURRENT actor trivially, which would make
      // this gate unusable by anyone but SUPER_ADMIN. Gating on the
      // "approve" action alone still achieves the real intent (a more
      // senior/different role must be the one to actually submit a
      // threshold-crossing adjustment) without requiring a two-phase
      // workflow Stock Movement was never built to have.
      await PermissionService.assert(actor.userId, "fg_inventory", "approve");
    }
  }

  const movementNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "STOCK_MOVEMENT",
  });

  const inventoryTransactionType = INVENTORY_TRANSACTION_TYPE_BY_MOVEMENT_TYPE[input.movementType];
  // A raw-material Transfer is sent now and received later (receiveStockMovement).
  const isSendOnlyTransfer = input.movementType === "TRANSFER" && !isFinishedGoods;

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
          status: isSendOnlyTransfer ? "IN_TRANSIT" : "POSTED",
        },
        input.items.map((item) => ({
          productId: item.productId,
          uomId: item.uomId,
          quantity: item.quantity,
          remarks: item.remarks || null,
          warehouseLocationId: item.warehouseLocationId || null,
          // Finished Goods Inventory module (FGI-014) — both null for a
          // raw-material line, exactly as before this task.
          productVariantId: item.productVariantId || null,
          // Raw-material Transfer: the destination location is picked by the
          // receiver, never on the Send page.
          toWarehouseLocationId: isSendOnlyTransfer ? null : item.toWarehouseLocationId || null,
        }))
      );

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        const baseQuantity = baseQuantities[i];
        // Finished Goods Inventory module (FGI-014) — spread onto every
        // recordInventoryTransaction() call below only for a Finished Goods
        // document; `{}` for raw material, so those calls are byte-for-byte
        // identical to before this task.
        const fgFields = isFinishedGoods ? { productVariantId: item.productVariantId!, stockStatus: "SALEABLE" as const } : {};

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
            // Source-side only for raw material — the destination side of a
            // raw-material Transfer still has no location field this pass,
            // exactly as before this task.
            warehouseLocationId: item.warehouseLocationId || null,
            ...fgFields,
          });
          // Raw material: the destination side is posted by
          // receiveStockMovement() once the receiver picks a location; until
          // then the stock is in transit and counts in neither warehouse.
          if (isSendOnlyTransfer) continue;
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: input.toWarehouseId!,
            transactionType: inventoryTransactionType,
            quantity: baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
            // Finished Goods Inventory module (FGI-014, Decision 2/§4.4) —
            // the destination side's own location, now wired up for a
            // Finished Goods Transfer. Raw material keeps no destination
            // location, unchanged.
            warehouseLocationId: isFinishedGoods ? item.toWarehouseLocationId || null : null,
            ...fgFields,
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
            ...fgFields,
          });
        } else {
          // ADJUSTMENT — the item's own signed quantity carries the meaning
          // (positive = found, negative = written off), posted as-is (already
          // base-UOM converted for raw material, or passed through as-entered
          // for finished goods, sign preserved either way).
          await recordInventoryTransaction(tx, actor, {
            productId: item.productId,
            warehouseId: input.warehouseId,
            transactionType: inventoryTransactionType,
            quantity: baseQuantity,
            referenceModule: "STOCK_MOVEMENT",
            referenceRecordId: created.id,
            warehouseLocationId: item.warehouseLocationId || null,
            ...fgFields,
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
    newValues: {
      movementNumber,
      movementType: input.movementType,
      itemFamily: input.itemFamily,
      warehouseId: input.warehouseId,
      itemCount: input.items.length,
      status: movement.status,
    },
  });

  return movement;
}

/**
 * Receive an in-transit raw-material Transfer (2026-10-21). The receiver must
 * pick a destination location for every line; only then is the destination
 * side posted to the ledger (base unit, at that location) and the movement
 * marked RECEIVED. The status flip is a guarded update inside the same
 * transaction, so a double click or two receivers can't post it twice.
 */
export async function receiveStockMovement(actor: ActorContext, id: string, input: ReceiveStockMovementInput) {
  const movement = await getStockMovementById(actor, id);
  if (movement.movementType !== "TRANSFER" || movement.status !== "IN_TRANSIT" || !movement.toWarehouseId) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      movement.status === "RECEIVED" ? "This transfer has already been received." : "Only an in-transit transfer can be received.",
      { status: movement.status }
    );
  }
  const toWarehouseId = movement.toWarehouseId;

  const locationByItem = new Map(input.items.map((i) => [i.itemId, i.toWarehouseLocationId]));
  const unknown = input.items.filter((i) => !movement.items.some((item) => item.id === i.itemId));
  if (unknown.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A line does not belong to this transfer.", { itemIds: unknown.map((u) => u.itemId) });
  }
  const missing = movement.items.filter((item) => !locationByItem.get(item.id));
  if (missing.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Pick a destination location for every line before receiving (missing: ${missing.map((m) => m.product.styleName).join(", ")}).`,
      { itemIds: missing.map((m) => m.id) }
    );
  }

  const locationIds = Array.from(new Set(locationByItem.values()));
  const validLocations = await prisma.warehouseLocation.findMany({
    where: { id: { in: locationIds }, warehouseId: toWarehouseId, isActive: true, warehouse: { companyId: actor.companyId } },
    select: { id: true },
  });
  if (validLocations.length !== locationIds.length) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Every destination location must be an active location of ${movement.toWarehouse?.name ?? "the destination warehouse"}.`,
      { locationIds }
    );
  }

  const baseQuantities = await convertItemsToBaseUom(
    actor.companyId,
    movement.items.map((item) => ({ productId: item.productId, uomId: item.uomId, quantity: Number(item.quantity) }))
  );

  await prisma.$transaction(async (tx) => {
    const flipped = await tx.stockMovement.updateMany({
      where: { id: movement.id, companyId: actor.companyId, status: "IN_TRANSIT" },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedByUserId: actor.userId },
    });
    if (flipped.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This transfer has already been received.", { id });
    }
    for (let i = 0; i < movement.items.length; i++) {
      const item = movement.items[i];
      const toWarehouseLocationId = locationByItem.get(item.id)!;
      await tx.stockMovementItem.update({ where: { id: item.id }, data: { toWarehouseLocationId } });
      await recordInventoryTransaction(tx, actor, {
        productId: item.productId,
        warehouseId: toWarehouseId,
        transactionType: "STOCK_TRANSFER",
        quantity: baseQuantities[i],
        referenceModule: "STOCK_MOVEMENT",
        referenceRecordId: movement.id,
        warehouseLocationId: toWarehouseLocationId,
      });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "stock_movements",
    recordId: movement.id,
    action: "UPDATE",
    oldValues: { status: "IN_TRANSIT" },
    newValues: { status: "RECEIVED", locations: Object.fromEntries(locationByItem) },
  });

  return getStockMovementById(actor, id);
}

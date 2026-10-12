import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { logger } from "@/core/logging/logger";
import { replaceCartonBarcodes } from "@/core/barcode/barcode.service";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { DispatchStatus, type Prisma } from "@prisma/client";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { ForwarderRepository } from "@/modules/forwarders/forwarder.repository";
import { recordInventoryTransaction, getAvailableQuantity } from "@/modules/inventory/inventory.service";
import { getDispatchSettings, extraDispatchNeedsApproval, type DispatchSettingsValue } from "@/core/dispatch-settings/DispatchSettingsService";
import type { DispatchInput, UpdateDispatchInput, SetCartonsInput } from "./dispatch.schema";
import { DispatchRepository } from "./dispatch.repository";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

// A Dispatch may be created against an order that's CONFIRMED (the normal
// case), still PARTIALLY_DISPATCHED (a prior Dispatch already shipped part
// of it), already INVOICED (advance billing before shipment — a real,
// deliberately-supported ordering, not assumed to only happen after
// shipment), or already DISPATCHED.
//
// DISPATCHED was originally excluded here ("nothing left to ship") before
// Extra Dispatch Quantity existed — with it, that's no longer true: an
// order the Regular fulfillment logic already considers fully shipped can
// still legitimately need a further shipment (a replacement, a free/FOC
// piece, an extra sample) entirely as Extra. Re-including DISPATCHED here
// doesn't weaken anything — buildDispatchItems() still computes Regular=0
// for every line on such an order (remaining is already 0), so the whole
// quantity is forced through the Extra path: a reason is still required,
// the allowExtraDispatch/approval settings still apply, and Regular
// fulfillment (already 100%) is untouched.
const DISPATCH_ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED", "DISPATCHED"] as const;

/**
 * ON_HOLD is reachable only from DRAFT/PACKED — post-dispatch "hold" doesn't
 * correspond to a real floor action once goods have left (matching
 * Purchasing's own lesson: don't let CANCELLED-from-ON_HOLD reachability
 * quietly widen later). CANCELLED is independently and unconditionally
 * guarded at cancel time by whether `dispatchedAt` is set (see
 * cancelDispatch below) — this map is not the only line of defense.
 */
const ALLOWED_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  DRAFT: ["ON_HOLD", "CANCELLED"],
  PACKED: ["ON_HOLD", "CANCELLED"],
  DISPATCHED: [],
  DELIVERED: [],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
};

interface OrderItemLike {
  id: string;
  productId: string;
  // TOTAL physical quantity ever dispatched (regular + extra) — kept for
  // reference/display; NOT what remaining-to-dispatch is computed from
  // anymore (see regularDispatchedQuantity below).
  dispatchedQuantity: number;
  // Extra Dispatch Quantity (2026-09-30) — the portion of dispatchedQuantity
  // that counts toward Sale Order fulfillment; this is what "remaining"
  // must be based on, per the spec's own invariant ("Sale Order Fulfillment
  // = Regular Dispatch Only").
  regularDispatchedQuantity: number;
  breakdown: Array<{ orderedQuantity: number }>;
}

function orderedTotalOf(item: OrderItemLike): number {
  return item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
}

/** Remaining Order Qty = MAX(0, SO Qty - Already Regular Dispatched Qty). */
function remainingToDispatch(item: OrderItemLike): number {
  return Math.max(0, orderedTotalOf(item) - item.regularDispatchedQuantity);
}

/**
 * Extra Dispatch Quantity's own cumulative-Regular split (2026-09-30) —
 * NOT `MAX(0, dispatchQty - orderedTotal)`, which is wrong the instant a
 * second dispatch exists against the same line (see the spec's own
 * DSP-001/DSP-002 worked example). Regular is capped by what's genuinely
 * still remaining against the order right now; anything past that is Extra.
 */
function splitRegularExtra(item: OrderItemLike, dispatchQty: number): { regularQty: number; extraQty: number } {
  const remaining = remainingToDispatch(item);
  const regularQty = Math.min(dispatchQty, remaining);
  const extraQty = Math.max(0, dispatchQty - remaining);
  return { regularQty, extraQty };
}

async function buildDispatchItems(
  orderItems: OrderItemLike[],
  inputItems: DispatchInput["items"],
  settings: DispatchSettingsValue
) {
  const itemsById = new Map(orderItems.map((i) => [i.id, i]));
  const items = [];
  for (const line of inputItems) {
    const orderItem = itemsById.get(line.salesOrderItemId);
    if (!orderItem) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "One or more lines do not belong to the selected sales order.",
        { salesOrderItemId: line.salesOrderItemId }
      );
    }

    const { regularQty, extraQty } = splitRegularExtra(orderItem, line.dispatchedQuantity);

    if (extraQty > 0) {
      if (!settings.allowExtraDispatch) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot dispatch ${line.dispatchedQuantity} for this line — only ${regularQty} remains against the sales order, and Extra Dispatch is disabled for this company.`,
          { salesOrderItemId: line.salesOrderItemId, requestedQuantity: line.dispatchedQuantity, remaining: regularQty }
        );
      }
      // "Extra Qty > 0 -> Extra Reason Required" (the spec's own invariant) —
      // enforced HERE, not in Zod, since the split above is only knowable
      // once the order's own cumulative Regular total is read; Zod's own
      // remarks-required-when-OTHER rule already ran on the raw input.
      if (!line.extraDispatchReason) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `${extraQty} of this line's ${line.dispatchedQuantity} pieces is Extra (beyond the ${regularQty} remaining on the sales order) — an Extra Dispatch Reason is required.`,
          { salesOrderItemId: line.salesOrderItemId, regularQty, extraQty }
        );
      }
    }

    items.push({
      salesOrderItemId: orderItem.id,
      productId: orderItem.productId,
      dispatchedQuantity: line.dispatchedQuantity,
      regularDispatchQuantity: regularQty,
      extraDispatchQuantity: extraQty,
      extraDispatchReason: extraQty > 0 ? (line.extraDispatchReason ?? null) : null,
      extraDispatchRemarks: extraQty > 0 ? (line.extraDispatchRemarks?.trim() || null) : null,
    });
  }
  return items;
}

const VALID_DISPATCH_STATUSES = new Set<string>(Object.values(DispatchStatus));

export async function listDispatches(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.DispatchWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { dispatchNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_DISPATCH_STATUSES.has(query.status) ? { status: query.status as DispatchStatus } : {}),
  };

  const [data, totalCount] = await Promise.all([
    DispatchRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    DispatchRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a dispatch outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getDispatchById(actor: { companyId: string; userId: string }, id: string) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!dispatch.branchId || !allowedBranchIds.has(dispatch.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });
  }

  return dispatch;
}

/**
 * Stock check at Draft time (create/edit), not just at Confirm — a Dispatch
 * should never be saved for more pieces than the chosen warehouse actually
 * holds. Pieces already sitting on OTHER open (Draft/Packed) dispatches from
 * the same warehouse are treated as spoken for, so two drafts can't both
 * claim the same stock. Confirm still re-checks against live stock.
 */
export interface DispatchableStock {
  onHand: number;
  reserved: number;
  available: number;
}

/** Per-style Finished Goods stock at a warehouse, minus what other open (Draft/Packed) dispatches already claim. */
export async function getDispatchableStock(
  companyId: string,
  warehouseId: string,
  productIds: string[],
  excludeDispatchId?: string
): Promise<Map<string, DispatchableStock>> {
  const result = new Map<string, DispatchableStock>();
  for (const productId of new Set(productIds)) {
    const onHand = await getAvailableQuantity(companyId, productId, warehouseId);
    const reservedAgg = await prisma.dispatchItem.aggregate({
      where: {
        productId,
        dispatch: {
          companyId,
          warehouseId,
          status: { in: ["DRAFT", "PACKED"] },
          ...(excludeDispatchId ? { id: { not: excludeDispatchId } } : {}),
        },
      },
      _sum: { dispatchedQuantity: true },
    });
    const reserved = Number(reservedAgg._sum.dispatchedQuantity ?? 0);
    result.set(productId, { onHand, reserved, available: Math.max(0, onHand - reserved) });
  }
  return result;
}

async function assertFinishedGoodsAvailable(
  companyId: string,
  warehouseId: string,
  items: Array<{ productId: string; dispatchedQuantity: number }>,
  excludeDispatchId?: string
) {
  const requestedByProduct = new Map<string, number>();
  for (const item of items) {
    requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) ?? 0) + item.dispatchedQuantity);
  }
  const stock = await getDispatchableStock(companyId, warehouseId, [...requestedByProduct.keys()], excludeDispatchId);

  for (const [productId, requested] of requestedByProduct) {
    const { onHand, reserved, available } = stock.get(productId)!;
    if (requested > available) {
      const product = await prisma.product.findFirst({ where: { id: productId, companyId }, select: { styleName: true } });
      const name = product?.styleName ?? "this style";
      throw new BusinessRuleError(
        "INSUFFICIENT_FG_STOCK",
        `Only ${available} pieces of "${name}" are available for dispatch in this warehouse, but ${requested} were entered.` +
          (reserved > 0 ? ` (In stock: ${onHand}, already on other open dispatches: ${reserved}.)` : ` (In stock: ${onHand}.)`),
        { productId, warehouseId, onHand, reserved, available, requested }
      );
    }
  }
}

/** Optional, so most dispatches have nothing to validate — but when a
 * Forwarder IS picked, re-verify it's this company's own active row rather
 * than trusting a client-supplied id, same discipline Job Work Order's own
 * contractorId check already uses. */
async function resolveForwarderId(companyId: string, forwarderId: string | undefined): Promise<string | null> {
  if (!forwarderId) return null;
  const forwarder = await ForwarderRepository.findById(companyId, forwarderId);
  if (!forwarder) throw new BusinessRuleError("NOT_FOUND", "Forwarder not found.", { id: forwarderId });
  if (!forwarder.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Forwarder "${forwarder.name}" is inactive.`, { id: forwarder.id });
  }
  return forwarder.id;
}

/**
 * Release-to-Dispatch gate (2026-10-10) — opt-in by construction: a line
 * whose Sales Order Item has NO linked Production Order at all (Make-to-
 * Stock pools, orders never put through formal Production tracking) is
 * silently skipped, never blocked — this avoids any regression on existing
 * dispatch flows that don't use the Production module end-to-end. The gate
 * only fires when a real, non-cancelled Production Order genuinely exists
 * for the line AND hasn't been marked released yet. Mirrors Sales Order's
 * own "block, unless an elevated override reason is supplied" shape for its
 * sample-approval gate (assertSamplesApprovedOrOverride) — the override here
 * asserts `production`/`approve` (the permission the override itself needs),
 * same cross-module-assertion precedent as Material Request's own
 * generatePurchaseOrdersForShortfall().
 */
/** Returns the ids of any unreleased Production Orders the caller's override
 * reason just overrode (empty array if nothing needed overriding) — the
 * caller writes the actual audit entry once a real dispatch id exists,
 * rather than this pre-check writing one against a record that doesn't
 * exist yet. */
async function assertProductionReleasedForLines(
  actor: ActorContext,
  items: Array<{ salesOrderItemId: string; dispatchedQuantity: number }>,
  overrideReason: string | undefined
): Promise<string[]> {
  const lineIds = items.filter((i) => i.dispatchedQuantity > 0).map((i) => i.salesOrderItemId);
  if (lineIds.length === 0) return [];

  // CLOSED is excluded from the blocking set, not just CANCELLED — reaching
  // CLOSED already requires every lot to be COMPLETED/CANCELLED with at
  // least one real completion (see closeProductionOrder's own guard), so a
  // closed order is unambiguously "production finished" regardless of
  // whether anyone separately clicked Release — requiring that extra click
  // for something already fully done would be pure friction, not a real
  // check.
  const unreleasedOrders = await prisma.productionOrder.findMany({
    where: {
      salesOrderItemId: { in: lineIds },
      status: { notIn: ["CANCELLED", "CLOSED"] },
      releasedToDispatchAt: null,
    },
    select: { id: true, orderNumber: true, product: { select: { styleName: true } } },
  });
  if (unreleasedOrders.length === 0) return [];

  const trimmedReason = overrideReason?.trim();
  if (!trimmedReason) {
    const names = unreleasedOrders.map((o) => `${o.orderNumber} (${o.product.styleName})`).join(", ");
    throw new BusinessRuleError(
      "PRODUCTION_NOT_RELEASED_TO_DISPATCH",
      `Cannot create this dispatch — production has not been released to dispatch yet for: ${names}. A Production Manager must click "Release to Dispatch" on the relevant Production Order, or a Management user may override with a reason.`,
      { unreleasedProductionOrderIds: unreleasedOrders.map((o) => o.id) }
    );
  }

  await PermissionService.assert(actor.userId, "production", "approve");
  return unreleasedOrders.map((o) => o.id);
}

export async function createDispatch(actor: ActorContext, input: DispatchInput) {
  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, input.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: input.salesOrderId });

  if (!(DISPATCH_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot dispatch a sales order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  const settings = await getDispatchSettings(actor.companyId);
  const items = await buildDispatchItems(order.items, input.items, settings);
  await assertFinishedGoodsAvailable(actor.companyId, input.warehouseId, items);
  const overriddenProductionOrderIds = await assertProductionReleasedForLines(
    actor,
    items,
    input.overrideProductionReleaseReason
  );
  const forwarderId = await resolveForwarderId(actor.companyId, input.forwarderId);

  const dispatchNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "DISPATCH",
  });

  const dispatch = await DispatchRepository.createWithItems(
    {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      dispatchNumber,
      salesOrderId: order.id,
      customerId: order.customerId,
      warehouseId: input.warehouseId,
      dispatchDate: new Date(input.dispatchDate),
      status: "DRAFT",
      deliveryAddress: input.deliveryAddress,
      transporterName: input.transporterName || null,
      vehicleNumber: input.vehicleNumber || null,
      trackingNumber: input.trackingNumber || null,
      forwarderId,
      lrNumber: input.lrNumber || null,
      awbNumber: input.awbNumber || null,
      driverDetails: input.driverDetails || null,
      freightCharges: input.freightCharges ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      shipmentRemarks: input.shipmentRemarks || null,
      requestedByUserId: actor.userId,
    },
    items
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: dispatch.id,
    action: "CREATE",
    newValues: { dispatchNumber: dispatch.dispatchNumber, salesOrderId: order.id },
  });

  if (overriddenProductionOrderIds.length > 0) {
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "dispatches",
      recordId: dispatch.id,
      action: "UPDATE",
      newValues: {
        productionReleaseOverrideReason: input.overrideProductionReleaseReason?.trim(),
        overriddenProductionOrderIds,
      },
    });
  }

  return dispatch;
}

/** Editable while DRAFT or PACKED — replacing items also clears any existing
 * Cartons (they'd otherwise reference deleted DispatchItem rows) and reopens
 * the Dispatch to DRAFT, since whatever was packed no longer corresponds to
 * the new item set. */
export async function updateDispatch(actor: ActorContext, id: string, input: UpdateDispatchInput) {
  const existing = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, existing.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: existing.salesOrderId });

  // This dispatch's own not-yet-confirmed lines don't count against
  // "remaining" — only regularDispatchedQuantity (from OTHER, already-
  // confirmed dispatches) does, so re-editing the same DRAFT dispatch's own
  // quantities isn't blocked by itself; Regular/Extra are recomputed fresh
  // on every edit rather than stored as independent input.
  const settings = await getDispatchSettings(actor.companyId);
  const items = await buildDispatchItems(order.items, input.items, settings);
  await assertFinishedGoodsAvailable(actor.companyId, input.warehouseId, items, id);
  const overriddenProductionOrderIds = await assertProductionReleasedForLines(
    actor,
    items,
    input.overrideProductionReleaseReason
  );
  const forwarderId = await resolveForwarderId(actor.companyId, input.forwarderId);

  const updated = await DispatchRepository.replaceItems(
    id,
    {
      warehouseId: input.warehouseId,
      dispatchDate: new Date(input.dispatchDate),
      deliveryAddress: input.deliveryAddress,
      transporterName: input.transporterName || null,
      vehicleNumber: input.vehicleNumber || null,
      trackingNumber: input.trackingNumber || null,
      forwarderId,
      lrNumber: input.lrNumber || null,
      awbNumber: input.awbNumber || null,
      driverDetails: input.driverDetails || null,
      freightCharges: input.freightCharges ?? null,
      expectedDeliveryDate: input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : null,
      shipmentRemarks: input.shipmentRemarks || null,
    },
    items
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "DRAFT", itemCount: updated.items.length },
  });

  if (overriddenProductionOrderIds.length > 0) {
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "dispatches",
      recordId: id,
      action: "UPDATE",
      newValues: {
        productionReleaseOverrideReason: input.overrideProductionReleaseReason?.trim(),
        overriddenProductionOrderIds,
      },
    });
  }

  return updated;
}

/** Editable while DRAFT or PACKED — packing is a real multi-step floor
 * process that can span both; markPacked/confirmDispatch re-validate
 * completeness regardless of which status label the caller is coming from. */
export async function setCartons(actor: ActorContext, id: string, input: SetCartonsInput) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit cartons for a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const dispatchItemProductId = new Map(existing.items.map((i) => [i.id, i.productId]));

  const variantIds = [...new Set(input.cartons.flatMap((c) => c.items.map((i) => i.productVariantId).filter(Boolean)))] as string[];
  const variants = variantIds.length > 0 ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } } }) : [];
  const variantProductId = new Map(variants.map((v) => [v.id, v.productId]));

  const cartons = input.cartons.map((carton, index) => {
    for (const item of carton.items) {
      const expectedProductId = dispatchItemProductId.get(item.dispatchItemId);
      if (!expectedProductId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A carton line does not belong to this dispatch.",
          { dispatchItemId: item.dispatchItemId }
        );
      }
      if (item.productVariantId && variantProductId.get(item.productVariantId) !== expectedProductId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A carton line's variant does not match its style.",
          { dispatchItemId: item.dispatchItemId, productVariantId: item.productVariantId }
        );
      }
    }
    return {
      cartonNumber: index + 1,
      totalQuantity: carton.items.reduce((sum, i) => sum + i.quantity, 0),
      items: carton.items.map((i) => ({
        dispatchItemId: i.dispatchItemId,
        productVariantId: i.productVariantId || null,
        quantity: i.quantity,
      })),
    };
  });

  const updated = await DispatchRepository.setCartons(id, cartons);

  // Best-effort: cartons are deleted and recreated with fresh ids on every
  // call (see DispatchRepository.setCartons), so the prior call's own CARTON
  // barcode rows are dangling the instant new ones exist — replaceCartonBarcodes
  // cleans those up and registers a fresh one per new carton. Never allowed
  // to fail the real carton write itself, same reasoning as
  // mintFabricRollBarcode/registerProductionLotBarcode above.
  try {
    await replaceCartonBarcodes(
      { companyId: actor.companyId, userId: actor.userId },
      {
        previousCartonIds: existing.cartons.map((c) => c.id),
        dispatchNumber: existing.dispatchNumber,
        newCartons: updated.cartons.map((c) => ({ id: c.id, cartonNumber: c.cartonNumber })),
      }
    );
  } catch (err) {
    logger.error("Failed to replace Carton barcodes after setCartons", { error: err, dispatchId: id });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    newValues: { cartonCount: cartons.length },
  });

  return updated;
}

/**
 * DRAFT/PACKED -> PACKED. Validates, per DispatchItem, that the sum of its
 * carton-item quantities across every carton exactly equals its own
 * dispatchedQuantity — every line actually packed, not just an aggregate
 * total that happens to match by coincidence across different items.
 *
 * `scannedCartonIds` is optional (2026-09-29, Barcode Management & Scanning
 * System Phase 1) — when the pack screen has the warehouse user scan every
 * physical carton's label before confirming, this cross-checks that the
 * scanned set is EXACTLY the dispatch's own real carton set (same cardinality,
 * no missing carton, no carton scanned twice, no stray carton from a
 * different dispatch) before the existing quantity validation below even
 * runs. Every existing caller omits it and behaves identically to before.
 */
export async function markPacked(actor: ActorContext, id: string, scannedCartonIds?: string[]) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot pack a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  if (scannedCartonIds) {
    const realCartonIds = new Set(existing.cartons.map((c) => c.id));
    const scannedSet = new Set(scannedCartonIds);
    if (scannedSet.size !== scannedCartonIds.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", "The same carton was scanned more than once.", {});
    }
    const missing = existing.cartons.filter((c) => !scannedSet.has(c.id));
    const unexpected = scannedCartonIds.filter((cid) => !realCartonIds.has(cid));
    if (missing.length > 0 || unexpected.length > 0) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        missing.length > 0
          ? `Carton #${missing[0].cartonNumber} has not been scanned yet.`
          : "A scanned carton does not belong to this dispatch.",
        { missingCartonNumbers: missing.map((c) => c.cartonNumber), unexpectedCartonIds: unexpected }
      );
    }
  }

  const packedByItemId = new Map<string, number>();
  for (const carton of existing.cartons) {
    for (const cartonItem of carton.items) {
      packedByItemId.set(
        cartonItem.dispatchItem.id,
        (packedByItemId.get(cartonItem.dispatchItem.id) ?? 0) + cartonItem.quantity
      );
    }
  }

  for (const item of existing.items) {
    const packed = packedByItemId.get(item.id) ?? 0;
    if (packed !== item.dispatchedQuantity) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Packed quantity (${packed}) for "${item.product.styleName}" does not match the quantity to dispatch (${item.dispatchedQuantity}).`,
        { dispatchItemId: item.id, packed, expected: item.dispatchedQuantity }
      );
    }
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, existing.status, { status: "PACKED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch's status changed — reload and try again.", {});
  }

  const updated = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "PACKED" },
  });

  return updated;
}

/**
 * PACKED -> DISPATCHED. Self-approval-guarded via "post" (mirroring Invoice/
 * Journal's precedent — this is posting a ledger-affecting confirmation, not
 * approving someone else's request, so "post" is the right verb, not
 * Payment's "approve"). Extra Dispatch Quantity (2026-09-30): when this
 * dispatch's own extra quantity requires sign-off (per DispatchSettings — a
 * blanket company requirement, or either configured threshold), a SECOND,
 * separately self-approval-guarded "approve" assert additionally runs before
 * anything is posted — Reason (why) and Approval (a real sign-off) are
 * deliberately different checkpoints, not the same click. One transaction:
 * for each DispatchItem — a pre-check against real FG stock
 * (INSUFFICIENT_FG_STOCK, checked against the TOTAL regular+extra quantity —
 * extra dispatch never bypasses this), a guarded increment of
 * SalesOrderItem.regularDispatchedQuantity ONLY (capped by a FRESH read of
 * sum(breakdown.orderedQuantity) inside this same transaction — safe with
 * the plain Prisma updateMany idiom, not raw SQL, because updateSalesOrder()
 * now blocks edits while any Dispatch references the order, so that sum
 * cannot move underneath this transaction; dispatchedQuantity, the TOTAL,
 * is incremented unconditionally in the same write — extra is never capped
 * by the order's own quantity, only by real stock, already checked above),
 * and a negative DISPATCH InventoryTransaction for the total physical
 * quantity. Then a fresh-read-plus-unconditional-write recompute of
 * SalesOrder.status — Regular-only, per the spec's own invariant ("Sale
 * Order Fulfillment = Regular Dispatch Only") — same idiom as goods-
 * receipt.service.ts's own received-quantity recompute (not a guarded
 * conditional transition, since multiple Dispatches over time have no single
 * "expected prior status").
 */
export async function confirmDispatch(actor: ActorContext, id: string) {
  const dispatch = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!dispatch) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await PermissionService.assert(actor.userId, "dispatch", "post", { createdBy: dispatch.requestedByUserId });

  if (dispatch.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot confirm a dispatch in "${dispatch.status}" status — it must be Packed first.`,
      { currentStatus: dispatch.status }
    );
  }

  // Pre-check against real FG stock — the same "pre-check is enough, a
  // hot-path race guard isn't warranted for a manual, low-frequency action"
  // tradeoff already accepted project-wide for Stock Movement's own
  // negative-quantity paths, applied consistently here. Checked against the
  // TOTAL (regular+extra) — extra dispatch never bypasses this gate.
  for (const item of dispatch.items) {
    const available = await getAvailableQuantity(actor.companyId, item.productId, dispatch.warehouseId);
    if (item.dispatchedQuantity > available) {
      throw new BusinessRuleError(
        "INSUFFICIENT_FG_STOCK",
        `Unable to confirm dispatch because ${item.dispatchedQuantity} pieces of "${item.product.styleName}" are not available in Finished Goods stock. Available: ${available}, Requested: ${item.dispatchedQuantity}.`,
        { productId: item.productId, warehouseId: dispatch.warehouseId, available, requested: item.dispatchedQuantity }
      );
    }
  }

  const totalRegular = dispatch.items.reduce((sum, i) => sum + i.regularDispatchQuantity, 0);
  const totalExtra = dispatch.items.reduce((sum, i) => sum + i.extraDispatchQuantity, 0);
  const settings = await getDispatchSettings(actor.companyId);
  const needsApproval = extraDispatchNeedsApproval(settings, { totalRegular, totalExtra });
  if (needsApproval) {
    // Genuinely separate from "post" above — the same actor may hold both
    // (e.g. SUPER_ADMIN), but a role that holds only "post" (e.g.
    // DISPATCH_MANAGER, who packs/ships the ordinary case) will be denied
    // here with a clean PERMISSION_DENIED, and the creator of this dispatch
    // still cannot approve their own extra quantity even if they do hold
    // "approve" — "approve" is already self-approval-guarded project-wide.
    await PermissionService.assert(actor.userId, "dispatch", "approve", { createdBy: dispatch.requestedByUserId });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of dispatch.items) {
      const orderItem = await tx.salesOrderItem.findUniqueOrThrow({
        where: { id: item.salesOrderItem.id },
        select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
      });
      const orderedTotal = orderItem.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);

      const { count } = await tx.salesOrderItem.updateMany({
        where: {
          id: item.salesOrderItem.id,
          regularDispatchedQuantity: { lte: orderedTotal - item.regularDispatchQuantity },
        },
        data: {
          regularDispatchedQuantity: { increment: item.regularDispatchQuantity },
          dispatchedQuantity: { increment: item.dispatchedQuantity },
        },
      });
      if (count === 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          `Cannot dispatch ${item.dispatchedQuantity} for "${item.product.styleName}" — the remaining order quantity changed.`,
          { salesOrderItemId: item.salesOrderItem.id }
        );
      }

      await recordInventoryTransaction(tx, actor, {
        productId: item.productId,
        warehouseId: dispatch.warehouseId,
        transactionType: "DISPATCH",
        quantity: -item.dispatchedQuantity,
        referenceModule: "DISPATCH",
        referenceRecordId: item.id,
      });
    }

    const allItems = await tx.salesOrderItem.findMany({
      where: { salesOrderId: dispatch.salesOrderId },
      select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    });
    // Regular-only, per the spec's own invariant — Extra never inflates
    // Sale Order fulfillment.
    const allFullyDispatched = allItems.every(
      (i) => i.regularDispatchedQuantity >= i.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0)
    );
    await tx.salesOrder.update({
      where: { id: dispatch.salesOrderId },
      data: { status: allFullyDispatched ? "DISPATCHED" : "PARTIALLY_DISPATCHED" },
    });

    const { count } = await tx.dispatch.updateMany({
      where: { id, status: "PACKED" },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch is no longer in Packed status.", {});
    }
  });

  const updated = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "POST",
    oldValues: { status: "PACKED" },
    newValues: {
      status: "DISPATCHED",
      // Extra Dispatch Quantity auditability (2026-09-30) — who confirmed
      // it, when (the audit log's own existing timestamp/actor columns), and
      // whether this shipment included Extra quantity requiring a distinct
      // approval sign-off, reusing the existing Audit Log system rather than
      // adding new Dispatch columns purely to record who/when approved.
      totalRegularQuantity: totalRegular,
      totalExtraQuantity: totalExtra,
      ...(totalExtra > 0 ? { extraDispatchApprovalRequired: needsApproval, approvedByUserId: actor.userId } : {}),
    },
  });

  return updated;
}

/** DISPATCHED -> DELIVERED. No ledger impact, no SalesOrder.status change —
 * DISPATCHED is the terminal tracked state on the order; "delivered" is a
 * Dispatch-level fact only. */
export async function markDelivered(actor: ActorContext, id: string, receivedByName: string | undefined) {
  const existing = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const { count } = await DispatchRepository.updateStatusConditional(id, "DISPATCHED", {
    status: "DELIVERED",
    deliveredAt: new Date(),
    receivedByName: receivedByName || null,
  });
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot mark a dispatch in "${existing.status}" status as delivered — it must be Dispatched first.`,
      { currentStatus: existing.status }
    );
  }

  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "DISPATCHED" },
    newValues: { status: "DELIVERED" },
  });

  return updated;
}

export async function transitionDispatchStatus(actor: ActorContext, id: string, targetStatus: "ON_HOLD" | "CANCELLED") {
  const before = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a dispatch from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  // Independent, unconditional guard — never inferred from the status label
  // or transition path alone (the exact bug class this project has hit
  // twice: Sampling's Hold/Resume bug, Purchasing's cancel-from-ON_HOLD
  // bug). A Dispatch that has ever posted to the ledger (dispatchedAt set)
  // can never be cancelled, regardless of which status label got it here.
  if (targetStatus === "CANCELLED" && before.dispatchedAt) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Cannot cancel a dispatch that has already been confirmed — its stock impact is a posted fact.",
      { dispatchedAt: before.dispatchedAt }
    );
  }

  const data: Prisma.DispatchUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") {
    data.statusBeforeHold = before.status;
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, before.status, data);
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a dispatch from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }
  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the dispatch was held from — no caller-chosen
 * target, same reasoning as Sampling's/Sales Order's own resume-from-hold. */
export async function resumeDispatchFromHold(actor: ActorContext, id: string) {
  const before = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch isn't on hold.", {
      currentStatus: before.status,
    });
  }

  const { count } = await DispatchRepository.updateStatusConditional(id, "ON_HOLD", {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This dispatch isn't on hold.", {
      currentStatus: before.status,
    });
  }
  const updated = await DispatchRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "dispatches",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}

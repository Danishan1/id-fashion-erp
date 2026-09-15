import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import type { DispatchStatus, Prisma } from "@prisma/client";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { recordInventoryTransaction, getAvailableQuantity } from "@/modules/inventory/inventory.service";
import type { DispatchInput, UpdateDispatchInput, SetCartonsInput } from "./dispatch.schema";
import { DispatchRepository } from "./dispatch.repository";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

// A Dispatch may be created against an order that's CONFIRMED (the normal
// case), still PARTIALLY_DISPATCHED (a prior Dispatch already shipped part
// of it), or already INVOICED (advance billing before shipment — a real,
// deliberately-supported ordering, not assumed to only happen after
// shipment). DISPATCHED itself is excluded — nothing left to ship.
const DISPATCH_ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED"] as const;

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
  dispatchedQuantity: number;
  breakdown: Array<{ orderedQuantity: number }>;
}

function remainingToDispatch(item: OrderItemLike): number {
  const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
  return orderedTotal - item.dispatchedQuantity;
}

async function buildDispatchItems(orderItems: OrderItemLike[], inputItems: DispatchInput["items"]) {
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
    const remaining = remainingToDispatch(orderItem);
    if (line.dispatchedQuantity > remaining) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Cannot dispatch ${line.dispatchedQuantity} for this line — only ${remaining} remains to be dispatched.`,
        { salesOrderItemId: line.salesOrderItemId, requestedQuantity: line.dispatchedQuantity, remaining }
      );
    }
    items.push({
      salesOrderItemId: orderItem.id,
      productId: orderItem.productId,
      dispatchedQuantity: line.dispatchedQuantity,
    });
  }
  return items;
}

export async function listDispatches(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.DispatchWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { dispatchNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
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

  const items = await buildDispatchItems(order.items, input.items);

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
  // "remaining" — only dispatchedQuantity (from OTHER, already-confirmed
  // dispatches) does, so re-editing the same DRAFT dispatch's own quantities
  // isn't blocked by itself.
  const items = await buildDispatchItems(order.items, input.items);

  const updated = await DispatchRepository.replaceItems(
    id,
    {
      warehouseId: input.warehouseId,
      dispatchDate: new Date(input.dispatchDate),
      deliveryAddress: input.deliveryAddress,
      transporterName: input.transporterName || null,
      vehicleNumber: input.vehicleNumber || null,
      trackingNumber: input.trackingNumber || null,
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
 */
export async function markPacked(actor: ActorContext, id: string) {
  const existing = await DispatchRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });

  if (existing.status !== "DRAFT" && existing.status !== "PACKED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot pack a dispatch in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
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
 * Payment's "approve"). One transaction: for each DispatchItem — a
 * pre-check against real FG stock (INSUFFICIENT_FG_STOCK), a guarded
 * increment of SalesOrderItem.dispatchedQuantity (capped by a FRESH read of
 * sum(breakdown.orderedQuantity) inside this same transaction — safe with
 * the plain Prisma updateMany idiom, not raw SQL, because updateSalesOrder()
 * now blocks edits while any Dispatch references the order, so that sum
 * cannot move underneath this transaction), and a negative DISPATCH
 * InventoryTransaction. Then a fresh-read-plus-unconditional-write recompute
 * of SalesOrder.status (same idiom as goods-receipt.service.ts's own
 * received-quantity recompute — not a guarded conditional transition, since
 * multiple Dispatches over time have no single "expected prior status").
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
  // negative-quantity paths, applied consistently here.
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

  await prisma.$transaction(async (tx) => {
    for (const item of dispatch.items) {
      const orderItem = await tx.salesOrderItem.findUniqueOrThrow({
        where: { id: item.salesOrderItem.id },
        select: { dispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
      });
      const orderedTotal = orderItem.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);

      const { count } = await tx.salesOrderItem.updateMany({
        where: { id: item.salesOrderItem.id, dispatchedQuantity: { lte: orderedTotal - item.dispatchedQuantity } },
        data: { dispatchedQuantity: { increment: item.dispatchedQuantity } },
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
      select: { dispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    });
    const allFullyDispatched = allItems.every(
      (i) => i.dispatchedQuantity >= i.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0)
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
    newValues: { status: "DISPATCHED" },
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

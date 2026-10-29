import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { prisma } from "@/core/db/client";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { SampleRequestRepository } from "@/modules/sampling/sample.repository";
import { SalesInvoiceRepository } from "@/modules/accounts/sales-invoice.repository";
import { DispatchRepository } from "@/modules/dispatch/dispatch.repository";
import { getSalesOrderItemProductionSummary } from "@/modules/production/production-progress.service";
import type { ConfirmSalesOrderInput, SalesOrderInput, UpdateSalesOrderInput } from "./sales-order.schema";
import { CompanyRepository, SalesOrderRepository } from "./sales-order.repository";
import { buildReconciledItemPlan, snapshotUnsnapshottedLinesInTx } from "./sales-order-bom.service";
import { releaseActiveReservationsForSalesOrderInTx } from "@/modules/finished-goods-inventory/finished-goods-reservation.service";
import { SalesOrderStatus, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Only DRAFT/CONFIRMED/ON_HOLD/CANCELLED are wired up here — the same
 * discipline as Sampling's ALLOWED_TRANSITIONS: IN_PRODUCTION is reserved for
 * 5C to set as a side effect of creating a Production Order from this order,
 * and PARTIALLY_DISPATCHED/DISPATCHED/INVOICED/CLOSED belong to Phase 7/8.
 * CONFIRMED itself is reachable only through confirmSalesOrder() below, not
 * this map, since it carries the sample-approval-gate business logic.
 */
const ALLOWED_TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  DRAFT: ["CANCELLED"],
  CONFIRMED: ["ON_HOLD", "CANCELLED"],
  IN_PRODUCTION: [],
  PARTIALLY_DISPATCHED: [],
  DISPATCHED: [],
  INVOICED: [],
  CLOSED: [],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
};

const VALID_SALES_ORDER_STATUSES = new Set<string>(Object.values(SalesOrderStatus));

export async function listSalesOrders(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.SalesOrderWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_SALES_ORDER_STATUSES.has(query.status)
      ? { status: query.status as SalesOrderStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    SalesOrderRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    SalesOrderRepository.count(where),
  ]);

  return { data, totalCount };
}

/** The "Last Order Price" hint on the create/edit form — what this exact
 * customer was actually charged the last time they ordered this exact
 * style, so a merchandiser can default a repeat order to real negotiated
 * history instead of a generic sample-costing estimate. Returns null when
 * there's no prior order at all (the common case for a first-time line) —
 * the form shows nothing rather than a "no prior order" message for that. */
export async function getLastOrderedPrice(companyId: string, customerId: string, productId: string, excludeOrderId?: string) {
  const item = await SalesOrderRepository.findLastOrderedItem(companyId, customerId, productId, excludeOrderId);
  if (!item) return null;
  return { unitPrice: item.unitPrice.toString(), orderNumber: item.salesOrder.orderNumber, orderDate: item.salesOrder.orderDate };
}

/**
 * The fuller price-history list behind getLastOrderedPrice's own single
 * most-recent figure — every real price this exact customer was actually
 * charged for this exact style, so a merchandiser has real negotiated
 * history (not just the latest one) to finalize today's Unit Price against.
 * Powers the Unit Price field's own datalist suggestions on the Sales Order
 * create/edit form — same shape/purpose as the Purchase Order form's own
 * price-history suggestions, just sourced from what we charged instead of
 * what we paid.
 */
export async function getSalesOrderPriceHistory(
  companyId: string,
  customerId: string,
  productId: string,
  excludeOrderId?: string,
  sinceDate?: Date
) {
  const items = await SalesOrderRepository.findOrderedPriceHistory(companyId, customerId, productId, excludeOrderId, sinceDate);
  return items.map((item) => ({
    unitPrice: Number(item.unitPrice),
    orderNumber: item.salesOrder.orderNumber,
    orderDate: item.salesOrder.orderDate.toISOString(),
  }));
}

/** A branch-restricted user gets NOT_FOUND for an order outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getSalesOrderById(actor: { companyId: string; userId: string }, id: string) {
  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!order.branchId || !allowedBranchIds.has(order.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });
  }

  // Per-line rollup of every Production Order linked to it — how much has
  // been planned/produced/rejected against what was actually ordered.
  // Purely informational (never a cap on this order itself, see
  // getSalesOrderItemProductionSummary's own doc comment) — attached directly
  // onto each item (not a separate parallel array) so the detail page gets
  // it in the same server-rendered payload with no index-matching needed.
  const items = await Promise.all(
    order.items.map(async (item) => ({ ...item, productionSummary: await getSalesOrderItemProductionSummary(actor.companyId, item.id) }))
  );

  return { ...order, items };
}

/**
 * Shared by confirmSalesOrder() and updateSalesOrder() — an edit to an
 * already-Confirmed order could otherwise add an unapproved-sample-linked
 * line without ever passing through the gate, silently defeating the whole
 * point of it.
 */
async function assertSamplesApprovedOrOverride(
  actor: ActorContext,
  requestedByUserId: string,
  items: Array<{ sampleRequestId: string | null; sampleStatus: string | null }>,
  overrideReason: string | undefined
) {
  const unapprovedItems = items.filter((item) => item.sampleRequestId && item.sampleStatus !== "APPROVED");
  if (unapprovedItems.length === 0) return;

  if (!overrideReason) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `${unapprovedItems.length} line(s) reference a sample that isn't Approved yet. Provide a Management override reason to proceed anyway.`,
      { unapprovedSampleRequestIds: unapprovedItems.map((i) => i.sampleRequestId) }
    );
  }

  await PermissionService.assert(actor.userId, "sales_orders", "approve", { createdBy: requestedByUserId });
}

/**
 * Every other module that references `Product` by id (BOM, Purchase Order,
 * Material Request) restricts its lookup to the correct `itemType` via
 * `findMaterialById`/`findStyleById` — Sales Order was the one exception,
 * accepting any UUID that exists in `products` with no itemType check at
 * all, so a raw material could be sold as a finished-goods line via a direct
 * API call (the UI's own picker was the only thing preventing it). Closes
 * that gap the same way every sibling module already does.
 */
async function assertItemsAreStyles(
  companyId: string,
  items: { productId: string }[],
  opts: { rejectInactive?: boolean } = {},
) {
  const distinctProductIds = [...new Set(items.map((item) => item.productId))];
  for (const productId of distinctProductIds) {
    const style = await ProductRepository.findStyleById(companyId, productId);
    if (!style) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });
    // Only enforced on create — an existing order whose style was deactivated
    // later must stay editable, it just can't gain new lines on it via a new order.
    if (opts.rejectInactive && !style.isActive) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Style "${style.styleName}" is inactive and cannot be used on a new sales order.`,
        { id: productId },
      );
    }
  }
}

/**
 * Any customer may order any design (a SampleRequest) — a design originally
 * developed/approved for Customer B can be referenced on Customer A's order
 * as-is, never duplicated. What IS enforced: the design exists in this
 * company, belongs to the same Style as the line it's linked on, and is not
 * a dead (Rejected/Cancelled) design. Approval status itself stays enforced
 * by the existing confirm-time gate (assertSamplesApprovedOrOverride), which
 * carries its own Management override path.
 */
async function assertLinkedDesignsValid(
  companyId: string,
  items: { productId: string; sampleRequestId?: string | null }[],
) {
  for (const item of items) {
    if (!item.sampleRequestId) continue;
    const design = await SampleRequestRepository.findAnyById(companyId, item.sampleRequestId);
    if (!design) {
      throw new BusinessRuleError("NOT_FOUND", "The linked design was not found.", { id: item.sampleRequestId });
    }
    if (design.status === "REJECTED" || design.status === "CANCELLED") {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Design ${design.requestNumber} is ${design.status.toLowerCase()} and cannot be ordered.`,
        { id: item.sampleRequestId },
      );
    }
    if (design.productId && design.productId !== item.productId) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Design ${design.requestNumber} belongs to a different Style than the one selected on this line.`,
        { id: item.sampleRequestId },
      );
    }
  }
}

/**
 * The customer must belong to the actor's company, and a buyer (when given)
 * must belong to that customer — never another customer's or another
 * company's buyer. Runs on both create and edit.
 */
async function assertCustomerAndBuyer(companyId: string, customerId: string, buyerId: string | null | undefined) {
  const customer = await CustomerRepository.findByIdWithBuyers(companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });
  if (buyerId && !customer.buyers.some((b) => b.id === buyerId)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `The selected buyer does not belong to customer "${customer.name}".`, {
      customerId,
      buyerId,
    });
  }
  return customer;
}

/**
 * `origin.sourceQuotationRevisionId` is set only by Sales & Marketing's
 * quotation conversion (S4, 2026-10-29) — never from the public order API.
 * The column is unique, so a second conversion of the same revision fails
 * with a unique violation instead of creating a second order.
 */
export async function createSalesOrder(actor: ActorContext, input: SalesOrderInput, origin: { sourceQuotationRevisionId?: string } = {}) {
  await assertCustomerAndBuyer(actor.companyId, input.customerId, input.buyerId);

  await assertItemsAreStyles(actor.companyId, input.items, { rejectInactive: true });
  await assertLinkedDesignsValid(actor.companyId, input.items);

  // Never trust a client-supplied id belongs to this company without
  // checking, even one that came from a same-app link (the pattern this
  // codebase follows everywhere — Sampling's addSampleMaterial fix, the
  // 26-entity sweep). CRM Replacement, 2026-10-09: repointed at CrmOpportunity.
  if (input.originatingOpportunityId) {
    const opportunity = await prisma.crmOpportunity.findFirst({ where: { id: input.originatingOpportunityId, companyId: actor.companyId } });
    if (!opportunity) throw new BusinessRuleError("NOT_FOUND", "The originating opportunity was not found.", { id: input.originatingOpportunityId });
  }

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  // Always the company's own base currency — a customer's own
  // defaultCurrencyCode is deliberately NOT used here. Multi-currency UI is
  // deferred project-wide, and per-customer currency was causing orders to
  // silently land in USD/etc. for customers configured that way, which isn't
  // what this business actually wants today.
  const currencyCode = company.baseCurrencyCode;

  const orderNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "SALES_ORDER",
  });

  const totalAmount = input.items.reduce((orderSum, item) => {
    const itemQty = item.breakdown.reduce((qtySum, b) => qtySum + b.orderedQuantity, 0);
    return orderSum + item.unitPrice * itemQty;
  }, 0);

  // Bare header first — createHeader() has no items yet, so
  // buildReconciledItemPlan() below (called against this real order id with
  // zero existing SalesOrderLines) correctly treats every submitted item as
  // a fresh line, reusing the exact same write path updateSalesOrder() uses
  // rather than a second, parallel nested-create shape.
  const header = await SalesOrderRepository.createHeader({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    orderNumber,
    customerId: input.customerId,
    buyerId: input.buyerId || null,
    orderDate: new Date(input.orderDate),
    requiredShipDate: input.requiredShipDate ? new Date(input.requiredShipDate) : null,
    customerPoNumber: input.customerPoNumber || null,
    originatingOpportunityId: input.originatingOpportunityId || null,
    sourceQuotationRevisionId: origin.sourceQuotationRevisionId ?? null,
    status: "DRAFT",
    currencyCode,
    exchangeRate: 1,
    baseCurrencyCode: company.baseCurrencyCode,
    totalAmount,
    baseTotalAmount: totalAmount,
    requestedByUserId: actor.userId,
  });

  // A brand-new order always starts DRAFT — isConfirmed: false, so no line
  // gets a BOM/Sample snapshot yet (that happens once, for every line, at
  // confirmSalesOrder() time).
  const itemPlan = await buildReconciledItemPlan(
    actor,
    header.id,
    false,
    input.items.map((item) => ({
      productId: item.productId,
      sampleRequestId: item.sampleRequestId || null,
      unitPrice: item.unitPrice,
      notes: item.notes || null,
      breakdown: item.breakdown,
    }))
  );
  const order = await SalesOrderRepository.replaceItems(actor.companyId, header.id, {}, itemPlan);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_orders",
    recordId: order.id,
    action: "CREATE",
    newValues: { orderNumber: order.orderNumber, totalAmount: order.totalAmount },
  });

  return order;
}

/**
 * Editable while DRAFT or CONFIRMED — once an order has moved into
 * production (5C), it's no longer editable at all; additional quantity
 * becomes a new Sales Order instead, so already-committed production data
 * (material allocated, fabric cut) never silently goes stale under it.
 * Editing a CONFIRMED order re-runs the same sample-approval gate as
 * confirmSalesOrder(), since an edit could otherwise add an
 * unapproved-sample-linked line without ever passing through it.
 */
export async function updateSalesOrder(actor: ActorContext, id: string, input: UpdateSalesOrderInput) {
  const existing = await SalesOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  await assertCustomerAndBuyer(actor.companyId, input.customerId, input.buyerId);
  await assertItemsAreStyles(actor.companyId, input.items);
  await assertLinkedDesignsValid(actor.companyId, input.items);

  if (existing.status !== "DRAFT" && existing.status !== "CONFIRMED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a sales order in "${existing.status}" status — create a new sales order for additional quantity instead.`,
      { currentStatus: existing.status }
    );
  }

  // An active (non-cancelled) Sales Invoice has already copied this order's
  // items/prices/customer — letting the order keep changing underneath it
  // would silently desync the invoice from what it claims to represent.
  const activeInvoice = await SalesInvoiceRepository.findActiveByOrderId(actor.companyId, id);
  if (activeInvoice) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      `This sales order has an active invoice (${activeInvoice.invoiceNumber}) and can no longer be edited.`,
      { salesInvoiceId: activeInvoice.id }
    );
  }

  // ANY Dispatch (any status, including CANCELLED — its own DispatchItem
  // rows still sit on the salesOrderItemId FK) blocks editing — replaceItems()
  // below unconditionally deletes and recreates every SalesOrderItem/
  // breakdown row, which would otherwise violate that FK the moment a
  // Dispatch (even a still-DRAFT one) references this order. Deliberately
  // NOT scoped to "active" Dispatches only, unlike the invoice check above —
  // see DispatchRepository.findAnyByOrderId's own doc comment for why.
  const anyDispatch = await DispatchRepository.findAnyByOrderId(actor.companyId, id);
  if (anyDispatch) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      `This sales order has a dispatch (${anyDispatch.dispatchNumber}) and can no longer be edited.`,
      { dispatchId: anyDispatch.id }
    );
  }

  if (existing.status === "CONFIRMED") {
    const sampleRequestIds = input.items.map((item) => item.sampleRequestId).filter((v): v is string => Boolean(v));
    const samples =
      sampleRequestIds.length > 0
        ? await SampleRequestRepository.findMany({ companyId: actor.companyId, id: { in: sampleRequestIds } }, {})
        : [];
    const statusById = new Map(samples.map((s) => [s.id, s.status]));

    await assertSamplesApprovedOrOverride(
      actor,
      existing.requestedByUserId,
      input.items.map((item) => ({
        sampleRequestId: item.sampleRequestId || null,
        sampleStatus: item.sampleRequestId ? statusById.get(item.sampleRequestId) ?? null : null,
      })),
      input.overrideReason
    );
  }

  const totalAmount = input.items.reduce((orderSum, item) => {
    const itemQty = item.breakdown.reduce((qtySum, b) => qtySum + b.orderedQuantity, 0);
    return orderSum + item.unitPrice * itemQty;
  }, 0);

  // Effective BOM (2026-09-24) — reconciles each submitted item against the
  // order's existing SalesOrderLines before writing: an unchanged line (same
  // productId/sampleRequestId) keeps its own frozen snapshot and any active
  // overrides untouched; a changed product/sample, or a genuinely new line,
  // gets a fresh SalesOrderLine — snapshotted immediately only because this
  // order is already CONFIRMED (a still-DRAFT edit defers snapshotting to
  // confirmSalesOrder()). An existing line whose id isn't resubmitted at all
  // (a deleted line) simply ends up with no live item after this write —
  // its own overrides stop applying without ever being deleted.
  const itemPlan = await buildReconciledItemPlan(
    actor,
    id,
    existing.status === "CONFIRMED",
    input.items.map((item) => ({
      salesOrderLineId: item.salesOrderLineId || undefined,
      productId: item.productId,
      sampleRequestId: item.sampleRequestId || null,
      unitPrice: item.unitPrice,
      notes: item.notes || null,
      breakdown: item.breakdown,
    }))
  );

  const updated = await SalesOrderRepository.replaceItems(
    actor.companyId,
    id,
    {
      customerId: input.customerId,
      buyerId: input.buyerId || null,
      orderDate: new Date(input.orderDate),
      requiredShipDate: input.requiredShipDate ? new Date(input.requiredShipDate) : null,
      customerPoNumber: input.customerPoNumber || null,
      totalAmount,
      baseTotalAmount: totalAmount,
    },
    itemPlan
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { totalAmount: existing.totalAmount, itemCount: existing.items.length },
    newValues: { totalAmount: updated.totalAmount, itemCount: updated.items.length, overrideReason: input.overrideReason || null },
  });

  return updated;
}

/**
 * DRAFT -> CONFIRMED, gated on every line item's linked sample (if any)
 * actually being Approved. A repeat/direct line with no sample link needs no
 * gate at all. Management can override with a reason, but never for their
 * own order — PermissionService's resourceContext.createdBy check denies
 * self-approval the same way it already does for Sampling's Approve action.
 */
export async function confirmSalesOrder(actor: ActorContext, id: string, input: ConfirmSalesOrderInput) {
  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  if (order.status !== "DRAFT") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot confirm a sales order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  await assertSamplesApprovedOrOverride(
    actor,
    order.requestedByUserId,
    order.items.map((item) => ({ sampleRequestId: item.sampleRequestId, sampleStatus: item.sampleRequest?.status ?? null })),
    input.overrideReason
  );

  await prisma.$transaction(async (tx) => {
    // Conditional on status still being DRAFT at write time — closes the
    // race between the check above and this write (two concurrent "Confirm"
    // clicks both reading DRAFT before either commits).
    const { count } = await tx.salesOrder.updateMany({ where: { id, status: "DRAFT" }, data: { status: "CONFIRMED" } });
    if (count === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot confirm a sales order in "${order.status}" status.`,
        { currentStatus: order.status }
      );
    }

    // Effective BOM (2026-09-24) — DRAFT -> CONFIRMED is the one true "this
    // order is now committed" event the spec describes; every line without
    // a snapshot yet gets one now, atomically alongside the status flip.
    await snapshotUnsnapshottedLinesInTx(tx, actor, id);
  });

  const updated = await SalesOrderRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: order.status },
    newValues: { status: "CONFIRMED", overrideReason: input.overrideReason || null },
  });

  return updated;
}

export async function transitionSalesOrderStatus(actor: ActorContext, id: string, targetStatus: SalesOrderStatus) {
  const before = await SalesOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a sales order from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  const data: Prisma.SalesOrderUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") {
    data.statusBeforeHold = before.status;
  }

  if (targetStatus === "CANCELLED") {
    await prisma.$transaction(async (tx) => {
      // Prevent cancellation when open dispatches exist in DRAFT, PACKED, or ON_HOLD status
      const openDispatches = await tx.dispatch.findMany({
        where: {
          companyId: actor.companyId,
          salesOrderId: id,
          status: { in: ["DRAFT", "PACKED", "ON_HOLD"] },
        },
        select: { id: true, dispatchNumber: true, status: true },
      });
      if (openDispatches.length > 0) {
        throw new BusinessRuleError(
          "REFERENCED_RECORD_IN_USE",
          `Cannot cancel sales order "${before.orderNumber}" because active dispatches (${openDispatches.map((d) => d.dispatchNumber).join(", ")}) are in progress. Cancel or remove those dispatches first.`,
          {
            salesOrderId: id,
            openDispatchNumbers: openDispatches.map((d) => d.dispatchNumber),
          }
        );
      }

      // Conditional on status still being `before.status` at write time — closes
      // the race between the check above and this write (e.g. two concurrent
      // "Cancel" clicks both reading the same prior status before either commits).
      const { count } = await tx.salesOrder.updateMany({
        where: { id, status: before.status },
        data,
      });
      if (count === 0) {
        throw new BusinessRuleError(
          "INVALID_STATE_TRANSITION",
          `Cannot move a sales order from "${before.status}" to "${targetStatus}".`,
          { from: before.status, to: targetStatus }
        );
      }

      // Release eligible active FinishedGoodsReservation records
      await releaseActiveReservationsForSalesOrderInTx(tx, id);
    });
  } else {
    // Conditional on status still being `before.status` at write time — closes
    // the race between the check above and this write (e.g. two concurrent
    // "Hold" clicks both reading the same prior status before either commits).
    const { count } = await SalesOrderRepository.updateStatusConditional(id, before.status, data);
    if (count === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot move a sales order from "${before.status}" to "${targetStatus}".`,
        { from: before.status, to: targetStatus }
      );
    }
  }

  const updated = await SalesOrderRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the order was held from — no caller-chosen
 * target, same reasoning as Sampling's resumeSampleFromHold(). */
export async function resumeSalesOrderFromHold(actor: ActorContext, id: string) {
  const before = await SalesOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This sales order isn't on hold.", {
      currentStatus: before.status,
    });
  }

  // Conditional on status still being ON_HOLD at write time — closes the
  // race between the check above and this write (two concurrent "Resume"
  // clicks both reading ON_HOLD before either commits).
  const { count } = await SalesOrderRepository.updateStatusConditional(id, "ON_HOLD", {
    status: before.statusBeforeHold,
    statusBeforeHold: null,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This sales order isn't on hold.", {
      currentStatus: before.status,
    });
  }
  const updated = await SalesOrderRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}

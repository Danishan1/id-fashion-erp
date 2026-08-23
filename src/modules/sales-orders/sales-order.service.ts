import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { SampleRequestRepository } from "@/modules/sampling/sample.repository";
import type { ConfirmSalesOrderInput, SalesOrderInput, UpdateSalesOrderInput } from "./sales-order.schema";
import { CompanyRepository, SalesOrderRepository } from "./sales-order.repository";
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

export async function listSalesOrders(companyId: string, query: ListQuery) {
  const where: Prisma.SalesOrderWhereInput = {
    companyId,
    ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
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

export async function getSalesOrderById(companyId: string, id: string) {
  const order = await SalesOrderRepository.findByIdWithDetails(companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id });
  return order;
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

export async function createSalesOrder(actor: ActorContext, input: SalesOrderInput) {
  const customer = await CustomerRepository.findByIdWithBuyers(actor.companyId, input.customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: input.customerId });

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

  const order = await SalesOrderRepository.createWithItems({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    orderNumber,
    customerId: input.customerId,
    buyerId: input.buyerId || null,
    orderDate: new Date(input.orderDate),
    requiredShipDate: input.requiredShipDate ? new Date(input.requiredShipDate) : null,
    status: "DRAFT",
    currencyCode,
    exchangeRate: 1,
    baseCurrencyCode: company.baseCurrencyCode,
    totalAmount,
    baseTotalAmount: totalAmount,
    requestedByUserId: actor.userId,
    items: {
      create: input.items.map((item) => ({
        productId: item.productId,
        sampleRequestId: item.sampleRequestId || null,
        unitPrice: item.unitPrice,
        notes: item.notes || null,
        breakdown: {
          create: item.breakdown.map((b) => ({
            productVariantId: b.productVariantId,
            orderedQuantity: b.orderedQuantity,
          })),
        },
      })),
    },
  });

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

  if (existing.status !== "DRAFT" && existing.status !== "CONFIRMED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a sales order in "${existing.status}" status — create a new sales order for additional quantity instead.`,
      { currentStatus: existing.status }
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

  const updated = await SalesOrderRepository.replaceItems(
    id,
    {
      customerId: input.customerId,
      buyerId: input.buyerId || null,
      orderDate: new Date(input.orderDate),
      requiredShipDate: input.requiredShipDate ? new Date(input.requiredShipDate) : null,
      totalAmount,
      baseTotalAmount: totalAmount,
    },
    input.items.map((item) => ({
      productId: item.productId,
      sampleRequestId: item.sampleRequestId || null,
      unitPrice: item.unitPrice,
      notes: item.notes || null,
      breakdown: item.breakdown,
    }))
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

  // Conditional on status still being DRAFT at write time — closes the race
  // between the check above and this write (two concurrent "Confirm" clicks
  // both reading DRAFT before either commits).
  const { count } = await SalesOrderRepository.updateStatusConditional(id, "DRAFT", { status: "CONFIRMED" });
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot confirm a sales order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }
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

  // Conditional on status still being `before.status` at write time — closes
  // the race between the check above and this write (e.g. two concurrent
  // "Cancel" clicks both reading the same prior status before either commits).
  const { count } = await SalesOrderRepository.updateStatusConditional(id, before.status, data);
  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a sales order from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
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

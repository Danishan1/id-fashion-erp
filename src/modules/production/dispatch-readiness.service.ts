import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import { getProgressForOrders, type ProductionOrderProgress } from "./production-progress.service";

const EPSILON = 0.0001;

/**
 * Dispatch readiness of a Production Order — always derived, never stored.
 *
 * READY_FOR_DISPATCH: every planned piece is accounted for (finished at the
 *   final stage, or permanently rejected/damaged) and at least one piece is
 *   finished. Pieces finished through an external job-work receipt count the
 *   same way, since a job-work receipt covering the final stage posts them to
 *   Finished Goods exactly like an in-house completion.
 * DISPATCHED: ready, and the linked Sale Order line has actually shipped
 *   (confirmed dispatches) everything that was finished. Draft/Packed
 *   dispatches don't count — the order stays in "For Dispatching" with its
 *   in-progress quantity shown until they're confirmed.
 * null: still in production, or the order is on hold / cancelled.
 */
export type DispatchReadiness = "READY_FOR_DISPATCH" | "DISPATCHED" | null;

const READINESS_ELIGIBLE_STATUSES = new Set(["PLANNED", "MATERIAL_ALLOCATED", "IN_PROGRESS", "CLOSED"]);
const SALES_ORDER_DISPATCHABLE = new Set(["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED", "DISPATCHED"]); // = DISPATCH_ELIGIBLE_ORDER_STATUSES

export interface DispatchQuantities {
  /** Physically shipped (confirmed dispatches). */
  shipped: number;
  /** On Draft/Packed dispatches not yet confirmed. */
  inProgress: number;
}

function isFullyProcessed(progress: ProductionOrderProgress): boolean {
  return (
    progress.producedQuantity > EPSILON &&
    progress.producedQuantity + progress.rejectedQuantity >= progress.plannedQuantity - EPSILON
  );
}

/** Shipped + in-flight dispatch quantity per Sale Order line. */
async function dispatchQuantitiesByItem(salesOrderItemIds: string[]): Promise<Map<string, DispatchQuantities>> {
  const result = new Map<string, DispatchQuantities>();
  if (salesOrderItemIds.length === 0) return result;

  const [items, openLines] = await Promise.all([
    prisma.salesOrderItem.findMany({ where: { id: { in: salesOrderItemIds } }, select: { id: true, dispatchedQuantity: true } }),
    prisma.dispatchItem.groupBy({
      by: ["salesOrderItemId"],
      where: { salesOrderItemId: { in: salesOrderItemIds }, dispatch: { status: { in: ["DRAFT", "PACKED"] } } },
      _sum: { dispatchedQuantity: true },
    }),
  ]);
  const openByItem = new Map(openLines.map((l) => [l.salesOrderItemId, Number(l._sum.dispatchedQuantity ?? 0)]));
  for (const item of items) {
    result.set(item.id, { shipped: Number(item.dispatchedQuantity), inProgress: openByItem.get(item.id) ?? 0 });
  }
  return result;
}

function readinessFor(
  order: { status: string; salesOrderItemId: string | null },
  progress: ProductionOrderProgress | undefined,
  dispatchQty: DispatchQuantities | undefined
): DispatchReadiness {
  if (!progress || !READINESS_ELIGIBLE_STATUSES.has(order.status) || !isFullyProcessed(progress)) return null;
  if (order.salesOrderItemId && dispatchQty) {
    // Only a confirmed (shipped) dispatch counts — a Draft/Packed one hasn't left yet.
    if (dispatchQty.shipped >= progress.producedQuantity - EPSILON) return "DISPATCHED";
  }
  return "READY_FOR_DISPATCH";
}

/** Adds `dispatchReadiness` (+ produced/dispatched figures) to a page of production orders. */
export async function attachDispatchReadiness<T extends { id: string; status: string; plannedQuantity: unknown; salesOrderItemId: string | null }>(
  companyId: string,
  orders: T[]
): Promise<Array<T & { dispatchReadiness: DispatchReadiness; producedQuantity: number }>> {
  const progress = await getProgressForOrders(companyId, orders);
  const dispatchQty = await dispatchQuantitiesByItem(
    [...new Set(orders.map((o) => o.salesOrderItemId).filter((id): id is string => !!id))]
  );
  return orders.map((order) => {
    const p = progress.get(order.id);
    return {
      ...order,
      producedQuantity: p?.producedQuantity ?? 0,
      dispatchReadiness: readinessFor(order, p, order.salesOrderItemId ? dispatchQty.get(order.salesOrderItemId) : undefined),
    };
  });
}

export interface ReadyForDispatchRow {
  productionOrderId: string;
  productionOrderNumber: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  salesOrderItemId: string | null;
  customerName: string | null;
  style: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  shippedQuantity: number;
  inProgressDispatchQuantity: number;
  pendingDispatchQuantity: number;
  jobWork: Array<{ id: string; jobWorkNumber: string; status: string; receivedQuantity: number; contractorName: string }>;
}

type ReadyProductionOrder = {
  id: string;
  orderNumber: string;
  status: string;
  plannedQuantity: unknown;
  salesOrderItemId: string | null;
  product: { styleName: string; styleCode: string } | null;
  salesOrderItem: { salesOrder: { id: string; orderNumber: string; status: string; customer: { name: string } | null } } | null;
};

/**
 * The real "has something genuinely dispatchable" computation, shared by
 * `listReadyForDispatch` (the Dispatch page's own panel) and
 * `listDispatchEligibleSalesOrders` (the New Dispatch form's own Sales Order
 * picker) — a single source of truth, so the picker can never offer an order
 * the panel itself wouldn't consider ready, and vice versa. Returns the
 * already-computed progress/dispatch-quantity maps alongside the filtered
 * orders so neither caller needs to re-run those same queries a second time.
 */
async function findReadyProductionOrders(actor: { companyId: string; userId: string }): Promise<{
  ready: ReadyProductionOrder[];
  progress: Map<string, ProductionOrderProgress>;
  dispatchQty: Map<string, DispatchQuantities>;
}> {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const orders = await prisma.productionOrder.findMany({
    where: {
      companyId: actor.companyId,
      ...branchScopeWhere(allowedBranchIds),
      status: { in: ["PLANNED", "MATERIAL_ALLOCATED", "IN_PROGRESS", "CLOSED"] },
      lots: { some: { status: { in: ["IN_PROGRESS", "COMPLETED"] } } },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      plannedQuantity: true,
      salesOrderItemId: true,
      product: { select: { styleName: true, styleCode: true } },
      salesOrderItem: {
        select: { salesOrder: { select: { id: true, orderNumber: true, status: true, customer: { select: { name: true } } } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const progress = await getProgressForOrders(actor.companyId, orders);
  const dispatchQty = await dispatchQuantitiesByItem(
    [...new Set(orders.map((o) => o.salesOrderItemId).filter((id): id is string => !!id))]
  );

  const ready = orders.filter((o) => {
    const p = progress.get(o.id);
    const so = o.salesOrderItem?.salesOrder;
    if (so && !SALES_ORDER_DISPATCHABLE.has(so.status)) return false;
    return readinessFor(o, p, o.salesOrderItemId ? dispatchQty.get(o.salesOrderItemId) : undefined) === "READY_FOR_DISPATCH";
  });

  return { ready, progress, dispatchQty };
}

export interface DispatchEligibleSalesOrder {
  id: string;
  orderNumber: string;
  status: string;
}

/**
 * The real, server-derived set of Sales Orders worth offering in the New
 * Dispatch form's own picker — process-flow clarity fix (2026-10-16), spec
 * §3: "The Sales Order selection list must show only orders with eligible,
 * packed quantities remaining for dispatch."
 *
 * The union of two sets, not just one:
 *   1. Orders with at least one line that genuinely has dispatchable
 *      (Packing-complete, not-yet-shipped) quantity remaining — reuses the
 *      exact same readiness computation the "For Dispatching" panel already
 *      proved correct, rather than a second, parallel eligibility rule this
 *      picker could drift from.
 *   2. Orders already fully DISPATCHED. These have nothing left for REGULAR
 *      fulfillment (readinessFor() correctly excludes them from set 1), but
 *      Extra Dispatch Quantity (2026-09-30) was deliberately designed to
 *      stay reachable against them — a replacement, a free/FOC piece, or an
 *      extra sample against an order the system already considers fully
 *      shipped. Dropping them from this picker would silently break that
 *      already-shipped feature; see DISPATCH_ELIGIBLE_ORDER_STATUSES's own
 *      comment in dispatch.service.ts for the full reasoning.
 */
export async function listDispatchEligibleSalesOrders(actor: { companyId: string; userId: string }): Promise<DispatchEligibleSalesOrder[]> {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const [{ ready }, dispatchedOrders] = await Promise.all([
    findReadyProductionOrders(actor),
    prisma.salesOrder.findMany({
      where: { companyId: actor.companyId, ...branchScopeWhere(allowedBranchIds), status: "DISPATCHED" },
      select: { id: true, orderNumber: true, status: true },
    }),
  ]);

  const byId = new Map<string, DispatchEligibleSalesOrder>();
  for (const order of ready) {
    const so = order.salesOrderItem?.salesOrder;
    if (so && !byId.has(so.id)) byId.set(so.id, { id: so.id, orderNumber: so.orderNumber, status: so.status });
  }
  for (const so of dispatchedOrders) {
    if (!byId.has(so.id)) byId.set(so.id, so);
  }
  return [...byId.values()].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
}

/**
 * Production orders whose pieces are all finished and still have something
 * left to ship — the Dispatch page's "For Dispatching" list. Fully-received
 * job-work orders on the same lots are listed alongside as the source of
 * those pieces.
 */
export async function listReadyForDispatch(actor: { companyId: string; userId: string }): Promise<ReadyForDispatchRow[]> {
  const { ready, progress, dispatchQty } = await findReadyProductionOrders(actor);

  const jobWork = ready.length
    ? await prisma.jobWorkOrder.findMany({
        where: {
          companyId: actor.companyId,
          status: { in: ["FULLY_RECEIVED", "CLOSED"] },
          jobOrder: { lot: { productionOrderId: { in: ready.map((o) => o.id) } } },
        },
        select: {
          id: true,
          jobWorkNumber: true,
          status: true,
          receivedQuantity: true,
          contractor: { select: { name: true } },
          jobOrder: { select: { lot: { select: { productionOrderId: true } } } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return ready.map((o) => {
    const p = progress.get(o.id)!;
    const q = (o.salesOrderItemId && dispatchQty.get(o.salesOrderItemId)) || { shipped: 0, inProgress: 0 };
    const so = o.salesOrderItem?.salesOrder ?? null;
    return {
      productionOrderId: o.id,
      productionOrderNumber: o.orderNumber,
      salesOrderId: so?.id ?? null,
      salesOrderNumber: so?.orderNumber ?? null,
      salesOrderItemId: o.salesOrderItemId,
      customerName: so?.customer?.name ?? null,
      style: o.product ? `${o.product.styleName} (${o.product.styleCode})` : "—",
      plannedQuantity: p.plannedQuantity,
      producedQuantity: p.producedQuantity,
      rejectedQuantity: p.rejectedQuantity,
      shippedQuantity: q.shipped,
      inProgressDispatchQuantity: q.inProgress,
      pendingDispatchQuantity: Math.max(0, Math.round((p.producedQuantity - q.shipped - q.inProgress) * 100) / 100),
      jobWork: jobWork
        .filter((jw) => jw.jobOrder.lot.productionOrderId === o.id)
        .map((jw) => ({
          id: jw.id,
          jobWorkNumber: jw.jobWorkNumber,
          status: jw.status,
          receivedQuantity: Number(jw.receivedQuantity),
          contractorName: jw.contractor.name,
        })),
    };
  });
}

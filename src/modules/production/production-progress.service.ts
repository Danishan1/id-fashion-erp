import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

const EPSILON = 0.0001;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type ProductionProgressStatus = "PLANNED" | "IN_PRODUCTION" | "PARTIALLY_COMPLETED" | "COMPLETED" | "OVER_PRODUCED";

export interface LotProgressRow {
  lotId: string;
  lotNumber: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  status: string;
}

export interface ProductionOrderProgress {
  productionOrderId: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  balanceQuantity: number;
  overProductionQuantity: number;
  progressPercent: number;
  progressStatus: ProductionProgressStatus;
  lots: LotProgressRow[];
}

/**
 * The one place "how many units has this Production Order actually
 * finished, and how many are genuinely lost" gets computed — derived purely
 * from the existing Lot/JobOrder/ProductionStageTransaction ledger, never a
 * separate stored counter (this project's own strongest architectural
 * discipline: derive, don't duplicate — see Lot.currentStageId's own
 * "cache only, never source of truth" precedent).
 *
 * producedQuantity = sum of JobOrder.completedQuantity across every JobOrder
 * sitting at a `productionStage.isFinal` stage. A unit is only ever
 * finalized once (completeAtFinalStageInTx sets it exactly once per
 * final-stage JobOrder row, and a lot revisiting the same final stage after
 * rework gets a brand-new row rather than mutating an old one — see
 * schema.prisma's own note on JobOrder not being unique on
 * (lotId, productionStageId)), so this sum can never double-count a
 * physical unit.
 *
 * rejectedQuantity = sum of "permanently lost" units — damagedQuantity
 * (which schema/service code never returns to the flow) plus whatever
 * portion of rejectedQuantity was NOT immediately re-routed for rework.
 * QC's own rejectedQuantity write (applyQcDispositionInTx) always happens
 * inside the same transaction as a matching outgoing REWORK
 * ProductionStageTransaction of the identical quantity (see
 * recordQcInspection), so netting rejectedQuantity against that JobOrder's
 * own outgoing REWORK-transaction total correctly zeroes out any rejection
 * that was actually sent onward for rework (it will show up again later,
 * either in producedQuantity once it finishes, or back in rejectedQuantity
 * if it fails again) — only a plain-progress-entry rejection (which has no
 * rework routing at all) survives this net as genuinely, permanently lost.
 * Without this net, a reworked-then-finished unit would be double-counted:
 * once in "rejected" (from the original QC call) and again in "produced"
 * (once it actually finishes) — exactly the "produced quantity cannot be
 * incorrectly duplicated" requirement this function exists to satisfy.
 */
async function computeProgressForOrders(
  companyId: string,
  orders: Array<{ id: string; plannedQuantity: unknown }>
): Promise<Map<string, ProductionOrderProgress>> {
  const result = new Map<string, ProductionOrderProgress>();
  if (orders.length === 0) return result;

  const lots = await prisma.lot.findMany({
    where: { companyId, productionOrderId: { in: orders.map((o) => o.id) } },
    select: { id: true, lotNumber: true, quantity: true, status: true, productionOrderId: true },
    orderBy: { createdAt: "asc" },
  });

  const lotIds = lots.map((l) => l.id);
  const jobOrders =
    lotIds.length === 0
      ? []
      : await prisma.jobOrder.findMany({
          where: { lotId: { in: lotIds } },
          select: {
            id: true,
            lotId: true,
            completedQuantity: true,
            rejectedQuantity: true,
            damagedQuantity: true,
            productionStage: { select: { isFinal: true } },
          },
        });

  const jobOrderIds = jobOrders.map((j) => j.id);
  const reworkOut =
    jobOrderIds.length === 0
      ? []
      : await prisma.productionStageTransaction.groupBy({
          by: ["fromJobOrderId"],
          where: { fromJobOrderId: { in: jobOrderIds }, transactionType: "REWORK" },
          _sum: { quantity: true },
        });
  const reworkByJobOrderId = new Map(reworkOut.map((r) => [r.fromJobOrderId as string, Number(r._sum.quantity ?? 0)]));

  function lotLostQuantity(jo: (typeof jobOrders)[number]): number {
    const netRejected = Math.max(0, Number(jo.rejectedQuantity) - (reworkByJobOrderId.get(jo.id) ?? 0));
    return Number(jo.damagedQuantity) + netRejected;
  }

  const lotsByOrderId = new Map<string, typeof lots>();
  for (const lot of lots) {
    const list = lotsByOrderId.get(lot.productionOrderId) ?? [];
    list.push(lot);
    lotsByOrderId.set(lot.productionOrderId, list);
  }

  for (const order of orders) {
    const orderLots = lotsByOrderId.get(order.id) ?? [];
    const lotRows: LotProgressRow[] = orderLots.map((lot) => {
      const lotJobOrders = jobOrders.filter((j) => j.lotId === lot.id);
      const produced = lotJobOrders.filter((j) => j.productionStage.isFinal).reduce((s, j) => s + Number(j.completedQuantity), 0);
      const rejected = lotJobOrders.reduce((s, j) => s + lotLostQuantity(j), 0);
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        plannedQuantity: Number(lot.quantity),
        producedQuantity: round2(produced),
        rejectedQuantity: round2(rejected),
        status: lot.status,
      };
    });

    const plannedQuantity = Number(order.plannedQuantity);
    const producedQuantity = round2(lotRows.reduce((s, l) => s + l.producedQuantity, 0));
    const rejectedQuantity = round2(lotRows.reduce((s, l) => s + l.rejectedQuantity, 0));
    const balanceQuantity = round2(Math.max(0, plannedQuantity - producedQuantity - rejectedQuantity));
    const overProductionQuantity = round2(Math.max(0, producedQuantity - plannedQuantity));
    const progressPercent = plannedQuantity > 0 ? round2((producedQuantity / plannedQuantity) * 100) : 0;

    const hasAnyActivity = orderLots.some((l) => l.status !== "PLANNED");
    let progressStatus: ProductionProgressStatus;
    if (producedQuantity > plannedQuantity + EPSILON) progressStatus = "OVER_PRODUCED";
    else if (producedQuantity >= plannedQuantity - EPSILON) progressStatus = "COMPLETED";
    else if (producedQuantity > 0) progressStatus = "PARTIALLY_COMPLETED";
    else if (hasAnyActivity) progressStatus = "IN_PRODUCTION";
    else progressStatus = "PLANNED";

    result.set(order.id, {
      productionOrderId: order.id,
      plannedQuantity,
      producedQuantity,
      rejectedQuantity,
      balanceQuantity,
      overProductionQuantity,
      progressPercent,
      progressStatus,
      lots: lotRows,
    });
  }

  return result;
}

export async function getProductionOrderProgress(companyId: string, productionOrderId: string): Promise<ProductionOrderProgress> {
  const order = await prisma.productionOrder.findFirst({
    where: { id: productionOrderId, companyId },
    select: { id: true, plannedQuantity: true },
  });
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });

  const map = await computeProgressForOrders(companyId, [order]);
  return map.get(productionOrderId)!;
}

export interface SalesOrderItemProductionSummary {
  salesOrderItemId: string;
  orderedTotal: number;
  totalPlanned: number;
  totalProduced: number;
  totalRejected: number;
  /** How much of what the customer actually ordered still isn't finished —
   * max(0, orderedTotal - totalProduced). Independent of totalPlanned. */
  remainingProduction: number;
  /** Planning (not necessarily production) has exceeded what was ordered —
   * max(0, totalPlanned - orderedTotal). A distinct concept from any single
   * Production Order's own overProductionQuantity (which compares its
   * produced quantity against its OWN plan, not the Sales Order). */
  overPlannedVsOrdered: number;
  productionOrders: Array<{
    id: string;
    orderNumber: string;
    plannedQuantity: number;
    producedQuantity: number;
    rejectedQuantity: number;
    progressStatus: ProductionProgressStatus;
  }>;
}

/**
 * Aggregates every non-cancelled Production Order linked to one Sales Order
 * line — never touches SalesOrderItem/SalesOrder itself, purely a read-only
 * rollup, same "informational, never a cap" discipline already established
 * for getSalesOrderLineCommitment (production-order.service.ts).
 */
export async function getSalesOrderItemProductionSummary(
  companyId: string,
  salesOrderItemId: string
): Promise<SalesOrderItemProductionSummary> {
  const item = await prisma.salesOrderItem.findFirst({
    where: { id: salesOrderItemId, salesOrder: { companyId } },
    include: { breakdown: true },
  });
  if (!item) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: salesOrderItemId });

  const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);

  const orders = await prisma.productionOrder.findMany({
    where: { salesOrderItemId, status: { not: "CANCELLED" } },
    select: { id: true, orderNumber: true, plannedQuantity: true },
    orderBy: { createdAt: "asc" },
  });

  const progressMap = await computeProgressForOrders(companyId, orders);

  const productionOrders = orders.map((o) => {
    const progress = progressMap.get(o.id)!;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      plannedQuantity: progress.plannedQuantity,
      producedQuantity: progress.producedQuantity,
      rejectedQuantity: progress.rejectedQuantity,
      progressStatus: progress.progressStatus,
    };
  });

  const totalPlanned = round2(productionOrders.reduce((s, o) => s + o.plannedQuantity, 0));
  const totalProduced = round2(productionOrders.reduce((s, o) => s + o.producedQuantity, 0));
  const totalRejected = round2(productionOrders.reduce((s, o) => s + o.rejectedQuantity, 0));

  return {
    salesOrderItemId,
    orderedTotal,
    totalPlanned,
    totalProduced,
    totalRejected,
    remainingProduction: round2(Math.max(0, orderedTotal - totalProduced)),
    overPlannedVsOrdered: round2(Math.max(0, totalPlanned - orderedTotal)),
    productionOrders,
  };
}

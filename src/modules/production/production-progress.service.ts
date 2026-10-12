import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getAvailableQuantity } from "@/modules/inventory/inventory.service";

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
  // QC-sourced figures (2026-10-10, Dispatch quantity visibility) — summed
  // directly from real QcInspection rows, deliberately NOT derived from
  // JobOrder.qcPassedQuantity (that field tracks "has been inspected", not
  // "passed" — it increments by the full inspectedQuantity on every call
  // regardless of outcome). qcAcceptedQuantity is the one genuinely
  // "QC-Passed" figure a Dispatch screen should ever show.
  qcAcceptedQuantity: number;
  qcRejectedQuantity: number;
  qcDamagedQuantity: number;
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
  totalQcAccepted: number;
  totalQcRejected: number;
  totalQcDamaged: number;
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

  // QC-accepted/rejected/damaged (2026-10-10, Dispatch quantity visibility)
  // — summed directly from real QcInspection rows per lot, grouped in JS
  // (one small query over an already-small lot set, not a Prisma groupBy)
  // since we need the per-lot breakdown, not just a company-wide total.
  // Deliberately a separate figure from the JobOrder-derived
  // produced/rejected above (QC may re-inspect the same completed batch
  // more than once across its life; this reports the real QC event log,
  // not a re-derivation of the production ledger).
  const qcInspections =
    lotIds.length === 0
      ? []
      : await prisma.qcInspection.findMany({
          where: { lotId: { in: lotIds } },
          select: { lotId: true, acceptedQuantity: true, rejectedQuantity: true, damagedQuantity: true },
        });
  const qcByLotId = new Map<string, { accepted: number; rejected: number; damaged: number }>();
  for (const qc of qcInspections) {
    const current = qcByLotId.get(qc.lotId) ?? { accepted: 0, rejected: 0, damaged: 0 };
    current.accepted += Number(qc.acceptedQuantity);
    current.rejected += Number(qc.rejectedQuantity);
    current.damaged += Number(qc.damagedQuantity);
    qcByLotId.set(qc.lotId, current);
  }

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
      const qc = qcByLotId.get(lot.id) ?? { accepted: 0, rejected: 0, damaged: 0 };
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        plannedQuantity: Number(lot.quantity),
        producedQuantity: round2(produced),
        rejectedQuantity: round2(rejected),
        status: lot.status,
        qcAcceptedQuantity: round2(qc.accepted),
        qcRejectedQuantity: round2(qc.rejected),
        qcDamagedQuantity: round2(qc.damaged),
      };
    });

    const plannedQuantity = Number(order.plannedQuantity);
    const producedQuantity = round2(lotRows.reduce((s, l) => s + l.producedQuantity, 0));
    const rejectedQuantity = round2(lotRows.reduce((s, l) => s + l.rejectedQuantity, 0));
    const totalQcAccepted = round2(lotRows.reduce((s, l) => s + l.qcAcceptedQuantity, 0));
    const totalQcRejected = round2(lotRows.reduce((s, l) => s + l.qcRejectedQuantity, 0));
    const totalQcDamaged = round2(lotRows.reduce((s, l) => s + l.qcDamagedQuantity, 0));
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
      totalQcAccepted,
      totalQcRejected,
      totalQcDamaged,
    });
  }

  return result;
}

/**
 * Real-Lot traceability behind a warehouse's Finished-Goods stock for one
 * product (2026-10-10, multi-lot dispatch visibility) — sums every
 * PRODUCTION_RECEIPT ever posted (completeAtFinalStageInTx's own
 * `referenceModule: "PRODUCTION_ORDER", referenceRecordId: lotId`
 * convention, confirmed against that function directly rather than assumed)
 * grouped by lot, then joins back to each lot's own real row. Purely
 * informational — never used to gate or cap a dispatch quantity, since FG
 * stock is pooled per product+warehouse, not segregated per lot; this only
 * answers "which batches contributed to what's on hand," for a dispatcher
 * who wants that context.
 */
async function getContributingLots(companyId: string, productId: string, warehouseId: string) {
  const receipts = await prisma.inventoryTransaction.groupBy({
    by: ["referenceRecordId"],
    where: { companyId, productId, warehouseId, transactionType: "PRODUCTION_RECEIPT", referenceModule: "PRODUCTION_ORDER" },
    _sum: { quantity: true },
  });
  if (receipts.length === 0) return [];

  const lotIds = receipts.map((r) => r.referenceRecordId);
  const lots = await prisma.lot.findMany({
    where: { id: { in: lotIds }, companyId },
    select: {
      id: true,
      lotNumber: true,
      productionOrder: { select: { id: true, orderNumber: true, salesOrderItemId: true } },
    },
  });
  const lotById = new Map(lots.map((l) => [l.id, l]));

  return receipts
    .map((r) => {
      const lot = lotById.get(r.referenceRecordId);
      if (!lot) return null;
      return {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        quantity: round2(Number(r._sum.quantity ?? 0)),
        productionOrderId: lot.productionOrder.id,
        productionOrderNumber: lot.productionOrder.orderNumber,
        orderedForSalesOrderItemId: lot.productionOrder.salesOrderItemId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber));
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
  // QC-sourced totals (2026-10-10, Dispatch quantity visibility) — summed
  // from real QcInspection rows across every lot of every non-cancelled
  // Production Order for this line. totalQcAccepted is the genuinely
  // "QC-Passed" figure; see LotProgressRow's own doc comment for why this
  // is deliberately NOT JobOrder.qcPassedQuantity.
  totalQcAccepted: number;
  totalQcRejected: number;
  totalQcDamaged: number;
  /**
   * Real Finished-Goods stock on hand for this line's product at the given
   * warehouse (the SAME figure Dispatch's own confirmDispatch() stock check
   * reads, via the existing getAvailableQuantity() — never a separate,
   * narrower "packing-ready" number). Only present when a warehouseId was
   * supplied; this module has no concept of "packed but not yet in a
   * dispatch" distinct from plain available stock — packing happens inside
   * a specific Dispatch's own Cartons (see dispatch.service.ts), there is no
   * pre-dispatch "packing-ready pool" to report a narrower figure for.
   * null means "not computed" (no warehouseId given), distinct from a real
   * computed 0.
   */
  availableStock: number | null;
  productionOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    plannedQuantity: number;
    producedQuantity: number;
    rejectedQuantity: number;
    progressStatus: ProductionProgressStatus;
    /** Release to Dispatch gate (2026-10-10) — null means not yet released;
     * a non-cancelled Production Order linked to this line that hasn't been
     * released blocks Dispatch creation for the quantity it covers (see
     * dispatch.service.ts's own createDispatch()). */
    releasedToDispatchAt: string | null;
    releasedToDispatchByUserName: string | null;
  }>;
  /**
   * Which real Lots' Finished-Goods receipts make up the available stock
   * figure above — purely informational traceability (2026-10-10, multi-lot
   * dispatch visibility), derived from InventoryTransaction's own existing
   * `referenceModule: "PRODUCTION_RECEIPT" / referenceRecordId: lotId`
   * convention (see completeAtFinalStageInTx), never a new ledger dimension.
   * Reflects every PRODUCTION_RECEIPT ever posted for this product at this
   * warehouse (not scoped to this Sales Order line specifically — stock is
   * pooled once it reaches Finished Goods, so a lot from a different order's
   * own Production Order can legitimately show up here too; each row's own
   * productionOrderNumber/orderedForSalesOrderItemId lets a reader tell which
   * is which). Empty array (not null) when a warehouseId was supplied but
   * nothing has posted yet; null entirely mirrors availableStock's own
   * "not computed" convention when no warehouseId was given.
   */
  contributingLots: Array<{
    lotId: string;
    lotNumber: string;
    quantity: number;
    productionOrderId: string;
    productionOrderNumber: string;
    orderedForSalesOrderItemId: string | null;
  }> | null;
}

/**
 * Aggregates every non-cancelled Production Order linked to one Sales Order
 * line — never touches SalesOrderItem/SalesOrder itself, purely a read-only
 * rollup, same "informational, never a cap" discipline already established
 * for getSalesOrderLineCommitment (production-order.service.ts).
 *
 * All figures here are STYLE-level (this Sales Order line as a whole), never
 * split by ProductVariant/Colour/Size — Production's own data genuinely has
 * no variant dimension (Lot/JobOrder/QcInspection all operate on a Lot's
 * flat quantity; LotVariantBreakdown is explicitly informational-only and
 * never flows through completed/rejected/damaged/qcPassed, see its own
 * schema.prisma comment). Only the Sales Order's own already-variant-level
 * data (orderedQuantity per breakdown row) can be shown accurately per
 * variant — reporting a per-variant production/QC split here would mean
 * fabricating a proportional estimate the real data doesn't support.
 */
export async function getSalesOrderItemProductionSummary(
  companyId: string,
  salesOrderItemId: string,
  warehouseId?: string
): Promise<SalesOrderItemProductionSummary> {
  const item = await prisma.salesOrderItem.findFirst({
    where: { id: salesOrderItemId, salesOrder: { companyId } },
    include: { breakdown: true },
  });
  if (!item) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: salesOrderItemId });

  const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);

  const orders = await prisma.productionOrder.findMany({
    where: { salesOrderItemId, status: { not: "CANCELLED" } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      plannedQuantity: true,
      releasedToDispatchAt: true,
      releasedToDispatchBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const progressMap = await computeProgressForOrders(companyId, orders);

  const productionOrders = orders.map((o) => {
    const progress = progressMap.get(o.id)!;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      plannedQuantity: progress.plannedQuantity,
      producedQuantity: progress.producedQuantity,
      rejectedQuantity: progress.rejectedQuantity,
      progressStatus: progress.progressStatus,
      releasedToDispatchAt: o.releasedToDispatchAt?.toISOString() ?? null,
      releasedToDispatchByUserName: o.releasedToDispatchBy?.fullName ?? null,
    };
  });

  const totalPlanned = round2(productionOrders.reduce((s, o) => s + o.plannedQuantity, 0));
  const totalProduced = round2(productionOrders.reduce((s, o) => s + o.producedQuantity, 0));
  const totalRejected = round2(productionOrders.reduce((s, o) => s + o.rejectedQuantity, 0));
  const totalQcAccepted = round2(orders.reduce((s, o) => s + (progressMap.get(o.id)?.totalQcAccepted ?? 0), 0));
  const totalQcRejected = round2(orders.reduce((s, o) => s + (progressMap.get(o.id)?.totalQcRejected ?? 0), 0));
  const totalQcDamaged = round2(orders.reduce((s, o) => s + (progressMap.get(o.id)?.totalQcDamaged ?? 0), 0));

  const availableStock = warehouseId ? await getAvailableQuantity(companyId, item.productId, warehouseId) : null;
  const contributingLots = warehouseId
    ? await getContributingLots(companyId, item.productId, warehouseId)
    : null;

  return {
    salesOrderItemId,
    orderedTotal,
    totalPlanned,
    totalProduced,
    totalRejected,
    remainingProduction: round2(Math.max(0, orderedTotal - totalProduced)),
    overPlannedVsOrdered: round2(Math.max(0, totalPlanned - orderedTotal)),
    totalQcAccepted,
    totalQcRejected,
    contributingLots,
    totalQcDamaged,
    availableStock,
    productionOrders,
  };
}

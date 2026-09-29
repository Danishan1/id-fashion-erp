import { prisma } from "@/core/db/client";
import { materialRequestScopeForOrder } from "./material-request-scope";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

function r4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export type StageTimelineStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "IN_PROGRESS"
  | "AT_JOB_WORK"
  | "READY_TO_FORWARD"
  | "COMPLETED";

export interface StageTimelineRow {
  stageId: string;
  stageName: string;
  sequence: number;
  isFinal: boolean;
  /** Pieces that reached this stage (sum of its job orders' planned quantity). */
  receivedQuantity: number;
  /** Pieces handed to workers (non-cancelled assignments). */
  assignedQuantity: number;
  completedQuantity: number;
  rejectedQuantity: number;
  damagedQuantity: number;
  extraQuantity: number;
  /** Pieces sent to external job work from this stage (non-cancelled job work orders). */
  sentToJobWorkQuantity: number;
  /** Good pieces received back from job work that was sent from this stage. */
  receivedFromJobWorkQuantity: number;
  jobWorkRejectedQuantity: number;
  jobWorkDamagedQuantity: number;
  /** Sent to job work but not yet received/rejected/damaged. */
  pendingAtJobWorkQuantity: number;
  /** Moved on to the next stage (forward or QC-accepted). */
  forwardedQuantity: number;
  /** Completed here and not yet moved on — what can go to the next stage right now. */
  availableForNextStageQuantity: number;
  status: StageTimelineStatus;
}

type TimelineScope = { lotId: string } | { productionOrderId: string };

/**
 * Stage-wise production timeline (2026-09-29) — one row per production stage,
 * in stage order, showing exactly how much reached it, was assigned, done,
 * sent to / received from job work, rejected/damaged, moved on, and what is
 * still available for the next stage. Computed straight from the job order
 * and job work ledgers (never stored), for one lot or rolled up across every
 * lot of a production order.
 */
export async function getStageTimeline(companyId: string, scope: TimelineScope): Promise<StageTimelineRow[]> {
  const jobOrderWhere =
    "lotId" in scope
      ? { companyId, lotId: scope.lotId, status: { not: "CANCELLED" as const } }
      : { companyId, productionOrderId: scope.productionOrderId, status: { not: "CANCELLED" as const } };

  const [stages, jobOrders] = await Promise.all([
    prisma.productionStage.findMany({
      where: { companyId, isActive: true },
      orderBy: { sequence: "asc" },
      select: { id: true, name: true, sequence: true, isFinal: true },
    }),
    prisma.jobOrder.findMany({
      where: jobOrderWhere,
      select: {
        id: true,
        productionStageId: true,
        plannedQuantity: true,
        completedQuantity: true,
        rejectedQuantity: true,
        damagedQuantity: true,
        extraQuantity: true,
        forwardedQuantity: true,
        productionStage: { select: { id: true, name: true, sequence: true, isFinal: true } },
        assignments: { where: { status: { not: "CANCELLED" } }, select: { assignedQuantity: true } },
        jobWorkOrders: {
          where: { status: { not: "CANCELLED" } },
          select: { issuedQuantity: true, receivedQuantity: true, rejectedQuantity: true, damagedQuantity: true },
        },
      },
    }),
  ]);

  // Inactive stages still show if real work sits on them.
  const stageById = new Map(stages.map((s) => [s.id, s]));
  for (const jo of jobOrders) if (!stageById.has(jo.productionStageId)) stageById.set(jo.productionStageId, jo.productionStage);

  const rows = [...stageById.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage): StageTimelineRow => {
      const atStage = jobOrders.filter((j) => j.productionStageId === stage.id);
      const sum = (f: (j: (typeof atStage)[number]) => number) => r4(atStage.reduce((s, j) => s + f(j), 0));

      const receivedQuantity = sum((j) => Number(j.plannedQuantity));
      const completedQuantity = sum((j) => Number(j.completedQuantity));
      const rejectedQuantity = sum((j) => Number(j.rejectedQuantity));
      const damagedQuantity = sum((j) => Number(j.damagedQuantity));
      const extraQuantity = sum((j) => Number(j.extraQuantity));
      const forwardedQuantity = sum((j) => Number(j.forwardedQuantity));
      const assignedQuantity = sum((j) => j.assignments.reduce((s, a) => s + Number(a.assignedQuantity), 0));
      const jw = (f: (w: (typeof atStage)[number]["jobWorkOrders"][number]) => number) =>
        sum((j) => j.jobWorkOrders.reduce((s, w) => s + f(w), 0));
      const sentToJobWorkQuantity = jw((w) => Number(w.issuedQuantity));
      const receivedFromJobWorkQuantity = jw((w) => Number(w.receivedQuantity));
      const jobWorkRejectedQuantity = jw((w) => Number(w.rejectedQuantity));
      const jobWorkDamagedQuantity = jw((w) => Number(w.damagedQuantity));
      const pendingAtJobWorkQuantity = r4(
        Math.max(0, sentToJobWorkQuantity - receivedFromJobWorkQuantity - jobWorkRejectedQuantity - jobWorkDamagedQuantity)
      );
      const availableForNextStageQuantity = stage.isFinal ? 0 : r4(Math.max(0, completedQuantity - forwardedQuantity));

      let status: StageTimelineStatus;
      if (atStage.length === 0) status = "NOT_STARTED";
      else if (pendingAtJobWorkQuantity > 0) status = "AT_JOB_WORK";
      else if (availableForNextStageQuantity > 0) status = "READY_TO_FORWARD";
      else if (completedQuantity + rejectedQuantity + damagedQuantity >= receivedQuantity + extraQuantity - 0.0001 && receivedQuantity > 0)
        status = "COMPLETED";
      else if (completedQuantity + rejectedQuantity + damagedQuantity > 0 || assignedQuantity > 0 || sentToJobWorkQuantity > 0)
        status = "IN_PROGRESS";
      else status = "PENDING";

      return {
        stageId: stage.id,
        stageName: stage.name.trim(),
        sequence: stage.sequence,
        isFinal: stage.isFinal,
        receivedQuantity,
        assignedQuantity,
        completedQuantity,
        rejectedQuantity,
        damagedQuantity,
        extraQuantity,
        sentToJobWorkQuantity,
        receivedFromJobWorkQuantity,
        jobWorkRejectedQuantity,
        jobWorkDamagedQuantity,
        pendingAtJobWorkQuantity,
        forwardedQuantity,
        availableForNextStageQuantity,
        status,
      };
    });

  return rows;
}

export type ProductionHistoryAction =
  | "LOT_CREATED"
  | "ASSIGNED"
  | "MATERIAL_REQUESTED"
  | "MATERIAL_ISSUED"
  | "MOVED_TO_NEXT_STAGE"
  | "REWORK"
  | "ADJUSTMENT"
  | "PROGRESS_LOGGED"
  | "QC_INSPECTED"
  | "SENT_TO_JOB_WORK"
  | "JOB_WORK_RECEIVED"
  | "EXTRA_PRODUCTION_CREATED";

export interface ProductionHistoryEvent {
  at: string;
  action: ProductionHistoryAction;
  user: string;
  productionOrder: string;
  salesOrder: string | null;
  lot: string | null;
  stage: string | null;
  /** Next stage for a movement / job-work receipt, when there is one. */
  nextStage: string | null;
  assignedQuantity: number | null;
  sentQuantity: number | null;
  receivedQuantity: number | null;
  rejectedQuantity: number | null;
  damagedQuantity: number | null;
  /** The event's own main quantity (moved, issued, logged, added…). */
  quantity: number | null;
  remarks: string;
}

function blankEvent(base: Pick<ProductionHistoryEvent, "at" | "action" | "user" | "productionOrder" | "salesOrder">): ProductionHistoryEvent {
  return {
    ...base,
    lot: null,
    stage: null,
    nextStage: null,
    assignedQuantity: null,
    sentQuantity: null,
    receivedQuantity: null,
    rejectedQuantity: null,
    damagedQuantity: null,
    quantity: null,
    remarks: "",
  };
}

/**
 * Production audit trail (2026-09-29): every quantity movement for a lot (or
 * a whole production order) in date order — lot creation, worker
 * assignments, material requests/issues, stage movements, progress, QC, job
 * work sent/received (with the stage it was received at), and extra
 * production. Built from the real ledgers; nothing here is a second copy of
 * the data.
 */
export async function getProductionHistory(companyId: string, scope: TimelineScope): Promise<ProductionHistoryEvent[]> {
  let productionOrderId: string;
  let lotFilter: string | null = null;
  if ("lotId" in scope) {
    const lot = await prisma.lot.findFirst({ where: { id: scope.lotId, companyId }, select: { productionOrderId: true } });
    if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: scope.lotId });
    productionOrderId = lot.productionOrderId;
    lotFilter = scope.lotId;
  } else {
    productionOrderId = scope.productionOrderId;
  }

  const order = await prisma.productionOrder.findFirst({
    where: { id: productionOrderId, companyId },
    select: { orderNumber: true, salesOrderItemId: true, salesOrderItem: { select: { salesOrder: { select: { orderNumber: true } } } } },
  });
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  const po = order.orderNumber;
  const so = order.salesOrderItem?.salesOrder.orderNumber ?? null;

  const requestScope = await materialRequestScopeForOrder(companyId, productionOrderId, order.salesOrderItemId);

  const lotWhere = lotFilter ? { id: lotFilter } : { productionOrderId, companyId };
  const jobOrderLotWhere = lotFilter ? { lotId: lotFilter } : { lot: { productionOrderId, companyId } };

  const [lots, assignments, transactions, progressEntries, qcInspections, jobWorkOrders, materialRequests, quantityChanges, stages] =
    await Promise.all([
      prisma.lot.findMany({
        where: lotWhere,
        select: { lotNumber: true, quantity: true, createdAt: true, createdBy: { select: { fullName: true } } },
      }),
      prisma.jobOrderAssignment.findMany({
        where: { jobOrder: jobOrderLotWhere },
        select: {
          assignedAt: true,
          assignedQuantity: true,
          status: true,
          employee: { select: { fullName: true } },
          assignedBy: { select: { fullName: true } },
          jobOrder: { select: { lot: { select: { lotNumber: true } }, productionStage: { select: { name: true } } } },
        },
      }),
      prisma.productionStageTransaction.findMany({
        where: lotFilter ? { lotId: lotFilter } : { productionOrderId },
        select: {
          performedAt: true,
          transactionType: true,
          quantity: true,
          revertReason: true,
          notes: true,
          lot: { select: { lotNumber: true } },
          fromJobOrder: { select: { productionStage: { select: { name: true } } } },
          toProductionStage: { select: { name: true } },
          performedBy: { select: { fullName: true } },
        },
      }),
      prisma.jobOrderProgressEntry.findMany({
        where: { jobOrder: jobOrderLotWhere },
        select: {
          createdAt: true,
          completedQuantity: true,
          rejectedQuantity: true,
          damagedQuantity: true,
          extraQuantity: true,
          isAdjustment: true,
          approvalStatus: true,
          remarks: true,
          employee: { select: { fullName: true } },
          jobOrder: { select: { lot: { select: { lotNumber: true } }, productionStage: { select: { name: true } } } },
        },
      }),
      prisma.qcInspection.findMany({
        where: lotFilter ? { lotId: lotFilter } : { productionOrderId },
        select: {
          inspectedAt: true,
          result: true,
          inspectedQuantity: true,
          acceptedQuantity: true,
          rejectedQuantity: true,
          damagedQuantity: true,
          inspector: { select: { fullName: true } },
          jobOrder: { select: { lot: { select: { lotNumber: true } }, productionStage: { select: { name: true } } } },
        },
      }),
      prisma.jobWorkOrder.findMany({
        where: { jobOrder: jobOrderLotWhere },
        select: {
          jobWorkNumber: true,
          createdAt: true,
          issuedQuantity: true,
          status: true,
          remarks: true,
          contractor: { select: { name: true } },
          requestedBy: { select: { fullName: true } },
          jobOrder: { select: { lot: { select: { lotNumber: true } }, productionStage: { select: { name: true } } } },
          coveredStages: { orderBy: { sequence: "asc" }, select: { productionStage: { select: { name: true, sequence: true, isFinal: true } } } },
          receipts: {
            select: {
              receiptNumber: true,
              createdAt: true,
              receivedQuantity: true,
              rejectedQuantity: true,
              damagedQuantity: true,
              status: true,
              approvalStatus: true,
              remarks: true,
              receivedBy: { select: { fullName: true } },
            },
          },
        },
      }),
      // Material is requested/issued per production order, so it shows in a lot's history too.
      prisma.materialRequest.findMany({
        where: requestScope,
        select: {
          id: true,
          requestNumber: true,
          createdAt: true,
          status: true,
          requestedBy: { select: { fullName: true } },
          lines: { select: { id: true, requestedQuantity: true } },
        },
      }),
      prisma.productionOrderQuantityChange.findMany({
        where: { companyId, productionOrderId },
        select: { createdAt: true, previousQuantity: true, addedQuantity: true, newQuantity: true, reason: true, createdBy: { select: { fullName: true } } },
      }),
      prisma.productionStage.findMany({
        where: { companyId, isActive: true },
        orderBy: { sequence: "asc" },
        select: { name: true, sequence: true },
      }),
    ]);

  const nextStageName = (sequence: number) => stages.find((s) => s.sequence > sequence)?.name.trim() ?? null;
  const events: ProductionHistoryEvent[] = [];
  const base = (at: Date, action: ProductionHistoryAction, user: string) =>
    blankEvent({ at: at.toISOString(), action, user, productionOrder: po, salesOrder: so });

  for (const lot of lots) {
    events.push({ ...base(lot.createdAt, "LOT_CREATED", lot.createdBy.fullName), lot: lot.lotNumber, quantity: Number(lot.quantity) });
  }
  for (const a of assignments) {
    events.push({
      ...base(a.assignedAt, "ASSIGNED", a.assignedBy.fullName),
      lot: a.jobOrder.lot.lotNumber,
      stage: a.jobOrder.productionStage.name.trim(),
      assignedQuantity: Number(a.assignedQuantity),
      quantity: Number(a.assignedQuantity),
      remarks: `Assigned to ${a.employee.fullName}${a.status === "CANCELLED" ? " (cancelled)" : ""}`,
    });
  }
  for (const mr of materialRequests) {
    events.push({
      ...base(mr.createdAt, "MATERIAL_REQUESTED", mr.requestedBy.fullName),
      quantity: r4(mr.lines.reduce((s, i) => s + Number(i.requestedQuantity), 0)),
      remarks: `${mr.requestNumber} (${mr.status})`,
    });
  }
  const requestItemIds = materialRequests.flatMap((mr) => mr.lines.map((i) => i.id));
  if (requestItemIds.length > 0) {
    const numberByItem = new Map(materialRequests.flatMap((mr) => mr.lines.map((i) => [i.id, mr.requestNumber] as const)));
    const issues = await prisma.inventoryTransaction.findMany({
      where: { companyId, referenceModule: "MATERIAL_REQUEST", referenceRecordId: { in: requestItemIds }, transactionType: "MATERIAL_ISSUE" },
      select: {
        performedAt: true,
        quantity: true,
        referenceRecordId: true,
        product: { select: { styleName: true, baseUom: { select: { code: true } } } },
        performedBy: { select: { fullName: true } },
      },
    });
    for (const t of issues) {
      const qty = -Number(t.quantity);
      events.push({
        ...base(t.performedAt, "MATERIAL_ISSUED", t.performedBy.fullName),
        quantity: r4(qty),
        remarks: `${t.product.styleName}: ${r4(qty)} ${t.product.baseUom?.code ?? ""} issued against ${numberByItem.get(t.referenceRecordId) ?? "material request"}`,
      });
    }
  }
  for (const t of transactions) {
    const action: ProductionHistoryAction =
      t.transactionType === "FORWARD" ? "MOVED_TO_NEXT_STAGE" : t.transactionType === "REWORK" ? "REWORK" : "ADJUSTMENT";
    events.push({
      ...base(t.performedAt, action, t.performedBy.fullName),
      lot: t.lot.lotNumber,
      stage: t.fromJobOrder?.productionStage.name.trim() ?? "(start)",
      nextStage: t.toProductionStage.name.trim(),
      quantity: Number(t.quantity),
      remarks: t.revertReason || t.notes || "",
    });
  }
  for (const p of progressEntries) {
    events.push({
      ...base(p.createdAt, "PROGRESS_LOGGED", p.employee?.fullName ?? "—"),
      lot: p.jobOrder.lot.lotNumber,
      stage: p.jobOrder.productionStage.name.trim(),
      quantity: Number(p.completedQuantity),
      rejectedQuantity: Number(p.rejectedQuantity),
      damagedQuantity: Number(p.damagedQuantity),
      remarks: [
        p.isAdjustment ? "Adjustment" : null,
        Number(p.extraQuantity) > 0 ? `${p.extraQuantity} extra` : null,
        p.approvalStatus !== "NOT_REQUIRED" ? p.approvalStatus : null,
        p.remarks,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const qc of qcInspections) {
    events.push({
      ...base(qc.inspectedAt, "QC_INSPECTED", qc.inspector.fullName),
      lot: qc.jobOrder.lot.lotNumber,
      stage: qc.jobOrder.productionStage.name.trim(),
      quantity: Number(qc.acceptedQuantity),
      rejectedQuantity: Number(qc.rejectedQuantity),
      damagedQuantity: Number(qc.damagedQuantity),
      remarks: `${qc.result} — inspected ${qc.inspectedQuantity}`,
    });
  }
  for (const w of jobWorkOrders) {
    const sentFrom = w.jobOrder.productionStage.name.trim();
    const last = w.coveredStages.length > 0 ? w.coveredStages[w.coveredStages.length - 1].productionStage : null;
    const receivedAt = last?.name.trim() ?? sentFrom;
    const next = last && !last.isFinal ? nextStageName(last.sequence) : null;
    events.push({
      ...base(w.createdAt, "SENT_TO_JOB_WORK", w.requestedBy.fullName),
      lot: w.jobOrder.lot.lotNumber,
      stage: sentFrom,
      sentQuantity: Number(w.issuedQuantity),
      quantity: Number(w.issuedQuantity),
      remarks: `${w.jobWorkNumber} to ${w.contractor.name}${receivedAt !== sentFrom ? ` (covers ${sentFrom} → ${receivedAt})` : ""} · ${w.status}`,
    });
    for (const rc of w.receipts) {
      events.push({
        ...base(rc.createdAt, "JOB_WORK_RECEIVED", rc.receivedBy.fullName),
        lot: w.jobOrder.lot.lotNumber,
        stage: receivedAt,
        nextStage: next,
        receivedQuantity: Number(rc.receivedQuantity),
        rejectedQuantity: Number(rc.rejectedQuantity),
        damagedQuantity: Number(rc.damagedQuantity),
        quantity: Number(rc.receivedQuantity),
        remarks: `${rc.receiptNumber} from ${w.contractor.name}, received at ${receivedAt}${rc.approvalStatus === "PENDING" ? " (awaiting approval)" : ""}${
          rc.status === "CANCELLED" ? " (reversed)" : rc.status === "PARTIALLY_REVERSED" ? " (partly reversed)" : ""
        }${rc.remarks ? ` · ${rc.remarks}` : ""}`,
      });
    }
  }
  for (const c of quantityChanges) {
    events.push({
      ...base(c.createdAt, "EXTRA_PRODUCTION_CREATED", c.createdBy.fullName),
      quantity: Number(c.addedQuantity),
      remarks: `Planned quantity ${Number(c.previousQuantity)} → ${Number(c.newQuantity)}${c.reason ? ` · ${c.reason}` : ""}`,
    });
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return events;
}

export const PRODUCTION_HISTORY_ACTION_LABELS: Record<ProductionHistoryAction, string> = {
  LOT_CREATED: "Lot Created",
  ASSIGNED: "Assigned",
  MATERIAL_REQUESTED: "Material Requested",
  MATERIAL_ISSUED: "Material Issued",
  MOVED_TO_NEXT_STAGE: "Moved to Next Stage",
  REWORK: "Sent Back for Rework",
  ADJUSTMENT: "Adjustment",
  PROGRESS_LOGGED: "Progress Logged",
  QC_INSPECTED: "QC Inspected",
  SENT_TO_JOB_WORK: "Sent to Job Work",
  JOB_WORK_RECEIVED: "Job Work Received",
  EXTRA_PRODUCTION_CREATED: "Extra Production Created",
};

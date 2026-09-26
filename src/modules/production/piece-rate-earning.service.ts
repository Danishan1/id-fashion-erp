import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { Prisma, RateCardRateSource } from "@prisma/client";
import { QcInspectionRepository, PieceRateEarningRepository } from "./production.repository";
import { getProductionSettings } from "@/core/production-settings/ProductionSettingsService";
import type { ActorContext } from "./production-order.service";

const EPSILON = 0.0001;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The core algorithm, given an already-computed `currentEligibleQty` for one
 * assignment — extracted so a single-assignment caller (ordinary progress
 * entries) and a multi-assignment caller (QC acceptance, pro-rated below)
 * can share it. Must be called inside the SAME transaction as the underlying
 * quantity write — a crash must never orphan a payment or pay with no
 * earning row.
 *
 * Rework never mutates a JobOrder (postStageTransactionInTx always creates a
 * brand-new JobOrder row at the rework destination), so the
 * (jobOrderId, jobOrderAssignmentId) key is already fully isolated per
 * lineage step — no cross-JobOrder walk is needed. The remainder
 * (currentEligibleQty minus every prior non-cancelled earning sharing this
 * exact key) is the only quantity ever newly paid — a physical piece can
 * never be paid for twice, even across a QC-accept/rework/re-accept cycle on
 * the SAME JobOrder (a rework destination is a different JobOrder id, so it
 * starts its own independent key).
 */
async function generateEmployeeEarningInTx(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    jobOrderId: string;
    jobOrderAssignmentId: string;
    currentEligibleQty: number;
    qtyBasis: "GOOD_COMPLETED_QTY" | "QC_ACCEPTED_QTY";
    generatedFromEntryId?: string | null;
    generatedFromQcInspectionId?: string | null;
  }
) {
  const assignment = await tx.jobOrderAssignment.findUnique({
    where: { id: params.jobOrderAssignmentId },
    include: { employee: { select: { id: true, payType: true } } },
  });
  if (!assignment || assignment.employee.payType !== "PIECE_RATE") return null;

  const effectiveRate = assignment.rateOverridden ? assignment.overriddenRate : assignment.resolvedRate;
  if (effectiveRate === null || effectiveRate === undefined) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No piece rate is on file for this assignment — an authorized rate must be set before this progress can be paid.",
      { jobOrderAssignmentId: params.jobOrderAssignmentId }
    );
  }
  const rateSource: RateCardRateSource | undefined = assignment.rateOverridden ? undefined : assignment.resolvedRateSource ?? undefined;

  const priorPaid = await PieceRateEarningRepository.sumPriorPayable(tx, {
    jobOrderId: params.jobOrderId,
    jobOrderAssignmentId: params.jobOrderAssignmentId,
  });

  const remainder = params.currentEligibleQty - priorPaid;
  if (Math.abs(remainder) <= EPSILON) return null;

  const payableQuantity = remainder;
  const amount = round2(payableQuantity * Number(effectiveRate));

  return PieceRateEarningRepository.createInTx(tx, {
    companyId: params.companyId,
    jobOrderId: params.jobOrderId,
    earnerType: "EMPLOYEE",
    jobOrderAssignmentId: params.jobOrderAssignmentId,
    employeeId: assignment.employeeId,
    productionOperationId: assignment.productionOperationId,
    qtyBasis: params.qtyBasis,
    payableQuantity,
    rateApplied: Number(effectiveRate),
    rateSource,
    amount,
    status: remainder < 0 ? "ADJUSTED" : "PENDING",
    cumulativeBasisAtGeneration: params.currentEligibleQty,
    generatedFromEntryId: params.generatedFromEntryId ?? null,
    generatedFromQcInspectionId: params.generatedFromQcInspectionId ?? null,
    remarks: remainder < 0 ? "Automatic clawback — a later QC disposition reduced this job order's completed quantity." : null,
  });
}

/**
 * Single-assignment entry point — used by ordinary progress entries
 * (recordProgressEntry/approveProgressEntry), where the caller already knows
 * exactly which assignment the entry belongs to. Computes the JobOrder's
 * live eligible quantity fresh per ProductionSettings.pieceRatePaymentQuantityRule.
 */
export async function generateEarningForJobOrderProgress(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    jobOrderId: string;
    jobOrderAssignmentId: string;
    generatedFromEntryId?: string | null;
    generatedFromQcInspectionId?: string | null;
  }
) {
  const settings = await getProductionSettings(params.companyId);
  const qtyBasis = settings.pieceRatePaymentQuantityRule;

  const currentEligibleQty =
    qtyBasis === "QC_ACCEPTED_QTY"
      ? await QcInspectionRepository.sumAcceptedByJobOrderIdInTx(tx, params.jobOrderId)
      : Number((await tx.jobOrder.findUniqueOrThrow({ where: { id: params.jobOrderId }, select: { completedQuantity: true } })).completedQuantity);

  return generateEmployeeEarningInTx(tx, { ...params, currentEligibleQty, qtyBasis });
}

/**
 * Multi-worker entry point — used by recordQcInspection(), which accepts/
 * rejects at the JobOrder level with no per-worker breakdown of its own.
 * When exactly one active assignment exists on the JobOrder (the common
 * case), this degenerates to the simple single-assignment case with no
 * proration. When more than one exists, the JobOrder's cumulative QC-accepted
 * total is split pro-rata by each assignment's own share of completed
 * quantity logged via progress entries against it — the last assignment (by
 * id, a stable order) absorbs any rounding remainder so the shares always
 * sum exactly to the real total. A JobOrder with zero active assignments (or
 * whose logged shares are all zero, so proration has nothing to key off of)
 * silently generates no earning — there's no one to attribute it to yet.
 */
export async function generateEarningsForQcAcceptance(
  tx: Prisma.TransactionClient,
  params: { companyId: string; jobOrderId: string; generatedFromQcInspectionId: string }
) {
  const settings = await getProductionSettings(params.companyId);
  if (settings.pieceRatePaymentQuantityRule !== "QC_ACCEPTED_QTY") return;

  const assignments = await tx.jobOrderAssignment.findMany({
    where: { jobOrderId: params.jobOrderId, status: { not: "CANCELLED" } },
    select: { id: true },
    orderBy: { assignedAt: "asc" },
  });
  if (assignments.length === 0) return;

  const totalAccepted = await QcInspectionRepository.sumAcceptedByJobOrderIdInTx(tx, params.jobOrderId);

  if (assignments.length === 1) {
    await generateEmployeeEarningInTx(tx, {
      companyId: params.companyId,
      jobOrderId: params.jobOrderId,
      jobOrderAssignmentId: assignments[0].id,
      currentEligibleQty: totalAccepted,
      qtyBasis: "QC_ACCEPTED_QTY",
      generatedFromQcInspectionId: params.generatedFromQcInspectionId,
    });
    return;
  }

  const progressShares = await tx.jobOrderProgressEntry.groupBy({
    by: ["jobOrderAssignmentId"],
    where: { jobOrderId: params.jobOrderId, jobOrderAssignmentId: { not: null } },
    _sum: { completedQuantity: true },
  });
  const shareByAssignmentId = new Map<string, number>(
    progressShares
      .filter((row): row is typeof row & { jobOrderAssignmentId: string } => row.jobOrderAssignmentId !== null)
      .map((row) => [row.jobOrderAssignmentId, Number(row._sum.completedQuantity ?? 0)])
  );
  const totalLogged = [...shareByAssignmentId.values()].reduce((sum, v) => sum + v, 0);
  if (totalLogged <= EPSILON) return;

  let allocated = 0;
  for (let i = 0; i < assignments.length; i++) {
    const isLast = i === assignments.length - 1;
    const share = (shareByAssignmentId.get(assignments[i].id) ?? 0) / totalLogged;
    const scaledEligibleQty = isLast ? totalAccepted - allocated : round2(totalAccepted * share);
    allocated += scaledEligibleQty;

    await generateEmployeeEarningInTx(tx, {
      companyId: params.companyId,
      jobOrderId: params.jobOrderId,
      jobOrderAssignmentId: assignments[i].id,
      currentEligibleQty: scaledEligibleQty,
      qtyBasis: "QC_ACCEPTED_QTY",
      generatedFromQcInspectionId: params.generatedFromQcInspectionId,
    });
  }
}

/**
 * Same algorithm, for a SUPPLIER (Contractor) earner (external Job Work) —
 * called from receiveJobWork() inside the same transaction as the receipt's
 * own applyJobOrderQuantityDelta call. Keyed by (jobOrderId, jobWorkOrderId)
 * rather than (jobOrderId, jobOrderAssignmentId); rejected/damaged quantity
 * is never passed in as payableQuantity — only genuinely received quantity
 * is ever paid.
 */
export async function generateEarningForJobWorkReceipt(
  tx: Prisma.TransactionClient,
  params: {
    companyId: string;
    jobOrderId: string;
    jobWorkOrderId: string;
    jobWorkReceiptId: string;
    contractorId: string;
    productionOperationId: string | null;
    resolvedRate: number | null;
    rateSource?: RateCardRateSource;
    receivedQuantityDelta: number;
  }
) {
  if (params.resolvedRate === null || params.resolvedRate === undefined) return null;

  const amount = round2(params.receivedQuantityDelta * params.resolvedRate);
  if (Math.abs(params.receivedQuantityDelta) <= EPSILON) return null;

  return PieceRateEarningRepository.createInTx(tx, {
    companyId: params.companyId,
    jobOrderId: params.jobOrderId,
    earnerType: "SUPPLIER",
    jobWorkOrderId: params.jobWorkOrderId,
    jobWorkReceiptId: params.jobWorkReceiptId,
    contractorId: params.contractorId,
    productionOperationId: params.productionOperationId,
    qtyBasis: "GOOD_COMPLETED_QTY",
    payableQuantity: params.receivedQuantityDelta,
    rateApplied: params.resolvedRate,
    rateSource: params.rateSource,
    amount,
    status: "PENDING",
    cumulativeBasisAtGeneration: params.receivedQuantityDelta,
  });
}

export async function listPieceRateEarnings(
  companyId: string,
  filters: { employeeId?: string; contractorId?: string; status?: string }
) {
  return PieceRateEarningRepository.findMany({
    companyId,
    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
    ...(filters.contractorId ? { contractorId: filters.contractorId } : {}),
    ...(filters.status ? { status: filters.status as never } : {}),
  });
}

async function transitionEarningStatus(
  actor: ActorContext,
  id: string,
  from: string[],
  to: "APPROVED" | "PAYABLE" | "PAID" | "CANCELLED"
) {
  const existing = await PieceRateEarningRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Piece rate earning not found.", { id });
  if (!from.includes(existing.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot move an earning from "${existing.status}" to "${to}".`, {
      currentStatus: existing.status,
    });
  }

  const updated = await PieceRateEarningRepository.update(id, {
    status: to,
    ...(to === "APPROVED" ? { approvedByUserId: actor.userId, approvedAt: new Date() } : {}),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "piece_rate_earnings",
    recordId: id,
    action: to === "CANCELLED" ? "CANCEL" : "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: to },
  });

  return updated;
}

export async function approvePieceRateEarning(actor: ActorContext, id: string) {
  await PermissionService.assert(actor.userId, "piece_rate", "approve");
  return transitionEarningStatus(actor, id, ["PENDING", "PENDING_APPROVAL"], "APPROVED");
}

export async function markPieceRateEarningsPayable(actor: ActorContext, id: string) {
  await PermissionService.assert(actor.userId, "piece_rate", "approve");
  return transitionEarningStatus(actor, id, ["APPROVED"], "PAYABLE");
}

export async function markPieceRateEarningPaid(actor: ActorContext, id: string) {
  await PermissionService.assert(actor.userId, "piece_rate", "approve");
  return transitionEarningStatus(actor, id, ["PAYABLE"], "PAID");
}

export async function cancelPieceRateEarning(actor: ActorContext, id: string) {
  await PermissionService.assert(actor.userId, "piece_rate", "approve");
  return transitionEarningStatus(actor, id, ["PENDING", "PENDING_APPROVAL", "APPROVED"], "CANCELLED");
}

import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * Worker-assignment capacity rules (2026-09-28).
 *
 * A worker's "consumed" quantity against their assignment is
 *     completed + rejected + damaged − extra
 * summed across their progress entries. `extra` is part of `completed`
 * (only possible on a stage with allowsExtraQuantity, e.g. Cutting), so a
 * cutter assigned 100 who cuts 105 records completed 105 / extra 5 and has
 * consumed exactly the 100 they were given.
 *
 * Rule: consumed ≤ assigned, and an assignment auto-completes the moment
 * consumed == assigned. PENDING (awaiting approval) entries count against
 * the cap so a worker can't over-submit while approvals are outstanding;
 * REJECTED entries never count. Adjustment entries carry no assignment.
 */

export const EPSILON = 0.0001;
export const ACTIVE_ASSIGNMENT_STATUSES = ["ASSIGNED", "IN_PROGRESS"] as const;

type Num = Prisma.Decimal | number | string | null | undefined;
const n = (v: Num) => Number(v ?? 0);

export interface EntryQuantities {
  completed: number;
  rejected: number;
  damaged: number;
  extra: number;
}

export function consumedOf(q: EntryQuantities): number {
  return q.completed + q.rejected + q.damaged - q.extra;
}

/** `SELECT ... FOR UPDATE` so two concurrent entries for one assignment serialize. */
export async function lockAssignmentInTx(tx: Prisma.TransactionClient, assignmentId: string) {
  await tx.$queryRaw`SELECT id FROM job_order_assignments WHERE id = ${assignmentId}::uuid FOR UPDATE`;
  return tx.jobOrderAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { employee: { select: { id: true, fullName: true } } },
  });
}

/** Consumed-of-assigned for one assignment. `includePending` counts PENDING entries too. */
export async function sumAssignmentConsumed(
  client: Prisma.TransactionClient,
  assignmentId: string,
  opts: { includePending: boolean; excludeEntryId?: string },
): Promise<number> {
  const agg = await client.jobOrderProgressEntry.aggregate({
    where: {
      jobOrderAssignmentId: assignmentId,
      isAdjustment: false,
      approvalStatus: opts.includePending ? { not: "REJECTED" } : { in: ["NOT_REQUIRED", "APPROVED"] },
      ...(opts.excludeEntryId ? { id: { not: opts.excludeEntryId } } : {}),
    },
    _sum: { completedQuantity: true, rejectedQuantity: true, damagedQuantity: true, extraQuantity: true },
  });
  return consumedOf({
    completed: n(agg._sum.completedQuantity),
    rejected: n(agg._sum.rejectedQuantity),
    damaged: n(agg._sum.damagedQuantity),
    extra: n(agg._sum.extraQuantity),
  });
}

/**
 * Validates one progress entry against its assignment and stage. Returns the
 * assignment's consumed total INCLUDING this entry. Throws with a message a
 * floor supervisor can act on.
 */
export async function assertEntryWithinAssignmentInTx(
  tx: Prisma.TransactionClient,
  params: {
    assignmentId: string;
    stage: { name: string; allowsExtraQuantity: boolean };
    entry: EntryQuantities;
    /** The entry being approved/edited itself, so it isn't double-counted. */
    excludeEntryId?: string;
  },
) {
  const { entry, stage } = params;
  const assignment = await lockAssignmentInTx(tx, params.assignmentId);
  const workerName = assignment.employee?.fullName ?? "this worker";

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status as (typeof ACTIVE_ASSIGNMENT_STATUSES)[number])) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      assignment.status === "COMPLETED"
        ? `${workerName} has already logged all ${Number(assignment.assignedQuantity)} assigned pieces — assign more work before logging further progress.`
        : `${workerName}'s assignment is ${assignment.status.toLowerCase()} — no further progress can be logged against it.`,
      { assignmentId: assignment.id, status: assignment.status },
    );
  }

  for (const [label, value] of [
    ["Completed", entry.completed],
    ["Rejected", entry.rejected],
    ["Damage", entry.damaged],
    ["Extra", entry.extra],
  ] as const) {
    if (value < 0) throw new BusinessRuleError("VALIDATION_ERROR", `${label} pieces cannot be negative.`, {});
  }
  if (entry.completed + entry.rejected + entry.damaged <= 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Enter at least one completed, rejected or damaged piece.", {});
  }
  if (entry.extra > 0 && !stage.allowsExtraQuantity) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Extra pieces can't be recorded at ${stage.name} — only a stage that allows extra pieces (e.g. Cutting) can.`,
      {},
    );
  }
  if (entry.extra > entry.completed + EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Extra pieces are part of the completed quantity and cannot exceed it.",
      { completed: entry.completed, extra: entry.extra },
    );
  }

  const assigned = n(assignment.assignedQuantity);
  const prior = await sumAssignmentConsumed(tx, assignment.id, { includePending: true, excludeEntryId: params.excludeEntryId });
  const remaining = Math.max(0, assigned - prior);
  const thisEntry = consumedOf(entry);
  const total = prior + thisEntry;

  if (total > assigned + EPSILON) {
    const over = total - assigned;
    const extraHint = stage.allowsExtraQuantity
      ? ` If ${over} completed piece(s) were genuinely cut beyond the assignment, record them in "Extra".`
      : "";
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Completed + Rejected + Damage cannot exceed ${workerName}'s assigned pieces. Assigned ${assigned}, already logged ${prior}, remaining ${remaining} — this entry adds ${thisEntry}.${extraHint}`,
      { assigned, alreadyLogged: prior, remaining, attempted: thisEntry },
    );
  }

  return { assignment, assigned, consumedAfter: total };
}

/**
 * After an entry is APPLIED (not merely pending), move the assignment along:
 * first real work → IN_PROGRESS (+startedAt); fully consumed → COMPLETED
 * (+completedAt). Uses applied-only totals, so a pending claim never closes
 * an assignment early.
 */
export async function syncAssignmentStatusInTx(tx: Prisma.TransactionClient, assignmentId: string) {
  const assignment = await tx.jobOrderAssignment.findUniqueOrThrow({ where: { id: assignmentId } });
  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status as (typeof ACTIVE_ASSIGNMENT_STATUSES)[number])) return assignment;
  const applied = await sumAssignmentConsumed(tx, assignmentId, { includePending: false });
  const assigned = n(assignment.assignedQuantity);
  if (applied >= assigned - EPSILON) {
    return tx.jobOrderAssignment.update({
      where: { id: assignmentId },
      data: { status: "COMPLETED", completedAt: new Date(), startedAt: assignment.startedAt ?? new Date() },
    });
  }
  if (applied > 0 && assignment.status === "ASSIGNED") {
    return tx.jobOrderAssignment.update({
      where: { id: assignmentId },
      data: { status: "IN_PROGRESS", startedAt: assignment.startedAt ?? new Date() },
    });
  }
  return assignment;
}

/** Σ over active assignments of pieces assigned but not yet actually worked (applied entries only). */
export async function sumUnworkedInternalAssignments(client: Prisma.TransactionClient, jobOrderId: string, excludeAssignmentId?: string) {
  const active = await client.jobOrderAssignment.findMany({
    where: {
      jobOrderId,
      status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
    },
    select: { id: true, assignedQuantity: true },
  });
  let total = 0;
  for (const a of active) {
    const applied = await sumAssignmentConsumed(client, a.id, { includePending: false });
    total += Math.max(0, n(a.assignedQuantity) - applied);
  }
  return total;
}

/** Σ issued-but-not-yet-received on this job order's live external job-work orders. */
export async function sumPendingExternalJobWork(client: Prisma.TransactionClient, jobOrderId: string, excludeJobWorkOrderId?: string) {
  const rows = await client.jobWorkOrder.findMany({
    where: { jobOrderId, status: { notIn: ["CANCELLED", "CLOSED"] }, ...(excludeJobWorkOrderId ? { id: { not: excludeJobWorkOrderId } } : {}) },
    select: { issuedQuantity: true, receivedQuantity: true, rejectedQuantity: true, damagedQuantity: true },
  });
  return rows.reduce((sum, r) => sum + Math.max(0, n(r.issuedQuantity) - n(r.receivedQuantity) - n(r.rejectedQuantity) - n(r.damagedQuantity)), 0);
}

/**
 * The single "how much of this job order's work is still free to hand out"
 * number, shared by internal worker assignment AND external job-work issue so
 * the same piece can never be committed to both a worker and a contractor.
 *   planned + extra − (completed + rejected + damaged)
 *     − unworked internal assignments − pending external job work
 */
export async function computeAvailableToCommit(
  client: Prisma.TransactionClient,
  jobOrder: { id: string; plannedQuantity: Num; extraQuantity?: Num; completedQuantity: Num; rejectedQuantity: Num; damagedQuantity: Num },
  opts: { excludeAssignmentId?: string; excludeJobWorkOrderId?: string } = {},
) {
  const capacity = n(jobOrder.plannedQuantity) + n(jobOrder.extraQuantity);
  const done = n(jobOrder.completedQuantity) + n(jobOrder.rejectedQuantity) + n(jobOrder.damagedQuantity);
  const unworkedInternal = await sumUnworkedInternalAssignments(client, jobOrder.id, opts.excludeAssignmentId);
  const pendingExternal = await sumPendingExternalJobWork(client, jobOrder.id, opts.excludeJobWorkOrderId);
  const available = Math.max(0, capacity - done - unworkedInternal - pendingExternal);
  return { available, capacity, done, unworkedInternal, pendingExternal };
}

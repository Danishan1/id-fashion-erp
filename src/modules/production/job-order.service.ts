import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import type { JobOrderStatus, Prisma, ProductionStage } from "@prisma/client";
import {
  JobOrderAssignmentRepository,
  JobOrderProgressEntryRepository,
  JobOrderRepository,
  LotRepository,
  ProductionOrderRepository,
  ProductionStageTransactionRepository,
  QcInspectionRepository,
} from "./production.repository";
import type {
  CreateAdjustmentEntryInput,
  CreateJobOrderAssignmentInput,
  CreateProgressEntryInput,
  CreateQcInspectionInput,
  ForwardJobOrderInput,
  RevertJobOrderInput,
  StartLotInput,
} from "./production.schema";
import type { ActorContext } from "./production-order.service";

const EPSILON = 0.0001;

export function computeJobOrderStatus(jo: {
  status: JobOrderStatus;
  plannedQuantity: Prisma.Decimal | number | string;
  completedQuantity: Prisma.Decimal | number | string;
  rejectedQuantity: Prisma.Decimal | number | string;
  damagedQuantity: Prisma.Decimal | number | string;
}): JobOrderStatus {
  if (jo.status === "CANCELLED" || jo.status === "ON_HOLD") return jo.status;
  const planned = Number(jo.plannedQuantity);
  const done = Number(jo.completedQuantity) + Number(jo.rejectedQuantity) + Number(jo.damagedQuantity);
  if (done <= 0) return "PENDING";
  if (done >= planned - EPSILON) return "COMPLETED";
  return "IN_PROGRESS";
}

async function findActiveStageById(companyId: string, stageId: string) {
  return prisma.productionStage.findFirst({ where: { id: stageId, companyId } });
}

async function findImmediateNextStage(companyId: string, currentSequence: number) {
  return prisma.productionStage.findFirst({
    where: { companyId, isActive: true, sequence: { gt: currentSequence } },
    orderBy: { sequence: "asc" },
  });
}

/**
 * The single append-only ledger write, shared by forward movement, manual
 * revert, and QC-driven revert/forward — one mechanism, no per-trigger
 * special case. Auto-creates the destination JobOrder (never hand-created).
 */
async function postStageTransactionInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: {
    productionOrderId: string;
    lot: { id: string; lotNumber: string };
    fromJobOrder: { id: string; productionStageId: string; productionStage: { sequence: number } } | null;
    toStage: ProductionStage;
    quantity: number;
    transactionType: "FORWARD" | "REWORK" | "ADJUSTMENT";
    revertReason?: string | null;
    notes?: string | null;
  }
) {
  const priorAtStage = await tx.jobOrder.count({ where: { lotId: params.lot.id, productionStageId: params.toStage.id } });
  const jobNumber = `${params.lot.lotNumber}-${params.toStage.code}-${priorAtStage + 1}`;

  const toJobOrder = await JobOrderRepository.createInTx(tx, {
    companyId: actor.companyId,
    productionOrderId: params.productionOrderId,
    lotId: params.lot.id,
    productionStageId: params.toStage.id,
    jobNumber,
    sourceJobOrderId: params.fromJobOrder?.id ?? null,
    plannedQuantity: params.quantity,
    status: "PENDING",
  });

  const isBackward = params.fromJobOrder ? params.toStage.sequence < params.fromJobOrder.productionStage.sequence : false;

  const transaction = await ProductionStageTransactionRepository.createInTx(tx, {
    companyId: actor.companyId,
    productionOrderId: params.productionOrderId,
    lotId: params.lot.id,
    fromJobOrderId: params.fromJobOrder?.id ?? null,
    toJobOrderId: toJobOrder.id,
    fromProductionStageId: params.fromJobOrder?.productionStageId ?? null,
    toProductionStageId: params.toStage.id,
    transactionType: params.transactionType,
    quantity: params.quantity,
    isBackward,
    revertReason: params.revertReason ?? null,
    performedByUserId: actor.userId,
    notes: params.notes ?? null,
  });

  await LotRepository.updateInTx(tx, params.lot.id, { currentStageId: params.toStage.id, status: "IN_PROGRESS" });

  return { jobOrder: toJobOrder, transactionId: transaction.id };
}

/** Posts the Finished-Goods receipt and closes out both the Lot and the
 * newly-created final-stage JobOrder — the automatic side effect of landing
 * on a stage flagged isFinal, same discipline as every other "terminal
 * action is a side effect, never a caller-chosen generic step" pattern in
 * this project. */
async function completeAtFinalStageInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: { productId: string; lotId: string; jobOrderId: string; quantity: number; warehouseId: string }
) {
  await recordInventoryTransaction(tx, actor, {
    productId: params.productId,
    warehouseId: params.warehouseId,
    transactionType: "PRODUCTION_RECEIPT",
    quantity: params.quantity,
    referenceModule: "PRODUCTION_ORDER",
    referenceRecordId: params.lotId,
  });
  await LotRepository.updateInTx(tx, params.lotId, { status: "COMPLETED" });
  await JobOrderRepository.updateInTx(tx, params.jobOrderId, {
    status: "COMPLETED",
    completedQuantity: params.quantity,
    actualEndAt: new Date(),
  });
}

/** 3-column guard (completed+rejected+damaged <= planned) — can't be a
 * single-column Prisma updateMany guard like every other accumulator in
 * this codebase, so this is a read-verify-write inside the caller's
 * transaction instead. A Postgres CHECK constraint is the hard backstop
 * (see the migration). `deltas` may be negative only for a genuine
 * isAdjustment=true correction. */
async function applyJobOrderQuantityDelta(
  tx: Prisma.TransactionClient,
  jobOrderId: string,
  deltas: { completed?: number; rejected?: number; damaged?: number }
) {
  const jo = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
  const planned = Number(jo.plannedQuantity);
  const newCompleted = Number(jo.completedQuantity) + (deltas.completed ?? 0);
  const newRejected = Number(jo.rejectedQuantity) + (deltas.rejected ?? 0);
  const newDamaged = Number(jo.damagedQuantity) + (deltas.damaged ?? 0);

  if (newCompleted < -EPSILON || newRejected < -EPSILON || newDamaged < -EPSILON) {
    throw new BusinessRuleError("OVER_PRODUCTION_NOT_ALLOWED", "This adjustment would make a quantity negative.", {
      newCompleted,
      newRejected,
      newDamaged,
    });
  }
  const total = newCompleted + newRejected + newDamaged;
  if (total > planned + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot record this entry — completed + rejected + damaged (${total}) would exceed the planned quantity (${planned}).`,
      { planned, attempted: total }
    );
  }

  return JobOrderRepository.updateInTx(tx, jobOrderId, {
    completedQuantity: Math.max(0, newCompleted),
    rejectedQuantity: Math.max(0, newRejected),
    damagedQuantity: Math.max(0, newDamaged),
    status: computeJobOrderStatus({
      status: jo.status,
      plannedQuantity: planned,
      completedQuantity: newCompleted,
      rejectedQuantity: newRejected,
      damagedQuantity: newDamaged,
    }),
  });
}

/** Manual revert only: pulls quantity back out of the genuinely-unprocessed
 * pool — units nobody has completed/rejected/damaged yet at this stage,
 * being sent to an earlier stage before this job order ever touches them.
 * This is deliberately NOT reused for QC (see
 * guardedShrinkPlannedForQcDisposition below): "unprocessed" is normally
 * zero once a stage's work is 100% logged as completed, which is the usual
 * precondition for running QC at all — reusing this guard there produced a
 * false "over production" rejection on every already-completed job order. */
async function guardedDecrementUnprocessedQuantity(tx: Prisma.TransactionClient, jobOrderId: string, decrementBy: number) {
  const jo = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
  const planned = Number(jo.plannedQuantity);
  const done = Number(jo.completedQuantity) + Number(jo.rejectedQuantity) + Number(jo.damagedQuantity);
  const unprocessed = planned - done;
  if (decrementBy > unprocessed + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot revert ${decrementBy} from this job order — only ${unprocessed} is still unprocessed.`,
      { unprocessed, attempted: decrementBy }
    );
  }
  return JobOrderRepository.updateInTx(tx, jobOrderId, { plannedQuantity: planned - decrementBy });
}

/** QC rejection/damage write-off only: draws from the *completed* pool
 * (pieces that already finished this stage), not the "unprocessed" one —
 * a fundamentally different pool than manual revert's. The real cap —
 * never disposition more than has been completed, and never disposition
 * the same completed piece twice — is already enforced atomically earlier
 * in the same transaction by guardedIncrementQcPassed() (qcPassed <=
 * completed) together with the schema-level invariant that
 * accepted+rejected+damaged === inspectedQuantity for a single inspection.
 * This guard only needs to stop plannedQuantity itself from going negative
 * as it shrinks to reflect that these pieces have left the job order's
 * remaining scope (routed backward for rework, or written off as damage) —
 * it must NOT re-check against "unprocessed", which is what caused BUG-03. */
async function guardedShrinkPlannedForQcDisposition(tx: Prisma.TransactionClient, jobOrderId: string, decrementBy: number) {
  const jo = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
  const planned = Number(jo.plannedQuantity);
  if (decrementBy > planned + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot remove ${decrementBy} from this job order — only ${planned} of planned quantity remains.`,
      { planned, attempted: decrementBy }
    );
  }
  return JobOrderRepository.updateInTx(tx, jobOrderId, { plannedQuantity: planned - decrementBy });
}

function guardedIncrementForwarded(tx: Prisma.TransactionClient, jobOrderId: string, cap: number, incrementBy: number) {
  return tx.jobOrder.updateMany({
    where: { id: jobOrderId, forwardedQuantity: { lte: cap - incrementBy } },
    data: { forwardedQuantity: { increment: incrementBy } },
  });
}

function guardedIncrementQcPassed(tx: Prisma.TransactionClient, jobOrderId: string, cap: number, incrementBy: number) {
  return tx.jobOrder.updateMany({
    where: { id: jobOrderId, qcPassedQuantity: { lte: cap - incrementBy } },
    data: { qcPassedQuantity: { increment: incrementBy } },
  });
}

export async function getJobOrderById(companyId: string, id: string) {
  const jobOrder = await JobOrderRepository.findAnyById(companyId, id);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id });
  return jobOrder;
}

/** The very first stage entry for a lot — same ledger mechanism as every
 * later move, just with no `fromJobOrder`. Always moves the lot's full
 * quantity (a lot has no separate "not yet started" sub-quantity to track;
 * a user wanting a partial start splits the lot first). */
export async function startLot(actor: ActorContext, lotId: string, input: StartLotInput) {
  const lot = await LotRepository.findAnyById(actor.companyId, lotId);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: lotId });
  if (lot.status !== "PLANNED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot start a lot in "${lot.status}" status.`, { currentStatus: lot.status });
  }

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, lot.productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: lot.productionOrderId });
  if (order.status === "ON_HOLD") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Resume the production order before starting new work on it.", {
      currentStatus: order.status,
    });
  }

  let stage;
  if (input.stageId) {
    stage = await findActiveStageById(actor.companyId, input.stageId);
    if (!stage || !stage.isActive) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: input.stageId });
  } else {
    stage = await prisma.productionStage.findFirst({ where: { companyId: actor.companyId, isActive: true }, orderBy: { sequence: "asc" } });
    if (!stage) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No active production stages are configured for this company yet.", {});
    }
  }

  const result = await prisma.$transaction((tx) =>
    postStageTransactionInTx(tx, actor, {
      productionOrderId: order.id,
      lot,
      fromJobOrder: null,
      toStage: stage,
      quantity: Number(lot.quantity),
      transactionType: "FORWARD",
    })
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_orders",
    recordId: result.jobOrder.id,
    action: "CREATE",
    newValues: { lotId, stageId: stage.id, quantity: lot.quantity },
  });

  return result.jobOrder;
}

export async function assignWorker(actor: ActorContext, jobOrderId: string, input: CreateJobOrderAssignmentInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });

  const alreadyAssigned = await JobOrderAssignmentRepository.sumAssignedByJobOrderId(jobOrderId);
  if (alreadyAssigned + input.assignedQuantity > Number(jobOrder.plannedQuantity) + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Assigning ${input.assignedQuantity} would bring total assignments to ${alreadyAssigned + input.assignedQuantity}, above the planned quantity of ${jobOrder.plannedQuantity}.`,
      { alreadyAssigned, planned: jobOrder.plannedQuantity }
    );
  }

  const assignment = await JobOrderAssignmentRepository.createInTx(prisma, {
    jobOrderId,
    employeeId: input.employeeId,
    assignedQuantity: input.assignedQuantity,
    status: "ASSIGNED",
    assignedByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_assignments",
    recordId: assignment.id,
    action: "CREATE",
    newValues: { jobOrderId, employeeId: input.employeeId, assignedQuantity: input.assignedQuantity },
  });

  return assignment;
}

/** The append-only worker log — never edited, never deleted. */
export async function recordProgressEntry(actor: ActorContext, jobOrderId: string, input: CreateProgressEntryInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot log progress against a cancelled job order.", {});
  }

  if (input.jobOrderAssignmentId) {
    const assignment = await JobOrderAssignmentRepository.findAnyById(input.jobOrderAssignmentId);
    if (!assignment || assignment.jobOrderId !== jobOrderId) {
      throw new BusinessRuleError("NOT_FOUND", "Assignment not found on this job order.", { id: input.jobOrderAssignmentId });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const jo = await applyJobOrderQuantityDelta(tx, jobOrderId, {
      completed: input.completedQuantity,
      rejected: input.rejectedQuantity,
      damaged: input.damagedQuantity,
    });
    await JobOrderProgressEntryRepository.createInTx(tx, {
      jobOrderId,
      jobOrderAssignmentId: input.jobOrderAssignmentId || null,
      employeeId: input.employeeId,
      recordedByUserId: actor.userId,
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      isAdjustment: false,
      remarks: input.remarks || null,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
    });
    return jo;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: jobOrderId,
    action: "CREATE",
    newValues: {
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
    },
  });

  return updated;
}

/** A genuine data-entry correction — the only kind of entry allowed to
 * carry a value that reduces an earlier (mistaken) entry, mirroring
 * InventoryTransaction's own signed-reversal convention rather than ever
 * editing/deleting an existing row. */
export async function recordAdjustmentEntry(actor: ActorContext, jobOrderId: string, input: CreateAdjustmentEntryInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });

  const updated = await prisma.$transaction(async (tx) => {
    const jo = await applyJobOrderQuantityDelta(tx, jobOrderId, {
      completed: input.completedQuantity,
      rejected: input.rejectedQuantity,
      damaged: input.damagedQuantity,
    });
    await JobOrderProgressEntryRepository.createInTx(tx, {
      jobOrderId,
      employeeId: actor.userId, // an adjustment has no real "worker" — recorded against the actor
      recordedByUserId: actor.userId,
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      isAdjustment: true,
      remarks: input.remarks,
    });
    return jo;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: jobOrderId,
    action: "UPDATE",
    newValues: { isAdjustment: true, ...input },
  });

  return updated;
}

export async function forwardJobOrder(actor: ActorContext, jobOrderId: string, input: ForwardJobOrderInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot forward a cancelled job order.", {});
  }

  const notYetForwarded = Number(jobOrder.completedQuantity) - Number(jobOrder.forwardedQuantity);
  if (input.quantity > notYetForwarded + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot forward ${input.quantity} — only ${notYetForwarded} completed-and-not-yet-forwarded remains.`,
      { notYetForwarded }
    );
  }

  const immediateNext = await findImmediateNextStage(actor.companyId, jobOrder.productionStage.sequence);
  let targetStage: Awaited<ReturnType<typeof findActiveStageById>>;
  if (input.targetStageId) {
    targetStage = await findActiveStageById(actor.companyId, input.targetStageId);
    if (!targetStage || !targetStage.isActive) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: input.targetStageId });
    if (targetStage.sequence <= jobOrder.productionStage.sequence) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The target stage must be ahead of the current stage — use revert to go backward.", {});
    }
    const isSkip = !immediateNext || targetStage.sequence > immediateNext.sequence;
    if (isSkip) {
      await PermissionService.assert(actor.userId, "production", "approve");
    }
  } else {
    if (!immediateNext) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "No further active stage is configured after this one. If this is meant to be the final stage, mark it IsFinal in Production Stage configuration.",
        {}
      );
    }
    targetStage = immediateNext;
  }

  if (targetStage.isFinal && !input.finishedGoodsWarehouseId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A Finished Goods warehouse is required — this stage completes the lot.", {});
  }

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, jobOrder.productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: jobOrder.productionOrderId });

  const result = await prisma.$transaction(async (tx) => {
    const posted = await postStageTransactionInTx(tx, actor, {
      productionOrderId: jobOrder.productionOrderId,
      lot: jobOrder.lot,
      fromJobOrder: jobOrder,
      toStage: targetStage,
      quantity: input.quantity,
      transactionType: "FORWARD",
    });

    const guard = await guardedIncrementForwarded(tx, jobOrderId, Number(jobOrder.completedQuantity), input.quantity);
    if (guard.count === 0) {
      throw new BusinessRuleError("OVER_PRODUCTION_NOT_ALLOWED", "This job order was updated by someone else at the same time — reload and try again.", {});
    }

    if (targetStage.isFinal) {
      await completeAtFinalStageInTx(tx, actor, {
        productId: order.productId,
        lotId: jobOrder.lot.id,
        jobOrderId: posted.jobOrder.id,
        quantity: input.quantity,
        warehouseId: input.finishedGoodsWarehouseId!,
      });
    }

    return posted;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_stage_transactions",
    recordId: result.transactionId,
    action: "CREATE",
    newValues: { fromJobOrderId: jobOrderId, toStageId: targetStage.id, quantity: input.quantity },
  });

  return result.jobOrder;
}

export async function revertJobOrder(actor: ActorContext, jobOrderId: string, input: RevertJobOrderInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot revert a cancelled job order.", {});
  }

  const targetStage = await findActiveStageById(actor.companyId, input.targetStageId);
  if (!targetStage) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: input.targetStageId });
  if (!targetStage.isActive || !targetStage.allowRework) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${targetStage.name}" does not allow rework to be sent back into it.`, {});
  }
  if (targetStage.sequence >= jobOrder.productionStage.sequence) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The target stage must be earlier than the current stage — use forward to go ahead.", {});
  }

  const unprocessed =
    Number(jobOrder.plannedQuantity) - Number(jobOrder.completedQuantity) - Number(jobOrder.rejectedQuantity) - Number(jobOrder.damagedQuantity);
  if (input.quantity > unprocessed + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot revert ${input.quantity} — only ${unprocessed} remains unprocessed on this job order.`,
      { unprocessed }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const posted = await postStageTransactionInTx(tx, actor, {
      productionOrderId: jobOrder.productionOrderId,
      lot: jobOrder.lot,
      fromJobOrder: jobOrder,
      toStage: targetStage,
      quantity: input.quantity,
      transactionType: "REWORK",
      revertReason: input.reason,
    });
    await guardedDecrementUnprocessedQuantity(tx, jobOrderId, input.quantity);
    return posted;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_stage_transactions",
    recordId: result.transactionId,
    action: "UPDATE",
    newValues: { fromJobOrderId: jobOrderId, toStageId: targetStage.id, quantity: input.quantity, reason: input.reason },
  });

  return result.jobOrder;
}

/**
 * Generic by construction — keyed on jobOrderId, never a stage name. A Fail
 * or Partial-Pass creates a REWORK ProductionStageTransaction using the
 * exact same target-stage validation as a manual revert (one mechanism).
 * Fully-damaged quantity posts a DAMAGE inventory transaction into a REJECT
 * warehouse instead — repairable (rejected) goes backward, fully damaged
 * never returns to the flow.
 */
export async function recordQcInspection(actor: ActorContext, jobOrderId: string, input: CreateQcInspectionInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });

  const completed = Number(jobOrder.completedQuantity);
  const alreadyInspected = Number(jobOrder.qcPassedQuantity);
  const notYetInspected = completed - alreadyInspected;
  if (input.inspectedQuantity > notYetInspected + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot inspect ${input.inspectedQuantity} — only ${notYetInspected} completed-and-not-yet-inspected remains.`,
      { notYetInspected }
    );
  }

  let reworkTargetStage = null;
  if (input.result !== "PASS" && input.rejectedQuantity > 0) {
    reworkTargetStage = await findActiveStageById(actor.companyId, input.reworkTargetStageId!);
    if (!reworkTargetStage) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: input.reworkTargetStageId });
    if (!reworkTargetStage.isActive || !reworkTargetStage.allowRework) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", `"${reworkTargetStage.name}" does not allow rework.`, {});
    }
    if (reworkTargetStage.sequence >= jobOrder.productionStage.sequence) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The rework target stage must be earlier than the current stage.", {});
    }
  }

  let nextStage = null;
  if (input.acceptedQuantity > 0) {
    nextStage = await findImmediateNextStage(actor.companyId, jobOrder.productionStage.sequence);
    if (!nextStage) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No further active stage is configured to forward the accepted quantity to.", {});
    }
    if (nextStage.isFinal && !input.finishedGoodsWarehouseId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "A Finished Goods warehouse is required — the next stage completes the lot.", {});
    }
  }

  if (input.damagedQuantity > 0 && !input.damageWarehouseId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A damage warehouse is required when recording damaged quantity.", {});
  }

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, jobOrder.productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: jobOrder.productionOrderId });

  const inspection = await prisma.$transaction(async (tx) => {
    const guard = await guardedIncrementQcPassed(tx, jobOrderId, completed, input.inspectedQuantity);
    if (guard.count === 0) {
      throw new BusinessRuleError("OVER_PRODUCTION_NOT_ALLOWED", "This job order was inspected by someone else at the same time — reload and try again.", {});
    }

    let reworkTransactionId: string | null = null;

    if (input.acceptedQuantity > 0 && nextStage) {
      const posted = await postStageTransactionInTx(tx, actor, {
        productionOrderId: jobOrder.productionOrderId,
        lot: jobOrder.lot,
        fromJobOrder: jobOrder,
        toStage: nextStage,
        quantity: input.acceptedQuantity,
        transactionType: "FORWARD",
      });
      await guardedIncrementForwarded(tx, jobOrderId, completed, input.acceptedQuantity);
      if (nextStage.isFinal) {
        await completeAtFinalStageInTx(tx, actor, {
          productId: order.productId,
          lotId: jobOrder.lot.id,
          jobOrderId: posted.jobOrder.id,
          quantity: input.acceptedQuantity,
          warehouseId: input.finishedGoodsWarehouseId!,
        });
      }
    }

    if (input.rejectedQuantity > 0 && reworkTargetStage) {
      const posted = await postStageTransactionInTx(tx, actor, {
        productionOrderId: jobOrder.productionOrderId,
        lot: jobOrder.lot,
        fromJobOrder: jobOrder,
        toStage: reworkTargetStage,
        quantity: input.rejectedQuantity,
        transactionType: "REWORK",
        revertReason: `QC rejection${input.remarks ? `: ${input.remarks}` : ""}`,
      });
      reworkTransactionId = posted.transactionId;
      await guardedShrinkPlannedForQcDisposition(tx, jobOrderId, input.rejectedQuantity);
    }

    if (input.damagedQuantity > 0) {
      await recordInventoryTransaction(tx, actor, {
        productId: order.productId,
        warehouseId: input.damageWarehouseId!,
        transactionType: "DAMAGE",
        quantity: input.damagedQuantity,
        referenceModule: "PRODUCTION_ORDER",
        referenceRecordId: jobOrderId,
      });
      await guardedShrinkPlannedForQcDisposition(tx, jobOrderId, input.damagedQuantity);
    }

    return QcInspectionRepository.createWithDefectsInTx(
      tx,
      {
        companyId: actor.companyId,
        productionOrderId: jobOrder.productionOrderId,
        lotId: jobOrder.lot.id,
        jobOrderId,
        inspectedQuantity: input.inspectedQuantity,
        acceptedQuantity: input.acceptedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        damagedQuantity: input.damagedQuantity,
        result: input.result,
        reworkStageTransactionId: reworkTransactionId,
        inspectorUserId: actor.userId,
        remarks: input.remarks || null,
      },
      input.defects.map((d) => ({
        defectTypeId: d.defectTypeId,
        quantity: d.quantity,
        severity: d.severity || null,
        remarks: d.remarks || null,
      }))
    );
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "qc_inspections",
    recordId: inspection.id,
    action: "CREATE",
    newValues: { jobOrderId, result: input.result, inspectedQuantity: input.inspectedQuantity },
  });

  return inspection;
}

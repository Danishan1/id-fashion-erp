import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { createFinishedGoodsReceiptInTx } from "@/modules/finished-goods-inventory/finished-goods-receipt.service";
import { applyPackingCompletionReservationsInTx } from "@/modules/finished-goods-inventory/finished-goods-reservation.service";
import { mintProductUnitsInTx } from "@/modules/product-units/product-unit.service";
import { ProductVariantRepository } from "@/modules/products/product.repository";
import { EmployeeRepository } from "@/modules/employees/employee.repository";
import { getProductionSettings } from "@/core/production-settings/ProductionSettingsService";
import { resolvePieceRate } from "./piece-rate-resolution.service";
import {
  assertEntryWithinAssignmentInTx,
  computeAvailableToCommit,
  syncAssignmentStatusInTx,
} from "./assignment-capacity";
import { generateEarningForJobOrderProgress, generateEarningsForQcAcceptance } from "./piece-rate-earning.service";
import { assertLotMaterialReady } from "./lot-readiness.service";
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
  DecideProgressEntryInput,
  ForwardJobOrderInput,
  RejectProgressEntryInput,
  RevertJobOrderInput,
  StartLotInput,
  SubmitSelfProgressEntryInput,
  UpdatePendingProgressEntryInput,
} from "./production.schema";
import type { ActorContext } from "./production-order.service";

const EPSILON = 0.0001;

/**
 * Enforces PermissionService.getAllowedProductionStageIds() on the write
 * side — the RBAC module/action check (production.edit/create/etc.) only
 * gates whether a user can touch the `production` module at all; a role
 * restricted to specific stages (e.g. "Cutting Supervisor") must additionally
 * be blocked from acting on a job order sitting at a stage outside that set.
 * `null` from the permission check means unrestricted (every pre-existing
 * role's default) — this is the common, no-op case for every company that
 * hasn't configured any stage restriction at all.
 */
export async function assertStageAccess(actor: ActorContext, productionStageId: string) {
  const allowed = await PermissionService.getAllowedProductionStageIds(actor.userId);
  if (allowed !== null && !allowed.has(productionStageId)) {
    throw new BusinessRuleError(
      "PRODUCTION_STAGE_ACCESS_DENIED",
      "You do not have access to this production stage.",
      { productionStageId }
    );
  }
}

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

/** Guards the one meaning `forwardJobOrder`/`recordQcInspection` actually
 * need `status === "COMPLETED"` to carry: "this quantity already reached
 * Finished Goods via `completeAtFinalStageInTx`, don't act on it again."
 * `computeJobOrderStatus` alone can't provide that — it returns "COMPLETED"
 * the moment completed+rejected+damaged reaches planned, which routinely
 * happens at an ordinary, non-final stage before anyone has forwarded
 * anything (ERP-BUG-Q10-0001: writing that value to the raw column here
 * made a fully-processed-but-not-yet-forwarded job order permanently
 * unforwardable and un-QC-able, since it looked identical to a job order
 * that had already posted to FG). Every write site that derives status from
 * quantities (ordinary progress entries, adjustments, QC disposition) must
 * route through this instead of `computeJobOrderStatus` directly, so
 * "COMPLETED" stays exclusively `completeAtFinalStageInTx`'s to grant. */
function computeWritableJobOrderStatus(jo: Parameters<typeof computeJobOrderStatus>[0]): JobOrderStatus {
  const computed = computeJobOrderStatus(jo);
  return computed === "COMPLETED" ? "IN_PROGRESS" : computed;
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

/** Posts the Finished-Goods receipt and closes out the newly-created
 * final-stage JobOrder — the automatic side effect of landing on a stage
 * flagged isFinal, same discipline as every other "terminal action is a side
 * effect, never a caller-chosen generic step" pattern in this project.
 *
 * The Lot itself only follows to COMPLETED once its FULL quantity is
 * accounted for — either landed at a final stage, or permanently removed
 * from the flow as rejected/damaged along the way. Each forward into an
 * isFinal stage creates its own JobOrder for just the forwarded batch (see
 * postStageTransactionInTx), so this function runs once per batch, not once
 * per lot — a small partial batch (e.g. a reworked handful trickling back
 * through QC) reaching Packing must NOT complete a lot whose bulk quantity
 * is still mid-pipeline. (Previously this set Lot.status unconditionally on
 * any final-stage arrival: a 1-of-22 rework batch reaching Packing flipped
 * the whole lot to COMPLETED, and canAct in LotWorkflowPanel — which only
 * allows PLANNED/IN_PROGRESS lots — then hid Forward on every other JobOrder
 * for that lot, stranding the remaining 20 pcs already completed at
 * Finishing with no way to send them on to Packing.) */
async function completeAtFinalStageInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: {
    productId: string;
    lotId: string;
    jobOrderId: string;
    productionOrderId: string;
    quantity: number;
    warehouseId: string;
    /** Finished Goods Inventory module (FGI-021) -- when supplied (Forward/
     * QC-Accept/the Job Work multi-stage cascade landing on a final stage for
     * a style with configured variants -- see resolveFinalStageVariantBreakdown
     * below), REPLACES the flat ledger posting below with
     * createFinishedGoodsReceiptInTx()'s own N per-variant postings -- never
     * runs ALONGSIDE the flat call, which would double-post StockBalance
     * (see that function's own doc comment for the full reasoning). null for
     * every no-variant style, regardless of caller -- the original,
     * byte-for-byte-unchanged flat posting. (2026-10-20: the Job Work cascade
     * used to be a third, deliberately-exempted "always flat" caller -- see
     * resolveFinalStageVariantBreakdown's own doc comment for why that scope
     * boundary was closed.) */
    variantBreakdown?: { productVariantId: string; quantity: number }[] | null;
  }
) {
  if (params.variantBreakdown && params.variantBreakdown.length > 0) {
    await createFinishedGoodsReceiptInTx(tx, actor, {
      productId: params.productId,
      lotId: params.lotId,
      jobOrderId: params.jobOrderId,
      productionOrderId: params.productionOrderId,
      warehouseId: params.warehouseId,
      quantity: params.quantity,
      variantBreakdown: params.variantBreakdown,
    });
    // Process-Flow Phase 1 (2026-10-16) — the real reservation-creation
    // trigger, in the SAME transaction as the FG receipt just posted above,
    // from the SAME variantBreakdown input. See
    // applyPackingCompletionReservationsInTx's own doc comment for the full
    // business rule, its fail-safes, and its documented (pre-existing,
    // inherited, not worsened) retry-exposure analysis. A no-variant style
    // never reaches this branch at all (variantBreakdown is null/empty for
    // it), matching that style type's own deliberate "no reservation of any
    // kind" design.
    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: params.productionOrderId,
      warehouseId: params.warehouseId,
      variantBreakdown: params.variantBreakdown,
    });

    // Mint serialized individual garment ProductUnit barcodes (FG-XXXXXXXX).
    // ProductionOrder has no salesOrderId column of its own — only
    // salesOrderItemId — so the real SalesOrder id is reached through that
    // item's own relation, matching every other reader of this FK chain
    // elsewhere in this codebase.
    const productionOrder = await tx.productionOrder.findUnique({
      where: { id: params.productionOrderId },
      select: { salesOrderItemId: true, salesOrderItem: { select: { salesOrderId: true } } },
    });

    for (const vb of params.variantBreakdown) {
      if (vb.quantity > 0) {
        await mintProductUnitsInTx(tx, actor, {
          productId: params.productId,
          productVariantId: vb.productVariantId,
          productionOrderId: params.productionOrderId,
          lotId: params.lotId,
          salesOrderId: productionOrder?.salesOrderItem?.salesOrderId ?? null,
          salesOrderItemId: productionOrder?.salesOrderItemId ?? null,
          warehouseId: params.warehouseId,
          quantity: vb.quantity,
        });
      }
    }
  } else {
    await recordInventoryTransaction(tx, actor, {
      productId: params.productId,
      warehouseId: params.warehouseId,
      transactionType: "PRODUCTION_RECEIPT",
      quantity: params.quantity,
      referenceModule: "PRODUCTION_ORDER",
      referenceRecordId: params.lotId,
    });
  }
  await JobOrderRepository.updateInTx(tx, params.jobOrderId, {
    status: "COMPLETED",
    completedQuantity: params.quantity,
    actualEndAt: new Date(),
  });

  const lot = await tx.lot.findUniqueOrThrow({ where: { id: params.lotId }, select: { quantity: true } });
  const jobOrders = await tx.jobOrder.findMany({
    where: { lotId: params.lotId },
    select: { completedQuantity: true, rejectedQuantity: true, damagedQuantity: true, productionStage: { select: { isFinal: true } } },
  });
  const accountedFor = jobOrders.reduce((sum, jo) => {
    const permanentlyDisposed = Number(jo.rejectedQuantity) + Number(jo.damagedQuantity);
    const reachedFinalStage = jo.productionStage.isFinal ? Number(jo.completedQuantity) : 0;
    return sum + permanentlyDisposed + reachedFinalStage;
  }, 0);

  if (accountedFor >= Number(lot.quantity) - EPSILON) {
    await LotRepository.updateInTx(tx, params.lotId, { status: "COMPLETED" });
  }
}

/**
 * Finished Goods Inventory module (FGI-020) — validates and resolves the
 * colour/size breakdown for a batch about to land on a final production
 * stage. Called from `forwardJobOrder()`/`recordQcInspection()` BEFORE their
 * own transaction opens (so a rejection here never leaves a partial write
 * behind — the same "rejected before any posting occurs" discipline every
 * other pre-transaction guard in this file already follows), and (2026-10-20,
 * closing the Phase 1 post-push audit's Medium-severity finding) from
 * `cascadeReceivedThroughStagesInTx` below, INSIDE its own transaction, right
 * when its loop reaches a final stage — Job Work's own established
 * convention already validates several of its guards mid-transaction and
 * relies on rollback (see `receiveJobWork()`'s `OVER_RECEIPT_NOT_ALLOWED`
 * check, which runs after a receipt row is already created in the same
 * transaction), so this isn't a new pattern for that caller.
 *
 * Returns `null` when the style has no configured (active) `ProductVariant`
 * rows at all — the flat-only posting path, completely unchanged for that
 * case; no breakdown is required or even meaningful.
 *
 * Throws `VALIDATION_ERROR` when the style DOES have variants configured
 * and the caller supplied no breakdown (or an empty one — never silently
 * defaulting to an arbitrary split), a variant that doesn't belong to this
 * style, or a sum that doesn't match the quantity actually being completed,
 * within this file's own `EPSILON` tolerance.
 */
export async function resolveFinalStageVariantBreakdown(
  productId: string,
  quantity: number,
  variantBreakdown: { productVariantId: string; quantity: number }[]
): Promise<{ productVariantId: string; quantity: number }[] | null> {
  const variants = await ProductVariantRepository.findManyActiveByProductId(productId);
  if (variants.length === 0) return null;

  if (variantBreakdown.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This style has colour/size variants configured — a breakdown of which variants make up this quantity is required to complete it onto a final stage.",
      { productId }
    );
  }

  const validVariantIds = new Set(variants.map((v) => v.id));
  for (const row of variantBreakdown) {
    if (!validVariantIds.has(row.productVariantId)) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "One of the selected colour/size variants does not belong to this style.",
        { productId, productVariantId: row.productVariantId }
      );
    }
  }

  const sum = variantBreakdown.reduce((total, row) => total + row.quantity, 0);
  if (Math.abs(sum - quantity) > EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `The colour/size breakdown (${sum}) must sum to exactly the quantity being completed (${quantity}).`,
      { breakdownSum: sum, quantity }
    );
  }

  return variantBreakdown;
}

/** 3-column guard (completed+rejected+damaged <= planned) — can't be a
 * single-column Prisma updateMany guard like every other accumulator in
 * this codebase, so this is a read-verify-write inside the caller's
 * transaction instead. A Postgres CHECK constraint is the hard backstop
 * (see the migration). `deltas` may be negative only for a genuine
 * isAdjustment=true correction. Exported so `job-work-order.service.ts` can
 * apply an external job-work receipt onto the exact same accumulators an
 * internal progress entry would — job-work-out is an alternative
 * fulfillment path for a JobOrder, not a parallel production system. */
export async function applyJobOrderQuantityDelta(
  tx: Prisma.TransactionClient,
  jobOrderId: string,
  deltas: { completed?: number; rejected?: number; damaged?: number; extra?: number }
) {
  const jo = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
  const planned = Number(jo.plannedQuantity);
  const newCompleted = Number(jo.completedQuantity) + (deltas.completed ?? 0);
  const newRejected = Number(jo.rejectedQuantity) + (deltas.rejected ?? 0);
  const newDamaged = Number(jo.damagedQuantity) + (deltas.damaged ?? 0);
  // Explicit extra pieces (Cutting) widen this job order's capacity — never
  // inferred from an over-count, only ever from a recorded extraQuantity.
  const newExtra = Number(jo.extraQuantity) + (deltas.extra ?? 0);

  if (newCompleted < -EPSILON || newRejected < -EPSILON || newDamaged < -EPSILON || newExtra < -EPSILON) {
    throw new BusinessRuleError("OVER_PRODUCTION_NOT_ALLOWED", "This adjustment would make a quantity negative.", {
      newCompleted,
      newRejected,
      newDamaged,
      newExtra,
    });
  }
  const total = newCompleted + newRejected + newDamaged;
  const capacity = planned + newExtra;
  if (total > capacity + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      newExtra > 0
        ? `Cannot record this entry — completed + rejected + damaged (${total}) would exceed the planned quantity (${planned}) plus recorded extra pieces (${newExtra}).`
        : `Cannot record this entry — completed + rejected + damaged (${total}) would exceed the planned quantity (${planned}).`,
      { planned, extra: newExtra, attempted: total }
    );
  }

  return JobOrderRepository.updateInTx(tx, jobOrderId, {
    completedQuantity: Math.max(0, newCompleted),
    rejectedQuantity: Math.max(0, newRejected),
    damagedQuantity: Math.max(0, newDamaged),
    extraQuantity: Math.max(0, newExtra),
    status: computeWritableJobOrderStatus({
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
 * This is deliberately NOT reused for QC (see applyQcDispositionInTx
 * below): "unprocessed" is normally zero once a stage's work is 100% logged
 * as completed, which is the usual precondition for running QC at all —
 * reusing this guard there produced a false "over production" rejection on
 * every already-completed job order. */
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

/** QC rejection/damage write-off: reclassifies already-completed quantity
 * as rejected/damaged rather than shrinking plannedQuantity. The prior
 * version of this function shrank `plannedQuantity` to "make room," but
 * `completedQuantity` itself never shrank to match — so on the normal
 * precondition for running QC (a job order that's already 100% completed,
 * completed === planned), shrinking planned below the already-fixed
 * completed value made the `completed+rejected+damaged <= planned` CHECK
 * constraint impossible to satisfy, crashing with a raw DB error (ERP-BUG-0002).
 * Moving the disposed quantity OUT of completedQuantity and INTO
 * rejectedQuantity/damagedQuantity instead leaves the sum unchanged, so the
 * constraint stays satisfied automatically — no need to touch planned at
 * all. The only real guard needed here is that completedQuantity can't go
 * negative; recordQcInspection()'s own notYetForwarded pre-check already
 * guarantees the disposed units haven't already left this job order via a
 * manual Forward or a prior QC acceptance. */
async function applyQcDispositionInTx(
  tx: Prisma.TransactionClient,
  jobOrderId: string,
  disposition: { rejected?: number; damaged?: number }
) {
  const jo = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
  const rejectedDelta = disposition.rejected ?? 0;
  const damagedDelta = disposition.damaged ?? 0;
  const moveOut = rejectedDelta + damagedDelta;

  const newCompleted = Number(jo.completedQuantity) - moveOut;
  if (newCompleted < -EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot move ${moveOut} out of completed — only ${jo.completedQuantity} is completed on this job order.`,
      { completed: jo.completedQuantity, attempted: moveOut }
    );
  }

  const newRejected = Number(jo.rejectedQuantity) + rejectedDelta;
  const newDamaged = Number(jo.damagedQuantity) + damagedDelta;

  return JobOrderRepository.updateInTx(tx, jobOrderId, {
    completedQuantity: Math.max(0, newCompleted),
    rejectedQuantity: newRejected,
    damagedQuantity: newDamaged,
    status: computeWritableJobOrderStatus({
      status: jo.status,
      plannedQuantity: jo.plannedQuantity,
      completedQuantity: newCompleted,
      rejectedQuantity: newRejected,
      damagedQuantity: newDamaged,
    }),
  });
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

/**
 * Multi-stage external job work (2026-09-28): a contractor who performs
 * several consecutive stages (e.g. Stitching → Finishing) hands back pieces
 * that have been through ALL of them. Once the received quantity has been
 * applied as completed on the source job order, this moves those same pieces
 * forward through each further covered stage using exactly the ledger a
 * manual Forward uses — postStageTransactionInTx + the guarded forwarded
 * accumulator + (on an isFinal stage) the Finished-Goods receipt — so the
 * stage-transaction audit trail and Lot completion stay correct.
 *
 * Each intermediate stage's new job order is marked completed for the
 * cascaded quantity; the last covered stage's job order is left completed
 * (ready to forward/QC internally) unless it is a final stage, in which case
 * the pieces land in Finished Goods.
 *
 * `variantBreakdown` (2026-10-20, closing the Phase 1 post-push audit's
 * Medium-severity finding) — previously this cascade ALWAYS took the
 * flat-only FG-posting path, even for a variant-bearing style, meaning
 * production completed via an external Job Work receipt never created a
 * Finished Goods Reservation and silently understated a real order's own
 * "Allocated" figure. Now resolved via `resolveFinalStageVariantBreakdown`
 * (the exact same validation `forwardJobOrder`/`recordQcInspection` already
 * use) the moment the loop reaches a final stage — never speculatively
 * resolved earlier, since only the terminal stage's own completion actually
 * needs it. Optional and defaults to `[]`: a no-variant style resolves to
 * `null` regardless (unchanged, flat-only path), and an omitted/empty
 * breakdown on a variant-bearing style throws the same `VALIDATION_ERROR`
 * the internal paths already throw — callers (`receiveJobWork`/
 * `approveJobWorkReceipt`) must supply it when the covered range ends on a
 * final stage for a style that has configured variants.
 */
export async function cascadeReceivedThroughStagesInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: {
    sourceJobOrderId: string;
    /** Covered stages AFTER the source stage, in working order. */
    downstreamStageIds: string[];
    quantity: number;
    finishedGoodsWarehouseId: string | null;
    jobWorkNumber: string;
    variantBreakdown?: { productVariantId: string; quantity: number }[];
  },
) {
  if (params.quantity <= EPSILON || params.downstreamStageIds.length === 0) return;

  let current = await tx.jobOrder.findUniqueOrThrow({
    where: { id: params.sourceJobOrderId },
    include: { productionStage: true, lot: { select: { id: true, lotNumber: true } }, productionOrder: { select: { productId: true } } },
  });

  for (const stageId of params.downstreamStageIds) {
    const toStage = await tx.productionStage.findFirst({ where: { id: stageId, companyId: actor.companyId } });
    if (!toStage) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id: stageId });

    const posted = await postStageTransactionInTx(tx, actor, {
      productionOrderId: current.productionOrderId,
      lot: current.lot,
      fromJobOrder: current,
      toStage,
      quantity: params.quantity,
      transactionType: "FORWARD",
      notes: `Received from external job-work ${params.jobWorkNumber}`,
    });

    const fresh = await tx.jobOrder.findUniqueOrThrow({ where: { id: current.id } });
    const guard = await guardedIncrementForwarded(tx, current.id, Number(fresh.completedQuantity), params.quantity);
    if (guard.count === 0) {
      throw new BusinessRuleError(
        "OVER_PRODUCTION_NOT_ALLOWED",
        `Cannot move ${params.quantity} received pieces on from ${current.productionStage.name} — not enough completed, un-forwarded pieces there.`,
        {},
      );
    }

    if (toStage.isFinal) {
      if (!params.finishedGoodsWarehouseId) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "This job work ends at a final stage but has no Finished Goods warehouse set.",
          {},
        );
      }
      // Resolved only now, right at the terminal stage — see this function's
      // own doc comment. Throws VALIDATION_ERROR (rolling back this whole
      // transaction, including the stage-transaction/forwarded-accumulator
      // writes already made above) if the style has variants and none/an
      // invalid breakdown was supplied.
      const resolvedVariantBreakdown = await resolveFinalStageVariantBreakdown(
        current.productionOrder.productId,
        params.quantity,
        params.variantBreakdown ?? []
      );
      await completeAtFinalStageInTx(tx, actor, {
        productId: current.productionOrder.productId,
        lotId: current.lot.id,
        jobOrderId: posted.jobOrder.id,
        productionOrderId: current.productionOrderId,
        quantity: params.quantity,
        warehouseId: params.finishedGoodsWarehouseId,
        variantBreakdown: resolvedVariantBreakdown,
      });
      return;
    }

    await applyJobOrderQuantityDelta(tx, posted.jobOrder.id, { completed: params.quantity });
    current = await tx.jobOrder.findUniqueOrThrow({
      where: { id: posted.jobOrder.id },
      include: { productionStage: true, lot: { select: { id: true, lotNumber: true } }, productionOrder: { select: { productId: true } } },
    });
  }
}

/** A branch-restricted user gets NOT_FOUND for a job order outside their allowed branches — derived from its own Lot's branch, since JobOrder itself carries no branchId column. */
export async function getJobOrderById(companyId: string, id: string, userId?: string) {
  const jobOrder = await JobOrderRepository.findAnyById(companyId, id);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id });

  if (userId) {
    const allowedBranchIds = await PermissionService.getAllowedBranchIds(userId);
    if (allowedBranchIds !== null && (!jobOrder.lot.branchId || !allowedBranchIds.has(jobOrder.lot.branchId))) {
      throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id });
    }
  }

  return jobOrder;
}

/** The very first stage entry for a lot — same ledger mechanism as every
 * later move, just with no `fromJobOrder`. Always moves the lot's full
 * quantity (a lot has no separate "not yet started" sub-quantity to track;
 * a user wanting a partial start splits the lot first). */
/**
 * Starts an existing PLANNED lot (a lot raised before 2026-09-29, when Add
 * Lot still left lots unstarted). Same gate as createLot: the order's issued
 * material must cover every counted lot, and at least one worker must be
 * assigned to the lot's first stage in the same step.
 */
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
    stage = await findFirstActiveStage(actor.companyId);
  }
  await assertStageAccess(actor, stage.id);

  // This lot is already counted among the order's lots, so nothing new is added.
  await assertLotMaterialReady(actor.companyId, order.id, { newLotPieces: 0 });
  const prepared = await prepareLotStartAssignments(actor, { productId: order.productId, lotQuantity: Number(lot.quantity), stage }, input.assignments);

  const result = await prisma.$transaction((tx) =>
    startLotAtStageInTx(tx, actor, { productionOrderId: order.id, lot, stage, assignments: prepared })
  );

  await writeLotStartAuditLogs(
    actor,
    { lotId, stageId: stage.id, quantity: lot.quantity, jobOrderId: result.jobOrder.id },
    result.assignments,
    prepared
  );

  return result.jobOrder;
}

/** The job order must exist, be live, and not already be fully finished at a final stage. */
function assertJobOrderAcceptsWork(jobOrder: { status: string; productionStage: { isFinal: boolean } }, action: string) {
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot ${action} on a cancelled job order.`, {});
  }
  if (jobOrder.status === "ON_HOLD") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This job order is on hold — resume it before you ${action}.`, {});
  }
  if (jobOrder.status === "COMPLETED" && jobOrder.productionStage.isFinal) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This job order is already completed — you can no longer ${action}.`, {});
  }
}

/**
 * Validates one worker assignment (tenant-scoped worker, active, expected
 * time window, piece-rate snapshot) and returns the row data ready to insert.
 * Shared by assignWorker (an already-running job order) and startLot/createLot
 * (the lot's first-stage workers, inserted in the same transaction that
 * creates the job order) so both paths enforce exactly the same rules.
 */
export async function prepareAssignmentData(
  actor: ActorContext,
  context: { productId: string | null; stage: { id: string; name: string } },
  input: CreateJobOrderAssignmentInput
): Promise<PreparedAssignment> {
  // Tenant-scoped — an employeeId from another company would otherwise sit
  // unvalidated on the assignment record.
  const employee = await EmployeeRepository.findById(actor.companyId, input.employeeId);
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Worker not found.", { id: input.employeeId });
  if (employee.isActive === false) {
    throw new BusinessRuleError("VALIDATION_ERROR", `${employee.fullName} is inactive and cannot be assigned work.`, {});
  }
  // Work Skills (2026-09-29): only a worker trained for this stage may be
  // assigned to it. Enforced here so every assign path (Assign Worker, Add
  // Lot, Start Lot) applies it, not just the filtered dropdown.
  if (!employee.workSkills.some((w) => w.productionStageId === context.stage.id)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `${employee.fullName} does not have "${context.stage.name.trim()}" in their Work Skills, so they can't be assigned to this stage. Add the skill in Masters → Employees first.`,
      { employeeId: employee.id, stageId: context.stage.id }
    );
  }

  const expectedStartAt = input.expectedStartAt ? new Date(input.expectedStartAt) : new Date();
  const expectedEndAt = new Date(input.expectedEndAt);
  if (Number.isNaN(expectedEndAt.getTime()) || Number.isNaN(expectedStartAt.getTime())) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Expected time is not a valid date/time.", {});
  }
  if (expectedEndAt.getTime() <= expectedStartAt.getTime()) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Expected completion time must be after the expected start time.", {});
  }
  // A small grace window so a form opened a minute ago doesn't bounce.
  if (expectedEndAt.getTime() < Date.now() - 5 * 60 * 1000) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Expected completion time cannot be in the past.", {});
  }

  // Piece-Rate Job Rate Snapshot (2026-09-18) — only enforced when the
  // company has piece-rate tracking enabled AND this employee is actually
  // paid PIECE_RATE; every other assignment (FIXED_SALARY workers, or any
  // assignment at all while the company setting is off) behaves exactly as
  // before, with none of these columns populated. Never a silent 0 — if
  // resolution fails and no authorized override was supplied, the
  // assignment is blocked outright.
  let rateFields: Partial<Prisma.JobOrderAssignmentUncheckedCreateInput> = {};
  const settings = await getProductionSettings(actor.companyId);
  if (settings.pieceRateTrackingEnabled && employee.payType === "PIECE_RATE") {
    if (input.overriddenRate) {
      await PermissionService.assert(actor.userId, "piece_rate", "override");
    }
    if (!input.productionOperationId && !input.overriddenRate) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "Select which Operation this piece-rate assignment is for (or supply an authorized override rate).",
        {}
      );
    }

    const resolution = input.productionOperationId
      ? await resolvePieceRate({
          companyId: actor.companyId,
          productId: context.productId,
          productionOperationId: input.productionOperationId,
          employeeId: input.employeeId,
          asOfDate: new Date(),
        })
      : ({ resolved: false } as const);

    if (!resolution.resolved && !input.overriddenRate) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "No piece rate is configured for this worker/style/operation combination — set up a Rate Card first, or supply an authorized override rate.",
        {}
      );
    }

    rateFields = {
      productionOperationId: input.productionOperationId || null,
      resolvedRate: resolution.resolved ? resolution.rate : null,
      resolvedRateSource: resolution.resolved && resolution.source !== "EMPLOYEE_LEGACY" ? resolution.source : null,
      resolvedRateCardId: resolution.resolved ? resolution.rateCardId : null,
      rateSnapshotAt: new Date(),
      rateOverridden: Boolean(input.overriddenRate),
      overriddenRate: input.overriddenRate ?? null,
      overrideReason: input.overriddenRate ? input.overrideReason || null : null,
      overriddenByUserId: input.overriddenRate ? actor.userId : null,
      overriddenAt: input.overriddenRate ? new Date() : null,
    };
  }

  return {
    employeeName: employee.fullName,
    data: {
      employeeId: input.employeeId,
      assignedQuantity: input.assignedQuantity,
      status: "ASSIGNED",
      assignedByUserId: actor.userId,
      expectedStartAt,
      expectedEndAt,
      ...rateFields,
    },
  };
}

export interface PreparedAssignment {
  employeeName: string;
  data: Omit<Prisma.JobOrderAssignmentUncheckedCreateInput, "jobOrderId">;
}

async function writeAssignmentAuditLog(actor: ActorContext, assignment: { id: string; jobOrderId: string }, prepared: PreparedAssignment) {
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_assignments",
    recordId: assignment.id,
    action: "CREATE",
    newValues: { ...prepared.data, jobOrderId: assignment.jobOrderId },
  });
}

/**
 * Validates every first-stage worker for a lot before anything is written.
 * The assigned pieces may not exceed the lot's own quantity (the job order is
 * brand new, so nothing else is committed against it yet).
 */
export async function prepareLotStartAssignments(
  actor: ActorContext,
  context: { productId: string | null; lotQuantity: number; stage: { id: string; name: string } },
  inputs: CreateJobOrderAssignmentInput[]
): Promise<PreparedAssignment[]> {
  if (inputs.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Cutting worker assignment, material request and material issue are required before creating the production lot. Assign at least one cutting worker.",
      {}
    );
  }
  const totalAssigned = inputs.reduce((sum, a) => sum + a.assignedQuantity, 0);
  if (totalAssigned > context.lotQuantity + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Assigned quantity cannot be greater than the lot quantity. Lot: ${context.lotQuantity}, assigned: ${totalAssigned}.`,
      { lotQuantity: context.lotQuantity, assigned: totalAssigned }
    );
  }
  const prepared: PreparedAssignment[] = [];
  for (const input of inputs) prepared.push(await prepareAssignmentData(actor, { productId: context.productId, stage: context.stage }, input));
  return prepared;
}

/** Posts the lot onto its first stage and inserts its workers — one transaction, no half-started lot. */
export async function startLotAtStageInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: {
    productionOrderId: string;
    lot: { id: string; lotNumber: string; quantity: unknown };
    stage: ProductionStage;
    assignments: PreparedAssignment[];
  }
) {
  const result = await postStageTransactionInTx(tx, actor, {
    productionOrderId: params.productionOrderId,
    lot: params.lot,
    fromJobOrder: null,
    toStage: params.stage,
    quantity: Number(params.lot.quantity),
    transactionType: "FORWARD",
  });
  const createdAssignments = [];
  for (const prepared of params.assignments) {
    createdAssignments.push(await JobOrderAssignmentRepository.createInTx(tx, { jobOrderId: result.jobOrder.id, ...prepared.data }));
  }
  return { jobOrder: result.jobOrder, assignments: createdAssignments };
}

/** Audit rows for a lot start — called after the start transaction commits. */
export async function writeLotStartAuditLogs(
  actor: ActorContext,
  params: { lotId: string; stageId: string; quantity: unknown; jobOrderId: string },
  assignments: Array<{ id: string; jobOrderId: string }>,
  prepared: PreparedAssignment[]
) {
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_orders",
    recordId: params.jobOrderId,
    action: "CREATE",
    newValues: { lotId: params.lotId, stageId: params.stageId, quantity: params.quantity },
  });
  for (let i = 0; i < assignments.length; i++) await writeAssignmentAuditLog(actor, assignments[i], prepared[i]);
}

/** The first active stage by sequence — where every new lot starts (Cutting). */
export async function findFirstActiveStage(companyId: string) {
  const stage = await prisma.productionStage.findFirst({ where: { companyId, isActive: true }, orderBy: { sequence: "asc" } });
  if (!stage) throw new BusinessRuleError("VALIDATION_ERROR", "No active production stages are configured for this company yet.", {});
  return stage;
}

export async function assignWorker(actor: ActorContext, jobOrderId: string, input: CreateJobOrderAssignmentInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  assertJobOrderAcceptsWork(jobOrder, "assign a worker");
  if (!jobOrder.productionStage.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Stage "${jobOrder.productionStage.name}" is inactive.`, {});
  }
  await assertStageAccess(actor, jobOrder.productionStageId);

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, jobOrder.productionOrderId);
  const prepared = await prepareAssignmentData(actor, { productId: order?.productId ?? null, stage: jobOrder.productionStage }, input);

  // Capacity check and insert under one row lock on the job order, so two
  // supervisors assigning at the same moment can't both pass the check.
  const assignment = await prisma.$transaction(async (tx) => {
    const locked = await JobOrderRepository.findForGuardedUpdateInTx(tx, jobOrderId);
    const { available } = await computeAvailableToCommit(tx, locked);
    if (input.assignedQuantity > available + EPSILON) {
      throw new BusinessRuleError(
        "OVER_PRODUCTION_NOT_ALLOWED",
        available <= 0
          ? "No pieces are available to assign on this job order — everything is already assigned, worked, or sent to job-work."
          : `Assigned quantity cannot be greater than available quantity. Available: ${available}, requested: ${input.assignedQuantity}.`,
        { available, requested: input.assignedQuantity }
      );
    }
    return JobOrderAssignmentRepository.createInTx(tx, { jobOrderId, ...prepared.data });
  });

  await writeAssignmentAuditLog(actor, assignment, prepared);

  return assignment;
}

/** The append-only worker log — never edited, never deleted (unless
 * ProductionSettings.supervisorApprovalRequired is on, in which case this
 * routes through the same PENDING+approve flow submitSelfProgressEntry
 * already uses — see the branch below). Returns a discriminated result so
 * the caller can tell which happened. */
export async function recordProgressEntry(actor: ActorContext, jobOrderId: string, input: CreateProgressEntryInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  assertJobOrderAcceptsWork(jobOrder, "log production");
  await assertStageAccess(actor, jobOrder.productionStageId);

  // Log Process requires a real worker assignment (2026-09-28): no assigned
  // worker → no entry, even via a direct API call. The worker is always the
  // assignment's own employee, never a client-chosen one.
  const liveAssignments = jobOrder.assignments.filter((a) => a.status !== "CANCELLED" && a.status !== "REASSIGNED");
  if (liveAssignments.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Please assign a worker before logging the production process.",
      {}
    );
  }
  // (A specific assignment that is already COMPLETED is rejected below by
  // assertEntryWithinAssignmentInTx with its own, more precise message.)
  const assignment = await JobOrderAssignmentRepository.findAnyById(input.jobOrderAssignmentId);
  if (!assignment || assignment.jobOrderId !== jobOrderId) {
    throw new BusinessRuleError("NOT_FOUND", "That worker is not assigned to this job order.", { id: input.jobOrderAssignmentId });
  }
  if (input.employeeId && input.employeeId !== assignment.employeeId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The selected worker does not match this assignment.", {});
  }
  const employeeId = assignment.employeeId;

  // Tenant-scoped — the assignment's employee must belong to this company.
  const employee = await EmployeeRepository.findById(actor.companyId, employeeId);
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Worker not found.", { id: employeeId });

  const settings = await getProductionSettings(actor.companyId);
  const entryQuantities = {
    completed: input.completedQuantity,
    rejected: input.rejectedQuantity,
    damaged: input.damagedQuantity,
    extra: input.extraQuantity,
  };

  // P0 — company-wide "always require approval" setting: route the
  // ordinary Supervisor-direct path through the exact same PENDING+approve
  // machinery submitSelfProgressEntry already established, instead of
  // applying immediately. approveProgressEntry/rejectProgressEntry/
  // updatePendingProgressEntry/listPendingProgressEntries need zero changes
  // — they already operate generically on any PENDING entry regardless of
  // enteredBy.
  if (settings.supervisorApprovalRequired) {
    const entry = await prisma.$transaction(async (tx) => {
      await assertEntryWithinAssignmentInTx(tx, {
        assignmentId: assignment.id,
        stage: jobOrder.productionStage,
        entry: entryQuantities,
      });
      return JobOrderProgressEntryRepository.createInTx(tx, {
        jobOrderId,
        jobOrderAssignmentId: assignment.id,
        employeeId,
        recordedByUserId: actor.userId,
        completedQuantity: input.completedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        damagedQuantity: input.damagedQuantity,
        extraQuantity: input.extraQuantity,
        isAdjustment: false,
        remarks: input.remarks || null,
        enteredBy: "SUPERVISOR",
        approvalStatus: "PENDING",
        startedAt: input.startedAt ? new Date(input.startedAt) : null,
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
      });
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "job_order_progress_entries",
      recordId: entry.id,
      action: "CREATE",
      newValues: {
        enteredBy: "SUPERVISOR",
        approvalStatus: "PENDING",
        completedQuantity: input.completedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        damagedQuantity: input.damagedQuantity,
      },
    });

    return { status: "PENDING" as const, entry };
  }

  const updated = await prisma.$transaction(async (tx) => {
    await assertEntryWithinAssignmentInTx(tx, {
      assignmentId: assignment.id,
      stage: jobOrder.productionStage,
      entry: entryQuantities,
    });
    const jo = await applyJobOrderQuantityDelta(tx, jobOrderId, entryQuantities);
    const entry = await JobOrderProgressEntryRepository.createInTx(tx, {
      jobOrderId,
      jobOrderAssignmentId: assignment.id,
      employeeId,
      recordedByUserId: actor.userId,
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      extraQuantity: input.extraQuantity,
      isAdjustment: false,
      remarks: input.remarks || null,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
    });
    await syncAssignmentStatusInTx(tx, assignment.id);

    if (settings.pieceRateTrackingEnabled && settings.pieceRatePaymentQuantityRule === "GOOD_COMPLETED_QTY") {
      await generateEarningForJobOrderProgress(tx, {
        companyId: actor.companyId,
        jobOrderId,
        jobOrderAssignmentId: assignment.id,
        generatedFromEntryId: entry.id,
      });
    }

    return jo;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: jobOrderId,
    action: "CREATE",
    newValues: {
      jobOrderAssignmentId: assignment.id,
      employeeId,
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      extraQuantity: input.extraQuantity,
    },
  });

  return { status: "APPLIED" as const, jobOrder: updated };
}

/** A genuine data-entry correction — the only kind of entry allowed to
 * carry a value that reduces an earlier (mistaken) entry, mirroring
 * InventoryTransaction's own signed-reversal convention rather than ever
 * editing/deleting an existing row. */
export async function recordAdjustmentEntry(actor: ActorContext, jobOrderId: string, input: CreateAdjustmentEntryInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  await assertStageAccess(actor, jobOrder.productionStageId);

  // An adjustment has no real "worker" — attribute it to the acting user's
  // own linked Employee record if one exists (User.employeeId), else leave
  // it unattributed (null — the column is nullable specifically for this
  // case). actor.userId itself is a User id, never an Employee id — passing
  // it directly as employeeId used to fail the FK constraint on every call.
  const actingUser = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });

  const updated = await prisma.$transaction(async (tx) => {
    const jo = await applyJobOrderQuantityDelta(tx, jobOrderId, {
      completed: input.completedQuantity,
      rejected: input.rejectedQuantity,
      damaged: input.damagedQuantity,
    });
    await JobOrderProgressEntryRepository.createInTx(tx, {
      jobOrderId,
      employeeId: actingUser?.employeeId ?? null,
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

// ─────────────────────────────────────────────────────────────
// Worker self-entry (2026-09-02) — an additive, parallel path alongside
// recordProgressEntry above. The existing supervisor-direct flow is
// completely unchanged: it still applies immediately, no approval. A
// self-submitted entry instead sits PENDING and does NOT touch the
// JobOrder's real quantities until a Supervisor approves it (see
// approveProgressEntry) — a worker's own unverified claim must never count
// as real production before someone checks it.
// ─────────────────────────────────────────────────────────────

/** Resolves the acting User's own linked Employee, requiring both the link
 * and the per-employee Admin toggle to be set — shared by every self-entry
 * function below so the same two guards can never drift out of sync. */
async function resolveSelfEntryEmployee(actor: ActorContext) {
  const actingUser = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  if (!actingUser?.employeeId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Your login isn't linked to an Employee record yet — ask an Admin to link it before you can log your own progress.",
      {}
    );
  }
  const employee = await EmployeeRepository.findById(actor.companyId, actingUser.employeeId);
  if (!employee || !employee.selfEntryEnabled) {
    throw new BusinessRuleError(
      "PERMISSION_DENIED",
      "Self-entry has not been enabled for your Employee record — ask an Admin to enable it.",
      {}
    );
  }
  return employee;
}

/** A worker submits their own progress. employeeId/jobOrderAssignmentId are
 * never taken from client input — always the caller's own resolved Employee
 * and their own real assignment on this job order, so a worker can never
 * credit someone else. No quantity delta is applied here; see
 * approveProgressEntry for where that actually happens. */
export async function submitSelfProgressEntry(actor: ActorContext, jobOrderId: string, input: SubmitSelfProgressEntryInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  assertJobOrderAcceptsWork(jobOrder, "log production");
  await assertStageAccess(actor, jobOrder.productionStageId);

  const employee = await resolveSelfEntryEmployee(actor);

  const assignment = await JobOrderAssignmentRepository.findByJobOrderAndEmployee(jobOrderId, employee.id);
  if (!assignment) {
    throw new BusinessRuleError("VALIDATION_ERROR", "You are not assigned to this job order.", {});
  }
  // Work Skills (2026-09-29): a worker may log their own work only on a stage
  // they are skilled for. This (plus Self Entry and their own assignment) is
  // what authorizes a self-entry — not the Production "create" permission.
  if (!employee.workSkills.some((w) => w.productionStageId === jobOrder.productionStageId)) {
    throw new BusinessRuleError(
      "PERMISSION_DENIED",
      `You don't have "${jobOrder.productionStage.name.trim()}" in your Work Skills, so you can't log progress on this stage. Ask an Admin to add it in Masters → Employees.`,
      { stageId: jobOrder.productionStageId }
    );
  }

  const entry = await prisma.$transaction(async (tx) => {
    await assertEntryWithinAssignmentInTx(tx, {
      assignmentId: assignment.id,
      stage: jobOrder.productionStage,
      entry: {
        completed: input.completedQuantity,
        rejected: input.rejectedQuantity,
        damaged: input.damagedQuantity,
        extra: input.extraQuantity,
      },
    });
    return JobOrderProgressEntryRepository.createInTx(tx, {
      jobOrderId,
      jobOrderAssignmentId: assignment.id,
      employeeId: employee.id,
      recordedByUserId: actor.userId,
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      extraQuantity: input.extraQuantity,
      isAdjustment: false,
      remarks: input.remarks || null,
      enteredBy: "SELF",
      approvalStatus: "PENDING",
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: entry.id,
    action: "CREATE",
    newValues: {
      enteredBy: "SELF",
      approvalStatus: "PENDING",
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
    },
  });

  return entry;
}

async function loadPendingEntryForCompany(companyId: string, entryId: string) {
  const entry = await JobOrderProgressEntryRepository.findAnyById(entryId);
  if (!entry || entry.jobOrder.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Progress entry not found.", { id: entryId });
  }
  return entry;
}

/** A Supervisor corrects a worker's self-submitted quantities/remarks before
 * deciding — only while still PENDING (mirrors Expense.updateExpense's
 * edit-only-while-PENDING_APPROVAL shape). Gated on the same "approve"
 * action as the decision itself: only someone who could approve/reject this
 * entry can also correct it first. */
export async function updatePendingProgressEntry(actor: ActorContext, entryId: string, input: UpdatePendingProgressEntryInput) {
  const entry = await loadPendingEntryForCompany(actor.companyId, entryId);
  await PermissionService.assert(actor.userId, "production", "approve");

  if (entry.approvalStatus !== "PENDING") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a progress entry in "${entry.approvalStatus}" status.`,
      { currentStatus: entry.approvalStatus }
    );
  }

  const before = {
    completedQuantity: entry.completedQuantity,
    rejectedQuantity: entry.rejectedQuantity,
    damagedQuantity: entry.damagedQuantity,
    remarks: entry.remarks,
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (entry.jobOrderAssignmentId) {
      await assertEntryWithinAssignmentInTx(tx, {
        assignmentId: entry.jobOrderAssignmentId,
        stage: entry.jobOrder.productionStage,
        entry: {
          completed: input.completedQuantity,
          rejected: input.rejectedQuantity,
          damaged: input.damagedQuantity,
          extra: input.extraQuantity ?? Number(entry.extraQuantity),
        },
        excludeEntryId: entryId,
      });
    }
    return tx.jobOrderProgressEntry.update({
      where: { id: entryId },
      data: {
        completedQuantity: input.completedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        damagedQuantity: input.damagedQuantity,
        extraQuantity: input.extraQuantity ?? Number(entry.extraQuantity),
        remarks: input.remarks || null,
      },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: entryId,
    action: "UPDATE",
    oldValues: before,
    newValues: {
      completedQuantity: input.completedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      remarks: input.remarks,
    },
  });

  return updated;
}

/** The actual approval decision — this is where the worker's claimed
 * quantities finally become real, applied via the exact same
 * applyJobOrderQuantityDelta cap-check every other write path uses,
 * re-validated against the JobOrder's CURRENT state (which may have moved
 * since submission). Self-approval-guarded — a Supervisor/Manager can't
 * approve their own submitted entry — matching Expense.approveExpense's
 * precedent exactly. */
export async function approveProgressEntry(actor: ActorContext, entryId: string, input: DecideProgressEntryInput) {
  const entry = await loadPendingEntryForCompany(actor.companyId, entryId);
  await PermissionService.assert(actor.userId, "production", "approve", { createdBy: entry.recordedByUserId });

  const updated = await prisma.$transaction(async (tx) => {
    const guard = await JobOrderProgressEntryRepository.updateStatusConditionalInTx(tx, entryId, "PENDING", {
      approvalStatus: "APPROVED",
      approvedByUserId: actor.userId,
      approvedAt: new Date(),
      approvalRemark: input.approvalRemark || null,
    });
    if (guard.count === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot approve a progress entry in "${entry.approvalStatus}" status.`,
        { currentStatus: entry.approvalStatus }
      );
    }

    const approvedQuantities = {
      completed: Number(entry.completedQuantity),
      rejected: Number(entry.rejectedQuantity),
      damaged: Number(entry.damagedQuantity),
      extra: Number(entry.extraQuantity),
    };
    // Re-validated against the assignment's CURRENT state (it may have moved
    // since submission) — this entry is excluded from the prior sum so it
    // isn't counted twice.
    if (entry.jobOrderAssignmentId) {
      await assertEntryWithinAssignmentInTx(tx, {
        assignmentId: entry.jobOrderAssignmentId,
        stage: entry.jobOrder.productionStage,
        entry: approvedQuantities,
        excludeEntryId: entry.id,
      });
    }
    await applyJobOrderQuantityDelta(tx, entry.jobOrderId, approvedQuantities);
    if (entry.jobOrderAssignmentId) await syncAssignmentStatusInTx(tx, entry.jobOrderAssignmentId);

    const settings = await getProductionSettings(actor.companyId);
    if (settings.pieceRateTrackingEnabled && settings.pieceRatePaymentQuantityRule === "GOOD_COMPLETED_QTY" && entry.jobOrderAssignmentId) {
      await generateEarningForJobOrderProgress(tx, {
        companyId: actor.companyId,
        jobOrderId: entry.jobOrderId,
        jobOrderAssignmentId: entry.jobOrderAssignmentId,
        generatedFromEntryId: entry.id,
      });
    }

    return tx.jobOrderProgressEntry.findUniqueOrThrow({ where: { id: entryId } });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: entryId,
    action: "APPROVE",
    oldValues: { approvalStatus: "PENDING" },
    newValues: { approvalStatus: "APPROVED", approvalRemark: input.approvalRemark },
  });

  return updated;
}

/** Rejects a self-submitted entry — a remark is required (mirrors
 * Expense.rejectExpense's required rejectionReason). No JobOrder quantity
 * change; the row stays as a permanent rejected record with the
 * Supervisor's remark. Deliberately NOT self-approval-guarded, matching
 * Sampling's/Expense's own precedent that only the Approve branch carries
 * that guard. */
export async function rejectProgressEntry(actor: ActorContext, entryId: string, input: RejectProgressEntryInput) {
  const entry = await loadPendingEntryForCompany(actor.companyId, entryId);
  await PermissionService.assert(actor.userId, "production", "approve");

  const guard = await JobOrderProgressEntryRepository.updateStatusConditional(entryId, "PENDING", {
    approvalStatus: "REJECTED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
    approvalRemark: input.approvalRemark,
  });
  if (guard.count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot reject a progress entry in "${entry.approvalStatus}" status.`,
      { currentStatus: entry.approvalStatus }
    );
  }

  const updated = await prisma.jobOrderProgressEntry.findUniqueOrThrow({ where: { id: entryId } });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_order_progress_entries",
    recordId: entryId,
    action: "REJECT",
    oldValues: { approvalStatus: "PENDING" },
    newValues: { approvalStatus: "REJECTED", approvalRemark: input.approvalRemark },
  });

  return updated;
}

/** Backs the worker-facing "My Work" list — every job order the caller's own
 * linked Employee is actively assigned to, at a stage their Role allows (same
 * filtering convention as getLotById in lot.service.ts). Throws the same
 * "not linked"/"not enabled" errors as submitSelfProgressEntry so the page
 * can show a clear message instead of a blank/broken list. */
export async function listMyProductionAssignments(actor: ActorContext) {
  const employee = await resolveSelfEntryEmployee(actor);
  const assignments = await JobOrderAssignmentRepository.listActiveForEmployee(actor.companyId, employee.id);

  const allowedStageIds = await PermissionService.getAllowedProductionStageIds(actor.userId);
  if (allowedStageIds === null) return assignments;

  return assignments.filter((a) => allowedStageIds.has(a.jobOrder.productionStage.id));
}

/** Backs the "My Submitted Entries" section of the same page — every
 * self-entry the caller has ever submitted, regardless of stage (a worker
 * should still see the outcome of an entry even if their stage access was
 * later narrowed). */
export async function listMySubmittedProgressEntries(actor: ActorContext) {
  const employee = await resolveSelfEntryEmployee(actor);
  return JobOrderProgressEntryRepository.findByEmployeeAndSource(employee.id, "SELF");
}

/** Backs the Supervisor-facing "Pending Approvals" queue. */
export async function listPendingProgressEntries(actor: ActorContext) {
  await PermissionService.assert(actor.userId, "production", "approve");
  return JobOrderProgressEntryRepository.findPendingForCompany(actor.companyId);
}

export async function forwardJobOrder(actor: ActorContext, jobOrderId: string, input: ForwardJobOrderInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot forward a cancelled job order.", {});
  }
  // Guarded on the SOURCE stage only — a supervisor moving completed work
  // along the pipeline to the next stage doesn't need access to that next
  // stage themselves, matching how a real factory floor hands off work.
  await assertStageAccess(actor, jobOrder.productionStageId);
  // BUGFIX (previously): this guard used to fire on `status === "COMPLETED"`
  // alone. That's wrong — computeJobOrderStatus() (called by
  // applyJobOrderQuantityDelta on every ordinary progress entry, not just by
  // completeAtFinalStageInTx) already returns "COMPLETED" the moment
  // completed+rejected+damaged reaches plannedQuantity, at ANY stage, final
  // or not. A supervisor logging 100% done at Cutting in one entry — before
  // ever clicking Forward — hit exactly this: the job order was genuinely
  // stuck at stage 1 of 6 with forwardedQuantity still 0, and every Forward
  // attempt afterward was refused with a message that claimed it had
  // "already reached Finished Goods," which was false. Reproduced live and
  // confirmed against the database before this fix.
  //
  // The real invariant to protect is narrower: forwarding must be blocked
  // only for a job order that already sits AT a final stage and is
  // COMPLETED there — that combination is what completeAtFinalStageInTx
  // itself produces, and is the only state where "nothing left to forward,
  // FG already posted" is actually true. A COMPLETED job order at a
  // non-final stage still has real work to forward; the notYetForwarded
  // check just below already caps that correctly and safely.
  if (jobOrder.status === "COMPLETED" && jobOrder.productionStage.isFinal) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This job order already completed at a final production stage and its quantity has already reached Finished Goods — it cannot be forwarded again.",
      {}
    );
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

  // Finished Goods Inventory module (FGI-020) -- resolved/validated BEFORE
  // the transaction opens, so a rejection here never leaves a partial write
  // behind.
  const variantBreakdown = targetStage.isFinal
    ? await resolveFinalStageVariantBreakdown(order.productId, input.quantity, input.variantBreakdown ?? [])
    : null;

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
        productionOrderId: jobOrder.productionOrderId,
        quantity: input.quantity,
        warehouseId: input.finishedGoodsWarehouseId!,
        variantBreakdown,
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

  // result.jobOrder is the row exactly as `postStageTransactionInTx` created
  // it (status "PENDING", completedQuantity 0) — when the target stage is
  // final, `completeAtFinalStageInTx` mutates that same row afterward
  // (status "COMPLETED", completedQuantity set) inside the same transaction,
  // so returning the pre-mutation object straight from the transaction's
  // return value would hand the caller stale status/quantity for the very
  // job order that just completed.
  if (targetStage.isFinal) {
    const fresh = await JobOrderRepository.findAnyById(actor.companyId, result.jobOrder.id);
    if (fresh) return fresh;
  }

  return result.jobOrder;
}

export async function revertJobOrder(actor: ActorContext, jobOrderId: string, input: RevertJobOrderInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot revert a cancelled job order.", {});
  }
  await assertStageAccess(actor, jobOrder.productionStageId);

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
  await assertStageAccess(actor, jobOrder.productionStageId);
  // BUGFIX (previously): same false-positive as forwardJobOrder() — see the
  // long comment there. "COMPLETED" alone can mean "100% logged at a
  // perfectly ordinary, non-final stage," not just "already posted to
  // Finished Goods." QC inspection is only genuinely impossible once a job
  // order sits AT a final stage and is COMPLETED there — that's the only
  // state where "this quantity already left the factory" is actually true.
  if (jobOrder.status === "COMPLETED" && jobOrder.productionStage.isFinal) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This job order already completed at a final production stage and its quantity has already reached Finished Goods — it cannot be inspected again.",
      {}
    );
  }

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

  // A unit that has already left this job order via a manual Forward (or an
  // earlier QC acceptance) is no longer physically present at this stage —
  // QC must not be able to inspect/accept/reject/damage it a second time.
  // Both this job order's manual Forward and QC's own accept branch draw
  // down the same shared forwardedQuantity pool (see guardedIncrementForwarded),
  // so checking against it here (not just qcPassedQuantity above) is what
  // actually closes the gap: without this, accepting at QC after an earlier
  // manual Forward of the same completed quantity created a second,
  // phantom downstream job order and double-posted Finished-Goods stock.
  const alreadyForwarded = Number(jobOrder.forwardedQuantity);
  const notYetForwarded = completed - alreadyForwarded;
  if (input.inspectedQuantity > notYetForwarded + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot inspect ${input.inspectedQuantity} — only ${notYetForwarded} completed unit(s) have not already been forwarded to the next stage (e.g. via a manual Forward). QC can only act on units still present at this stage.`,
      { notYetForwarded }
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

  // Finished Goods Inventory module (FGI-020) -- resolved/validated BEFORE
  // the transaction opens, so a rejection here never leaves a partial write
  // behind.
  const variantBreakdown =
    input.acceptedQuantity > 0 && nextStage?.isFinal
      ? await resolveFinalStageVariantBreakdown(order.productId, input.acceptedQuantity, input.variantBreakdown ?? [])
      : null;

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
      const forwardGuard = await guardedIncrementForwarded(tx, jobOrderId, completed, input.acceptedQuantity);
      if (forwardGuard.count === 0) {
        throw new BusinessRuleError(
          "OVER_PRODUCTION_NOT_ALLOWED",
          "This job order was forwarded by someone else at the same time — reload and try again.",
          {}
        );
      }
      if (nextStage.isFinal) {
        await completeAtFinalStageInTx(tx, actor, {
          productId: order.productId,
          lotId: jobOrder.lot.id,
          jobOrderId: posted.jobOrder.id,
          productionOrderId: jobOrder.productionOrderId,
          quantity: input.acceptedQuantity,
          warehouseId: input.finishedGoodsWarehouseId!,
          variantBreakdown,
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
      await applyQcDispositionInTx(tx, jobOrderId, { rejected: input.rejectedQuantity });
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
      await applyQcDispositionInTx(tx, jobOrderId, { damaged: input.damagedQuantity });
    }

    const createdInspection = await QcInspectionRepository.createWithDefectsInTx(
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

    // Piece-Rate (2026-09-18) — QC acceptance is the primary earning trigger
    // (QC_ACCEPTED_QTY is the recommended default payment-quantity rule).
    // Runs inside this same transaction so an earning is never generated
    // without the QC row that justified it, or vice versa.
    const settings = await getProductionSettings(actor.companyId);
    if (settings.pieceRateTrackingEnabled && input.acceptedQuantity > 0) {
      await generateEarningsForQcAcceptance(tx, {
        companyId: actor.companyId,
        jobOrderId,
        generatedFromQcInspectionId: createdInspection.id,
      });
    }

    return createdInspection;
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

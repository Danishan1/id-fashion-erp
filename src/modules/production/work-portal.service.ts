import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { PermissionService } from "@/core/rbac/PermissionService";
import {
  deleteAttachment,
  getAttachmentForDownload,
  listAttachments,
  uploadAttachment,
} from "@/core/attachments/AttachmentService";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  EPSILON,
  lockAssignmentInTx,
  sumAssignmentConsumed,
  syncAssignmentStatusInTx,
} from "./assignment-capacity";
import { assertJobOrderScope, getJobOrderById } from "./job-order.service";
import { getProductionApprovalTeam } from "./production-scope";

/**
 * P4 (2026-10-21): the Employee Work Portal's two new actions.
 *   - Hand-back: a worker returns pieces of their assignment they won't work.
 *   - Slips: photos/scans of handwritten slips or PDFs attached to a job order.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

export const handbackSchema = z.object({
  quantity: z.coerce.number().int("Whole pieces only.").positive("Enter at least 1 piece."),
  reason: z.string().trim().min(3, "Give a short reason.").max(500),
});
export type HandbackInput = z.infer<typeof handbackSchema>;

async function linkedEmployeeId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  return user?.employeeId ?? null;
}

/**
 * Who may act on an assignment:
 *   - the worker it belongs to (their login's linked employee), or
 *   - someone with production.edit within the job order's branch/stage, and --
 *     when they have a Production team -- only for that team (P3).
 */
async function assertCanActOnAssignment(
  actor: ActorContext,
  assignment: { id: string; employeeId: string; jobOrder: { id: string; productionStageId: string; lot: { branchId: string | null } } }
) {
  if ((await linkedEmployeeId(actor.userId)) === assignment.employeeId) return;
  const notFound = new BusinessRuleError("NOT_FOUND", "Assignment not found.", { id: assignment.id });
  if (!(await PermissionService.can(actor.userId, "production", "edit"))) throw notFound;
  await assertJobOrderScope(actor, assignment.jobOrder);
  const team = await getProductionApprovalTeam(actor.userId);
  if (team && !team.has(assignment.employeeId)) throw notFound;
}

/**
 * Hands back `quantity` unworked pieces of an assignment. The assignment's
 * assigned quantity drops by the same amount in one transaction (row-locked),
 * so the pieces become available to assign again. Can't hand back pieces
 * already logged, including entries still waiting for approval.
 */
export async function handBackAssignment(actor: ActorContext, assignmentId: string, input: HandbackInput) {
  const assignment = await prisma.jobOrderAssignment.findFirst({
    where: { id: assignmentId, jobOrder: { companyId: actor.companyId } },
    select: {
      id: true,
      employeeId: true,
      jobOrder: { select: { id: true, productionStageId: true, lot: { select: { branchId: true } } } },
    },
  });
  if (!assignment) throw new BusinessRuleError("NOT_FOUND", "Assignment not found.", { id: assignmentId });
  await assertCanActOnAssignment(actor, assignment);

  const handback = await prisma.$transaction(async (tx) => {
    const locked = await lockAssignmentInTx(tx, assignmentId);
    if (!ACTIVE_ASSIGNMENT_STATUSES.includes(locked.status as (typeof ACTIVE_ASSIGNMENT_STATUSES)[number])) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This assignment is ${locked.status.toLowerCase()} — nothing to hand back.`, {
        status: locked.status,
      });
    }
    const assigned = Number(locked.assignedQuantity);
    const consumed = await sumAssignmentConsumed(tx, assignmentId, { includePending: true });
    const returnable = Math.max(0, assigned - consumed);
    if (input.quantity > returnable + EPSILON) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `You can hand back at most ${returnable} piece(s): ${assigned} assigned, ${consumed} already logged (including entries waiting for approval).`,
        { field: "quantity", returnable }
      );
    }

    const newAssigned = assigned - input.quantity;
    await tx.jobOrderAssignment.update({
      where: { id: assignmentId },
      data:
        newAssigned <= EPSILON && consumed <= EPSILON
          ? { assignedQuantity: newAssigned, status: "CANCELLED" }
          : { assignedQuantity: newAssigned },
    });
    if (newAssigned > EPSILON || consumed > EPSILON) await syncAssignmentStatusInTx(tx, assignmentId);

    return tx.productionHandback.create({
      data: {
        companyId: actor.companyId,
        jobOrderId: assignment.jobOrder.id,
        jobOrderAssignmentId: assignmentId,
        employeeId: assignment.employeeId,
        quantity: input.quantity,
        reason: input.reason,
        assignedQuantityBefore: assigned,
        handedBackByUserId: actor.userId,
      },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_handbacks",
    recordId: handback.id,
    action: "CREATE",
    newValues: handback,
  });
  return handback;
}

/** Hand-backs on one job order, newest first (visible to anyone who can see the job order). */
export async function listHandbacks(actor: ActorContext, jobOrderId: string) {
  await getJobOrderById(actor.companyId, jobOrderId, actor.userId);
  return prisma.productionHandback.findMany({
    where: { companyId: actor.companyId, jobOrderId },
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { id: true, fullName: true, employeeCode: true } },
      handedBackBy: { select: { id: true, fullName: true } },
    },
  });
}

// ---------------------------------------------------------------- slips ---

/** Slips are images (camera/gallery) or PDFs only. */
export const SLIP_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

/** Anyone who can see the job order (P1 scope: assigned workers, or view_all). */
export async function listJobOrderSlips(actor: ActorContext, jobOrderId: string) {
  await getJobOrderById(actor.companyId, jobOrderId, actor.userId);
  return listAttachments(actor.companyId, "JOB_ORDER", jobOrderId);
}

/** The assigned worker, or someone with production.edit in scope. */
async function assertCanUploadSlip(actor: ActorContext, jobOrderId: string) {
  const jobOrder = await getJobOrderById(actor.companyId, jobOrderId, actor.userId);
  const employeeId = await linkedEmployeeId(actor.userId);
  if (employeeId && jobOrder.assignments.some((a) => a.employeeId === employeeId && a.status !== "CANCELLED")) return jobOrder;
  await PermissionService.assert(actor.userId, "production", "edit");
  await assertJobOrderScope(actor, jobOrder);
  return jobOrder;
}

export async function uploadJobOrderSlip(
  actor: ActorContext,
  jobOrderId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string }
) {
  if (!SLIP_MIME_TYPES.includes(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Slips must be a photo (JPG, PNG, WEBP, HEIC) or a PDF.", { field: "file" });
  }
  const jobOrder = await assertCanUploadSlip(actor, jobOrderId);
  return uploadAttachment(actor, "JOB_ORDER", jobOrderId, file, jobOrder.productionStage.name);
}

/** Download: same visibility as the job order, and the file must belong to it. */
export async function getJobOrderSlipForDownload(actor: ActorContext, jobOrderId: string, attachmentId: string) {
  await getJobOrderById(actor.companyId, jobOrderId, actor.userId);
  const result = await getAttachmentForDownload(actor.companyId, attachmentId);
  if (result.attachment.relatedModule !== "JOB_ORDER" || result.attachment.relatedRecordId !== jobOrderId) {
    throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
  }
  return result;
}

/** The uploader can remove their own slip; otherwise production.edit in scope. */
export async function deleteJobOrderSlip(actor: ActorContext, jobOrderId: string, attachmentId: string) {
  const jobOrder = await getJobOrderById(actor.companyId, jobOrderId, actor.userId);
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, companyId: actor.companyId, relatedModule: "JOB_ORDER", relatedRecordId: jobOrderId },
    select: { uploadedById: true },
  });
  if (!attachment) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
  if (attachment.uploadedById !== actor.userId) {
    await PermissionService.assert(actor.userId, "production", "edit");
    await assertJobOrderScope(actor, jobOrder);
  }
  await deleteAttachment(actor, attachmentId);
}

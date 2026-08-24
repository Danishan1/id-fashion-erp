import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import type { RelatedModule } from "@prisma/client";
import { CrmActivityRepository, CrmFollowupRepository } from "./crm-activity.repository";
import type { ActorContext } from "./lead.service";
import type { CreateCrmActivityInput, CreateCrmFollowupInput, CrmFollowupStatusChangeInput } from "./crm-activity.schema";

/**
 * relatedRecordId is a polymorphic FK with no DB-enforced referential
 * integrity (same tradeoff as Attachment/AuditLog elsewhere in this
 * project) — this app-layer existence + tenant check is what actually
 * prevents a cross-tenant write, the exact bug class this project has
 * found and fixed twice already (Sampling's addSampleMaterial, then a
 * 26-entity sweep). Never skip this for a new polymorphic caller.
 */
async function assertRelatedRecordInCompany(companyId: string, relatedModule: RelatedModule, relatedRecordId: string) {
  const exists = await (
    relatedModule === "LEAD"
      ? prisma.lead.findFirst({ where: { id: relatedRecordId, companyId }, select: { id: true } })
      : relatedModule === "DEAL"
        ? prisma.deal.findFirst({ where: { id: relatedRecordId, companyId }, select: { id: true } })
        : prisma.customer.findFirst({ where: { id: relatedRecordId, companyId }, select: { id: true } })
  );
  if (!exists) throw new BusinessRuleError("NOT_FOUND", "The related record was not found.", { relatedModule, relatedRecordId });
}

export async function listCrmActivities(companyId: string, relatedModule: RelatedModule, relatedRecordId: string) {
  await assertRelatedRecordInCompany(companyId, relatedModule, relatedRecordId);
  return CrmActivityRepository.findByRelated(companyId, relatedModule, relatedRecordId);
}

export async function addCrmActivity(actor: ActorContext, input: CreateCrmActivityInput) {
  await assertRelatedRecordInCompany(actor.companyId, input.relatedModule, input.relatedRecordId);

  const activity = await CrmActivityRepository.create({
    companyId: actor.companyId,
    relatedModule: input.relatedModule,
    relatedRecordId: input.relatedRecordId,
    activityType: input.activityType,
    subject: input.subject || null,
    body: input.body || null,
    performedByUserId: actor.userId,
  });

  // Mirrors the source's own rule: logging an activity against a Lead
  // bumps its lastActivityAt, used for "stale lead" visibility.
  if (input.relatedModule === "LEAD") {
    await prisma.lead.update({ where: { id: input.relatedRecordId }, data: { lastActivityAt: new Date() } });
  }

  return activity;
}

export async function listCrmFollowups(companyId: string, relatedModule: RelatedModule, relatedRecordId: string) {
  await assertRelatedRecordInCompany(companyId, relatedModule, relatedRecordId);
  return CrmFollowupRepository.findByRelated(companyId, relatedModule, relatedRecordId);
}

export async function addCrmFollowup(actor: ActorContext, input: CreateCrmFollowupInput) {
  await assertRelatedRecordInCompany(actor.companyId, input.relatedModule, input.relatedRecordId);

  return CrmFollowupRepository.create({
    companyId: actor.companyId,
    relatedModule: input.relatedModule,
    relatedRecordId: input.relatedRecordId,
    assignedToUserId: input.assignedToUserId || null,
    followupDate: new Date(input.followupDate),
    type: input.type,
    status: "PENDING",
    notes: input.notes || null,
    createdByUserId: actor.userId,
  });
}

export async function changeCrmFollowupStatus(actor: ActorContext, id: string, input: CrmFollowupStatusChangeInput) {
  const existing = await CrmFollowupRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Follow-up not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This follow-up is already "${existing.status}".`, { currentStatus: existing.status });
  }

  return CrmFollowupRepository.update(id, {
    status: input.status,
    completedAt: input.status === "COMPLETED" ? new Date() : null,
  });
}

/** Powers the CRM dashboard's pending/overdue counters — same live
 * read-time comparison the source uses (status='pending' AND
 * followup_date < now()), never a stored "isOverdue" flag. */
export async function getFollowupCounters(companyId: string) {
  const now = new Date();
  const [pending, overdue] = await Promise.all([
    CrmFollowupRepository.countPending(companyId),
    CrmFollowupRepository.countOverdue(companyId, now),
  ]);
  return { pending, overdue };
}

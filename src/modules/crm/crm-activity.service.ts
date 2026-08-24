import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import { createNotification } from "@/core/notifications/NotificationService";
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
    priority: input.priority,
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

/** Midnight-today / midnight-tomorrow — the one boundary definition shared
 * by `getFollowupCounters()` and `listFollowupsForManagement()`, so
 * "overdue" vs. "due today" never drifts between the dashboard's counters
 * and the management screen's own bucketing. */
function getTodayBoundaries(now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  return { startOfToday, startOfTomorrow };
}

/** Powers the CRM dashboard's and Follow-up Management's overdue/due-today/
 * upcoming/completed counters — same live read-time comparison the source
 * uses (status='pending' AND followup_date < now()), never a stored
 * "isOverdue" flag. `pending` is kept as the sum of the three open buckets
 * for any existing caller expecting the original two-field shape. */
export async function getFollowupCounters(companyId: string) {
  const { startOfToday, startOfTomorrow } = getTodayBoundaries(new Date());

  const [overdue, dueToday, upcoming, completed] = await Promise.all([
    CrmFollowupRepository.countOverdue(companyId, startOfToday),
    CrmFollowupRepository.countDueToday(companyId, startOfToday, startOfTomorrow),
    CrmFollowupRepository.countUpcoming(companyId, startOfTomorrow),
    CrmFollowupRepository.countCompleted(companyId),
  ]);

  return { overdue, dueToday, upcoming, completed, pending: overdue + dueToday + upcoming };
}

/**
 * The full Follow-up Management screen's data source — every non-cancelled
 * follow-up company-wide, bucketed the same way as `getFollowupCounters()`,
 * with each row's polymorphic `relatedModule`/`relatedRecordId` resolved to
 * a human label. Resolution is batched per module (one query per of
 * Lead/Deal/Customer, not one query per follow-up) since a company can have
 * many follow-ups and an N+1 here would scale badly.
 */
export async function listFollowupsForManagement(companyId: string) {
  const { startOfToday, startOfTomorrow } = getTodayBoundaries(new Date());
  const all = await CrmFollowupRepository.findAllForCompany(companyId);

  const idsByModule = { LEAD: new Set<string>(), DEAL: new Set<string>(), CUSTOMER: new Set<string>() } as const;
  for (const f of all) {
    if (f.relatedModule === "LEAD" || f.relatedModule === "DEAL" || f.relatedModule === "CUSTOMER") {
      idsByModule[f.relatedModule].add(f.relatedRecordId);
    }
  }

  const [leads, deals, customers] = await Promise.all([
    idsByModule.LEAD.size ? prisma.lead.findMany({ where: { id: { in: [...idsByModule.LEAD] } }, select: { id: true, name: true } }) : [],
    idsByModule.DEAL.size ? prisma.deal.findMany({ where: { id: { in: [...idsByModule.DEAL] } }, select: { id: true, title: true } }) : [],
    idsByModule.CUSTOMER.size
      ? prisma.customer.findMany({ where: { id: { in: [...idsByModule.CUSTOMER] } }, select: { id: true, name: true } })
      : [],
  ]);
  const leadNames = new Map(leads.map((l) => [l.id, l.name]));
  const dealTitles = new Map(deals.map((d) => [d.id, d.title]));
  const customerNames = new Map(customers.map((c) => [c.id, c.name]));

  const decorated = all.map((f) => ({
    ...f,
    relatedLabel:
      f.relatedModule === "LEAD"
        ? (leadNames.get(f.relatedRecordId) ?? "Deleted Lead")
        : f.relatedModule === "DEAL"
          ? (dealTitles.get(f.relatedRecordId) ?? "Deleted Deal")
          : (customerNames.get(f.relatedRecordId) ?? "Deleted Customer"),
  }));

  return {
    overdue: decorated.filter((f) => f.status === "PENDING" && f.followupDate < startOfToday),
    dueToday: decorated.filter((f) => f.status === "PENDING" && f.followupDate >= startOfToday && f.followupDate < startOfTomorrow),
    upcoming: decorated.filter((f) => f.status === "PENDING" && f.followupDate >= startOfTomorrow),
    completed: decorated.filter((f) => f.status === "COMPLETED"),
  };
}

/**
 * The manual "check for due follow-ups" action — mirrors Marketing's own
 * "Run Automation Now" pattern (`runMarketingAutomation()`), since this
 * project has no background job runner to fire this on a schedule. Notifies
 * the follow-up's own assignee (or its creator, if unassigned) exactly once
 * per follow-up — dedup is a plain "does a Notification already point at
 * this follow-up" check, simpler than the source's 24h re-notify window
 * since nothing re-runs this hourly on its own; a completed/cancelled
 * follow-up is excluded by `findDuePending` only ever returning PENDING rows.
 */
export async function generateFollowupNotifications(companyId: string) {
  const now = new Date();
  const dueOrOverdue = await CrmFollowupRepository.findDuePending(companyId, now);

  let notified = 0;
  for (const followup of dueOrOverdue) {
    const alreadyNotified = await prisma.notification.findFirst({
      where: { companyId, relatedModule: "CRM_FOLLOWUP", relatedRecordId: followup.id },
      select: { id: true },
    });
    if (alreadyNotified) continue;

    const recipientId = followup.assignedToUserId ?? followup.createdByUserId;
    const isOverdue = followup.followupDate < now;
    await createNotification({
      companyId,
      userId: recipientId,
      title: isOverdue ? "Follow-up overdue" : "Follow-up due today",
      body: `A ${followup.type.toLowerCase()} follow-up ${isOverdue ? "was due" : "is due"} on ${followup.followupDate.toLocaleDateString()}${followup.notes ? `: ${followup.notes}` : "."}`,
      relatedModule: "CRM_FOLLOWUP",
      relatedRecordId: followup.id,
    });
    notified++;
  }

  return { checked: dueOrOverdue.length, notified };
}

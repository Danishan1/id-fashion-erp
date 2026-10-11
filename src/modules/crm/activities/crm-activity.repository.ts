import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmDb } from "../core/crm-db";

export const ACTIVITY_SELECT = {
  id: true,
  type: true,
  subject: true,
  description: true,
  status: true,
  priority: true,
  entityType: true,
  entityId: true,
  assignedToUserId: true,
  dueAt: true,
  allDay: true,
  endAt: true,
  originalDueAt: true,
  rescheduleCount: true,
  reminderOffsetMinutes: true,
  reminderAt: true,
  reminderState: true,
  reminderSentAt: true,
  outcome: true,
  direction: true,
  durationMinutes: true,
  location: true,
  timezone: true,
  videoLink: true,
  appointmentType: true,
  confirmedAt: true,
  confirmedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancelReason: true,
  noShowAt: true,
  noShowByUserId: true,
  noShowReason: true,
  completedAt: true,
  completedByUserId: true,
  source: true,
  externalRef: true,
  metadata: true,
  createdByUserId: true,
  updatedByUserId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  assignedTo: { select: { id: true, fullName: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  links: { select: { entityType: true, entityId: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { entityType: "asc" }] },
} as const satisfies Prisma.CrmActivitySelect;
export type ActivityRow = Prisma.CrmActivityGetPayload<{ select: typeof ACTIVITY_SELECT }>;

/** Activity data access (Phase 09). Soft-deleted rows are excluded everywhere except `findRaw`. */
export const CrmActivityRepository = {
  findRaw(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmActivity.findFirst({ where: { id, companyId } });
  },
  findOne(companyId: string, id: string, db: CrmDb = prisma) {
    return db.crmActivity.findFirst({ where: { id, companyId, deletedAt: null }, select: ACTIVITY_SELECT });
  },
  findMany(where: Prisma.CrmActivityWhereInput, orderBy: Prisma.CrmActivityOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmActivity.findMany({ where, orderBy, skip, take, select: ACTIVITY_SELECT });
  },
  count(where: Prisma.CrmActivityWhereInput) {
    return prisma.crmActivity.count({ where });
  },
  findByExternalRef(companyId: string, source: string, externalRef: string) {
    return prisma.crmActivity.findFirst({ where: { companyId, source, externalRef }, select: ACTIVITY_SELECT });
  },
  create(data: Prisma.CrmActivityUncheckedCreateInput, db: CrmDb) {
    return db.crmActivity.create({ data, select: ACTIVITY_SELECT });
  },
  /** Optimistic-locked update; returns the number of rows changed (0 = stale version). */
  updateVersioned(id: string, version: number, data: Prisma.CrmActivityUncheckedUpdateManyInput, db: CrmDb) {
    return db.crmActivity.updateMany({ where: { id, version, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
  },
  createLinks(rows: Prisma.CrmActivityLinkCreateManyInput[], db: CrmDb) {
    return db.crmActivityLink.createMany({ data: rows, skipDuplicates: true });
  },
  /** Newest activity ids shown on a record (timeline scope). */
  linkedActivityIds(companyId: string, entityType: CrmEntityType, entityIds: string[], take = 500) {
    if (!entityIds.length) return Promise.resolve([] as string[]);
    return prisma.crmActivityLink
      .findMany({ where: { companyId, entityType, entityId: { in: entityIds } }, select: { activityId: true }, orderBy: { createdAt: "desc" }, take })
      .then((rows) => [...new Set(rows.map((r) => r.activityId))]);
  },
  /** Records an activity can point at, with the fields needed for validation, links and labels. */
  async records(companyId: string, refs: { entityType: CrmEntityType; entityId: string }[]) {
    const ids = (t: CrmEntityType) => [...new Set(refs.filter((r) => r.entityType === t).map((r) => r.entityId))];
    const [leads, contacts, companies, opportunities, conversations] = await Promise.all([
      ids("LEAD").length ? prisma.crmLead.findMany({ where: { companyId, id: { in: ids("LEAD") } }, select: { id: true, leadNumber: true, fullName: true, crmCompanyId: true, archivedAt: true } }) : [],
      ids("CONTACT").length ? prisma.crmContact.findMany({ where: { companyId, id: { in: ids("CONTACT") } }, select: { id: true, fullName: true, crmCompanyId: true, archivedAt: true, mergedIntoId: true } }) : [],
      ids("COMPANY").length ? prisma.crmCompany.findMany({ where: { companyId, id: { in: ids("COMPANY") } }, select: { id: true, name: true, archivedAt: true, mergedIntoId: true } }) : [],
      ids("OPPORTUNITY").length
        ? prisma.crmOpportunity.findMany({ where: { companyId, id: { in: ids("OPPORTUNITY") } }, select: { id: true, opportunityNumber: true, name: true, crmCompanyId: true, crmContactId: true, archivedAt: true, pipelineId: true, stageId: true } })
        : [],
      // Phase 11: a task created from a conversation is linked to it.
      ids("CONVERSATION").length
        ? prisma.crmConversation.findMany({ where: { companyId, id: { in: ids("CONVERSATION") } }, select: { id: true, displayName: true, displayIdentifier: true, channelType: true, status: true, contactId: true, crmCompanyId: true, opportunityId: true } })
        : [],
    ]);
    return { leads, contacts, companies, opportunities, conversations };
  },
  userNames(ids: string[]) {
    if (!ids.length) return Promise.resolve([] as { id: string; fullName: string }[]);
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  },
  activeUser(companyId: string, userId: string) {
    return prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true, fullName: true } });
  },
  /**
   * Merge support (contacts / companies): the merged record's activities move
   * to the survivor — links and the "created on" record — without duplicates.
   */
  async moveToSurvivor(companyId: string, entityType: CrmEntityType, fromId: string, toId: string, db: CrmDb) {
    const already = (await db.crmActivityLink.findMany({ where: { companyId, entityType, entityId: toId }, select: { activityId: true } })).map((r) => r.activityId);
    // Activities already on the survivor keep that link; the merged record's duplicate link goes.
    const dropped = already.length ? (await db.crmActivityLink.deleteMany({ where: { companyId, entityType, entityId: fromId, activityId: { in: already } } })).count : 0;
    const links = await db.crmActivityLink.updateMany({ where: { companyId, entityType, entityId: fromId }, data: { entityId: toId } });
    await db.crmActivity.updateMany({ where: { companyId, entityType, entityId: fromId }, data: { entityId: toId } });
    return links.count + dropped;
  },
  /** Scheduled reminders whose time has come (the reminder job). */
  dueReminders(now: Date, take: number) {
    return prisma.crmActivity.findMany({
      where: { reminderState: "PENDING", reminderAt: { lte: now } },
      orderBy: { reminderAt: "asc" },
      take,
      select: { id: true, companyId: true, subject: true, type: true, status: true, dueAt: true, allDay: true, timezone: true, reminderAt: true, deletedAt: true, assignedToUserId: true, createdByUserId: true, entityType: true, entityId: true },
    });
  },
};

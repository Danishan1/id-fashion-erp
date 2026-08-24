import { prisma } from "@/core/db/client";
import type { Prisma, RelatedModule } from "@prisma/client";

export const CrmActivityRepository = {
  create: (data: Prisma.CrmActivityUncheckedCreateInput) =>
    prisma.crmActivity.create({ data, include: { performedBy: { select: { id: true, fullName: true } } } }),

  findByRelated: (companyId: string, relatedModule: RelatedModule, relatedRecordId: string) =>
    prisma.crmActivity.findMany({
      where: { companyId, relatedModule, relatedRecordId },
      include: { performedBy: { select: { id: true, fullName: true } } },
      orderBy: { activityAt: "desc" },
    }),
};

export const CrmFollowupRepository = {
  create: (data: Prisma.CrmFollowupUncheckedCreateInput) =>
    prisma.crmFollowup.create({ data, include: { assignedTo: { select: { id: true, fullName: true } } } }),

  update: (id: string, data: Prisma.CrmFollowupUncheckedUpdateInput) =>
    prisma.crmFollowup.update({ where: { id }, data, include: { assignedTo: { select: { id: true, fullName: true } } } }),

  findAnyById: (companyId: string, id: string) => prisma.crmFollowup.findFirst({ where: { id, companyId } }),

  findByRelated: (companyId: string, relatedModule: RelatedModule, relatedRecordId: string) =>
    prisma.crmFollowup.findMany({
      where: { companyId, relatedModule, relatedRecordId },
      include: { assignedTo: { select: { id: true, fullName: true } } },
      orderBy: { followupDate: "asc" },
    }),

  /** Pending follow-ups due within `withinMs` from now, across the whole
   * company — powers the CRM dashboard's overdue/upcoming counts, mirroring
   * the source's own eq_crm_followup_reminders() query shape. */
  findDuePending: (companyId: string, byDate: Date) =>
    prisma.crmFollowup.findMany({
      where: { companyId, status: "PENDING", followupDate: { lte: byDate } },
      include: { assignedTo: { select: { id: true, fullName: true } } },
      orderBy: { followupDate: "asc" },
    }),

  countPending: (companyId: string) => prisma.crmFollowup.count({ where: { companyId, status: "PENDING" } }),

  countOverdue: (companyId: string, now: Date) =>
    prisma.crmFollowup.count({ where: { companyId, status: "PENDING", followupDate: { lt: now } } }),
};

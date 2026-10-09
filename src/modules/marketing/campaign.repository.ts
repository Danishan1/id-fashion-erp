import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  owner: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  dailyMetrics: { orderBy: { metricDate: "desc" as const }, take: 60 },
  attributions: {
    orderBy: { createdAt: "desc" as const },
    take: 50,
    include: { crmLead: { select: { id: true, leadNumber: true, fullName: true } } },
  },
  alerts: { orderBy: { createdAt: "desc" as const }, take: 50 },
} satisfies Prisma.CampaignInclude;

export const CampaignRepository = {
  create: (data: Prisma.CampaignUncheckedCreateInput) => prisma.campaign.create({ data, include: DETAIL_INCLUDE }),

  update: (id: string, data: Prisma.CampaignUncheckedUpdateInput) => prisma.campaign.update({ where: { id }, data, include: DETAIL_INCLUDE }),

  findAnyById: (companyId: string, id: string) => prisma.campaign.findFirst({ where: { id, companyId } }),

  findByIdWithDetails: (companyId: string, id: string) => prisma.campaign.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  findMany: (where: Prisma.CampaignWhereInput, args: Omit<Prisma.CampaignFindManyArgs, "where">) =>
    prisma.campaign.findMany({
      where,
      include: { owner: { select: { id: true, fullName: true } } },
      ...args,
    }),

  count: (where: Prisma.CampaignWhereInput) => prisma.campaign.count({ where }),

  /** Every campaign this company has with status ACTIVE/PAUSED — the same
   * set the source's own eq_mkt_run_automation() iterates over. */
  findActiveOrPaused: (companyId: string) => prisma.campaign.findMany({ where: { companyId, status: { in: ["ACTIVE", "PAUSED"] } } }),

  findManyByChannel: (companyId: string, channel: string) => prisma.campaign.findMany({ where: { companyId, channel: channel as never } }),
};

export const CampaignDailyMetricRepository = {
  /** Upsert on (campaignId, metricDate) — mirrors the source's own
   * eq_mkt_upsert_daily() exactly, so re-recording the same day corrects
   * it rather than duplicating a row. */
  upsert: (campaignId: string, metricDate: Date, data: Omit<Prisma.CampaignDailyMetricUncheckedCreateInput, "campaignId" | "metricDate">) =>
    prisma.campaignDailyMetric.upsert({
      where: { campaignId_metricDate: { campaignId, metricDate } },
      create: { campaignId, metricDate, ...data },
      update: data,
    }),

  sumByCampaignIds: (campaignIds: string[]) =>
    prisma.campaignDailyMetric.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: campaignIds } },
      _sum: { spend: true },
    }),
};

export const CampaignAttributionRepository = {
  create: (data: Prisma.CampaignAttributionUncheckedCreateInput) => prisma.campaignAttribution.create({ data }),
};

export const CampaignAlertRepository = {
  create: (data: Prisma.CampaignAlertUncheckedCreateInput) => prisma.campaignAlert.create({ data }),

  findOpenByTypeAndCampaign: (companyId: string, alertType: Prisma.CampaignAlertUncheckedCreateInput["alertType"], campaignId: string | null) =>
    prisma.campaignAlert.findFirst({ where: { companyId, alertType, campaignId, status: "OPEN" } }),

  findAnyById: (companyId: string, id: string) => prisma.campaignAlert.findFirst({ where: { id, companyId } }),

  update: (id: string, data: Prisma.CampaignAlertUncheckedUpdateInput) => prisma.campaignAlert.update({ where: { id }, data }),

  countOpen: (companyId: string) => prisma.campaignAlert.count({ where: { companyId, status: "OPEN" } }),
};

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { CampaignAlertType, Prisma } from "@prisma/client";
import { CampaignAlertRepository, CampaignAttributionRepository, CampaignDailyMetricRepository, CampaignRepository } from "./campaign.repository";
import type { AddAttributionInput, CreateCampaignInput, RecordDailyMetricInput, UpdateCampaignInput } from "./campaign.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface CampaignMetrics {
  spend: number;
  leads: number;
  qualifiedLeads: number;
  customers: number;
  revenue: number;
}

const EMPTY_METRICS: CampaignMetrics = { spend: 0, leads: 0, qualifiedLeads: 0, customers: 0, revenue: 0 };

/**
 * Deliberately computed, never stored — the source's own eq_mkt_campaigns
 * table holds these as flat mutable columns, exactly the "second source of
 * truth" this project has fixed more than once elsewhere. "Qualified" reuses
 * the same score>=50 threshold that already computes Lead.priority (WARM/HOT)
 * — the source's own `lead_quality IN ('high','medium')` count is the
 * identical definition under different labels. "Customers"/"revenue" trace
 * the real causal chain (Lead.campaignId -> won Lead -> its Deal(s)), not a
 * counter anyone has to remember to increment.
 */
async function computeCampaignMetricsMap(companyId: string, campaignIds: string[]): Promise<Map<string, CampaignMetrics>> {
  const map = new Map<string, CampaignMetrics>();
  if (campaignIds.length === 0) return map;
  for (const id of campaignIds) map.set(id, { ...EMPTY_METRICS });

  const [spendRows, leadCounts, qualifiedCounts, customerCounts, revenueRows] = await Promise.all([
    CampaignDailyMetricRepository.sumByCampaignIds(campaignIds),
    prisma.lead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds }, leadScore: { gte: 50 } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds }, status: "WON" }, _count: { _all: true } }),
    Promise.all(
      campaignIds.map(async (id) => {
        const agg = await prisma.deal.aggregate({ where: { stage: "WON", lead: { campaignId: id } }, _sum: { value: true } });
        return [id, Number(agg._sum.value ?? 0)] as const;
      })
    ),
  ]);

  for (const r of spendRows) if (r.campaignId) map.get(r.campaignId)!.spend = Number(r._sum.spend ?? 0);
  for (const r of leadCounts) if (r.campaignId) map.get(r.campaignId)!.leads = r._count._all;
  for (const r of qualifiedCounts) if (r.campaignId) map.get(r.campaignId)!.qualifiedLeads = r._count._all;
  for (const r of customerCounts) if (r.campaignId) map.get(r.campaignId)!.customers = r._count._all;
  for (const [id, revenue] of revenueRows) map.get(id)!.revenue = revenue;

  return map;
}

async function decorateCampaigns<T extends { id: string }>(companyId: string, campaigns: T[]): Promise<(T & { metrics: CampaignMetrics })[]> {
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id));
  return campaigns.map((c) => ({ ...c, metrics: metricsMap.get(c.id) ?? { ...EMPTY_METRICS } }));
}

export async function listCampaigns(companyId: string, query: ListQuery) {
  const where: Prisma.CampaignWhereInput = {
    companyId,
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    CampaignRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    CampaignRepository.count(where),
  ]);

  return { data: await decorateCampaigns(companyId, data), totalCount };
}

export async function getCampaignById(companyId: string, id: string) {
  const campaign = await CampaignRepository.findByIdWithDetails(companyId, id);
  if (!campaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });
  const [decorated] = await decorateCampaigns(companyId, [campaign]);
  return decorated;
}

export async function createCampaign(actor: ActorContext, input: CreateCampaignInput) {
  const campaignNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "CAMPAIGN",
  });

  const campaign = await CampaignRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    campaignNumber,
    name: input.name,
    objective: input.objective || null,
    channel: input.channel,
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    budget: input.budget,
    ownerUserId: input.ownerUserId || null,
    status: input.status,
    approvalStatus: input.approvalStatus,
    notes: input.notes || null,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "mkt_campaigns",
    recordId: campaign.id,
    action: "CREATE",
    newValues: { campaignNumber, name: input.name, channel: input.channel, budget: input.budget },
  });

  return (await decorateCampaigns(actor.companyId, [campaign]))[0];
}

export async function updateCampaign(actor: ActorContext, id: string, input: UpdateCampaignInput) {
  const existing = await CampaignRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });

  const updated = await CampaignRepository.update(id, {
    name: input.name,
    objective: input.objective || null,
    channel: input.channel,
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    budget: input.budget,
    ownerUserId: input.ownerUserId || null,
    status: input.status,
    approvalStatus: input.approvalStatus,
    notes: input.notes || null,
  });

  // Budget-change history reuses AuditLog directly — no parallel table,
  // matching the mapping decision for the source's own budget_changes table.
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "mkt_campaigns",
    recordId: id,
    action: "UPDATE",
    oldValues: { budget: existing.budget, status: existing.status },
    newValues: { budget: input.budget, status: input.status },
  });

  return (await decorateCampaigns(actor.companyId, [updated]))[0];
}

export async function recordDailyMetric(actor: ActorContext, campaignId: string, input: RecordDailyMetricInput) {
  const campaign = await CampaignRepository.findAnyById(actor.companyId, campaignId);
  if (!campaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id: campaignId });

  return CampaignDailyMetricRepository.upsert(campaignId, new Date(input.metricDate), {
    spend: input.spend,
    impressions: input.impressions,
    clicks: input.clicks,
    notes: input.notes || null,
    recordedByUserId: actor.userId,
  });
}

export async function addAttribution(actor: ActorContext, input: AddAttributionInput) {
  if (input.campaignId) {
    const campaign = await CampaignRepository.findAnyById(actor.companyId, input.campaignId);
    if (!campaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id: input.campaignId });
  }
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, companyId: actor.companyId }, select: { id: true } });
    if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id: input.leadId });
  }

  return CampaignAttributionRepository.create({
    companyId: actor.companyId,
    campaignId: input.campaignId || null,
    leadId: input.leadId || null,
    prospectName: input.prospectName || null,
    source: input.source || null,
    medium: input.medium || null,
    content: input.content || null,
    term: input.term || null,
    utmCampaign: input.utmCampaign || null,
    landingPage: input.landingPage || null,
    isFirstTouch: input.isFirstTouch,
    isLastTouch: input.isLastTouch,
    attributedRevenue: input.attributedRevenue,
  });
}

async function createAlertIfNotOpen(
  companyId: string,
  alertType: CampaignAlertType,
  priority: "MEDIUM" | "HIGH",
  campaignId: string,
  title: string,
  message: string,
  metricValue: number,
  thresholdValue: number
) {
  const existing = await CampaignAlertRepository.findOpenByTypeAndCampaign(companyId, alertType, campaignId);
  if (existing) return;
  await CampaignAlertRepository.create({ companyId, campaignId, alertType, priority, title, message, metricValue, thresholdValue });
}

/**
 * Ports the source's eq_mkt_run_automation() 4 threshold rules exactly (see
 * the migration report §3.5 for the precise formulas this mirrors). No
 * real background-job runner exists in this project yet, so — matching the
 * source's own "Run Automation Now" manual-trigger fallback alongside its
 * WP-Cron — this is exposed as a callable action from the Marketing
 * dashboard rather than only running on a schedule.
 */
export async function runMarketingAutomation(companyId: string) {
  const campaigns = await CampaignRepository.findActiveOrPaused(companyId);
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id));

  for (const campaign of campaigns) {
    const m = metricsMap.get(campaign.id)!;
    const budget = Number(campaign.budget);

    if (budget > 0 && m.spend > budget) {
      await createAlertIfNotOpen(companyId, "BUDGET_OVERSPEND", "HIGH", campaign.id, "Budget exceeded", `${campaign.name} has exceeded planned budget by ₹${(m.spend - budget).toFixed(2)}`, m.spend, budget);
    } else if (budget > 0 && m.spend >= budget * 0.8) {
      await createAlertIfNotOpen(companyId, "BUDGET_80_PERCENT", "MEDIUM", campaign.id, "80% budget used", `${campaign.name} has used ${((m.spend / budget) * 100).toFixed(1)}% of budget`, m.spend, budget * 0.8);
    }

    if (m.spend >= 1000) {
      const roas = m.spend ? m.revenue / m.spend : 0;
      if (roas < 1) {
        await createAlertIfNotOpen(companyId, "LOW_ROAS", "HIGH", campaign.id, "ROAS below 1.0x", `${campaign.name} is currently below break-even ROAS: ${roas.toFixed(2)}x`, roas, 1);
      } else if (roas < 1.5) {
        await createAlertIfNotOpen(companyId, "ROAS_WATCH", "MEDIUM", campaign.id, "ROAS needs review", `${campaign.name} ROAS is ${roas.toFixed(2)}x`, roas, 1.5);
      }
    }

    if (m.leads >= 10 && m.spend > 0) {
      const cpl = m.spend / m.leads;
      const peers = await CampaignRepository.findManyByChannel(companyId, campaign.channel);
      const peerIds = peers.map((p) => p.id).filter((id) => id !== campaign.id);
      const peerMetrics = await computeCampaignMetricsMap(companyId, peerIds);
      const peerCpls = [...peerMetrics.values()].filter((p) => p.leads >= 10 && p.spend > 0).map((p) => p.spend / p.leads);
      const benchmark = peerCpls.length ? peerCpls.reduce((a, b) => a + b, 0) / peerCpls.length : 0;
      if (benchmark > 0 && cpl > benchmark * 1.5) {
        await createAlertIfNotOpen(companyId, "HIGH_CPL", "MEDIUM", campaign.id, "CPL above channel benchmark", `${campaign.name} CPL ₹${cpl.toFixed(2)} is more than 50% above channel benchmark ₹${benchmark.toFixed(2)}`, cpl, benchmark * 1.5);
      }
    }

    if (m.leads >= 20) {
      const rate = (m.customers / m.leads) * 100;
      if (rate < 2) {
        await createAlertIfNotOpen(companyId, "LOW_CONVERSION", "MEDIUM", campaign.id, "Low lead-to-customer conversion", `${campaign.name} conversion is ${rate.toFixed(1)}%`, rate, 2);
      }
    }
  }

  return { campaignsChecked: campaigns.length };
}

export async function resolveCampaignAlert(actor: ActorContext, id: string) {
  const alert = await CampaignAlertRepository.findAnyById(actor.companyId, id);
  if (!alert) throw new BusinessRuleError("NOT_FOUND", "Alert not found.", { id });
  if (alert.status !== "OPEN") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This alert is already "${alert.status}".`, { currentStatus: alert.status });
  }

  return CampaignAlertRepository.update(id, { status: "RESOLVED", resolvedAt: new Date() });
}

/** Mirrors eq_mkt_dashboard()'s stat cards — total budget/spend/leads/
 * qualified/customers/attributed revenue/ROAS/open alerts. */
export async function getMarketingDashboard(companyId: string) {
  const campaigns = await prisma.campaign.findMany({ where: { companyId }, select: { id: true, budget: true } });
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id));

  let budget = 0;
  let spend = 0;
  let leads = 0;
  let qualifiedLeads = 0;
  let customers = 0;
  let revenue = 0;
  for (const c of campaigns) {
    const m = metricsMap.get(c.id)!;
    budget += Number(c.budget);
    spend += m.spend;
    leads += m.leads;
    qualifiedLeads += m.qualifiedLeads;
    customers += m.customers;
    revenue += m.revenue;
  }

  const openAlerts = await CampaignAlertRepository.countOpen(companyId);

  return { budget, spend, leads, qualifiedLeads, customers, revenue, roas: spend ? revenue / spend : 0, openAlerts };
}

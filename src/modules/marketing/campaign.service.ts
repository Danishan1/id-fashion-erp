import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { CampaignStatus, type CampaignAlertType, type Prisma } from "@prisma/client";
import { CampaignAlertRepository, CampaignAttributionRepository, CampaignDailyMetricRepository, CampaignRepository } from "./campaign.repository";
import { getCrmSettings } from "@/modules/crm/crm-settings.service";
import type {
  AddAttributionInput,
  CampaignStatusChangeInput,
  CreateCampaignInput,
  RecordDailyMetricInput,
  RejectCampaignInput,
  UpdateCampaignInput,
} from "./campaign.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * A real transition guard for the lifecycle half of the campaign's state —
 * the source let `status` be set to anything freely. DRAFT -> ACTIVE requires
 * `approvalStatus === "APPROVED"`, checked separately in
 * `changeCampaignStatus()` since approval is a genuinely different axis (see
 * `CampaignApprovalStatus`) that this map can't express on its own.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["PAUSED", "COMPLETED"],
  PAUSED: ["ACTIVE", "COMPLETED"],
  COMPLETED: [],
};

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
 * the same configurable warm-lead threshold that computes Lead.priority
 * (WARM/HOT) — the source's own `lead_quality IN ('high','medium')` count was
 * already the identical definition under a different label (score>=50), now
 * both read from the one company-configurable `CrmSettings.warmThreshold`
 * (see crm-settings.service.ts) instead of two separately hardcoded copies.
 * "Customers"/"revenue" trace the real causal chain (Lead.campaignId -> won
 * Lead -> its Deal(s)), not a counter anyone has to remember to increment.
 */
async function computeCampaignMetricsMap(companyId: string, campaignIds: string[], warmThreshold: number): Promise<Map<string, CampaignMetrics>> {
  const map = new Map<string, CampaignMetrics>();
  if (campaignIds.length === 0) return map;
  for (const id of campaignIds) map.set(id, { ...EMPTY_METRICS });

  const [spendRows, leadCounts, qualifiedCounts, customerCounts, revenueRows] = await Promise.all([
    CampaignDailyMetricRepository.sumByCampaignIds(campaignIds),
    prisma.lead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds }, leadScore: { gte: warmThreshold } }, _count: { _all: true } }),
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
  const { warmThreshold } = await getCrmSettings(companyId);
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id), warmThreshold);
  return campaigns.map((c) => ({ ...c, metrics: metricsMap.get(c.id) ?? { ...EMPTY_METRICS } }));
}

const VALID_CAMPAIGN_STATUSES = new Set<string>(Object.values(CampaignStatus));

export async function listCampaigns(companyId: string, query: ListQuery, channel?: string) {
  const where: Prisma.CampaignWhereInput = {
    companyId,
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(channel ? { channel: channel as never } : {}),
    ...(query.status && VALID_CAMPAIGN_STATUSES.has(query.status) ? { status: query.status as CampaignStatus } : {}),
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
    status: "DRAFT",
    approvalStatus: "PENDING",
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
  if (existing.status === "COMPLETED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot edit a completed campaign.", { status: existing.status });
  }

  const updated = await CampaignRepository.update(id, {
    name: input.name,
    objective: input.objective || null,
    channel: input.channel,
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    budget: input.budget,
    ownerUserId: input.ownerUserId || null,
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
    oldValues: { budget: existing.budget },
    newValues: { budget: input.budget },
  });

  return (await decorateCampaigns(actor.companyId, [updated]))[0];
}

export async function changeCampaignStatus(actor: ActorContext, id: string, input: CampaignStatusChangeInput) {
  const existing = await CampaignRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });

  const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(input.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a campaign from "${existing.status}" to "${input.status}".`,
      { from: existing.status, to: input.status }
    );
  }
  if (input.status === "ACTIVE" && existing.approvalStatus !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot activate — this campaign is not Approved (current approval status: ${existing.approvalStatus}).${
        existing.approvalStatus === "REJECTED" && existing.rejectionReason ? ` Rejection reason: ${existing.rejectionReason}` : ""
      }`,
      { approvalStatus: existing.approvalStatus }
    );
  }

  const updated = await CampaignRepository.update(id, { status: input.status });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "mkt_campaigns",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: input.status },
  });

  return (await decorateCampaigns(actor.companyId, [updated]))[0];
}

/**
 * Self-approval-guarded like every other final approval checkpoint in this
 * project (Sample/Sales-Order/Purchase-Order) — the creator of a campaign
 * can't approve their own. Approving clears any prior rejection so the three
 * approval-metadata fields never describe a stale mix of both decisions.
 */
export async function approveCampaign(actor: ActorContext, id: string) {
  const existing = await CampaignRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });

  await PermissionService.assert(actor.userId, "marketing", "approve", { createdBy: existing.createdByUserId });

  const updated = await CampaignRepository.update(id, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
    rejectionReason: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "mkt_campaigns",
    recordId: id,
    action: "UPDATE",
    oldValues: { approvalStatus: existing.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return (await decorateCampaigns(actor.companyId, [updated]))[0];
}

/**
 * Deliberately NOT self-approval-guarded — matches Sales/Purchase Order's
 * own REJECTED path, where rejecting isn't the same self-dealing risk
 * approving is. A rejection can be reconsidered later via approveCampaign()
 * (no separate "resubmit" step needed since approvalStatus isn't a strict
 * one-way ratchet).
 */
export async function rejectCampaign(actor: ActorContext, id: string, input: RejectCampaignInput) {
  const existing = await CampaignRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });

  await PermissionService.assert(actor.userId, "marketing", "reject");

  const updated = await CampaignRepository.update(id, {
    approvalStatus: "REJECTED",
    rejectionReason: input.reason,
    approvedByUserId: null,
    approvedAt: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "mkt_campaigns",
    recordId: id,
    action: "UPDATE",
    oldValues: { approvalStatus: existing.approvalStatus },
    newValues: { approvalStatus: "REJECTED", rejectionReason: input.reason },
  });

  return (await decorateCampaigns(actor.companyId, [updated]))[0];
}

export async function recordDailyMetric(actor: ActorContext, campaignId: string, input: RecordDailyMetricInput) {
  const campaign = await CampaignRepository.findAnyById(actor.companyId, campaignId);
  if (!campaign) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id: campaignId });
  if (campaign.approvalStatus !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot record metrics for a campaign that hasn't been approved yet (current approval status: ${campaign.approvalStatus}).`,
      { approvalStatus: campaign.approvalStatus }
    );
  }

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
  const { warmThreshold } = await getCrmSettings(companyId);
  // A campaign can only ever reach ACTIVE/PAUSED once approved (enforced in
  // changeCampaignStatus()), but approval can later be revoked via
  // rejectCampaign() without forcing a status change — this filter is what
  // actually makes "rejected campaigns cannot trigger automation" (the
  // request's own §10 rule) hold for that revoked-after-activation case too.
  const campaigns = (await CampaignRepository.findActiveOrPaused(companyId)).filter((c) => c.approvalStatus === "APPROVED");
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id), warmThreshold);

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
      const peerMetrics = await computeCampaignMetricsMap(companyId, peerIds, warmThreshold);
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
  const { warmThreshold } = await getCrmSettings(companyId);
  const campaigns = await prisma.campaign.findMany({ where: { companyId }, select: { id: true, budget: true } });
  const metricsMap = await computeCampaignMetricsMap(companyId, campaigns.map((c) => c.id), warmThreshold);

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

export interface MarketingTrendPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  customers: number;
  revenue: number;
  cpl: number;
  roas: number;
}

/**
 * Local calendar-day key — deliberately NOT `toISOString().slice(0, 10)`.
 * Bucket boundaries below are constructed with local-time `Date` components
 * (`new Date(year, month, day)`), but `toISOString()` converts to UTC first;
 * in any timezone ahead of UTC (this business runs on IST, UTC+5:30) local
 * midnight becomes the *previous* day once converted to UTC, silently
 * shifting every bucket back by one day. Using local components on both
 * sides keeps bucket keys and incoming timestamps consistent regardless of
 * server timezone.
 */
function dayKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * A daily time series across every campaign — powers the Marketing
 * dashboard's trend charts. No new schema: `CampaignDailyMetric` already
 * stores spend/impressions/clicks by date, this just aggregates it alongside
 * Lead/Deal activity for the same window. Grouped in JS rather than a raw
 * SQL date-trunc — the window is small (default 30 days for one company),
 * and this keeps every query a plain typed Prisma call instead of introducing
 * this project's first raw-SQL aggregation for one dashboard.
 *
 * "Revenue" and "Customers" are approximated by `Deal.createdAt`/
 * `Lead.createdAt` (when the record was created), not a true "won on this
 * date" timestamp — `Deal` has no separate `wonAt` column (a known,
 * already-documented limitation elsewhere in this project), so a deal
 * created on day N and won on day N+5 shows its revenue on day N. Acceptable
 * for a trend shape; not exact day-level revenue recognition.
 */
export async function getMarketingTrends(companyId: string, days = 30): Promise<MarketingTrendPoint[]> {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));

  const [dailyMetrics, leads, wonDeals] = await Promise.all([
    prisma.campaignDailyMetric.findMany({
      where: { campaign: { companyId }, metricDate: { gte: startDate } },
      select: { metricDate: true, spend: true, impressions: true, clicks: true },
    }),
    prisma.lead.findMany({
      where: { companyId, campaignId: { not: null }, createdAt: { gte: startDate } },
      select: { createdAt: true, status: true },
    }),
    prisma.deal.findMany({
      where: { companyId, stage: "WON", createdAt: { gte: startDate }, lead: { campaignId: { not: null } } },
      select: { createdAt: true, value: true },
    }),
  ]);

  const buckets = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; customers: number; revenue: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
    buckets.set(dayKey(d), { spend: 0, impressions: 0, clicks: 0, leads: 0, customers: 0, revenue: 0 });
  }

  for (const m of dailyMetrics) {
    const bucket = buckets.get(dayKey(new Date(m.metricDate)));
    if (!bucket) continue;
    bucket.spend += Number(m.spend);
    bucket.impressions += Number(m.impressions);
    bucket.clicks += Number(m.clicks);
  }
  for (const l of leads) {
    const bucket = buckets.get(dayKey(new Date(l.createdAt)));
    if (!bucket) continue;
    bucket.leads += 1;
    if (l.status === "WON") bucket.customers += 1;
  }
  for (const d of wonDeals) {
    const bucket = buckets.get(dayKey(new Date(d.createdAt)));
    if (bucket) bucket.revenue += Number(d.value);
  }

  return [...buckets.entries()].map(([date, v]) => ({
    date,
    ...v,
    cpl: v.leads ? v.spend / v.leads : 0,
    roas: v.spend ? v.revenue / v.spend : 0,
  }));
}

export interface ChannelPerformanceRow {
  channel: string;
  campaignCount: number;
  leads: number;
  deals: number;
  wonDeals: number;
  revenue: number;
  spend: number;
  roi: number;
}

export interface ChannelPerformanceFilters {
  dateFrom?: Date;
  dateTo?: Date;
  channel?: string;
  campaignId?: string;
}

/**
 * Marketing Channel -> Leads -> Deals -> Won Deals -> Revenue -> ROI, per the
 * request's own worked example. Date/channel/campaign filters all narrow
 * which Leads/Deals/spend get counted, not which channels are *listed* —
 * a channel with zero activity in a narrow date range still shows a zero row
 * rather than disappearing, so the report reads as "how did every channel do
 * in this period," not "which channels happened to have data."
 *
 * "Deals" traced via Lead.campaignId -> Deal.leadId since Deal has no direct
 * campaignId column — the same join path `computeCampaignMetricsMap()`
 * already uses for its own revenue calc, just grouped by channel here
 * instead of by campaign.
 */
export async function getChannelPerformance(companyId: string, filters: ChannelPerformanceFilters = {}): Promise<ChannelPerformanceRow[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      companyId,
      ...(filters.channel ? { channel: filters.channel as never } : {}),
      ...(filters.campaignId ? { id: filters.campaignId } : {}),
    },
    select: { id: true, channel: true },
  });

  const rows = new Map<string, ChannelPerformanceRow>();
  const ensure = (channel: string) => {
    if (!rows.has(channel)) rows.set(channel, { channel, campaignCount: 0, leads: 0, deals: 0, wonDeals: 0, revenue: 0, spend: 0, roi: 0 });
    return rows.get(channel)!;
  };
  for (const c of campaigns) ensure(c.channel).campaignCount += 1;

  if (campaigns.length === 0) return [];
  const campaignIds = campaigns.map((c) => c.id);
  const channelByCampaignId = new Map(campaigns.map((c) => [c.id, c.channel]));
  const dateRange = filters.dateFrom || filters.dateTo ? { gte: filters.dateFrom, lte: filters.dateTo } : undefined;

  const [metricRows, leads, deals] = await Promise.all([
    prisma.campaignDailyMetric.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: campaignIds }, ...(dateRange ? { metricDate: dateRange } : {}) },
      _sum: { spend: true },
    }),
    prisma.lead.findMany({
      where: { companyId, campaignId: { in: campaignIds }, ...(dateRange ? { createdAt: dateRange } : {}) },
      select: { campaignId: true },
    }),
    prisma.deal.findMany({
      where: { companyId, lead: { campaignId: { in: campaignIds } }, ...(dateRange ? { createdAt: dateRange } : {}) },
      select: { stage: true, value: true, lead: { select: { campaignId: true } } },
    }),
  ]);

  for (const m of metricRows) {
    const channel = m.campaignId ? channelByCampaignId.get(m.campaignId) : undefined;
    if (channel) ensure(channel).spend += Number(m._sum.spend ?? 0);
  }
  for (const l of leads) {
    const channel = l.campaignId ? channelByCampaignId.get(l.campaignId) : undefined;
    if (channel) ensure(channel).leads += 1;
  }
  for (const d of deals) {
    const channel = d.lead?.campaignId ? channelByCampaignId.get(d.lead.campaignId) : undefined;
    if (!channel) continue;
    const row = ensure(channel);
    row.deals += 1;
    if (d.stage === "WON") {
      row.wonDeals += 1;
      row.revenue += Number(d.value);
    }
  }

  for (const row of rows.values()) row.roi = row.spend > 0 ? (row.revenue - row.spend) / row.spend : 0;

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
}

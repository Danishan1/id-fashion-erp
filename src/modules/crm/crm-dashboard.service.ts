import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";
import { round2 } from "@/lib/money";
import { computeWeightedValue } from "./deal.service";
import { getFollowupCounters, getTodayBoundaries, withRelatedLabels } from "./crm-activity.service";
import { listPipelineStages } from "./crm-config.service";
import { buildLeadSegmentWheres, createdRangeWhere, type LeadSegment } from "./lead-segments";

export interface CrmDashboardFilters {
  /** YYYY-MM-DD, inclusive — applied to Lead/Deal createdAt. */
  dateFrom?: string;
  dateTo?: string;
}

const FUNNEL_STEPS: Array<{ label: string; segment: LeadSegment | null }> = [
  { label: "Leads", segment: null },
  { label: "Contacted", segment: "CONTACTED" },
  { label: "Qualified", segment: "QUALIFIED" },
  { label: "Quotation", segment: "QUOTATION" },
  { label: "Won", segment: "WON" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function countFor<T extends { _count: { _all: number } }>(rows: T[], match: (r: T) => boolean): number {
  return rows.find(match)?._count._all ?? 0;
}

function monthKey(d: Date) {
  // createdAt/wonAt are full timestamps — bucketed by the server's own local
  // calendar month, the same convention getTodayBoundaries() uses for
  // "today" (only @db.Date columns need UTC bucketing, see Phase 9 notes).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Owner / sales-manager CRM dashboard — one cross-entity read-only rollup
 * (Lead + Deal + Follow-up + Activity), same precedent as getCustomer360().
 *
 * Every lead count goes through lead-segments.ts so the Leads list's
 * `?segment=` filter reproduces it exactly (click-through never disagrees
 * with the card). The period filter applies to Lead/Deal createdAt;
 * follow-up counters, the recent-activity feed, "closing soon" and the
 * 12-month trend are inherently "right now"/fixed-window and ignore it.
 */
export async function getCrmDashboard(companyId: string, filters: CrmDashboardFilters = {}) {
  const leadPeriod = createdRangeWhere(filters.dateFrom, filters.dateTo);
  const dealPeriod = leadPeriod as Prisma.DealWhereInput;
  const base: Prisma.LeadWhereInput = { companyId, ...leadPeriod };
  const segments = await buildLeadSegmentWheres(companyId);
  const inSegment = (segment: LeadSegment): Prisma.LeadWhereInput => ({ AND: [base, segments[segment]] });

  const now = new Date();
  const { startOfToday } = getTodayBoundaries(now);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [
    stages,
    totalLeads,
    segmentCounts,
    openLeadValueNoDeal,
    stageGroups,
    sourceAll,
    sourceQualified,
    sourceWon,
    sourceLost,
    repAll,
    repContacted,
    repNever,
    repWon,
    deals,
    followupCounters,
    overdueByRep,
    overdueList,
    upcomingList,
    recentActivities,
    trendLeads,
  ] = await Promise.all([
    listPipelineStages(companyId, "LEAD"),
    prisma.lead.count({ where: base }),
    Promise.all(
      (["NEW", "CONTACTED", "NEVER_CONTACTED", "QUALIFIED", "QUOTATION", "WON", "LOST", "SAMPLING", "HOT"] as const).map(
        async (s) => [s, await prisma.lead.count({ where: inSegment(s) })] as const
      )
    ),
    prisma.lead.aggregate({ where: { AND: [base, segments.OPEN, { deals: { none: {} } }] }, _sum: { value: true } }),
    prisma.lead.groupBy({ by: ["stageId"], where: base, _count: { _all: true }, _sum: { value: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: base, _count: { _all: true }, _sum: { value: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: inSegment("QUALIFIED"), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: inSegment("WON"), _count: { _all: true }, _sum: { value: true } }),
    prisma.lead.groupBy({ by: ["sourceId"], where: inSegment("LOST"), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToUserId"], where: base, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToUserId"], where: inSegment("CONTACTED"), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToUserId"], where: inSegment("NEVER_CONTACTED"), _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["assignedToUserId"], where: inSegment("WON"), _count: { _all: true } }),
    prisma.deal.findMany({
      where: { companyId, ...dealPeriod },
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        probabilityPercent: true,
        expectedCloseDate: true,
        assignedToUserId: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
        lead: { select: { companyName: true, name: true } },
      },
    }),
    getFollowupCounters(companyId),
    prisma.crmFollowup.groupBy({
      by: ["assignedToUserId"],
      where: { companyId, status: "PENDING", followupDate: { lt: startOfToday } },
      _count: { _all: true },
    }),
    prisma.crmFollowup.findMany({
      where: { companyId, status: "PENDING", followupDate: { lt: startOfToday } },
      orderBy: { followupDate: "asc" },
      take: 8,
      include: { assignedTo: { select: { id: true, fullName: true } } },
    }),
    prisma.crmFollowup.findMany({
      where: { companyId, status: "PENDING", followupDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 7 * DAY_MS) } },
      orderBy: { followupDate: "asc" },
      take: 8,
      include: { assignedTo: { select: { id: true, fullName: true } } },
    }),
    prisma.crmActivity.findMany({
      where: { companyId },
      orderBy: { activityAt: "desc" },
      take: 10,
      include: { performedBy: { select: { fullName: true } } },
    }),
    prisma.lead.findMany({
      where: { companyId, OR: [{ createdAt: { gte: twelveMonthsAgo } }, { wonAt: { gte: twelveMonthsAgo } }] },
      select: { createdAt: true, wonAt: true },
    }),
  ]);

  const count = Object.fromEntries(segmentCounts) as Record<(typeof segmentCounts)[number][0], number>;

  // ── Opportunities (Deals) ─────────────────────────────────
  const openDeals = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
  const wonDeals = deals.filter((d) => d.stage === "WON");
  const lostDeals = deals.filter((d) => d.stage === "LOST");
  const weightedPipelineValue = round2(openDeals.reduce((sum, d) => sum + computeWeightedValue(d.value, d.probabilityPercent), 0));
  const openLeadValue = round2(Number(openLeadValueNoDeal._sum.value ?? 0));
  const convertedCustomers = new Set(wonDeals.map((d) => d.customerId).filter(Boolean)).size;

  const dealsByStage: Record<string, number> = {};
  for (const d of deals) dealsByStage[d.stage] = (dealsByStage[d.stage] ?? 0) + 1;

  const closingSoon = openDeals
    .filter((d) => d.expectedCloseDate && d.expectedCloseDate.getTime() <= now.getTime() + 30 * DAY_MS)
    .sort((a, b) => a.expectedCloseDate!.getTime() - b.expectedCloseDate!.getTime())
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value),
      probabilityPercent: Number(d.probabilityPercent),
      expectedCloseDate: d.expectedCloseDate!.toISOString().slice(0, 10),
      overdue: d.expectedCloseDate!.getTime() < startOfToday.getTime(),
      party: d.customer?.name ?? d.lead?.companyName ?? d.lead?.name ?? null,
    }));

  // ── Pipeline by stage (every configured stage, even empty ones) ──
  const byStage = new Map(stageGroups.map((g) => [g.stageId, g]));
  const pipelineByStage = stages
    .filter((s) => s.isActive || byStage.has(s.id))
    .map((s) => ({
      stageId: s.id,
      name: s.name,
      kind: s.kind,
      count: byStage.get(s.id)?._count._all ?? 0,
      value: round2(Number(byStage.get(s.id)?._sum.value ?? 0)),
    }));

  // ── Lead source performance ───────────────────────────────
  const sourceIds = [...new Set(sourceAll.map((g) => g.sourceId).filter((id): id is string => !!id))];
  const sourceNames = new Map(
    (sourceIds.length ? await prisma.crmLeadSource.findMany({ where: { companyId, id: { in: sourceIds } }, select: { id: true, name: true } }) : []).map(
      (s) => [s.id, s.name]
    )
  );
  const sourcePerformance = sourceAll
    .map((g) => {
      const won = countFor(sourceWon, (r) => r.sourceId === g.sourceId);
      const lost = countFor(sourceLost, (r) => r.sourceId === g.sourceId);
      return {
        sourceId: g.sourceId,
        name: g.sourceId ? (sourceNames.get(g.sourceId) ?? "Unknown") : "Unspecified",
        leads: g._count._all,
        qualified: countFor(sourceQualified, (r) => r.sourceId === g.sourceId),
        won,
        lost,
        wonValue: round2(Number(sourceWon.find((r) => r.sourceId === g.sourceId)?._sum.value ?? 0)),
        // Of the decided leads (won + lost), what share was won.
        winRate: won + lost > 0 ? round2((won / (won + lost)) * 100) : null,
      };
    })
    .sort((a, b) => b.leads - a.leads);

  // ── Salesperson performance ───────────────────────────────
  const repIds = new Set<string>();
  for (const rows of [repAll, overdueByRep]) for (const r of rows) if (r.assignedToUserId) repIds.add(r.assignedToUserId);
  for (const d of deals) if (d.assignedToUserId) repIds.add(d.assignedToUserId);
  const reps = repIds.size
    ? await prisma.user.findMany({ where: { companyId, id: { in: [...repIds] } }, select: { id: true, fullName: true } })
    : [];
  const salespersonPerformance = reps
    .map((u) => ({
      userId: u.id,
      fullName: u.fullName,
      leads: countFor(repAll, (r) => r.assignedToUserId === u.id),
      contacted: countFor(repContacted, (r) => r.assignedToUserId === u.id),
      neverContacted: countFor(repNever, (r) => r.assignedToUserId === u.id),
      wonLeads: countFor(repWon, (r) => r.assignedToUserId === u.id),
      overdueFollowups: overdueByRep.find((r) => r.assignedToUserId === u.id)?._count._all ?? 0,
      openPipeline: round2(openDeals.filter((d) => d.assignedToUserId === u.id).reduce((s, d) => s + Number(d.value), 0)),
      wonValue: round2(wonDeals.filter((d) => d.assignedToUserId === u.id).reduce((s, d) => s + Number(d.value), 0)),
    }))
    .sort((a, b) => b.overdueFollowups - a.overdueFollowups || b.leads - a.leads);
  const unassignedOverdue = overdueByRep.find((r) => r.assignedToUserId === null)?._count._all ?? 0;

  // ── Funnel ────────────────────────────────────────────────
  const funnel = FUNNEL_STEPS.map((step) => ({
    label: step.label,
    segment: step.segment,
    count: step.segment ? count[step.segment as keyof typeof count] : totalLeads,
  }));

  // ── 12-month trend (fixed window, independent of the period filter) ──
  const trendMap = new Map<string, { created: number; won: number }>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth() + i, 1);
    trendMap.set(monthKey(d), { created: 0, won: 0 });
  }
  for (const l of trendLeads) {
    const c = trendMap.get(monthKey(l.createdAt));
    if (c) c.created++;
    if (l.wonAt) {
      const w = trendMap.get(monthKey(l.wonAt));
      if (w) w.won++;
    }
  }
  const monthlyTrend = [...trendMap.entries()].map(([month, v]) => ({ month, ...v }));

  const [overdueLabelled, upcomingLabelled, activitiesLabelled] = await Promise.all([
    withRelatedLabels(companyId, overdueList),
    withRelatedLabels(companyId, upcomingList),
    withRelatedLabels(companyId, recentActivities),
  ]);

  const decided = count.WON + count.LOST;

  return {
    kpis: {
      totalLeads,
      newLeads: count.NEW,
      contactedLeads: count.CONTACTED,
      neverContactedLeads: count.NEVER_CONTACTED,
      qualifiedLeads: count.QUALIFIED,
      hotLeads: count.HOT,
      samplingRequested: count.SAMPLING,
      wonLeads: count.WON,
      lostLeads: count.LOST,
      openOpportunities: openDeals.length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      followupsDueToday: followupCounters.dueToday,
      overdueFollowups: followupCounters.overdue,
      // Open deals weighted by probability, plus the expected value of open
      // leads that have no deal yet (so a lead and the deal it became are
      // never counted twice).
      expectedBusinessValue: round2(weightedPipelineValue + openLeadValue),
      weightedPipelineValue,
      openLeadValue,
      convertedCustomers,
      leadConversionRate: decided > 0 ? round2((count.WON / decided) * 100) : null,
    },
    funnel,
    pipelineByStage,
    dealsByStage,
    sourcePerformance,
    salespersonPerformance,
    unassignedOverdue,
    overdueFollowups: overdueLabelled.map((f) => ({
      id: f.id,
      followupDate: f.followupDate,
      type: f.type,
      notes: f.notes,
      relatedModule: f.relatedModule,
      relatedRecordId: f.relatedRecordId,
      relatedLabel: f.relatedLabel,
      assignedTo: f.assignedTo?.fullName ?? null,
    })),
    upcomingFollowups: upcomingLabelled.map((f) => ({
      id: f.id,
      followupDate: f.followupDate,
      type: f.type,
      notes: f.notes,
      relatedModule: f.relatedModule,
      relatedRecordId: f.relatedRecordId,
      relatedLabel: f.relatedLabel,
      assignedTo: f.assignedTo?.fullName ?? null,
    })),
    recentActivities: activitiesLabelled.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      subject: a.subject,
      activityAt: a.activityAt,
      relatedModule: a.relatedModule,
      relatedRecordId: a.relatedRecordId,
      relatedLabel: a.relatedLabel,
      performedBy: a.performedBy.fullName,
    })),
    closingSoon,
    monthlyTrend,
  };
}

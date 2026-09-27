import { prisma } from "@/core/db/client";
import { computeWeightedValue } from "./deal.service";
import { getFollowupCounters } from "./crm-activity.service";
import { getSalesLeaderboard } from "./deal.service";

export interface CrmDashboardFilters {
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * A genuine cross-entity aggregation (Lead + Deal + Customer + Follow-ups),
 * same precedent as `getMarketingDashboard()`/`getCustomer360()` — reads
 * Prisma directly rather than routing through lead.service.ts/deal.service.ts
 * for a read-only rollup that belongs to neither entity alone.
 *
 * The date range filters by `createdAt` on both Lead and Deal — "how much
 * CRM activity happened in this period" — applied uniformly so Pipeline/Won/
 * Lost/Top-Customers/Top-Opportunities all describe the same period's deals,
 * rather than mixing an all-time pipeline with a period-scoped lead count.
 * Deal has no separate "wonAt"/"closedAt" timestamp, so a deal won last month
 * but created this month is the one edge case this simplification doesn't
 * perfectly capture — accepted rather than adding a new timestamp column for
 * a dashboard-only nicety.
 *
 * Today's/Overdue Follow-ups are deliberately NOT date-range scoped — both
 * are inherently "right now" concepts (a follow-up due today is due today
 * regardless of which historical period the dashboard is otherwise showing).
 */
export async function getCrmDashboard(companyId: string, filters: CrmDashboardFilters = {}) {
  const dateWhere =
    filters.dateFrom || filters.dateTo
      ? { createdAt: { ...(filters.dateFrom ? { gte: filters.dateFrom } : {}), ...(filters.dateTo ? { lte: filters.dateTo } : {}) } }
      : {};

  const [leads, deals, followupCounters, leaderboard] = await Promise.all([
    prisma.lead.findMany({
      where: { companyId, ...dateWhere },
      select: { id: true, stage: { select: { code: true, kind: true } }, source: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      where: { companyId, ...dateWhere },
      select: {
        id: true,
        title: true,
        stage: true,
        value: true,
        probabilityPercent: true,
        customerId: true,
        customer: { select: { id: true, name: true } },
      },
    }),
    getFollowupCounters(companyId),
    getSalesLeaderboard(companyId),
  ]);

  const openDeals = deals.filter((d) => d.stage !== "WON" && d.stage !== "LOST");
  const wonDeals = deals.filter((d) => d.stage === "WON");
  const lostDeals = deals.filter((d) => d.stage === "LOST");

  const pipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value), 0);
  const weightedPipelineValue = openDeals.reduce((sum, d) => sum + computeWeightedValue(d.value, d.probabilityPercent), 0);
  const wonValue = wonDeals.reduce((sum, d) => sum + Number(d.value), 0);

  const closedCount = wonDeals.length + lostDeals.length;
  const conversionRate = closedCount > 0 ? (wonDeals.length / closedCount) * 100 : 0;
  const averageDealValue = deals.length > 0 ? deals.reduce((sum, d) => sum + Number(d.value), 0) / deals.length : 0;

  const dealsByStage: Record<string, number> = {};
  for (const d of deals) dealsByStage[d.stage] = (dealsByStage[d.stage] ?? 0) + 1;

  const leadsBySource: Record<string, number> = {};
  for (const l of leads) {
    const key = l.source?.name ?? "Unspecified";
    leadsBySource[key] = (leadsBySource[key] ?? 0) + 1;
  }

  const customerWonValue = new Map<string, { id: string; name: string; value: number }>();
  for (const d of wonDeals) {
    if (!d.customer) continue;
    const existing = customerWonValue.get(d.customer.id);
    customerWonValue.set(d.customer.id, { id: d.customer.id, name: d.customer.name, value: (existing?.value ?? 0) + Number(d.value) });
  }
  const topCustomers = [...customerWonValue.values()].sort((a, b) => b.value - a.value).slice(0, 5);

  const topOpportunities = [...openDeals]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5)
    .map((d) => ({ id: d.id, title: d.title, value: Number(d.value), customerName: d.customer?.name ?? null }));

  return {
    totalLeads: leads.length,
    // Interim mapping onto the configurable stages; the dashboard itself is
    // reworked in the next CRM slice.
    newLeads: leads.filter((l) => l.stage.code === "NEW_LEAD").length,
    qualifiedLeads: leads.filter((l) => l.stage.code === "QUALIFICATION").length,
    openDeals: openDeals.length,
    wonDeals: wonDeals.length,
    lostDeals: lostDeals.length,
    pipelineValue,
    weightedPipelineValue,
    wonValue,
    conversionRate,
    averageDealValue,
    dealsByStage,
    leadsBySource,
    topCustomers,
    topOpportunities,
    salesLeaderboard: leaderboard,
    todaysFollowups: followupCounters.dueToday,
    overdueFollowups: followupCounters.overdue,
  };
}

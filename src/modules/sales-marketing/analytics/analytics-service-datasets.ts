import { prisma } from "@/core/db/client";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { attributionReport } from "@/modules/sales-marketing/attribution/attribution-report.service";
import { listTargets } from "@/modules/sales-marketing/performance/target.service";
import { ANALYTICS_LIMITS, changePercent, ratio, type MetricDef } from "./analytics-registry";
import type { ResultRow, ValidatedQuery } from "./analytics-engine";

/**
 * Phase 17 — datasets that wrap an existing governed service instead of SQL,
 * so their numbers are exactly the numbers on those screens:
 *  - campaigns: the Phase 13 attribution report (default model, current run,
 *    order-value basis) + Phase 12 actual spend + the planned budget;
 *  - targets: Phase 05 approved targets whose own period overlaps the range.
 * The wrapped services apply their own permissions and record scope. Ratios
 * are recomputed from summed parts here too.
 */

export interface ServiceRun {
  rows: ResultRow[];
  totals: { values: Record<string, number | null>; compare?: Record<string, number | null>; change?: Record<string, number | null> };
  truncated: boolean;
}
interface Period {
  from: string;
  to: string;
}
export interface ServiceDataset {
  run(actor: SalesActor, v: ValidatedQuery, metrics: MetricDef[], period: Period, cmp: Period | null): Promise<ServiceRun>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Parts per campaign; ratios derive from these (pure — unit-tested). */
export interface CampaignParts {
  revenue: number;
  spend: number;
  budget: number;
  orders: number;
  delivered: number;
}
export function campaignValues(p: CampaignParts, metrics: MetricDef[]) {
  const all: Record<string, number | null> = {
    attributed_revenue: r2(p.revenue),
    marketing_spend: r2(p.spend),
    planned_budget: r2(p.budget),
    budget_utilization: ratio(p.spend, p.budget, "percent"),
    campaign_roi: p.spend > 0 ? ratio(p.revenue - p.spend, p.spend, "percent") : null,
    campaign_roas: ratio(p.revenue, p.spend, "ratio"),
    credited_orders: r2(p.orders),
    cost_per_order: ratio(p.spend, p.orders, "currency"),
    messages_delivered: p.delivered,
  };
  return Object.fromEntries(metrics.map((m) => [m.id, all[m.id] ?? null]));
}
const addParts = (a: CampaignParts, b: CampaignParts): CampaignParts => ({ revenue: a.revenue + b.revenue, spend: a.spend + b.spend, budget: a.budget + b.budget, orders: a.orders + b.orders, delivered: a.delivered + b.delivered });
const ZERO: CampaignParts = { revenue: 0, spend: 0, budget: 0, orders: 0, delivered: 0 };

async function campaignParts(actor: SalesActor, period: Period, only: string[] | undefined) {
  const rep = await attributionReport(actor, { from: period.from, to: period.to, basis: "ORDER_VALUE" });
  const rows = only?.length ? rep.rows.filter((r) => only.includes(r.campaignId)) : rep.rows;
  const budgets = new Map((await prisma.marketingCampaign.findMany({ where: { companyId: actor.companyId, id: { in: rows.map((r) => r.campaignId) } }, select: { id: true, plannedBudget: true } })).map((c) => [c.id, Number(c.plannedBudget ?? 0)]));
  return new Map(
    rows.map((r) => [
      r.campaignId,
      { label: `${r.code} — ${r.name}`, parts: { revenue: r.revenue, spend: r.actualSpend, budget: budgets.get(r.campaignId) ?? 0, orders: r.credited.SALES_ORDER_BOOKED ?? 0, delivered: r.messagesDelivered } as CampaignParts },
    ])
  );
}

const campaigns: ServiceDataset = {
  async run(actor, v, metrics, period, cmp) {
    const only = v.q.filters.campaign;
    const cur = await campaignParts(actor, period, only);
    const prev = cmp ? await campaignParts(actor, cmp, only) : null;
    const grouped = v.q.groupBy.includes("campaign");
    const total = [...cur.values()].reduce((s, c) => addParts(s, c.parts), ZERO);
    const totals: ServiceRun["totals"] = { values: campaignValues(total, metrics) };
    if (prev) {
      totals.compare = campaignValues([...prev.values()].reduce((s, c) => addParts(s, c.parts), ZERO), metrics);
      totals.change = Object.fromEntries(metrics.map((m) => [m.id, changePercent(totals.values[m.id] ?? null, totals.compare![m.id] ?? null)]));
    }
    if (!grouped) return { rows: [], totals, truncated: false };
    const rows: ResultRow[] = [...cur.entries()].map(([id, c]) => {
      const row: ResultRow = { keys: { campaign: id }, labels: { campaign: c.label }, values: campaignValues(c.parts, metrics) };
      if (prev) {
        row.compare = campaignValues(prev.get(id)?.parts ?? ZERO, metrics);
        row.change = Object.fromEntries(metrics.map((m) => [m.id, changePercent(row.values[m.id], row.compare![m.id])]));
      }
      return row;
    });
    return { rows: rows.slice(0, ANALYTICS_LIMITS.maxRows), totals, truncated: rows.length > ANALYTICS_LIMITS.maxRows };
  },
};

const targets: ServiceDataset = {
  async run(actor, v, metrics, period) {
    const list = await listTargets(actor, { status: "approved" });
    const overlapping = list.data.filter((t) => t.periodStart <= period.to && t.periodEnd >= period.from && t.target !== null);
    const values = (target: number, actual: number) => {
      const all: Record<string, number | null> = { target_value: r2(target), target_actual: r2(actual), target_attainment: ratio(actual, target, "percent") };
      return Object.fromEntries(metrics.map((m) => [m.id, all[m.id] ?? null]));
    };
    // Targets on different measures (value vs count) can't be added together.
    const units = new Set(overlapping.map((t) => t.unit));
    const totals: ServiceRun["totals"] =
      units.size <= 1
        ? { values: values(overlapping.reduce((s, t) => s + (t.target ?? 0), 0), overlapping.reduce((s, t) => s + t.actual, 0)) }
        : { values: Object.fromEntries(metrics.map((m) => [m.id, null])) };
    if (!v.q.groupBy.includes("target")) return { rows: [], totals, truncated: list.truncated };
    const rows: ResultRow[] = overlapping.map((t) => ({
      keys: { target: t.id },
      labels: { target: `${t.subject} · ${t.metricLabel} · ${t.periodLabel}` },
      values: values(t.target ?? 0, t.actual),
    }));
    return { rows: rows.slice(0, ANALYTICS_LIMITS.maxRows), totals, truncated: list.truncated || rows.length > ANALYTICS_LIMITS.maxRows };
  },
};

export const SERVICE_DATASETS: Record<string, ServiceDataset> = { campaigns, targets };

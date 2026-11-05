import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { listEligibleOwners } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { bookedOrderWhere, canSeeRep, canSeeTeam, canSeeTerritory, getPerformanceScope, metricTotals, sumKeys, type MetricTotals, type PerformanceScope } from "@/modules/sales-marketing/performance/performance-actuals";
import { teamsByManager } from "@/modules/sales-marketing/performance/performance-board.service";
import { isoDateSchema, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { isPeriodStart, periodContaining, periodProgress, shiftPeriod, type Period, type PeriodProgress } from "@/modules/sales-marketing/performance/performance-periods";
import type { SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import {
  BASELINE_ASSUMPTIONS,
  DEDUP_REASONS,
  EXCLUSION_LABELS,
  adjustPipeline,
  compareWithTarget,
  itemsInWindow,
  pipelineForecast,
  trendForecast,
  type AdjustedItem,
  type ExcludedItem,
  type ExclusionReason,
  type ForecastAssumptions,
  type PipelineForecast,
  type TargetComparison,
  type TrendForecast,
} from "./forecast-methods";
import { loadPipeline } from "./forecast-pipeline";

/**
 * The sales forecast (Sales & Marketing Phase 06, PHASE_06_FORECAST.md).
 * Metric: booked order value (Phase 05 definition, `metricTotals`). Methods
 * live in forecast-methods.ts; this file loads the inputs, applies the
 * viewer's visibility (Phase 05 rules) and assembles rows, warnings and the
 * history chart. Nothing here writes anything.
 */

export const assumptionsSchema = z
  .object({
    probabilityFactor: z.coerce.number().min(0).max(200).default(100),
    slipDays: z.coerce.number().int().min(0).max(365).default(0),
    includeOverdue: z.boolean().default(false),
    includeQuotations: z.boolean().default(true),
    includeOpportunities: z.boolean().default(true),
    trendGrowth: z.coerce.number().min(-100).max(200).default(0),
  })
  .strict();

export const forecastQuerySchema = z.object({
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().or(z.literal("")),
  periodStart: isoDateSchema.optional().or(z.literal("")),
});

const CHART_BACK = 6;
const CHART_AHEAD = 2;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export interface ForecastRow {
  key: string;
  name: string;
  actual: number;
  pipeline: PipelineForecast;
  trend: TrendForecast;
  comparison: TargetComparison;
  targetId: string | null;
}

export interface ForecastWarning {
  key: string;
  severity: "info" | "warning";
  message: string;
}

export interface ForecastContext {
  companyId: string;
  period: Period;
  today: string;
  assumptions: ForecastAssumptions;
  /** null = everything (snapshots, view_all). */
  scope: PerformanceScope | null;
}

async function resolvePeriod(companyId: string, raw: unknown) {
  const q = forecastQuerySchema.parse(raw ?? {});
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true, baseCurrencyCode: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  const type = (q.periodType || "MONTH") as SalesTargetPeriodTypeKey;
  if (q.periodStart && !isPeriodStart(type, q.periodStart, company.fiscalYearStartMonth)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Pick a period from the list.", { fieldErrors: { periodStart: "Not the start of a period." } });
  }
  return { period: periodContaining(type, q.periodStart || todayIsoDate(), company.fiscalYearStartMonth), fiscalStartMonth: company.fiscalYearStartMonth, baseCurrencyCode: company.baseCurrencyCode };
}

/** Approved booked-order-value targets for one period, keyed "REP:<id>", "TEAM:<id>", "TERRITORY:<id>", "COMPANY". */
async function approvedTargets(companyId: string, period: Period) {
  const rows = await prisma.salesTarget.findMany({
    where: { companyId, metric: "BOOKED_ORDER_VALUE", periodType: period.type, periodStart: toDbDate(period.start), isArchived: false },
    select: { id: true, scope: true, userId: true, territoryId: true, revisions: { where: { status: "APPROVED" }, select: { targetValue: true } } },
  });
  const map = new Map<string, { id: string; value: number | null }>();
  for (const t of rows) map.set(t.scope === "COMPANY" ? "COMPANY" : `${t.scope}:${t.scope === "TERRITORY" ? t.territoryId : t.userId}`, { id: t.id, value: t.revisions[0] ? Number(t.revisions[0].targetValue) : null });
  return map;
}

async function firstBookedDate(companyId: string): Promise<string | null> {
  const o = await prisma.salesOrder.findFirst({ where: { companyId, ...bookedOrderWhere }, orderBy: { orderDate: "asc" }, select: { orderDate: true } });
  return o ? o.orderDate.toISOString().slice(0, 10) : null;
}

interface PeriodTotals {
  period: Period;
  rep: MetricTotals;
  territory: MetricTotals;
  total: number;
}

async function totalsFor(companyId: string, period: Period): Promise<PeriodTotals> {
  const [rep, territory] = await Promise.all([metricTotals(companyId, "BOOKED_ORDER_VALUE", period.start, period.end, "REP"), metricTotals(companyId, "BOOKED_ORDER_VALUE", period.start, period.end, "TERRITORY")]);
  return { period, rep, territory, total: sumKeys(rep, rep.keys()).value };
}

/** Everything the forecast needs, loaded once. */
export async function computeForecast(ctx: ForecastContext) {
  const { companyId, period, today, assumptions, scope } = ctx;
  const settings = await getSalesMarketingSettings(companyId);
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true, baseCurrencyCode: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  const fiscal = company.fiscalYearStartMonth;
  const lookback = settings.forecastTrendLookback;
  const back = Math.max(lookback, CHART_BACK);
  const pastPeriods = Array.from({ length: back }, (_, i) => shiftPeriod(period.type, period.start, -(back - i), fiscal));
  const futurePeriods = Array.from({ length: CHART_AHEAD }, (_, i) => shiftPeriod(period.type, period.start, i + 1, fiscal));

  const [pipeline, current, past, future, targets, firstBooked, teams, owners, territories] = await Promise.all([
    loadPipeline(companyId, today, {
      probabilityApproved: settings.forecastProbabilityApproved,
      probabilityIssued: settings.forecastProbabilityIssued,
      probabilityAccepted: settings.forecastProbabilityAccepted,
      staleDays: settings.forecastStaleDays,
      baseCurrencyCode: company.baseCurrencyCode,
    }),
    totalsFor(companyId, period),
    Promise.all(pastPeriods.map((p) => totalsFor(companyId, p))),
    Promise.all(futurePeriods.map((p) => totalsFor(companyId, p))),
    approvedTargets(companyId, period),
    firstBookedDate(companyId),
    teamsByManager(companyId),
    prisma.user.findMany({ where: { companyId }, select: { id: true, fullName: true } }),
    prisma.salesTerritory.findMany({ where: { companyId }, select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const adjusted = adjustPipeline(pipeline.items, assumptions, today);
  const lookbackPeriods = past.slice(-lookback);

  const trendFor = (valueOf: (t: PeriodTotals) => number): TrendForecast =>
    trendForecast({ history: lookbackPeriods.map((t) => ({ start: t.period.start, end: t.period.end, label: t.period.label, value: valueOf(t) })), lookback, firstBookedDate: firstBooked, growth: assumptions.trendGrowth });

  const row = (key: string, name: string, actual: number, items: AdjustedItem[], valueOf: (t: PeriodTotals) => number, targetKey: string): ForecastRow => {
    const p = pipelineForecast({ period, today, actual, items });
    const target = targets.get(targetKey);
    return { key, name, actual, pipeline: p, trend: trendFor(valueOf), comparison: compareWithTarget(target?.value ?? null, actual, p.forecast, p.weightedPipeline), targetId: target?.id ?? null };
  };
  const names = new Map(owners.map((u) => [u.id, u.fullName]));
  const all = scope === null || scope.viewAll;

  // Reps: S&M people, anyone with actuals / pipeline / a target this period.
  const eligible = await listEligibleOwners({ companyId, userId: scope?.userId ?? "", branchId: null });
  const repIds = new Set<string>(eligible.map((u) => u.id));
  for (const k of current.rep.keys()) if (k) repIds.add(k);
  for (const i of adjusted) if (i.repUserId) repIds.add(i.repUserId);
  for (const k of targets.keys()) if (k.startsWith("REP:")) repIds.add(k.slice(4));
  const reps = [...repIds]
    .filter((id) => names.has(id) && (all || canSeeRep(scope!, id)))
    .map((id) => row(id, names.get(id)!, sumKeys(current.rep, [id]).value, adjusted.filter((i) => i.repUserId === id), (t) => sumKeys(t.rep, [id]).value, `REP:${id}`))
    .sort((a, b) => b.pipeline.forecast - a.pipeline.forecast || a.name.localeCompare(b.name));

  const teamRows = [...teams.entries()]
    .filter(([managerId]) => all || canSeeTeam(scope!, managerId))
    .map(([managerId, t]) => {
      const members = new Set(t.members);
      return row(managerId, `${t.name}'s team`, sumKeys(current.rep, t.members).value, adjusted.filter((i) => i.repUserId && members.has(i.repUserId)), (p) => sumKeys(p.rep, t.members).value, `TEAM:${managerId}`);
    })
    .sort((a, b) => b.pipeline.forecast - a.pipeline.forecast);

  const territoryRows = territories
    .filter((t) => all || canSeeTerritory(scope!, t.id))
    .filter((t) => t.isActive || current.territory.has(t.id) || adjusted.some((i) => i.territoryId === t.id))
    .map((t) => row(t.id, `${t.name} (${t.code})`, sumKeys(current.territory, [t.id]).value, adjusted.filter((i) => i.territoryId === t.id), (p) => sumKeys(p.territory, [t.id]).value, `TERRITORY:${t.id}`))
    .sort((a, b) => b.pipeline.forecast - a.pipeline.forecast);

  const companyRow = all ? row("COMPANY", "Whole company", current.total, adjusted, (t) => t.total, "COMPANY") : null;

  // Items and exclusions the viewer may see.
  const visible = (i: { repUserId: string | null; territoryId: string | null }) => all || (i.repUserId !== null && canSeeRep(scope!, i.repUserId)) || (i.territoryId !== null && canSeeTerritory(scope!, i.territoryId));
  const window = new Set(itemsInWindow(adjusted, period, today).map((i) => `${i.source}:${i.id}`));
  const territoryNames = new Map(territories.map((t) => [t.id, t.name]));
  const items = adjusted.filter(visible).map((i) => ({
    ...i,
    inPeriod: window.has(`${i.source}:${i.id}`),
    rep: i.repUserId ? (names.get(i.repUserId) ?? null) : null,
    territory: i.territoryId ? (territoryNames.get(i.territoryId) ?? null) : null,
  }));
  const excluded = pipeline.excluded.filter(visible).map((e) => ({ ...e, reasonLabel: EXCLUSION_LABELS[e.reason], rep: e.repUserId ? (names.get(e.repUserId) ?? null) : null }));

  // History chart (focus: the company with view_all, else the viewer).
  const focusValue = (t: PeriodTotals) => (all ? t.total : sumKeys(t.rep, [scope!.userId]).value);
  const focusItems = all ? adjusted : adjusted.filter((i) => i.repUserId === scope!.userId);
  const autoSnapshots = await prisma.salesForecastSnapshot.findMany({
    where: { companyId, kind: "AUTO", periodType: period.type, periodStart: { in: pastPeriods.slice(-CHART_BACK).map((p) => toDbDate(p.start)).concat([toDbDate(period.start)]) } },
    select: { periodStart: true, summary: true },
  });
  const snapshotForecast = (start: string): number | null => {
    const s = autoSnapshots.find((x) => x.periodStart.toISOString().slice(0, 10) === start);
    if (!s) return null;
    const sum = s.summary as { company?: { pipeline?: { forecast?: number } }; reps?: { key: string; pipeline: { forecast: number } }[] };
    return all ? (sum.company?.pipeline?.forecast ?? null) : (sum.reps?.find((r) => r.key === scope!.userId)?.pipeline.forecast ?? null);
  };
  const focusTargetKey = all ? "COMPANY" : `REP:${scope!.userId}`;
  const chartTargets = await Promise.all([...pastPeriods.slice(-CHART_BACK).map((t) => t), period, ...futurePeriods].map((p) => approvedTargets(companyId, p).then((m) => m.get(focusTargetKey)?.value ?? null)));
  const chartPeriods = [...past.slice(-CHART_BACK), current, ...future];
  const chart = chartPeriods.map((t, i) => {
    const isPast = t.period.end < today;
    const p = isPast ? null : pipelineForecast({ period: t.period, today, actual: focusValue(t), items: focusItems });
    return {
      start: t.period.start,
      label: t.period.label,
      actual: focusValue(t),
      target: chartTargets[i],
      forecast: p ? p.forecast : null,
      snapshotForecast: snapshotForecast(t.period.start),
      current: t.period.start === period.start,
    };
  });

  // Warnings (on what the viewer can see).
  const warnings: ForecastWarning[] = [];
  const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const byReason = new Map<ExclusionReason, ExcludedItem[]>();
  for (const e of excluded) if (!DEDUP_REASONS.includes(e.reason)) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e]);
  for (const [reason, list] of byReason) {
    const value = list.reduce((s, e) => s + (e.value ?? 0), 0);
    warnings.push({ key: `excluded-${reason}`, severity: "warning", message: `${list.length} left out — ${EXCLUSION_LABELS[reason].toLowerCase()}${value ? ` (${inr(value)} unweighted)` : ""}.` });
  }
  const overdue = items.filter((i) => i.overdue && !assumptions.includeOverdue);
  if (overdue.length) warnings.push({ key: "overdue", severity: "warning", message: `${overdue.length} open item${overdue.length === 1 ? " has" : "s have"} an expected date in the past (${inr(overdue.reduce((s, i) => s + i.weighted, 0))} weighted) and ${overdue.length === 1 ? "is" : "are"} not counted in any period. Update the dates, or try a scenario that includes them.` });
  const stale = items.filter((i) => i.stale);
  if (stale.length) warnings.push({ key: "stale", severity: "warning", message: `${stale.length} opportunit${stale.length === 1 ? "y hasn't" : "ies haven't"} been updated for over ${settings.forecastStaleDays} days.` });
  const defaults = items.filter((i) => i.inPeriod && i.probabilitySource === "QUOTATION_DEFAULT");
  if (defaults.length) warnings.push({ key: "default-probability", severity: "info", message: `${defaults.length} quotation${defaults.length === 1 ? " uses" : "s use"} a default probability from settings (Approved ${settings.forecastProbabilityApproved}%, Issued ${settings.forecastProbabilityIssued}%, Accepted ${settings.forecastProbabilityAccepted}%) — chosen defaults, not measured rates.` });
  const focusRow = companyRow ?? reps.find((r) => r.key === scope?.userId) ?? null;
  if (focusRow && !focusRow.trend.available) warnings.push({ key: "trend", severity: "info", message: `Trend method: ${focusRow.trend.reason}` });
  if (focusRow && focusRow.comparison.target === null) warnings.push({ key: "no-target", severity: "info", message: `No approved target for ${companyRow ? "the company" : "you"} in ${period.label} — the forecast can't be compared with one.` });
  if (focusRow?.comparison.percent !== null && focusRow?.comparison.percent !== undefined && focusRow.comparison.percent < 80 && focusRow.pipeline.state !== "ENDED") {
    warnings.push({ key: "below-target", severity: "warning", message: `The forecast is ${r2(100 - focusRow.comparison.percent)}% below the target.` });
  }

  return {
    period,
    progress: periodProgress(period.start, period.end, today) as PeriodProgress,
    today,
    assumptions,
    settings: {
      probabilityApproved: settings.forecastProbabilityApproved,
      probabilityIssued: settings.forecastProbabilityIssued,
      probabilityAccepted: settings.forecastProbabilityAccepted,
      trendLookback: lookback,
      staleDays: settings.forecastStaleDays,
    },
    viewAll: all,
    company: companyRow,
    me: reps.find((r) => r.key === scope?.userId) ?? null,
    reps,
    teams: teamRows,
    territories: territoryRows,
    items,
    excluded,
    warnings,
    chart,
    calculatedAt: new Date().toISOString(),
  };
}

export type ForecastResult = Awaited<ReturnType<typeof computeForecast>>;

/** The forecast in the viewer's own scope (baseline assumptions). */
export async function getForecast(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const { period } = await resolvePeriod(actor.companyId, raw);
  const scope = await getPerformanceScope(actor);
  const result = await computeForecast({ companyId: actor.companyId, period, today: todayIsoDate(), assumptions: BASELINE_ASSUMPTIONS, scope });
  return withLinks(actor, result);
}

/** Drill-down links only to records the viewer may open. */
export async function withLinks(actor: SalesActor, result: ForecastResult) {
  const [canQuotes, canCrm] = await Promise.all([PermissionService.can(actor.userId, "sales_quotations", "view"), PermissionService.can(actor.userId, "crm", "view")]);
  return {
    ...result,
    items: result.items.map((i) => ({ ...i, href: i.source === "QUOTATION" ? (canQuotes ? `/sales-marketing/quotations/${i.id}` : null) : canCrm ? `/crm/opportunities/${i.id}` : null })),
  };
}

export { resolvePeriod as resolveForecastPeriod };

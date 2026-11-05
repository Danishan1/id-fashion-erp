import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { canSeeRep, canSeeTeam, canSeeTerritory, getPerformanceScope, metricTotals, sumKeys, teamMemberIds, type PerformanceScope } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { periodContaining, periodLabel, type Period } from "@/modules/sales-marketing/performance/performance-periods";
import type { SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { BASELINE_ASSUMPTIONS, accuracySummary, forecastError, type ForecastError } from "./forecast-methods";
import { computeForecast, resolveForecastPeriod, type ForecastResult, type ForecastRow } from "./forecast.service";

/**
 * Forecast snapshots and accuracy (Phase 06, PHASE_06_FORECAST.md §6).
 * A snapshot stores the forecast exactly as calculated at that moment, for
 * the whole company (no viewer filter), and is never changed afterwards.
 * Readers only see the rows their Phase 05 scope allows.
 */

const LATE_AFTER_DAYS = 3;

interface StoredRow {
  key: string;
  name: string;
  actual: number;
  pipeline: { forecast: number; weightedPipeline: number; unweightedPipeline: number; items: number };
  trend: { available: boolean; value: number | null; reason: string | null };
  target: number | null;
}
export interface SnapshotSummary {
  company: StoredRow | null;
  reps: StoredRow[];
  teams: StoredRow[];
  territories: StoredRow[];
}

const store = (r: ForecastRow): StoredRow => ({
  key: r.key,
  name: r.name,
  actual: r.actual,
  pipeline: { forecast: r.pipeline.forecast, weightedPipeline: r.pipeline.weightedPipeline, unweightedPipeline: r.pipeline.unweightedPipeline, items: r.pipeline.items },
  trend: { available: r.trend.available, value: r.trend.value, reason: r.trend.reason },
  target: r.comparison.target,
});

function snapshotData(f: ForecastResult) {
  return {
    assumptions: { ...f.assumptions, settings: f.settings, method: "PIPELINE + TREND" } as Prisma.InputJsonValue,
    summary: { company: f.company ? store(f.company) : null, reps: f.reps.map(store), teams: f.teams.map(store), territories: f.territories.map(store) } as unknown as Prisma.InputJsonValue,
    items: {
      included: f.items.map((i) => ({ source: i.source, id: i.id, number: i.number, value: i.value, probability: i.adjustedProbability, probabilitySource: i.probabilitySource, expectedDate: i.adjustedDate, weighted: i.weighted, inPeriod: i.inPeriod, overdue: i.overdue, repUserId: i.repUserId, territoryId: i.territoryId })),
      excluded: f.excluded.map((e) => ({ source: e.source, id: e.id, number: e.number, value: e.value, reason: e.reason, detail: e.detail ?? null, repUserId: e.repUserId, territoryId: e.territoryId })),
    } as unknown as Prisma.InputJsonValue,
  };
}

const daysFromStart = (start: string, today: string) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;

/** Takes (and stores) one snapshot. Company-wide; nothing is filtered by viewer. */
export async function takeSnapshot(companyId: string, period: Period, kind: "MANUAL" | "AUTO", createdByUserId: string | null, note: string | null, today = todayIsoDate()) {
  const f = await computeForecast({ companyId, period, today, assumptions: BASELINE_ASSUMPTIONS, scope: null });
  return prisma.salesForecastSnapshot.create({
    data: {
      companyId,
      kind,
      periodType: period.type,
      periodStart: toDbDate(period.start),
      periodEnd: toDbDate(period.end),
      late: kind === "AUTO" && daysFromStart(period.start, today) > LATE_AFTER_DAYS,
      note,
      createdByUserId,
      ...snapshotData(f),
    },
  });
}

export const manualSnapshotSchema = z
  .object({ periodType: z.enum(["MONTH", "QUARTER", "YEAR"]), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: optionalText(500) })
  .strict();

export async function createManualSnapshot(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "create");
  const input = manualSnapshotSchema.parse(raw);
  const { period } = await resolveForecastPeriod(actor.companyId, input);
  if (period.end < todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "That period has ended — there is nothing left to forecast.", { fieldErrors: { periodStart: "Ended." } });
  const s = await takeSnapshot(actor.companyId, period, "MANUAL", actor.userId, input.note || null);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "sales_forecast_snapshots", recordId: s.id, action: "CREATE", oldValues: undefined, newValues: { periodType: period.type, periodStart: period.start, note: input.note || null } });
  return getSnapshot(actor, s.id);
}

/**
 * Background job (every few hours): one automatic snapshot per company for
 * the current month, and for the current quarter / year in their first
 * month, if it doesn't exist yet. Safe to run any number of times.
 */
export async function takeAutoSnapshotsForAllCompanies(today = todayIsoDate()) {
  const companies = await prisma.company.findMany({ select: { id: true, fiscalYearStartMonth: true } });
  let created = 0;
  for (const c of companies) {
    const month = periodContaining("MONTH", today, c.fiscalYearStartMonth);
    const due: Period[] = [month];
    for (const type of ["QUARTER", "YEAR"] as const) {
      const p = periodContaining(type, today, c.fiscalYearStartMonth);
      if (p.start === month.start) due.push(p);
    }
    for (const p of due) {
      const exists = await prisma.salesForecastSnapshot.findFirst({ where: { companyId: c.id, kind: "AUTO", periodType: p.type, periodStart: toDbDate(p.start) }, select: { id: true } });
      if (exists) continue;
      try {
        await takeSnapshot(c.id, p, "AUTO", null, null, today);
        created++;
      } catch (error) {
        // Another worker made it first (partial unique index) — fine.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
      }
    }
  }
  return { created };
}

// ── Read + accuracy ──────────────────────────────────────────────

function visibleRows(summary: SnapshotSummary, scope: PerformanceScope) {
  if (scope.viewAll) return summary;
  return {
    company: null,
    reps: summary.reps.filter((r) => canSeeRep(scope, r.key)),
    teams: summary.teams.filter((r) => canSeeTeam(scope, r.key)),
    territories: summary.territories.filter((r) => canSeeTerritory(scope, r.key)),
  };
}

/** Actual booked order value now for one snapshot row. */
async function actualNow(companyId: string, start: string, end: string) {
  const [rep, territory] = await Promise.all([metricTotals(companyId, "BOOKED_ORDER_VALUE", start, end, "REP"), metricTotals(companyId, "BOOKED_ORDER_VALUE", start, end, "TERRITORY")]);
  return {
    company: sumKeys(rep, rep.keys()).value,
    rep: (id: string) => sumKeys(rep, [id]).value,
    territory: (id: string) => sumKeys(territory, [id]).value,
    team: async (managerId: string) => sumKeys(rep, await teamMemberIds(managerId)).value,
  };
}

const accuracyOf = (row: StoredRow, actual: number) => ({
  pipeline: forecastError(row.pipeline.forecast, actual),
  trend: row.trend.value === null ? null : forecastError(row.trend.value, actual),
});

export const snapshotFilterSchema = z.object({ periodType: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().or(z.literal("")), kind: z.enum(["MANUAL", "AUTO"]).optional().or(z.literal("")) });

export async function listSnapshots(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const f = snapshotFilterSchema.parse(raw ?? {});
  const scope = await getPerformanceScope(actor);
  const company = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  const rows = await prisma.salesForecastSnapshot.findMany({
    where: { companyId: actor.companyId, ...(f.periodType ? { periodType: f.periodType } : {}), ...(f.kind ? { kind: f.kind } : {}) },
    orderBy: [{ periodStart: "desc" }, { takenAt: "desc" }],
    take: 200,
    select: { id: true, kind: true, periodType: true, periodStart: true, periodEnd: true, takenAt: true, late: true, note: true, summary: true, createdBy: { select: { fullName: true } } },
  });
  const today = todayIsoDate();
  const data = await Promise.all(
    rows.map(async (s) => {
      const start = dbDate(s.periodStart);
      const end = dbDate(s.periodEnd);
      const sum = s.summary as unknown as SnapshotSummary;
      const focus = scope.viewAll ? sum.company : (sum.reps.find((r) => r.key === actor.userId) ?? null);
      const ended = end < today;
      let actual: number | null = null;
      if (ended && focus) {
        const a = await actualNow(actor.companyId, start, end);
        actual = scope.viewAll ? a.company : a.rep(actor.userId);
      }
      return {
        id: s.id,
        kind: s.kind,
        periodType: s.periodType,
        periodLabel: periodLabel(s.periodType, start, company?.fiscalYearStartMonth ?? 1),
        periodStart: start,
        periodEnd: end,
        takenAt: s.takenAt.toISOString(),
        late: s.late,
        note: s.note,
        by: s.createdBy?.fullName ?? "Automatic",
        focus: scope.viewAll ? "Company" : "You",
        forecast: focus ? focus.pipeline.forecast : null,
        trend: focus ? focus.trend.value : null,
        target: focus ? focus.target : null,
        ended,
        actual,
        accuracy: ended && focus && actual !== null ? accuracyOf(focus, actual) : null,
      };
    })
  );
  return { data };
}

export async function getSnapshot(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const s = await prisma.salesForecastSnapshot.findFirst({ where: { id, companyId: actor.companyId }, include: { createdBy: { select: { fullName: true } } } });
  if (!s) throw new BusinessRuleError("NOT_FOUND", "Snapshot not found.", { id });
  const scope = await getPerformanceScope(actor);
  const company = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  const start = dbDate(s.periodStart);
  const end = dbDate(s.periodEnd);
  const ended = end < todayIsoDate();
  const rows = visibleRows(s.summary as unknown as SnapshotSummary, scope);
  const a = ended ? await actualNow(actor.companyId, start, end) : null;
  const withAccuracy = async (list: StoredRow[], actualOf: (key: string) => number | Promise<number>) =>
    Promise.all(list.map(async (r) => ({ ...r, actualNow: a ? await actualOf(r.key) : null, accuracy: a ? accuracyOf(r, await actualOf(r.key)) : null })));
  const items = s.items as unknown as { included: { repUserId: string | null; territoryId: string | null }[]; excluded: { repUserId: string | null; territoryId: string | null }[] };
  const visible = (i: { repUserId: string | null; territoryId: string | null }) => scope.viewAll || (i.repUserId !== null && canSeeRep(scope, i.repUserId)) || (i.territoryId !== null && canSeeTerritory(scope, i.territoryId));
  return {
    id: s.id,
    kind: s.kind,
    periodType: s.periodType,
    periodLabel: periodLabel(s.periodType, start, company?.fiscalYearStartMonth ?? 1),
    periodStart: start,
    periodEnd: end,
    takenAt: s.takenAt.toISOString(),
    late: s.late,
    note: s.note,
    by: s.createdBy?.fullName ?? "Automatic",
    assumptions: s.assumptions,
    ended,
    company: rows.company ? { ...rows.company, actualNow: a?.company ?? null, accuracy: a ? accuracyOf(rows.company, a.company) : null } : null,
    reps: await withAccuracy(rows.reps, (k) => a!.rep(k)),
    teams: await withAccuracy(rows.teams, (k) => a!.team(k)),
    territories: await withAccuracy(rows.territories, (k) => a!.territory(k)),
    items: { included: (items.included ?? []).filter(visible), excluded: (items.excluded ?? []).filter(visible) },
  };
}

/**
 * Accuracy over ended periods, from AUTOMATIC snapshots only (all taken at
 * the start of their period, so they are comparable). Company figures with
 * view_all, otherwise the viewer's own.
 */
export async function getAccuracySummary(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const periodType = (z.object({ periodType: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().or(z.literal("")) }).parse(raw ?? {}).periodType || "MONTH") as SalesTargetPeriodTypeKey;
  const list = await listSnapshots(actor, { periodType, kind: "AUTO" });
  const ended = list.data.filter((s) => s.accuracy);
  const pipeline: ForecastError[] = ended.map((s) => s.accuracy!.pipeline);
  const trend: ForecastError[] = ended.map((s) => s.accuracy!.trend).filter((e): e is ForecastError => e !== null);
  return {
    periodType,
    focus: list.data[0]?.focus ?? ((await getPerformanceScope(actor)).viewAll ? "Company" : "You"),
    periods: ended.map((s) => ({ id: s.id, periodLabel: s.periodLabel, periodStart: s.periodStart, late: s.late, ...s.accuracy! })),
    pipeline: accuracySummary(pipeline),
    trend: accuracySummary(trend),
    note: ended.length
      ? "Comparisons use automatic start-of-period snapshots only, against booked order value as it is now. Trend accuracy is only over periods where the trend had enough history."
      : "No ended period has an automatic snapshot yet. Accuracy appears once a period that was snapshotted at its start has ended — past forecasts are never reconstructed.",
  };
}


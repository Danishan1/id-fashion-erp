import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getPerformanceScope } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { BASELINE_ASSUMPTIONS, type ForecastAssumptions } from "./forecast-methods";
import { assumptionsSchema, computeForecast, resolveForecastPeriod, type ForecastResult, type ForecastRow } from "./forecast.service";

/**
 * What-if scenarios (Phase 06, PHASE_06_FORECAST.md §7). A scenario only
 * changes forecast assumptions; it never touches CRM, quotations, orders,
 * targets or settings. Results are recalculated live next to the baseline
 * (in the viewer's own scope); the last result is stored when saved.
 */

const TABLE = "sales_forecast_scenarios";

const periodFields = { periodType: z.enum(["MONTH", "QUARTER", "YEAR"]), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) };
export const scenarioCreateSchema = z
  .object({ name: z.string().trim().min(1, "Enter a name").max(200), description: optionalText(1000), ...periodFields, assumptions: assumptionsSchema })
  .strict();
export const scenarioUpdateSchema = z
  .object({ name: z.string().trim().min(1, "Enter a name").max(200), description: optionalText(1000), assumptions: assumptionsSchema, version: z.number().int().min(1) })
  .strict();
export const scenarioPreviewSchema = z.object({ ...periodFields, assumptions: assumptionsSchema }).strict();

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

interface Compared {
  key: string;
  name: string;
  baseline: { forecast: number; weightedPipeline: number; trend: number | null };
  scenario: { forecast: number; weightedPipeline: number; trend: number | null };
  difference: number;
  /** null when the baseline is 0. */
  differencePercent: number | null;
  target: number | null;
}

function compare(base: ForecastRow, alt: ForecastRow | undefined): Compared {
  const s = alt ?? base;
  const difference = r2(s.pipeline.forecast - base.pipeline.forecast);
  return {
    key: base.key,
    name: base.name,
    baseline: { forecast: base.pipeline.forecast, weightedPipeline: base.pipeline.weightedPipeline, trend: base.trend.value },
    scenario: { forecast: s.pipeline.forecast, weightedPipeline: s.pipeline.weightedPipeline, trend: s.trend.value },
    difference,
    differencePercent: base.pipeline.forecast > 0 ? Math.round((difference / base.pipeline.forecast) * 1000) / 10 : null,
    target: base.comparison.target,
  };
}

function compareResults(base: ForecastResult, alt: ForecastResult) {
  const byKey = (rows: ForecastRow[]) => new Map(rows.map((r) => [r.key, r]));
  const [reps, teams, territories] = [byKey(alt.reps), byKey(alt.teams), byKey(alt.territories)];
  return {
    hypothetical: true as const,
    period: base.period,
    calculatedAt: new Date().toISOString(),
    company: base.company ? compare(base.company, alt.company ?? undefined) : null,
    me: base.me ? compare(base.me, alt.me ?? undefined) : null,
    reps: base.reps.map((r) => compare(r, reps.get(r.key))),
    teams: base.teams.map((r) => compare(r, teams.get(r.key))),
    territories: base.territories.map((r) => compare(r, territories.get(r.key))),
  };
}

async function runComparison(actor: SalesActor, periodRaw: { periodType: string; periodStart: string }, assumptions: ForecastAssumptions) {
  const { period } = await resolveForecastPeriod(actor.companyId, periodRaw);
  const scope = await getPerformanceScope(actor);
  const today = todayIsoDate();
  const [base, alt] = await Promise.all([
    computeForecast({ companyId: actor.companyId, period, today, assumptions: BASELINE_ASSUMPTIONS, scope }),
    computeForecast({ companyId: actor.companyId, period, today, assumptions, scope }),
  ]);
  return { period, result: compareResults(base, alt) };
}

/** Unsaved what-if (sales_performance.view). */
export async function previewScenario(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const input = scenarioPreviewSchema.parse(raw);
  return (await runComparison(actor, input, input.assumptions)).result;
}

export async function createScenario(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "create");
  const input = scenarioCreateSchema.parse(raw);
  const { period, result } = await runComparison(actor, input, input.assumptions);
  const s = await prisma.$transaction(async (tx) => {
    const row = await tx.salesForecastScenario.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        description: input.description || null,
        periodType: period.type,
        periodStart: toDbDate(period.start),
        periodEnd: toDbDate(period.end),
        assumptions: input.assumptions as unknown as Prisma.InputJsonValue,
        lastResult: result as unknown as Prisma.InputJsonValue,
        lastCalculatedAt: new Date(),
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: row.id, action: "CREATE", newValues: { name: input.name, period: period.start, assumptions: input.assumptions } }, tx);
    return row;
  });
  return getScenario(actor, s.id);
}

async function loadScenario(actor: SalesActor, id: string) {
  const s = await prisma.salesForecastScenario.findFirst({ where: { id, companyId: actor.companyId }, include: { createdBy: { select: { fullName: true } }, updatedBy: { select: { fullName: true } } } });
  if (!s) throw new BusinessRuleError("NOT_FOUND", "Scenario not found.", { id });
  return s;
}

export async function updateScenario(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = scenarioUpdateSchema.parse(raw);
  const s = await loadScenario(actor, id);
  if (s.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This scenario is archived.");
  if (s.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this scenario after you opened it. Reload to see their changes.");
  const { result } = await runComparison(actor, { periodType: s.periodType, periodStart: dbDate(s.periodStart) }, input.assumptions);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesForecastScenario.updateMany({
      where: { id: s.id, companyId: actor.companyId, version: s.version },
      data: { name: input.name, description: input.description || null, assumptions: input.assumptions as unknown as Prisma.InputJsonValue, lastResult: result as unknown as Prisma.InputJsonValue, lastCalculatedAt: new Date(), updatedByUserId: actor.userId, version: { increment: 1 } },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This scenario changed just now. Reload and try again.");
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: s.id, action: "UPDATE", oldValues: { name: s.name, assumptions: s.assumptions }, newValues: { name: input.name, assumptions: input.assumptions } }, tx);
  });
  return getScenario(actor, id);
}

export async function archiveScenario(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const s = await loadScenario(actor, id);
  if (s.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This scenario is already archived.");
  await prisma.$transaction(async (tx) => {
    await tx.salesForecastScenario.updateMany({ where: { id: s.id, companyId: actor.companyId }, data: { isArchived: true, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: s.id, action: "UPDATE", oldValues: { isArchived: false }, newValues: { isArchived: true } }, tx);
  });
  return getScenario(actor, id);
}

export async function listScenarios(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const { archived } = z.object({ archived: z.enum(["true", "false", ""]).optional() }).parse(raw ?? {});
  const rows = await prisma.salesForecastScenario.findMany({
    where: { companyId: actor.companyId, isArchived: archived === "true" },
    orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
    take: 200,
    include: { createdBy: { select: { fullName: true } } },
  });
  return rows.map((s) => ({ id: s.id, name: s.name, description: s.description, periodType: s.periodType, periodStart: dbDate(s.periodStart), periodEnd: dbDate(s.periodEnd), assumptions: s.assumptions as unknown as ForecastAssumptions, createdBy: s.createdBy.fullName, updatedAt: s.updatedAt.toISOString(), archived: s.isArchived }));
}

/** Scenario with a live comparison in the viewer's scope; the stored result only for its author or view_all. */
export async function getScenario(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "view");
  const s = await loadScenario(actor, id);
  const assumptions = assumptionsSchema.parse(s.assumptions);
  const [{ result }, scope] = await Promise.all([runComparison(actor, { periodType: s.periodType, periodStart: dbDate(s.periodStart) }, assumptions), getPerformanceScope(actor)]);
  const showStored = scope.viewAll || s.createdByUserId === actor.userId;
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    periodType: s.periodType,
    periodStart: dbDate(s.periodStart),
    periodEnd: dbDate(s.periodEnd),
    assumptions,
    archived: s.isArchived,
    version: s.version,
    createdBy: s.createdBy.fullName,
    updatedBy: s.updatedBy.fullName,
    updatedAt: s.updatedAt.toISOString(),
    live: result,
    stored: showStored && s.lastResult ? { result: s.lastResult, calculatedAt: s.lastCalculatedAt?.toISOString() ?? null } : null,
  };
}

import { Prisma, type SmAnalyticsReport } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { drillDown, runReport, validateQuery, type DrillResult, type ReportResult } from "./analytics-engine";
import { PERIOD_PRESETS, indiaToday, resolvePreset, type PeriodPreset } from "./analytics-periods";
import { ANALYTICS_LIMITS, reportQuerySchema, type ReportQuery } from "./analytics-registry";

/**
 * Phase 17 — saved reports, sharing, versions and the run log.
 *
 * A saved report is a governed definition (validated against the registry on
 * save and again on every run) — never SQL. Sharing is PRIVATE, with named
 * USERS, or the whole COMPANY; whoever opens it runs it with THEIR OWN
 * permissions, so sharing never widens what anyone can see. Only the owner
 * changes it (sales_analytics.create to save, .edit to share or schedule).
 * Every change keeps a version row and an audit entry.
 */

const TABLE = "sm_analytics_reports";
export const SLOW_RUN_MS = ANALYTICS_LIMITS.slowQueryMs;
export const RUN_LOG_RETENTION_DAYS = ANALYTICS_LIMITS.runRetentionDays;
const MAX_REPORTS_PER_USER = 100;
const MAX_SHARE = 50;

export const SHARING = { PRIVATE: "Only me", USERS: "Chosen people", COMPANY: "Everyone with Analytics access" } as const;
export type Sharing = keyof typeof SHARING;

export const savedDefinitionSchema = z
  .object({
    query: reportQuerySchema,
    period: z.discriminatedUnion("mode", [z.object({ mode: z.literal("fixed") }).strict(), z.object({ mode: z.literal("relative"), preset: z.enum(Object.keys(PERIOD_PRESETS) as [PeriodPreset, ...PeriodPreset[]]) }).strict()]).default({ mode: "fixed" }),
  })
  .strict();
export type SavedDefinition = z.infer<typeof savedDefinitionSchema>;

const ids = z.array(z.string().uuid()).max(MAX_SHARE).default([]);
export const savedReportCreateSchema = z
  .object({
    name: z.string().trim().min(3, "Give the report a name").max(120),
    description: z.string().trim().max(500).optional().nullable(),
    definition: savedDefinitionSchema,
    sharing: z.enum(["PRIVATE", "USERS", "COMPANY"]).default("PRIVATE"),
    sharedUserIds: ids,
    recipientUserIds: ids,
    deliveryFormat: z.enum(["CSV", "XLSX"]).default("XLSX"),
  })
  .strict();
export const savedReportUpdateSchema = savedReportCreateSchema.extend({ version: z.coerce.number().int() }).strict();

/** The period a saved definition covers today. */
export async function effectiveQuery(companyId: string, def: SavedDefinition, today = indiaToday()): Promise<ReportQuery> {
  if (def.period.mode === "fixed") return def.query;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
  return { ...def.query, ...resolvePreset(def.period.preset, today, c?.fiscalYearStartMonth ?? 4) };
}

export function canSeeReport(r: Pick<SmAnalyticsReport, "ownerUserId" | "sharing" | "sharedUserIds" | "isArchived">, userId: string) {
  if (r.ownerUserId === userId) return true;
  if (r.isArchived) return false;
  return r.sharing === "COMPANY" || (r.sharing === "USERS" && r.sharedUserIds.includes(userId));
}

async function loadVisible(actor: SalesActor, id: string) {
  const r = await prisma.smAnalyticsReport.findFirst({ where: { id, companyId: actor.companyId } });
  if (!r || !canSeeReport(r, actor.userId)) throw new BusinessRuleError("NOT_FOUND", "Saved report not found.", { id });
  return r;
}
async function loadOwned(actor: SalesActor, id: string) {
  const r = await loadVisible(actor, id);
  if (r.ownerUserId !== actor.userId) throw new BusinessRuleError("PERMISSION_DENIED", "Only the owner can change this report. Save a copy instead.");
  return r;
}

/** Shared-with and recipients must be active users of this company with Analytics access. */
async function checkPeople(companyId: string, userIds: string[], what: string) {
  if (!userIds.length) return;
  const found = await prisma.user.findMany({ where: { companyId, id: { in: userIds } }, select: { id: true, fullName: true } });
  if (found.length !== new Set(userIds).size) throw new BusinessRuleError("VALIDATION_ERROR", `Some ${what} aren't users of this company.`, { fieldErrors: { [what === "recipients" ? "recipientUserIds" : "sharedUserIds"]: "Unknown user." } });
  const without: string[] = [];
  for (const u of found) if (!(await PermissionService.can(u.id, "sales_analytics", "view"))) without.push(u.fullName);
  if (without.length) throw new BusinessRuleError("VALIDATION_ERROR", `${without.join(", ")} can't open Analytics, so they can't be ${what === "recipients" ? "recipients" : "shared with"}.`);
}

async function checkSave(actor: SalesActor, input: z.infer<typeof savedReportCreateSchema>) {
  validateQuery(input.definition.query);
  const sharesOrSchedules = input.sharing !== "PRIVATE" || input.recipientUserIds.length > 0;
  if (sharesOrSchedules) await PermissionService.assert(actor.userId, "sales_analytics", "edit");
  if (input.sharing === "USERS" && !input.sharedUserIds.length) throw new BusinessRuleError("VALIDATION_ERROR", "Choose who to share with.", { fieldErrors: { sharedUserIds: "Required." } });
  await checkPeople(actor.companyId, input.sharing === "USERS" ? input.sharedUserIds : [], "people");
  await checkPeople(actor.companyId, input.recipientUserIds, "recipients");
}

function dto(r: SmAnalyticsReport, userId: string, names: Map<string, string>) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    definition: r.definition as unknown as SavedDefinition,
    sharing: r.sharing as Sharing,
    sharingLabel: SHARING[r.sharing as Sharing],
    sharedUserIds: r.sharedUserIds,
    recipientUserIds: r.recipientUserIds,
    recipients: r.recipientUserIds.map((id) => ({ id, name: names.get(id) ?? "Unknown user" })),
    deliveryFormat: r.deliveryFormat as "CSV" | "XLSX",
    owner: { id: r.ownerUserId, name: names.get(r.ownerUserId) ?? "Unknown user" },
    isMine: r.ownerUserId === userId,
    isArchived: r.isArchived,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}
async function nameMap(companyId: string, rows: SmAnalyticsReport[]) {
  const all = [...new Set(rows.flatMap((r) => [r.ownerUserId, ...r.recipientUserIds, ...r.sharedUserIds]))];
  if (!all.length) return new Map<string, string>();
  return new Map((await prisma.user.findMany({ where: { companyId, id: { in: all } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
}
export type SavedReportDto = ReturnType<typeof dto>;

export async function listSavedReports(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const rows = await prisma.smAnalyticsReport.findMany({
    where: { companyId: actor.companyId, isArchived: false, OR: [{ ownerUserId: actor.userId }, { sharing: "COMPANY" }, { sharing: "USERS", sharedUserIds: { has: actor.userId } }] },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
  const names = await nameMap(actor.companyId, rows);
  return rows.map((r) => dto(r, actor.userId, names));
}

export async function getSavedReport(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const r = await loadVisible(actor, id);
  const names = await nameMap(actor.companyId, [r]);
  const versions = await prisma.smAnalyticsReportVersion.findMany({ where: { reportId: r.id }, orderBy: { version: "desc" }, take: 20, select: { version: true, name: true, changedByUserId: true, createdAt: true } });
  const vNames = new Map((await prisma.user.findMany({ where: { companyId: actor.companyId, id: { in: versions.map((v) => v.changedByUserId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return { ...dto(r, actor.userId, names), versions: versions.map((v) => ({ version: v.version, name: v.name, changedBy: vNames.get(v.changedByUserId) ?? "Unknown user", at: v.createdAt.toISOString() })) };
}

export async function createSavedReport(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_analytics", "create");
  const input = savedReportCreateSchema.parse(raw);
  await checkSave(actor, input);
  if ((await prisma.smAnalyticsReport.count({ where: { companyId: actor.companyId, ownerUserId: actor.userId, isArchived: false } })) >= MAX_REPORTS_PER_USER) throw new BusinessRuleError("VALIDATION_ERROR", `You can keep up to ${MAX_REPORTS_PER_USER} saved reports. Delete some first.`);
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.smAnalyticsReport.create({
      data: {
        companyId: actor.companyId,
        ownerUserId: actor.userId,
        name: input.name,
        description: input.description ?? null,
        definition: input.definition as unknown as Prisma.InputJsonValue,
        sharing: input.sharing,
        sharedUserIds: input.sharing === "USERS" ? input.sharedUserIds : [],
        recipientUserIds: input.recipientUserIds,
        deliveryFormat: input.deliveryFormat,
      },
    });
    await tx.smAnalyticsReportVersion.create({ data: { reportId: r.id, version: 1, name: r.name, definition: input.definition as unknown as Prisma.InputJsonValue, changedByUserId: actor.userId } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: r.id, action: "CREATE", newValues: { name: r.name, sharing: r.sharing, recipients: r.recipientUserIds.length, dataset: input.definition.query.dataset } }, tx);
    return r;
  });
  return getSavedReport(actor, created.id);
}

export async function updateSavedReport(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_analytics", "create");
  const input = savedReportUpdateSchema.parse(raw);
  const r = await loadOwned(actor, id);
  if (r.isArchived) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This report was deleted.");
  if (r.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this report since you opened it. Reload and try again.");
  await checkSave(actor, input);
  const definitionChanged = JSON.stringify(r.definition) !== JSON.stringify(input.definition) || r.name !== input.name;
  await prisma.$transaction(async (tx) => {
    const n = await tx.smAnalyticsReport.updateMany({
      where: { id: r.id, version: r.version },
      data: {
        name: input.name,
        description: input.description ?? null,
        definition: input.definition as unknown as Prisma.InputJsonValue,
        sharing: input.sharing,
        sharedUserIds: input.sharing === "USERS" ? input.sharedUserIds : [],
        recipientUserIds: input.recipientUserIds,
        deliveryFormat: input.deliveryFormat,
        version: { increment: 1 },
      },
    });
    if (n.count !== 1) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this report since you opened it. Reload and try again.");
    if (definitionChanged) await tx.smAnalyticsReportVersion.create({ data: { reportId: r.id, version: r.version + 1, name: input.name, definition: input.definition as unknown as Prisma.InputJsonValue, changedByUserId: actor.userId } });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: r.id, action: "UPDATE", oldValues: { name: r.name, sharing: r.sharing, sharedUserIds: r.sharedUserIds, recipientUserIds: r.recipientUserIds, version: r.version }, newValues: { name: input.name, sharing: input.sharing, sharedUserIds: input.sharedUserIds, recipientUserIds: input.recipientUserIds, definitionChanged } }, tx);
  });
  return getSavedReport(actor, r.id);
}

/** Soft delete (keeps delivery history). Its schedules stop delivering: the report is no longer found. */
export async function archiveSavedReport(actor: SalesActor, id: string, version: number) {
  await PermissionService.assert(actor.userId, "sales_analytics", "create");
  const r = await loadOwned(actor, id);
  const n = await prisma.smAnalyticsReport.updateMany({ where: { id: r.id, version }, data: { isArchived: true, version: { increment: 1 } } });
  if (n.count !== 1) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone changed this report since you opened it. Reload and try again.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: r.id, action: "DELETE", oldValues: { name: r.name } });
  return { ok: true };
}

// ── Running + the run log ─────────────────────────────────────────

export type RunSource = "INTERACTIVE" | "DASHBOARD" | "DRILL" | "EXPORT" | "DELIVERY";

async function logRun(actor: SalesActor, entry: { source: RunSource; reportId?: string | null; dataset: string; metrics: string[]; rowCount: number; durationMs: number; status: "OK" | "DENIED" | "FAILED"; error?: string | null }) {
  await prisma.smAnalyticsRun
    .create({ data: { companyId: actor.companyId, userId: actor.userId, reportId: entry.reportId ?? null, source: entry.source, dataset: entry.dataset.slice(0, 40), metrics: entry.metrics.slice(0, 10).map((m) => m.slice(0, 60)), rowCount: entry.rowCount, durationMs: entry.durationMs, status: entry.status, slow: entry.durationMs >= SLOW_RUN_MS, error: entry.error?.slice(0, 300) ?? null } })
    .catch(() => undefined); // the log never breaks a report
}

const datasetOf = (raw: unknown) => (raw && typeof raw === "object" && typeof (raw as { dataset?: unknown }).dataset === "string" ? (raw as { dataset: string }).dataset : "unknown");
const metricsOf = (raw: unknown) => (raw && typeof raw === "object" && Array.isArray((raw as { metrics?: unknown }).metrics) ? ((raw as { metrics: unknown[] }).metrics.filter((m) => typeof m === "string") as string[]) : []);

/** runReport + a run-log row (usage and timing only — never the data). */
export async function runLogged(actor: SalesActor, raw: unknown, source: RunSource, reportId?: string | null): Promise<ReportResult> {
  const started = Date.now();
  try {
    const r = await runReport(actor, raw);
    await logRun(actor, { source, reportId, dataset: r.dataset.key, metrics: r.columns.filter((c) => c.kind === "metric").map((c) => c.key), rowCount: r.rows.length, durationMs: Date.now() - started, status: "OK" });
    return r;
  } catch (e) {
    const denied = e instanceof BusinessRuleError && e.code === "PERMISSION_DENIED";
    const validation = e instanceof BusinessRuleError && e.code === "VALIDATION_ERROR";
    if (!validation) await logRun(actor, { source, reportId, dataset: datasetOf(raw), metrics: metricsOf(raw), rowCount: 0, durationMs: Date.now() - started, status: denied ? "DENIED" : "FAILED", error: e instanceof Error ? e.message : "Error" });
    throw e;
  }
}

export async function drillLogged(actor: SalesActor, raw: unknown, keys: Record<string, string | null>): Promise<DrillResult> {
  const started = Date.now();
  const r = await drillDown(actor, raw, keys);
  await logRun(actor, { source: "DRILL", dataset: datasetOf(raw), metrics: metricsOf(raw), rowCount: r.rows.length, durationMs: Date.now() - started, status: "OK" });
  return r;
}

/** Runs a saved report as the viewer (their permissions), for its current relative period unless overridden. */
export async function runSavedReport(actor: SalesActor, id: string, source: RunSource = "INTERACTIVE") {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const r = await loadVisible(actor, id);
  const def = savedDefinitionSchema.parse(r.definition);
  const query = await effectiveQuery(actor.companyId, def);
  return { report: { id: r.id, name: r.name }, result: await runLogged(actor, query, source, r.id) };
}

/** Usage summary for admins: runs, slow runs and failures by dataset (last 30 days). */
export async function usageSummary(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await prisma.smAnalyticsRun.groupBy({ by: ["dataset", "status"], where: { companyId: actor.companyId, createdAt: { gte: since } }, _count: { _all: true }, _avg: { durationMs: true }, _max: { durationMs: true } });
  const slow = await prisma.smAnalyticsRun.groupBy({ by: ["dataset"], where: { companyId: actor.companyId, createdAt: { gte: since }, slow: true }, _count: { _all: true } });
  const slowBy = new Map(slow.map((s) => [s.dataset, s._count._all]));
  const by = new Map<string, { dataset: string; runs: number; denied: number; failed: number; avgMs: number; maxMs: number; slow: number }>();
  for (const r of rows) {
    const e = by.get(r.dataset) ?? { dataset: r.dataset, runs: 0, denied: 0, failed: 0, avgMs: 0, maxMs: 0, slow: slowBy.get(r.dataset) ?? 0 };
    e.runs += r._count._all;
    if (r.status === "DENIED") e.denied += r._count._all;
    if (r.status === "FAILED") e.failed += r._count._all;
    if (r.status === "OK") e.avgMs = Math.round(r._avg.durationMs ?? 0);
    e.maxMs = Math.max(e.maxMs, r._max.durationMs ?? 0);
    by.set(r.dataset, e);
  }
  return { since: since.toISOString(), slowThresholdMs: SLOW_RUN_MS, datasets: [...by.values()].sort((a, b) => b.runs - a.runs) };
}

/** Retention: run log rows older than 90 days. */
export async function pruneAnalyticsRuns(now = new Date()) {
  const r = await prisma.smAnalyticsRun.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RUN_LOG_RETENTION_DAYS * 86_400_000) } } });
  return r.count;
}

/** An ad-hoc run from the builder; an optional relative `preset` is resolved here (India date, company fiscal year). */
export async function runAdHoc(actor: SalesActor, raw: unknown) {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const { preset, ...rest } = body;
  if (preset === undefined) return runLogged(actor, rest, "INTERACTIVE");
  const p = z.enum(Object.keys(PERIOD_PRESETS) as [PeriodPreset, ...PeriodPreset[]]).parse(preset);
  const c = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  return runLogged(actor, { ...rest, ...resolvePreset(p, indiaToday(), c?.fiscalYearStartMonth ?? 4) }, "INTERACTIVE");
}

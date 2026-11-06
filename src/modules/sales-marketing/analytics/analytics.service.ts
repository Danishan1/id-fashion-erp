import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { listDashboards } from "./analytics-dashboards.service";
import { metricAccess } from "./analytics-engine";
import { buildReportFile } from "./analytics-export";
import { PERIOD_PRESETS } from "./analytics-periods";
import { ANALYTICS_LIMITS, ANALYTICS_TIMEZONE, DATASETS, FRESHNESS, METRICS, REPORTING_CURRENCY_NOTE, TIME_GRAINS, metricsOf } from "./analytics-registry";
import { runLogged } from "./analytics-reports.service";

/**
 * Phase 17 — the catalogue (datasets, governed metrics with definitions, the
 * viewer's access to each), filter options and synchronous exports.
 */

export async function catalog(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const datasets = [];
  for (const ds of Object.values(DATASETS)) {
    const p = ds.permission;
    const visible = await PermissionService.can(actor.userId, p.module as never, p.action as never);
    const { ok, no } = await metricAccess(actor.userId, metricsOf(ds.key));
    datasets.push({ ...ds, available: visible, unavailableReason: visible ? null : `Needs ${p.module}.${p.action}.`, metrics: metricsOf(ds.key).filter((m) => !m.retired).map((m) => ({ ...m, available: visible && ok.some((x) => x.id === m.id), unavailableReason: no.find((x) => x.id === m.id)?.reason ?? null })) });
  }
  const [canCreate, canEdit, canExport, isAdmin] = await Promise.all([
    PermissionService.can(actor.userId, "sales_analytics", "create"),
    PermissionService.can(actor.userId, "sales_analytics", "edit"),
    PermissionService.can(actor.userId, "sales_analytics", "export"),
    PermissionService.can(actor.userId, "sales_marketing_settings", "edit"),
  ]);
  return {
    datasets,
    retiredMetrics: METRICS.filter((m) => m.retired).map((m) => ({ id: m.id, version: m.version, label: m.label, replacedBy: m.replacedBy ?? null })),
    timeGrains: TIME_GRAINS,
    presets: PERIOD_PRESETS,
    limits: ANALYTICS_LIMITS,
    freshness: FRESHNESS,
    timezone: ANALYTICS_TIMEZONE,
    currency: REPORTING_CURRENCY_NOTE,
    dashboards: listDashboards(),
    can: { create: canCreate, edit: canEdit, export: canExport, admin: isAdmin },
  };
}

const optionsSchema = z.object({ dataset: z.string().max(40), dimension: z.string().max(40), search: z.string().max(80).optional() }).strict();

/** Filter choices for one dimension (company-scoped; names only). */
export async function dimensionOptions(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const f = optionsSchema.parse(raw);
  const ds = DATASETS[f.dataset];
  const dim = ds?.dimensions.find((d) => d.key === f.dimension);
  if (!ds || !dim) throw new BusinessRuleError("VALIDATION_ERROR", "Unknown dimension.");
  const s = f.search?.trim();
  const companyId = actor.companyId;
  const take = 50;
  switch (dim.kind) {
    case "enum":
      return Object.entries(dim.options ?? {}).map(([value, label]) => ({ value, label }));
    case "user":
      return (await prisma.user.findMany({ where: { companyId, ...(s ? { fullName: { contains: s, mode: "insensitive" } } : {}) }, orderBy: { fullName: "asc" }, take, select: { id: true, fullName: true } })).map((u) => ({ value: u.id, label: u.fullName }));
    case "customer":
      return (await prisma.customer.findMany({ where: { companyId, ...(s ? { name: { contains: s, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take, select: { id: true, name: true } })).map((u) => ({ value: u.id, label: u.name }));
    case "channel":
      return (await prisma.salesChannel.findMany({ where: { companyId }, orderBy: { name: "asc" }, take, select: { id: true, name: true } })).map((u) => ({ value: u.id, label: u.name }));
    case "territory":
      return (await prisma.salesTerritory.findMany({ where: { companyId }, orderBy: { name: "asc" }, take, select: { id: true, name: true } })).map((u) => ({ value: u.id, label: u.name }));
    case "campaign":
      return (await prisma.marketingCampaign.findMany({ where: { companyId, ...(s ? { name: { contains: s, mode: "insensitive" } } : {}) }, orderBy: { code: "desc" }, take, select: { id: true, code: true, name: true } })).map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
    default:
      return [];
  }
}

export const exportSchema = z.object({ query: z.unknown(), title: z.string().trim().min(1).max(120).default("Report"), format: z.enum(["CSV", "XLSX"]).default("XLSX"), reportId: z.string().uuid().optional() }).strict();

/** Synchronous, bounded export of a report as the viewer (their permissions), audited. */
export async function exportReport(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_analytics", "export");
  const input = exportSchema.parse(raw);
  const result = await runLogged(actor, input.query, "EXPORT", input.reportId ?? null);
  const me = await prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } });
  const file = await buildReportFile(result, input.title, input.format, me?.fullName ?? "you");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "sm_analytics_runs", recordId: input.reportId ?? actor.userId, action: "CREATE", newValues: { export: input.format, dataset: result.dataset.key, metrics: result.columns.filter((c) => c.kind === "metric").map((c) => c.key), rows: result.rows.length, period: result.meta.period, filters: Object.keys(result.query.filters) } });
  return file;
}

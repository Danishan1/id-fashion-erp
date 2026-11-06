import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { DASHBOARD_BY_KEY, DASHBOARDS } from "./analytics-dashboards";
import type { ReportResult } from "./analytics-engine";
import { PERIOD_PRESETS, indiaToday, resolvePreset, type PeriodPreset } from "./analytics-periods";
import { runLogged } from "./analytics-reports.service";

/**
 * Phase 17 — runs a standard dashboard as the viewer. Widgets run one at a
 * time (bounded load) and fail independently: a widget the viewer can't see
 * says so instead of showing zero, and an error in one widget never blanks the
 * others.
 */

export const dashboardRunSchema = z
  .object({
    preset: z.enum(Object.keys(PERIOD_PRESETS) as [PeriodPreset, ...PeriodPreset[]]).optional(),
  })
  .strict();

export type WidgetOutcome = { id: string; status: "OK"; result: ReportResult } | { id: string; status: "HIDDEN" | "ERROR"; message: string };

export function listDashboards() {
  return DASHBOARDS.map((d) => ({ key: d.key, label: d.label, description: d.description, defaultPreset: d.defaultPreset }));
}

export async function runDashboard(actor: SalesActor, key: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_analytics", "view");
  const def = DASHBOARD_BY_KEY.get(key);
  if (!def) throw new BusinessRuleError("NOT_FOUND", "Dashboard not found.", { key });
  const { preset = def.defaultPreset } = dashboardRunSchema.parse(raw ?? {});
  const c = await prisma.company.findUnique({ where: { id: actor.companyId }, select: { fiscalYearStartMonth: true } });
  const period = resolvePreset(preset, indiaToday(), c?.fiscalYearStartMonth ?? 4);
  const widgets: WidgetOutcome[] = [];
  for (const w of def.widgets) {
    try {
      widgets.push({ id: w.id, status: "OK", result: await runLogged(actor, { ...w.query, ...period }, "DASHBOARD") });
    } catch (e) {
      if (e instanceof BusinessRuleError && e.code === "PERMISSION_DENIED") widgets.push({ id: w.id, status: "HIDDEN", message: e.message });
      else widgets.push({ id: w.id, status: "ERROR", message: e instanceof BusinessRuleError ? e.message : "This widget couldn't be loaded." });
    }
  }
  return { dashboard: { key: def.key, label: def.label, description: def.description }, preset, presetLabel: PERIOD_PRESETS[preset], period, widgets: def.widgets.map((w) => ({ ...w, outcome: widgets.find((x) => x.id === w.id)! })) };
}

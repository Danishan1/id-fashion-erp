import { z } from "zod";

/**
 * Phase 21 — CRM dashboard: widget catalogue, default layout and the shapes of
 * the per-user customisation (client-safe; shared by the API, the service and
 * the UI). A widget's data comes only from GET /api/v1/crm/dashboard
 * (crm-dashboard.service.ts); the layout and default filters are stored with
 * the existing per-user CRM preferences ("dashboard.layout", "dashboard.filters").
 */

export const DASHBOARD_WIDGETS = {
  kpis: { label: "Key figures", description: "Active leads, new leads, open pipeline, wins, overdue work and upcoming appointments.", defaultSize: "full" },
  pipeline: { label: "Pipeline", description: "Open opportunities by stage, and won / lost in the period.", defaultSize: "half" },
  leads: { label: "Leads", description: "New leads per day, by source and by status.", defaultSize: "half" },
  attention: { label: "Leads needing attention", description: "Never contacted, follow-up date passed, recently updated.", defaultSize: "half" },
  myWork: { label: "My work", description: "Overdue, today and upcoming tasks; upcoming appointments; recently completed.", defaultSize: "half" },
  activity: { label: "Recent activity", description: "Leads created or converted, stage changes, wins, completed tasks, appointments and messages.", defaultSize: "half" },
  automation: { label: "Automation & integrations", description: "Workflow runs, bulk jobs, failed lead captures and messages.", defaultSize: "half" },
  quickActions: { label: "Quick actions", description: "Shortcuts to add records, tasks, calls, notes and appointments.", defaultSize: "half" },
} as const;

export type DashboardWidgetKey = keyof typeof DASHBOARD_WIDGETS;
export const DASHBOARD_WIDGET_KEYS = Object.keys(DASHBOARD_WIDGETS) as [DashboardWidgetKey, ...DashboardWidgetKey[]];
/** Widgets whose data comes from the API (quick actions are built in the browser from permissions). */
export const DATA_WIDGET_KEYS = DASHBOARD_WIDGET_KEYS.filter((k) => k !== "quickActions");

export type WidgetSize = "half" | "full";

export const dashboardLayoutSchema = z
  .object({
    widgets: z
      .array(z.object({ key: z.enum(DASHBOARD_WIDGET_KEYS), visible: z.boolean(), size: z.enum(["half", "full"]) }).strict())
      .max(DASHBOARD_WIDGET_KEYS.length)
      .refine((w) => new Set(w.map((x) => x.key)).size === w.length, "Each widget can appear once."),
  })
  .strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  widgets: [
    { key: "kpis", visible: true, size: "full" },
    { key: "pipeline", visible: true, size: "half" },
    { key: "myWork", visible: true, size: "half" },
    { key: "leads", visible: true, size: "half" },
    { key: "attention", visible: true, size: "half" },
    { key: "activity", visible: true, size: "half" },
    { key: "automation", visible: true, size: "half" },
    { key: "quickActions", visible: true, size: "full" },
  ],
};

/**
 * A saved layout merged with the catalogue: unknown keys dropped, widgets added
 * to the catalogue later appear (visible) at the end, so a stored layout never
 * hides a new widget for ever or breaks when one is removed.
 */
export function resolveDashboardLayout(stored: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(stored);
  if (!parsed.success) return DEFAULT_DASHBOARD_LAYOUT;
  const seen = new Set(parsed.data.widgets.map((w) => w.key));
  return { widgets: [...parsed.data.widgets, ...DEFAULT_DASHBOARD_LAYOUT.widgets.filter((w) => !seen.has(w.key))] };
}

export const DASHBOARD_RANGES = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  custom: "Custom range",
} as const;
export type DashboardRangeKey = keyof typeof DASHBOARD_RANGES;
export const DASHBOARD_RANGE_KEYS = Object.keys(DASHBOARD_RANGES) as [DashboardRangeKey, ...DashboardRangeKey[]];

/** Longest custom range (keeps the per-day charts and queries bounded). */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

/** Default filters a user saves for their dashboard (the pipeline and owner they usually look at). */
export const dashboardFiltersSchema = z
  .object({
    range: z.enum(DASHBOARD_RANGE_KEYS).optional(),
    pipelineId: z.string().uuid().nullable().optional(),
    owner: z.union([z.enum(["all", "me"]), z.string().uuid()]).optional(),
  })
  .strict();
export type DashboardSavedFilters = z.infer<typeof dashboardFiltersSchema>;

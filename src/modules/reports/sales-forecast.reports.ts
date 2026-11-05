import { PermissionService } from "@/core/rbac/PermissionService";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { round2 } from "@/lib/money";
import { getForecast } from "@/modules/sales-marketing/forecast/forecast.service";
import { getAccuracySummary } from "@/modules/sales-marketing/forecast/forecast-snapshot.service";
import { registerReport, type ReportViewer } from "./registry";

/**
 * Sales forecast reports (Sales & Marketing Phase 06, 2026-11-03), in the
 * Sales & Marketing Report Center category. Both call the same services as
 * the Forecast screens (so figures match) and need sales_performance.view.
 */

const CATEGORY = "sales-marketing" as const;
const actorOf = (companyId: string, viewer: ReportViewer) => ({ companyId, userId: viewer.userId, branchId: null });

// ── 1. Forecast pipeline ─────────────────────────────────────────

async function getForecastPipelineDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_performance", "view");
  const f = await getForecast(actorOf(companyId, viewer), { periodType: filters.periodType ?? "", periodStart: filters.periodStart ?? "" });
  const included = f.items.map((i) => ({
    recordId: i.id,
    source: i.source,
    number: i.number,
    kind: i.source === "QUOTATION" ? `Quotation (${i.status.toLowerCase().replace(/_/g, " ")})` : "Opportunity",
    customer: i.customer,
    rep: i.rep ?? "—",
    territory: i.territory ?? "—",
    expectedDate: i.adjustedDate,
    value: i.value,
    probability: i.adjustedProbability,
    probabilitySource: i.probabilitySource === "OPPORTUNITY" ? "Opportunity" : "Settings default",
    weighted: i.weighted,
    counted: i.inPeriod ? "Yes" : i.overdue ? "No — expected date passed" : "No — other period",
  }));
  const excluded = f.excluded.map((e) => ({
    recordId: e.id,
    source: e.source,
    number: e.number,
    kind: e.source === "QUOTATION" ? "Quotation" : "Opportunity",
    customer: "—",
    rep: e.rep ?? "—",
    territory: "—",
    expectedDate: null,
    value: e.value,
    probability: null,
    probabilitySource: "—",
    weighted: null,
    counted: `Left out — ${e.reasonLabel.toLowerCase()}${e.detail ? ` (${e.detail})` : ""}`,
  }));
  const rows = filters.show === "excluded" ? excluded : filters.show === "all" ? [...included, ...excluded] : included.filter((r) => r.counted === "Yes");
  return {
    title: "Forecast Pipeline",
    subtitle: `${f.period.label}: open quotations and CRM opportunities behind the forecast, with their probability and weighted value (value × probability). Each commercial deal is counted once. An estimate, not booked sales.`,
    filtersApplied: [{ label: "Period", value: f.period.label }, ...(filters.show ? [{ label: "Show", value: filters.show }] : [])],
    columns: [
      { key: "number", label: "Record", linkTo: "record" },
      { key: "kind", label: "Kind" },
      { key: "customer", label: "Customer" },
      { key: "rep", label: "Rep" },
      { key: "territory", label: "Territory" },
      { key: "expectedDate", label: "Expected", type: "date" },
      { key: "value", label: "Value", type: "currency", align: "right" },
      { key: "probability", label: "Probability %", type: "number", align: "right" },
      { key: "probabilitySource", label: "Probability from" },
      { key: "weighted", label: "Weighted", type: "currency", align: "right" },
      { key: "counted", label: "Counted in period" },
    ],
    rows,
    totals: {
      number: `${rows.length} records`,
      value: round2(rows.reduce((s, r) => s + (r.value ?? 0), 0)),
      weighted: round2(rows.reduce((s, r) => s + (r.weighted ?? 0), 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ── 2. Forecast accuracy ─────────────────────────────────────────

async function getForecastAccuracyDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_performance", "view");
  const a = await getAccuracySummary(actorOf(companyId, viewer), { periodType: filters.periodType ?? "" });
  const rows = a.periods.map((p) => ({
    snapshotId: p.id,
    period: p.periodLabel,
    late: p.late ? "Yes" : "No",
    forecast: p.pipeline.forecast,
    trend: p.trend?.forecast ?? null,
    actual: p.pipeline.actual,
    error: p.pipeline.error,
    percentError: p.pipeline.percentError,
    trendError: p.trend?.error ?? null,
  }));
  const fmt = (s: { mae: number | null; wape: number | null; bias: number | null; periods: number }) =>
    s.periods ? `MAE ₹${s.mae?.toLocaleString("en-IN")} · WAPE ${s.wape === null ? "n/a" : `${s.wape}%`} · bias ${s.bias === null ? "n/a" : `${s.bias}%`}` : "no ended periods";
  return {
    title: "Forecast Accuracy",
    subtitle: `${a.focus}: automatic start-of-period snapshots against booked order value now. Pipeline method — ${fmt(a.pipeline)}. Trend method — ${fmt(a.trend)}. ${a.note}`,
    filtersApplied: [{ label: "Periods", value: a.periodType.toLowerCase() }],
    columns: [
      { key: "period", label: "Period", linkTo: "snapshot" },
      { key: "late", label: "Snapshot late" },
      { key: "forecast", label: "Forecast (pipeline)", type: "currency", align: "right" },
      { key: "trend", label: "Trend estimate", type: "currency", align: "right" },
      { key: "actual", label: "Actual", type: "currency", align: "right" },
      { key: "error", label: "Error", type: "currency", align: "right" },
      { key: "percentError", label: "Error %", type: "percent", align: "right" },
      { key: "trendError", label: "Trend error", type: "currency", align: "right" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "forecast-pipeline", title: "Forecast Pipeline", buildDescriptor: getForecastPipelineDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "forecast-accuracy", title: "Forecast Accuracy", buildDescriptor: getForecastAccuracyDescriptor, pdfOrientation: "landscape" });

export { getForecastPipelineDescriptor, getForecastAccuracyDescriptor };

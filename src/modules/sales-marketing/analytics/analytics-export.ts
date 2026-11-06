import ExcelJS from "exceljs";
import { buildSafeCsv, sanitizeSpreadsheetCell } from "@/modules/bulk-actions/bulk-safety";
import type { ReportResult } from "./analytics-engine";
import { DATASETS, METRIC_BY_ID } from "./analytics-registry";

/**
 * Phase 17 — report files (CSV / Excel). Every file carries a header block so
 * a number is never read without its context: period, comparison, filters,
 * time zone, currency, freshness, metric definitions with versions, and any
 * metric left out for lack of permission. Every text cell is formula-safe
 * (sanitizeSpreadsheetCell); numbers stay numbers.
 */

export type Cell = string | number | null;

function filterText(r: ReportResult) {
  const ds = DATASETS[r.dataset.key];
  const parts = Object.entries(r.query.filters).map(([k, vals]) => `${ds?.dimensions.find((d) => d.key === k)?.label ?? k}: ${vals.length} selected`);
  return parts.length ? parts.join("; ") : "None";
}

/** Pure: the header block lines (unit-tested). */
export function headerBlock(r: ReportResult, title: string, generatedFor: string): Cell[][] {
  const rows: Cell[][] = [
    ["Report", title],
    ["Data", `${r.dataset.label} — ${r.dataset.grain}`],
    ["Period", `${r.meta.period.from} to ${r.meta.period.to} (India dates)`],
    ["Compared with", r.meta.comparePeriod ? `${r.meta.comparePeriod.from} to ${r.meta.comparePeriod.to}` : "No comparison"],
    ["Filters", filterText(r)],
    ["Time zone", r.meta.timezone],
    ["Currency", r.meta.currency],
    ["Generated", `${r.meta.generatedAt} for ${generatedFor} (with their permissions)`],
    ...r.meta.freshness.map((f) => ["Freshness", `${f.source}: ${f.label} — ${f.detail}`] as Cell[]),
  ];
  if (r.meta.reconciliation) rows.push(["Check", `${r.meta.reconciliation.matches ? "Matches" : "DOES NOT MATCH"} ${r.meta.reconciliation.source} (${r.meta.reconciliation.sourceTotal})`]);
  for (const u of r.unavailableMetrics) rows.push(["Not included", `${METRIC_BY_ID.get(u.id)?.label ?? u.id}: ${u.reason}`]);
  if (r.truncated) rows.push(["Note", "Only the first rows are included; narrow the filters for the rest."]);
  for (const m of r.meta.metrics) rows.push([`Definition: ${m.label} (v${m.version})`, m.formula]);
  return rows;
}

/** Pure: column headings + data rows + total row (unit-tested). */
export function tableRows(r: ReportResult): { header: string[]; rows: Cell[][] } {
  const compare = !!r.meta.comparePeriod;
  const metricCols = r.columns.filter((c) => c.kind === "metric");
  const dimCols = r.columns.filter((c) => c.kind === "dimension");
  const header = [
    ...dimCols.map((c) => c.label),
    ...metricCols.flatMap((c) => {
      const u = c.unit === "percent" ? " (%)" : c.unit === "hours" ? " (hours)" : "";
      return compare ? [`${c.label}${u}`, `${c.label} — previous${u}`, `${c.label} — change %`] : [`${c.label}${u}`];
    }),
  ];
  const vals = (v: Record<string, number | null>, cmp?: Record<string, number | null>, ch?: Record<string, number | null>) =>
    metricCols.flatMap((c) => (compare ? [v[c.key] ?? null, cmp?.[c.key] ?? null, ch?.[c.key] ?? null] : [v[c.key] ?? null]));
  const rows: Cell[][] = r.rows.map((row) => [...dimCols.map((c) => row.labels[c.key] ?? row.keys[c.key] ?? ""), ...vals(row.values, row.compare, row.change)]);
  rows.push([...(dimCols.length ? ["Total", ...dimCols.slice(1).map(() => "")] : []), ...vals(r.totals.values, r.totals.compare, r.totals.change)]);
  return { header, rows };
}

const safe = (v: Cell) => (typeof v === "number" ? v : (sanitizeSpreadsheetCell(v) as string | null));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";

export async function buildReportFile(r: ReportResult, title: string, format: "CSV" | "XLSX", generatedFor: string) {
  const stamp = r.meta.generatedAt.slice(0, 16).replace(/[-:T]/g, "");
  const head = headerBlock(r, title, generatedFor);
  const table = tableRows(r);
  if (format === "CSV") {
    const lines: (string | number | null)[][] = [...head.slice(1).map((l) => l.map(safe)), [], table.header.map(safe), ...table.rows.map((l) => l.map(safe))];
    return { buffer: buildSafeCsv(head[0].map((c) => String(c ?? "")), lines), fileName: `${slug(title)}-${stamp}.csv`, mimeType: "text/csv" };
  }
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet("Report");
  data.addRow(table.header.map(safe)).font = { bold: true };
  for (const l of table.rows) data.addRow(l.map(safe));
  data.getRow(data.rowCount).font = { bold: true };
  data.columns.forEach((c, i) => (c.width = i === 0 ? 30 : 18));
  const about = wb.addWorksheet("About this report");
  for (const l of head) about.addRow(l.map(safe));
  about.getColumn(1).width = 34;
  about.getColumn(2).width = 100;
  about.getColumn(1).font = { bold: true };
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName: `${slug(title)}-${stamp}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

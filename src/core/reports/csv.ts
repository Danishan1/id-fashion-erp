import { toCsv } from "@/lib/csv";
import type { ReportDescriptor } from "./report-types";

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Thin wrapper over the existing `toCsv` (src/lib/csv.ts) — used identically by every report's export/csv route. */
export function buildReportCsv(descriptor: ReportDescriptor): string {
  const header = descriptor.columns.map((c) => c.label);
  const rows = descriptor.rows.map((row) => descriptor.columns.map((c) => formatCell(row[c.key])));
  if (descriptor.totals) {
    rows.push(descriptor.columns.map((c) => (c.key in (descriptor.totals ?? {}) ? formatCell(descriptor.totals?.[c.key]) : "")));
  }
  return toCsv(header, rows);
}

export function reportCsvHeaders(fileName: string) {
  return {
    "Content-Type": "text/csv;charset=utf-8",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  };
}

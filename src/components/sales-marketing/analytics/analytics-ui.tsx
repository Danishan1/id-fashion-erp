"use client";

import { Badge } from "../pricing/pricing-ui";
import type { ReportResult, ResultColumn } from "@/modules/sales-marketing/analytics/analytics-engine";
import type { DatasetDef, MetricDef, ReportQueryInput } from "@/modules/sales-marketing/analytics/analytics-registry";

export { Badge, CARD } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";
export type { ReportResult, ResultColumn };

/** Phase 17 — shared bits of the analytics screens (DTOs mirror the services). */

export const AN_API = "/api/v1/sales-marketing/analytics";
export const AN_PAGE = "/sales-marketing/analytics";

export type CatalogMetric = MetricDef & { available: boolean; unavailableReason: string | null };
export type CatalogDataset = Omit<DatasetDef, "permission"> & { permission: { module: string; action: string }; available: boolean; unavailableReason: string | null; metrics: CatalogMetric[] };
export interface Catalog {
  datasets: CatalogDataset[];
  retiredMetrics: { id: string; version: number; label: string; replacedBy: string | null }[];
  timeGrains: Record<string, string>;
  presets: Record<string, string>;
  limits: { maxRangeDays: number; maxMetrics: number; maxGroupBy: number; maxRows: number; maxDrillRows: number; deliveryFileDays: number };
  freshness: Record<string, { label: string; tone: string; help: string }>;
  timezone: string;
  currency: string;
  dashboards: { key: string; label: string; description: string; defaultPreset: string }[];
  can: { create: boolean; edit: boolean; export: boolean; admin: boolean };
}

export type PeriodSpec = { mode: "fixed" } | { mode: "relative"; preset: string };
export interface SavedDefinition {
  query: ReportQueryInput & { from: string; to: string };
  period: PeriodSpec;
}
export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  definition: SavedDefinition;
  sharing: "PRIVATE" | "USERS" | "COMPANY";
  sharingLabel: string;
  sharedUserIds: string[];
  recipientUserIds: string[];
  recipients: { id: string; name: string }[];
  deliveryFormat: "CSV" | "XLSX";
  owner: { id: string; name: string };
  isMine: boolean;
  isArchived: boolean;
  version: number;
  updatedAt: string;
  versions?: { version: number; name: string; changedBy: string; at: string }[];
}

const inrFmt = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: v % 1 ? 2 : 0 })}`;

/** "n/a" for a ratio with no denominator — never shown as 0. */
export function formatValue(v: number | null | undefined, unit: string | undefined) {
  if (v === null || v === undefined) return "n/a";
  switch (unit) {
    case "currency":
      return inrFmt(v);
    case "percent":
      return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
    case "ratio":
      return `${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}×`;
    case "hours":
      return `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
    default:
      return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
}

export function ChangeChip({ change, higherIsBetter }: { change: number | null | undefined; higherIsBetter?: boolean }) {
  if (change === null || change === undefined) return <span className="text-xs text-zinc-400">—</span>;
  const good = higherIsBetter === undefined ? null : higherIsBetter ? change >= 0 : change <= 0;
  const cls = good === null ? "text-zinc-500" : good ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
  return <span className={`text-xs font-medium ${cls}`}>{`${change > 0 ? "▲" : change < 0 ? "▼" : "•"} ${Math.abs(change).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`}</span>;
}

type Tone = "zinc" | "green" | "amber" | "indigo" | "red";
export function FreshnessBadges({ result }: { result: ReportResult }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {result.meta.freshness.map((f, i) => (
        <span key={i} title={`${f.source}: ${f.detail}${f.asOf ? ` (as of ${new Date(f.asOf).toLocaleString("en-IN")})` : ""}`}>
          <Badge tone={(f.status === "CURRENT" ? "green" : f.status === "REFRESHING" ? "indigo" : f.status === "FAILED" ? "red" : f.status === "UNKNOWN" ? "zinc" : "amber") as Tone}>
            {f.source}: {f.label}
          </Badge>
        </span>
      ))}
    </div>
  );
}

export const metricColumns = (r: ReportResult) => r.columns.filter((c) => c.kind === "metric");
export const dimColumns = (r: ReportResult) => r.columns.filter((c) => c.kind === "dimension");

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** POSTs an export and downloads the file. Throws the API's message on failure. */
export async function exportFile(body: { query: unknown; title: string; format: "CSV" | "XLSX"; reportId?: string }) {
  const res = await fetch(`${AN_API}/export`, { method: "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error?.message ?? "The export failed.");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `report.${body.format === "CSV" ? "csv" : "xlsx"}`;
  downloadBlob(await res.blob(), name);
}

export const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

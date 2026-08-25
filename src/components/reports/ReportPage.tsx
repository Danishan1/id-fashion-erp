"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { ReportFilterBar, type ReportFilterFieldConfig } from "./ReportFilterBar";
import { ReportTable } from "./ReportTable";
import type { ReportDescriptor } from "@/core/reports/report-types";

export interface ReportPageProps {
  title: string;
  description?: string;
  breadcrumb: BreadcrumbItem[];
  /** JSON view route, e.g. /api/v1/reports/sales-orders/order-register — export routes are derived as `${apiPath}/export/<format>`. */
  apiPath: string;
  filterFields?: ReportFilterFieldConfig[];
  includeDateRange?: boolean;
  defaultFilters?: Record<string, string>;
  linkBuilders?: Record<string, (row: Record<string, unknown>) => string | undefined>;
  renderKpis?: (descriptor: ReportDescriptor) => ReactNode;
  renderChart?: (descriptor: ReportDescriptor) => ReactNode;
}

function buildQuery(filters: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export function ReportPage({
  title,
  description,
  breadcrumb,
  apiPath,
  filterFields = [],
  includeDateRange = true,
  defaultFilters = {},
  linkBuilders,
  renderKpis,
  renderChart,
}: ReportPageProps) {
  const [draft, setDraft] = useState<Record<string, string>>(defaultFilters);
  const [applied, setApplied] = useState<Record<string, string>>(defaultFilters);
  const [descriptor, setDescriptor] = useState<ReportDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const query = buildQuery(applied);
    fetch(`${apiPath}${query ? `?${query}` : ""}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? "Failed to load report.");
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setDescriptor(body.descriptor ?? body);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath, JSON.stringify(applied), refreshKey]);

  const loading = descriptor === null && error === null;

  const query = buildQuery(applied);
  const exportUrl = (format: "xlsx" | "csv" | "pdf") => `${apiPath}/export/${format}${query ? `?${query}` : ""}`;

  return (
    <div className="space-y-4">
      <Breadcrumb items={breadcrumb} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
        {description ? <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      </div>

      <ReportFilterBar
        fields={filterFields}
        values={draft}
        includeDateRange={includeDateRange}
        onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
        onApply={() => setApplied(draft)}
        onReset={() => {
          setDraft({});
          setApplied({});
        }}
      />

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Refresh
        </button>
        <a
          href={exportUrl("xlsx")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export Excel
        </a>
        <a
          href={exportUrl("csv")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export CSV
        </a>
        <a
          href={exportUrl("pdf")}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Export PDF
        </a>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Print
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : descriptor?.unavailableReason ? (
        <p className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-8 text-center text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          {descriptor.unavailableReason}
        </p>
      ) : descriptor ? (
        <>
          {descriptor.filtersApplied.length > 0 ? (
            <p className="text-xs text-zinc-500">Applied filters: {descriptor.filtersApplied.map((f) => `${f.label}: ${f.value}`).join(", ")}</p>
          ) : null}
          {renderKpis ? renderKpis(descriptor) : null}
          {renderChart ? renderChart(descriptor) : null}
          <ReportTable columns={descriptor.columns} rows={descriptor.rows} totals={descriptor.totals} linkBuilders={linkBuilders} />
          <p className="text-xs text-zinc-400">
            Generated {new Date(descriptor.generatedAt).toLocaleString()} by {descriptor.generatedByName}
            {descriptor.meta ? ` — ${descriptor.meta.totalCount} total row(s)` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

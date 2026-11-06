"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { AnalyticsChart } from "./AnalyticsChart";
import { AN_API, Badge, ChangeChip, FreshnessBadges, dimColumns, formatValue, metricColumns, send, type Catalog, type ReportResult } from "./analytics-ui";

interface DrillDto {
  label: string;
  rows: { id: string; ref: string; date: string | null; href: string | null; value: number | null; flags?: Record<string, boolean> }[];
  truncated: boolean;
  note: string | null;
  linkOnly?: { href: string; label: string };
}

/** Phase 17 — a report result: context (period, freshness, checks), chart, table with totals, drill-down. */
export function ResultView({ result, catalog, showChart = true }: { result: ReportResult; catalog: Catalog | null; showChart?: boolean }) {
  const [drill, setDrill] = useState<{ title: string; data: DrillDto | null; error: string | null } | null>(null);
  const mcols = metricColumns(result);
  const dcols = dimColumns(result);
  const compare = !!result.meta.comparePeriod;
  const metricDef = (id: string) => catalog?.datasets.flatMap((d) => d.metrics).find((m) => m.id === id);

  const openDrill = async (keys: Record<string, string | null>, title: string) => {
    setDrill({ title, data: null, error: null });
    try {
      setDrill({ title, data: await send<DrillDto>(`${AN_API}/drill`, "POST", { query: result.query, keys }), error: null });
    } catch (e) {
      setDrill({ title, data: null, error: (e as Error).message });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          <strong>{result.dataset.label}</strong> · {result.meta.period.from} to {result.meta.period.to}
          {result.meta.comparePeriod && ` · vs ${result.meta.comparePeriod.from} to ${result.meta.comparePeriod.to}`}
        </span>
        <span>{result.meta.timezone}</span>
        <span title={result.meta.currency}>Amounts in base currency</span>
        <span>{result.meta.durationMs} ms</span>
      </div>
      <FreshnessBadges result={result} />
      {result.meta.reconciliation && (
        <p className={`text-xs ${result.meta.reconciliation.matches ? "text-green-700 dark:text-green-400" : "font-medium text-red-700 dark:text-red-400"}`}>
          {result.meta.reconciliation.matches ? "✓ Total checked against" : "✗ Total does NOT match"} {result.meta.reconciliation.source} ({formatValue(result.meta.reconciliation.sourceTotal, "currency")}).
        </p>
      )}
      {result.unavailableMetrics.length > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Not shown because you don&apos;t have access: {result.unavailableMetrics.map((u) => `${metricDef(u.id)?.label ?? u.id} (${u.reason})`).join("; ")}
        </p>
      )}
      {result.truncated && <p className="text-xs text-amber-700 dark:text-amber-300">Only the first rows are shown. Narrow the period or add filters to see the rest; totals cover everything.</p>}

      {!dcols.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {mcols.map((m) => (
            <div key={m.key} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="text-xs text-zinc-500" title={metricDef(m.key)?.description}>
                {m.label}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatValue(result.totals.values[m.key], m.unit)}</div>
              {compare && (
                <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                  <span>was {formatValue(result.totals.compare?.[m.key], m.unit)}</span>
                  <ChangeChip change={result.totals.change?.[m.key]} higherIsBetter={metricDef(m.key)?.higherIsBetter} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {showChart && (dcols.length > 0 || result.dataset.key === "funnel") && <AnalyticsChart result={result} />}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              {dcols.map((c) => (
                <th key={c.key} className="px-2 py-1.5 font-medium">
                  {c.label}
                </th>
              ))}
              {mcols.map((c) => (
                <th key={c.key} className="px-2 py-1.5 text-right font-medium" title={metricDef(c.key)?.formula}>
                  {c.label}
                  <span className="ml-1 text-[10px] text-zinc-400">v{c.version}</span>
                </th>
              ))}
              {result.dataset.key !== "campaigns" && result.dataset.key !== "targets" && dcols.length > 0 && <th className="px-2 py-1.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {result.rows.map((r, i) => (
              <tr key={i}>
                {dcols.map((c) => (
                  <td key={c.key} className="px-2 py-1.5">
                    {r.labels[c.key] ?? r.keys[c.key] ?? "Not set"}
                  </td>
                ))}
                {mcols.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                    {formatValue(r.values[c.key], c.unit)}
                    {compare && r.change && (
                      <div>
                        <ChangeChip change={r.change[c.key]} higherIsBetter={metricDef(c.key)?.higherIsBetter} />
                      </div>
                    )}
                  </td>
                ))}
                {dcols.length > 0 && (
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => openDrill(r.keys, dcols.map((c) => r.labels[c.key] ?? r.keys[c.key] ?? "Not set").join(" · "))}>
                      Records
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {dcols.length > 0 && (
              <tr className="bg-zinc-50 font-semibold dark:bg-zinc-900">
                <td className="px-2 py-1.5" colSpan={dcols.length}>
                  Total
                </td>
                {mcols.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-right tabular-nums">
                    {formatValue(result.totals.values[c.key], c.unit)}
                  </td>
                ))}
                <td />
              </tr>
            )}
          </tbody>
        </table>
        {dcols.length > 0 && !result.rows.length && <p className="py-4 text-center text-sm text-zinc-500">No records in this period.</p>}
      </div>

      <Modal open={!!drill} onClose={() => setDrill(null)} title={drill ? `Records — ${drill.title}` : ""} maxWidthClass="max-w-2xl">
        {drill && !drill.data && !drill.error && <p className="text-sm text-zinc-500">Loading…</p>}
        {drill?.error && <p className="text-sm text-red-600">{drill.error}</p>}
        {drill?.data && (
          <div className="space-y-2">
            {drill.data.note && <p className="text-xs text-zinc-500">{drill.data.note}</p>}
            {drill.data.linkOnly && (
              <Link href={drill.data.linkOnly.href} className="text-sm text-indigo-600 hover:underline">
                {drill.data.linkOnly.label}
              </Link>
            )}
            {drill.data.rows.length > 0 && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-1">{drill.data.label}</th>
                    <th className="py-1">Date</th>
                    <th className="py-1 text-right">Value</th>
                    {drill.data.rows[0].flags && <th className="py-1">Stages reached</th>}
                  </tr>
                </thead>
                <tbody>
                  {drill.data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1">{r.href ? <Link href={r.href} className="text-indigo-600 hover:underline dark:text-indigo-400">{r.ref}</Link> : r.ref}</td>
                      <td className="py-1">{r.date?.slice(0, 10) ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{r.value === null ? "" : formatValue(r.value, "currency")}</td>
                      {r.flags && (
                        <td className="py-1">
                          <span className="flex flex-wrap gap-1">
                            {Object.entries(r.flags)
                              .filter(([, v]) => v)
                              .map(([k]) => (
                                <Badge key={k} tone="indigo">
                                  {k}
                                </Badge>
                              ))}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!drill.data.rows.length && !drill.data.linkOnly && <p className="text-sm text-zinc-500">No records.</p>}
            {drill.data.truncated && <p className="text-xs text-amber-700">Showing the first {drill.data.rows.length}. Narrow the report to see the rest.</p>}
            <p className="text-xs text-zinc-500">Each record opens in its own module, which checks your access again.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatCurrency, formatNumber } from "@/lib/currency";
import type { Money } from "./dashboard-types";

/**
 * Phase 21 — the dashboard's small, dependency-free charts (the app has no
 * charting library).
 *
 * Colours: one series = slot-1 blue; two series = blue + orange, validated
 * for colour-blind separation in light and dark (dataviz validator: adjacent
 * CVD ΔE 24.7 light / 26.8 dark). Text always uses ink colours, never the
 * series colour. Every chart has a hover / focus tooltip and a table view, so
 * no value depends on colour or hovering alone.
 */
const SERIES = {
  blue: { bg: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  orange: { bg: "bg-[#eb6834] dark:bg-[#d95926]" },
} as const;

/** "INR 1,000.00 · USD 500.00" — CRM estimates per currency, never summed across currencies. */
export function MoneyList({ values, empty = "—" }: { values: Money[]; empty?: string }) {
  if (!values.length) return <span>{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {values.map((v) => (
        <span key={v.currencyCode ?? "none"} className="whitespace-nowrap">
          {v.currencyCode ?? "No currency"} {formatCurrency(v.total)}
        </span>
      ))}
    </span>
  );
}

/**
 * Ranked horizontal bars as plain HTML (label · bar · value). Each row is a
 * link to the matching filtered list, so the value is always visible and the
 * chart is keyboard-navigable without a separate table.
 */
export function BarList({ rows, ariaLabel, valueLabel = "count" }: { rows: { key: string; label: string; value: number; href?: string; sub?: React.ReactNode }[]; ariaLabel: string; valueLabel?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={ariaLabel} className="space-y-1.5">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-zinc-700 dark:text-zinc-300">{r.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-zinc-900 dark:text-zinc-50" aria-label={`${formatNumber(r.value)} ${valueLabel}`}>
                {formatNumber(r.value)}
              </span>
            </span>
            <span className="mt-0.5 block h-2 w-full rounded-sm bg-zinc-100 dark:bg-zinc-800" aria-hidden>
              <span className={`block h-2 rounded-r-[4px] ${SERIES.blue.bg}`} style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} />
            </span>
            {r.sub && <span className="mt-0.5 block text-xs text-zinc-500">{r.sub}</span>}
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link href={r.href} className="block rounded px-1 py-0.5 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-zinc-800/50">
                {inner}
              </Link>
            ) : (
              <div className="px-1 py-0.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function shortDate(bucket: string, unit: "day" | "week") {
  const d = new Date(`${bucket}T00:00:00Z`);
  const label = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return unit === "week" ? `wk ${label}` : label;
}

/**
 * Columns over time (one or two series side by side), one shared y-axis from 0.
 * Hover or focus a period for a tooltip with every series; "Show as table"
 * lists every value.
 */
export function ColumnChart({
  title,
  unit,
  points,
  series,
}: {
  title: string;
  unit: "day" | "week";
  points: { bucket: string; values: number[] }[];
  series: { name: string; color: keyof typeof SERIES }[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const tableId = useId();
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const top = max <= 5 ? max : Math.ceil(max / mag) * mag;
  const total = points.reduce((sum, p) => sum + p.values.reduce((a, b) => a + b, 0), 0);
  const labelEvery = Math.ceil(points.length / 6);

  return (
    <figure className="space-y-1">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span>{title}</span>
        <span className="flex items-center gap-3">
          {series.length > 1 &&
            series.map((s) => (
              <span key={s.name} className="flex items-center gap-1">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SERIES[s.color].bg}`} aria-hidden />
                {s.name}
              </span>
            ))}
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" aria-expanded={table} aria-controls={tableId} onClick={() => setTable((t) => !t)}>
            {table ? "Show chart" : "Show as table"}
          </button>
        </span>
      </figcaption>
      {table ? (
        <div id={tableId} className="max-h-48 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-zinc-500">
                <th className="py-1 font-medium">{unit === "day" ? "Day" : "Week of"}</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.bucket} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-0.5">{p.bucket}</td>
                  {p.values.map((v, i) => (
                    <td key={i} className="py-0.5 text-right tabular-nums">
                      {formatNumber(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : total === 0 ? (
        <p className="flex h-[150px] items-center justify-center text-xs text-zinc-400">Nothing in this period.</p>
      ) : (
        <div className="relative">
          <div className="flex h-[150px] gap-1">
            {/* y-axis: 0, half, top */}
            <div className="flex w-7 shrink-0 flex-col justify-between pb-4 text-right text-xs text-zinc-400" aria-hidden>
              <span>{formatNumber(top, { notation: "compact" })}</span>
              <span>{formatNumber(Math.round(top / 2), { notation: "compact" })}</span>
              <span>0</span>
            </div>
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div
                className="relative flex flex-1 items-end border-b border-zinc-200 dark:border-zinc-700"
                role="img"
                aria-label={`${title}. ${series.map((s, i) => `${s.name}: ${formatNumber(points.reduce((a, p) => a + p.values[i], 0))}`).join(", ")} in total. Use "Show as table" for every value.`}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-zinc-100 dark:border-zinc-800" aria-hidden />
                <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-zinc-100 dark:border-zinc-800" aria-hidden />
                {points.map((p, i) => (
                  <div
                    key={p.bucket}
                    tabIndex={0}
                    aria-label={`${p.bucket}: ${series.map((s, si) => `${s.name} ${p.values[si]}`).join(", ")}`}
                    onPointerEnter={() => setActive(i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] focus:outline-none focus-visible:bg-indigo-50 dark:focus-visible:bg-indigo-500/10"
                  >
                    {p.values.map((v, si) => (
                      <span
                        key={si}
                        aria-hidden
                        className={`block max-w-[24px] flex-1 rounded-t-[4px] ${SERIES[series[si].color].bg} ${active === null || active === i ? "" : "opacity-40"}`}
                        style={{ height: v > 0 ? `max(2px, ${(v / top) * 100}%)` : 0 }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex h-4 text-xs text-zinc-400" aria-hidden>
                {points.map((p, i) => (
                  <span key={p.bucket} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
                    {i % labelEvery === 0 ? shortDate(p.bucket, unit) : ""}
                  </span>
                ))}
              </div>
              {active !== null && points[active] && (
                <div
                  role="status"
                  className="pointer-events-none absolute top-0 z-10 min-w-[7rem] rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                  style={{ left: `min(calc(${((active + 0.5) / points.length) * 100}% + 8px), calc(100% - 8rem))` }}
                >
                  <div className="text-zinc-500">{unit === "day" ? points[active].bucket : `Week of ${points[active].bucket}`}</div>
                  {series.map((s, si) => (
                    <div key={s.name} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-1 text-zinc-500">
                        <span className={`inline-block h-0.5 w-3 ${SERIES[s.color].bg}`} aria-hidden />
                        {s.name}
                      </span>
                      <strong className="tabular-nums text-zinc-900 dark:text-zinc-50">{formatNumber(points[active].values[si])}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}

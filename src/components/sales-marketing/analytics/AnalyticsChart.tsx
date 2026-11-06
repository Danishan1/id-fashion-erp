"use client";

import { formatValue, type ReportResult } from "./analytics-ui";

/**
 * Phase 17 — a small, dependency-free SVG chart for report results: a line
 * per metric over periods, horizontal bars per dimension value, or a funnel.
 * Values with different units are never drawn on one axis: only metrics
 * sharing the first metric's unit are plotted (the table shows all).
 */

const PALETTE = ["#4f46e5", "#0891b2", "#d97706", "#16a34a", "#db2777", "#7c3aed"];

export function AnalyticsChart({ result, kind, height = 220 }: { result: ReportResult; kind?: "line" | "bar" | "funnel"; height?: number }) {
  const metrics = result.columns.filter((c) => c.kind === "metric");
  const dims = result.columns.filter((c) => c.kind === "dimension");
  const resolved = kind ?? (dims[0]?.key === "period" ? "line" : result.dataset.key === "funnel" && !dims.length ? "funnel" : dims.length ? "bar" : null);
  if (!resolved || !metrics.length) return null;
  if (resolved === "funnel") return <Funnel result={result} />;
  if (!result.rows.length) return <p className="py-6 text-center text-sm text-zinc-500">Nothing to chart for this period.</p>;
  const unit = metrics[0].unit;
  const plotted = metrics.filter((m) => m.unit === unit).slice(0, 4);
  const label = (r: (typeof result.rows)[number]) => (dims[0] ? (r.labels[dims[0].key] ?? r.keys[dims[0].key] ?? "Not set") : "Total");

  if (resolved === "bar") {
    const rows = result.rows.slice(0, 15);
    const m = plotted[0];
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.values[m.key] ?? 0)));
    return (
      <figure aria-label={`${m.label} by ${dims[0]?.label ?? ""}`} className="space-y-1.5">
        {rows.map((r, i) => {
          const v = r.values[m.key];
          return (
            <div key={i} className="grid grid-cols-[minmax(0,12rem)_minmax(2.5rem,1fr)_auto] items-center gap-2 text-xs">
              <span className="truncate text-zinc-600 dark:text-zinc-300" title={label(r)}>
                {label(r)}
              </span>
              <div className="h-3 rounded bg-zinc-100 dark:bg-zinc-800">
                <div className="h-3 rounded" style={{ width: `${v === null ? 0 : (Math.abs(v) / max) * 100}%`, background: PALETTE[0] }} />
              </div>
              <span className="tabular-nums text-zinc-700 dark:text-zinc-200">{formatValue(v, m.unit)}</span>
            </div>
          );
        })}
        <figcaption className="pt-1 text-xs text-zinc-500">{m.label}</figcaption>
      </figure>
    );
  }

  // Line chart over periods.
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const points = result.rows;
  const all = points.flatMap((r) => plotted.map((m) => r.values[m.key]).filter((v): v is number => v !== null));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const ticks = [min, min + span / 2, max];
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={plotted.map((m) => m.label).join(", ")}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
              {formatValue(Math.round(t * 100) / 100, unit)}
            </text>
          </g>
        ))}
        {points.map((r, i) =>
          i % every === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor={points.length > 1 && i === points.length - 1 ? "end" : points.length > 1 && i === 0 ? "start" : "middle"} className="fill-zinc-500 text-[10px]">
              {label(r)}
            </text>
          ) : null
        )}
        {plotted.map((m, k) => {
          const pts = points.map((r, i) => (r.values[m.key] === null ? null : `${x(i)},${y(r.values[m.key] as number)}`)).filter(Boolean);
          return (
            <g key={m.key}>
              <polyline fill="none" stroke={PALETTE[k]} strokeWidth={2} points={pts.join(" ")} />
              {points.map((r, i) =>
                r.values[m.key] === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(r.values[m.key] as number)} r={2.5} fill={PALETTE[k]}>
                    <title>{`${label(r)} — ${m.label}: ${formatValue(r.values[m.key], m.unit)}`}</title>
                  </circle>
                )
              )}
            </g>
          );
        })}
      </svg>
      {plotted.length > 1 && (
        <figcaption className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          {plotted.map((m, k) => (
            <span key={m.key} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-3 rounded" style={{ background: PALETTE[k] }} /> {m.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

function Funnel({ result }: { result: ReportResult }) {
  const metrics = result.columns.filter((c) => c.kind === "metric");
  const first = result.totals.values[metrics[0].key] ?? 0;
  return (
    <figure className="space-y-1.5" aria-label="Enquiry funnel">
      {metrics.map((m, i) => {
        const v = result.totals.values[m.key] ?? 0;
        const prev = i ? (result.totals.values[metrics[i - 1].key] ?? 0) : null;
        return (
          <div key={m.key} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2 text-xs">
            <span className="text-zinc-600 dark:text-zinc-300">{m.label.replace(/^Funnel: /, "")}</span>
            <div className="h-4 rounded bg-zinc-100 dark:bg-zinc-800">
              <div className="h-4 rounded bg-indigo-500" style={{ width: `${first ? (v / first) * 100 : 0}%` }} />
            </div>
            <span className="tabular-nums">
              {formatValue(v, "count")}
              {prev ? <span className="ml-1 text-zinc-500">({Math.round((v / prev) * 1000) / 10}% of previous)</span> : null}
            </span>
          </div>
        );
      })}
      <figcaption className="pt-1 text-xs text-zinc-500">Each enquiry counted once per stage it reached (cohort by enquiry date).</figcaption>
    </figure>
  );
}

"use client";

import { useState } from "react";

export interface ChartPoint {
  start: string;
  label: string;
  actual: number;
  target: number | null;
  forecast: number | null;
  snapshotForecast: number | null;
  current: boolean;
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const compact = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${(v / 1e3).toFixed(0)}K` : `₹${v.toFixed(0)}`);

/**
 * Booked order value by period: actual (solid), the forecast for the current
 * and coming periods (striped — an estimate, not a sale), the approved target
 * (tick) and the start-of-period snapshot forecast (dot) for past periods.
 * One axis, one hue; identity never by colour alone (legend + pattern + table).
 */
export function ForecastChart({ points, title }: { points: ChartPoint[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...points.flatMap((p) => [p.actual, p.target ?? 0, p.forecast ?? 0, p.snapshotForecast ?? 0]));
  const nice = (() => {
    const pow = 10 ** Math.floor(Math.log10(max));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= max) ?? pow * 10;
    return step * 4;
  })();
  const W = 640;
  const H = 220;
  const left = 52;
  const bottom = 26;
  const plotH = H - bottom - 8;
  const band = (W - left - 8) / points.length;
  const barW = Math.min(24, band * 0.45);
  const y = (v: number) => 8 + plotH - (v / nice) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * nice);
  const barPath = (x: number, top: number, w: number) => {
    const h = 8 + plotH - top;
    if (h <= 0) return "";
    const r = Math.min(4, h, w / 2);
    return `M${x},${8 + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${8 + plotH} Z`;
  };
  const hp = hover === null ? null : points[hover];

  return (
    <div>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <pattern id="fc-stripes" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="fill-indigo-100 dark:fill-indigo-950" />
            <rect width="2" height="5" className="fill-indigo-400 dark:fill-indigo-500" />
          </pattern>
        </defs>
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-300">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-indigo-600 dark:bg-indigo-400" /> Actual (booked)
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="12" height="12" aria-hidden="true">
              <rect width="12" height="12" rx="2" fill="url(#fc-stripes)" />
            </svg>{" "}
            Forecast (estimate)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 bg-zinc-800 dark:bg-zinc-200" /> Approved target
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" /> Forecast at period start
          </span>
          <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setTable((t) => !t)}>
            {table ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>
      {table ? (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 text-right font-medium">Actual</th>
              <th className="py-1 text-right font-medium">Forecast</th>
              <th className="py-1 text-right font-medium">Target</th>
              <th className="py-1 text-right font-medium">Forecast at start</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.start} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1">
                  {p.label}
                  {p.current ? " (selected)" : ""}
                </td>
                <td className="py-1 text-right tabular-nums">{inr(p.actual)}</td>
                <td className="py-1 text-right tabular-nums">{p.forecast === null ? "—" : inr(p.forecast)}</td>
                <td className="py-1 text-right tabular-nums">{p.target === null ? "—" : inr(p.target)}</td>
                <td className="py-1 text-right tabular-nums">{p.snapshotForecast === null ? "—" : inr(p.snapshotForecast)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}: actual, forecast and target by period`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={W - 8} y1={y(t)} y2={y(t)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
                <text x={left - 6} y={y(t) + 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
                  {compact(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const cx = left + band * i + band / 2;
              const showForecast = p.forecast !== null && p.forecast > p.actual;
              return (
                <g key={p.start} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={left + band * i} y={8} width={band} height={plotH} className={hover === i ? "fill-zinc-100/60 dark:fill-zinc-800/40" : "fill-transparent"} />
                  {showForecast && <path d={barPath(cx - barW / 2, y(p.forecast!), barW)} fill="url(#fc-stripes)" />}
                  {p.actual > 0 && <path d={barPath(cx - barW / 2, y(p.actual), barW)} className="fill-indigo-600 dark:fill-indigo-400" />}
                  {p.target !== null && <line x1={cx - barW / 2 - 5} x2={cx + barW / 2 + 5} y1={y(p.target)} y2={y(p.target)} className="stroke-zinc-800 dark:stroke-zinc-200" strokeWidth={2} strokeLinecap="round" />}
                  {p.snapshotForecast !== null && <circle cx={cx + barW / 2 + 9} cy={y(p.snapshotForecast)} r={4} className="fill-amber-500 stroke-white dark:stroke-zinc-900" strokeWidth={2} />}
                  <text x={cx} y={H - 8} textAnchor="middle" className={`text-[10px] ${p.current ? "fill-zinc-900 font-semibold dark:fill-zinc-50" : "fill-zinc-500"}`}>
                    {p.label}
                  </text>
                </g>
              );
            })}
          </svg>
          {hp && (
            <div className="pointer-events-none absolute top-2 right-2 rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              <div className="font-semibold">{hp.label}</div>
              <div>Actual: {inr(hp.actual)}</div>
              {hp.forecast !== null && <div>Forecast: {inr(hp.forecast)}</div>}
              {hp.target !== null && <div>Target: {inr(hp.target)}</div>}
              {hp.snapshotForecast !== null && <div>Forecast at start: {inr(hp.snapshotForecast)}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDateTime } from "@/lib/date-format";
import { Badge, CARD, selectClass } from "../performance/performance-ui";
import { inr } from "./ForecastClient";

interface Err {
  forecast: number;
  actual: number;
  error: number;
  absoluteError: number;
  percentError: number | null;
}
interface SnapshotRow {
  id: string;
  kind: "MANUAL" | "AUTO";
  periodLabel: string;
  takenAt: string;
  late: boolean;
  note: string | null;
  by: string;
  focus: string;
  forecast: number | null;
  trend: number | null;
  target: number | null;
  ended: boolean;
  actual: number | null;
  accuracy: { pipeline: Err; trend: Err | null } | null;
}
interface Summary {
  periods: number;
  mae: number | null;
  wape: number | null;
  bias: number | null;
}
interface Accuracy {
  focus: string;
  pipeline: Summary;
  trend: Summary;
  note: string;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);

function SummaryCard({ title, s }: { title: string; s: Summary }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="font-medium">{title}</div>
      {s.periods === 0 ? (
        <p className="mt-1 text-xs text-zinc-500">No ended periods yet.</p>
      ) : (
        <dl className="mt-1 grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-zinc-500">Mean abs. error</dt>
            <dd className="text-base font-semibold tabular-nums">{inr(s.mae)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">WAPE</dt>
            <dd className="text-base font-semibold tabular-nums">{s.wape === null ? "n/a" : `${s.wape}%`}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Bias</dt>
            <dd className="text-base font-semibold tabular-nums">{pct(s.bias)}</dd>
          </div>
          <div className="col-span-3 text-zinc-500">
            Over {s.periods} period{s.periods === 1 ? "" : "s"}. WAPE = total absolute error ÷ total actual; bias above 0 = forecasts were too high.
          </div>
        </dl>
      )}
    </div>
  );
}

/** Forecast snapshots and accuracy (Phase 06). */
export function ForecastSnapshotsClient() {
  const [periodType, setPeriodType] = useState("MONTH");
  const [kind, setKind] = useState("");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: SnapshotRow[]; accuracy: Accuracy }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const opts = { headers: { "x-toast": "off" } };
    Promise.all([fetch(`/api/v1/sales-marketing/forecast/snapshots?periodType=${periodType}&kind=${kind}`, opts), fetch(`/api/v1/sales-marketing/forecast/accuracy?periodType=${periodType}`, opts)])
      .then(async ([a, b]) => {
        const [ra, rb] = await Promise.all([a.json().catch(() => null), b.json().catch(() => null)]);
        if (cancelled) return;
        if (!a.ok || !b.ok) setState({ kind: "error", message: ra?.error?.message ?? rb?.error?.message ?? "Could not load snapshots." });
        else setState({ kind: "ready", rows: ra.data, accuracy: rb.data });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [periodType, kind, retry]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Period type" value={periodType} onChange={(e) => (setState({ kind: "loading" }), setPeriodType(e.target.value))} className={selectClass}>
          <option value="MONTH">Months</option>
          <option value="QUARTER">Quarters</option>
          <option value="YEAR">Years</option>
        </select>
        <select aria-label="Kind" value={kind} onChange={(e) => (setState({ kind: "loading" }), setKind(e.target.value))} className={selectClass}>
          <option value="">Automatic &amp; manual</option>
          <option value="AUTO">Automatic only</option>
          <option value="MANUAL">Manual only</option>
        </select>
      </div>
      {state.kind === "loading" && <LoadingState />}
      {state.kind === "error" && <ErrorState message={state.message} onRetry={() => (setState({ kind: "loading" }), setRetry((r) => r + 1))} />}
      {state.kind === "ready" && (
        <>
          <section className={CARD} aria-label="Accuracy">
            <h2 className="text-sm font-semibold">Forecast accuracy · {state.accuracy.focus}</h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <SummaryCard title="Pipeline method" s={state.accuracy.pipeline} />
              <SummaryCard title="Trend method" s={state.accuracy.trend} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">{state.accuracy.note}</p>
          </section>
          <section className={`${CARD} overflow-x-auto`} aria-label="Snapshots">
            {state.rows.length === 0 ? (
              <p className="text-sm text-zinc-500">No snapshots yet. One is taken automatically at the start of each period (when the background worker runs), and you can save one from the Forecast page.</p>
            ) : (
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                    <th className="py-1.5 font-medium">Period</th>
                    <th className="py-1.5 font-medium">Taken</th>
                    <th className="py-1.5 text-right font-medium">Forecast then</th>
                    <th className="py-1.5 text-right font-medium">Trend then</th>
                    <th className="py-1.5 text-right font-medium">Actual</th>
                    <th className="py-1.5 text-right font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((s) => (
                    <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="py-1.5">
                        <Link href={`/sales-marketing/forecast/snapshots/${s.id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                          {s.periodLabel}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <Badge tone={s.kind === "AUTO" ? "indigo" : "zinc"}>{s.kind === "AUTO" ? "Automatic" : "Manual"}</Badge>
                          {s.late && <Badge tone="amber">Late</Badge>}
                        </div>
                      </td>
                      <td className="py-1.5 text-xs">
                        {formatDateTime(s.takenAt)}
                        <div className="text-zinc-500">
                          {s.by}
                          {s.note ? ` — ${s.note}` : ""}
                        </div>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{inr(s.forecast)}</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(s.trend)}</td>
                      <td className="py-1.5 text-right tabular-nums">{s.ended ? inr(s.actual) : <span className="text-xs text-zinc-400">Period not ended</span>}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {s.accuracy ? (
                          <>
                            {inr(s.accuracy.pipeline.error)}
                            <div className="text-xs text-zinc-500">{pct(s.accuracy.pipeline.percentError)}</div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

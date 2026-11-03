"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/date-format";
import type { SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { Badge, CARD, PeriodPicker, selectClass } from "../performance/performance-ui";
import { ForecastChart, type ChartPoint } from "./ForecastChart";

export const inr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export interface ForecastRowView {
  key: string;
  name: string;
  actual: number;
  pipeline: { state: string; weightedPipeline: number; unweightedPipeline: number; items: number; forecast: number; overdueItems: number; overdueWeighted: number };
  trend: { available: boolean; reason: string | null; value: number | null; basis: { label: string; value: number }[] };
  comparison: { target: number | null; gap: number | null; percent: number | null; stillNeeded: number | null; coverage: number | null };
  targetId: string | null;
}
interface Item {
  source: "QUOTATION" | "OPPORTUNITY";
  id: string;
  number: string;
  label: string;
  customer: string;
  status: string;
  value: number;
  adjustedProbability: number;
  probabilitySource: "OPPORTUNITY" | "QUOTATION_DEFAULT";
  adjustedDate: string;
  weighted: number;
  overdue: boolean;
  stale: boolean;
  inPeriod: boolean;
  rep: string | null;
  territory: string | null;
  opportunityNumber?: string | null;
  href: string | null;
}
interface Excluded {
  source: string;
  id: string;
  number: string;
  label: string;
  value: number | null;
  reason: string;
  reasonLabel: string;
  detail?: string;
  rep: string | null;
}
export interface ForecastView {
  period: { type: SalesTargetPeriodTypeKey; start: string; end: string; label: string };
  progress: { state: string; totalDays: number; elapsedDays: number; remainingDays: number };
  settings: { probabilityApproved: number; probabilityIssued: number; probabilityAccepted: number; trendLookback: number; staleDays: number };
  viewAll: boolean;
  company: ForecastRowView | null;
  me: ForecastRowView | null;
  reps: ForecastRowView[];
  teams: ForecastRowView[];
  territories: ForecastRowView[];
  items: Item[];
  excluded: Excluded[];
  warnings: { key: string; severity: "info" | "warning"; message: string }[];
  chart: ChartPoint[];
  calculatedAt: string;
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</div>
      {note && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{note}</div>}
    </div>
  );
}

export function RowsTable({ rows, empty }: { rows: ForecastRowView[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <th className="py-1.5 font-medium">Name</th>
            <th className="py-1.5 text-right font-medium">Booked so far</th>
            <th className="py-1.5 text-right font-medium">Weighted pipeline</th>
            <th className="py-1.5 text-right font-medium">Forecast</th>
            <th className="py-1.5 text-right font-medium">Trend estimate</th>
            <th className="py-1.5 text-right font-medium">Target</th>
            <th className="py-1.5 text-right font-medium">Forecast vs target</th>
            <th className="py-1.5 text-right font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="py-1.5">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(r.actual)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {inr(r.pipeline.weightedPipeline)}
                <div className="text-xs text-zinc-500">{r.pipeline.items} item{r.pipeline.items === 1 ? "" : "s"}</div>
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums">{inr(r.pipeline.forecast)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.trend.available ? inr(r.trend.value) : <span className="text-xs text-zinc-400">Not enough history</span>}</td>
              <td className="py-1.5 text-right tabular-nums">
                {r.targetId ? (
                  <Link href={`/sales-marketing/targets/${r.targetId}`} className="text-indigo-700 hover:underline dark:text-indigo-300">
                    {r.comparison.target === null ? "Not approved" : inr(r.comparison.target)}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.comparison.gap === null ? (
                  "—"
                ) : (
                  <>
                    <span className={r.comparison.gap < 0 ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-400"}>
                      {r.comparison.gap < 0 ? `${inr(-r.comparison.gap)} short` : `${inr(r.comparison.gap)} over`}
                    </span>
                    {r.comparison.percent !== null && <div className="text-xs text-zinc-500">{r.comparison.percent}% of target</div>}
                  </>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">{r.comparison.coverage === null ? "—" : `${r.comparison.coverage}×`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sales & Marketing → Forecast (Phase 06). Live, in the viewer's scope; estimates are never shown as sales. */
export function ForecastClient({ fiscalStartMonth, today, initial, canSnapshot }: { fiscalStartMonth: number; today: string; initial: { periodType: SalesTargetPeriodTypeKey; periodStart: string }; canSnapshot: boolean }) {
  const [period, setPeriod] = useState(initial);
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; f: ForecastView }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<"reps" | "teams" | "territories">("reps");
  const [itemFilter, setItemFilter] = useState<"period" | "all" | "excluded">("period");
  const [snapshot, setSnapshot] = useState<{ note: string; busy: boolean; error: string | null; done: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams(period);
    window.history.replaceState(null, "", `?${qs}`);
    fetch(`/api/v1/sales-marketing/forecast?${qs}`, { headers: { "x-toast": "off" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setState({ kind: "error", message: body?.error?.message ?? "Could not load the forecast." });
        else setState({ kind: "ready", f: body.data });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [period, retry]);

  const f = state.kind === "ready" ? state.f : null;
  const focus = f ? (f.company ?? f.me) : null;
  const items = f ? (itemFilter === "period" ? f.items.filter((i) => i.inPeriod) : f.items) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodPicker {...period} fiscalStartMonth={fiscalStartMonth} today={today} onChange={(p) => (setState({ kind: "loading" }), setPeriod(p))} />
        <div className="flex flex-wrap gap-2">
          <Link href="/sales-marketing/forecast/scenarios" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            What-if scenarios
          </Link>
          <Link href="/sales-marketing/forecast/snapshots" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Snapshots &amp; accuracy
          </Link>
          {canSnapshot && f && f.progress.state !== "ENDED" && (
            <Button size="sm" onClick={() => setSnapshot({ note: "", busy: false, error: null, done: null })}>
              Save snapshot
            </Button>
          )}
        </div>
      </div>

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "error" && <ErrorState message={state.message} onRetry={() => (setState({ kind: "loading" }), setRetry((r) => r + 1))} />}
      {f && (
        <>
          <section className={CARD} aria-label="Forecast overview">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {f.company ? "Company" : "You"} · {f.period.label} · booked order value (before GST)
              </h2>
              <span className="text-xs text-zinc-500">
                {formatDate(f.period.start)} – {formatDate(f.period.end)} · {f.progress.state === "CURRENT" ? `day ${f.progress.elapsedDays} of ${f.progress.totalDays}` : f.progress.state === "UPCOMING" ? "not started" : "ended"}
              </span>
            </div>
            {focus ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Figure label="Booked so far (actual)" value={inr(focus.actual)} />
                <Figure label="Weighted pipeline" value={inr(focus.pipeline.weightedPipeline)} note={`${focus.pipeline.items} open items, ${inr(focus.pipeline.unweightedPipeline)} unweighted`} />
                <Figure label="Forecast (pipeline)" value={inr(focus.pipeline.forecast)} note="Booked + weighted pipeline" />
                <Figure label="Trend estimate" value={focus.trend.available ? inr(focus.trend.value) : "—"} note={focus.trend.available ? `Average of ${focus.trend.basis.map((b) => b.label).join(", ")}` : "Not enough history"} />
                <Figure label="Approved target" value={inr(focus.comparison.target)} note={focus.comparison.percent !== null ? `Forecast = ${focus.comparison.percent}% of target` : undefined} />
                <Figure label="Still needed / coverage" value={inr(focus.comparison.stillNeeded)} note={focus.comparison.coverage !== null ? `Weighted pipeline covers ${focus.comparison.coverage}×` : undefined} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">You don&apos;t have Sales &amp; Marketing access as a rep, so there is nothing to forecast for you.</p>
            )}
            <p className="mt-3 text-xs text-zinc-500">
              A forecast is an estimate, not an order or revenue. Pipeline = open quotations (probability from a linked opportunity, else the settings defaults: approved {f.settings.probabilityApproved}%, issued {f.settings.probabilityIssued}%, accepted {f.settings.probabilityAccepted}%) and open CRM opportunities (their own probability) expected in the rest of the period — each counted once. Trend = average of the last {f.settings.trendLookback} complete periods. Calculated live {formatDateTime(f.calculatedAt)}.
            </p>
          </section>

          {f.warnings.length > 0 && (
            <section className={`${CARD} space-y-1`} aria-label="Data quality">
              <h2 className="text-sm font-semibold">Things that affect this forecast</h2>
              <ul className="space-y-1 text-sm">
                {f.warnings.map((w) => (
                  <li key={w.key} className="flex gap-2">
                    <Badge tone={w.severity === "warning" ? "amber" : "zinc"}>{w.severity === "warning" ? "Check" : "Note"}</Badge>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={CARD}>
            <ForecastChart points={f.chart} title={`${f.company ? "Company" : "Your"} booked order value by ${f.period.type.toLowerCase()}`} />
          </section>

          <section className={CARD} aria-label="Breakdown">
            <div className="mb-2 flex flex-wrap gap-1" role="tablist">
              {(
                [
                  ["reps", `Sales reps (${f.reps.length})`],
                  ["teams", `Teams (${f.teams.length})`],
                  ["territories", `Territories (${f.territories.length})`],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded px-2.5 py-1 text-xs font-medium ${tab === k ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                  {label}
                </button>
              ))}
            </div>
            <RowsTable rows={f[tab]} empty={tab === "teams" ? "No teams in your view (teams come from the CRM reporting tree)." : tab === "territories" ? "No territories in your view." : "No reps in your view."} />
          </section>

          <section className={CARD} aria-label="Pipeline">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Pipeline behind the forecast</h2>
              <select aria-label="Show" value={itemFilter} onChange={(e) => setItemFilter(e.target.value as typeof itemFilter)} className={selectClass}>
                <option value="period">Counted in {f.period.label}</option>
                <option value="all">All open items</option>
                <option value="excluded">Left out ({f.excluded.length})</option>
              </select>
            </div>
            {itemFilter === "excluded" ? (
              f.excluded.length === 0 ? (
                <p className="text-sm text-zinc-500">Nothing left out.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                      <th className="py-1.5 font-medium">Record</th>
                      <th className="py-1.5 font-medium">Why</th>
                      <th className="py-1.5 font-medium">Rep</th>
                      <th className="py-1.5 text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.excluded.map((e) => (
                      <tr key={`${e.source}-${e.id}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="py-1.5">
                          {e.number} <span className="text-xs text-zinc-500">{e.label}</span>
                        </td>
                        <td className="py-1.5">
                          {e.reasonLabel}
                          {e.detail ? <span className="text-xs text-zinc-500"> · {e.detail}</span> : null}
                        </td>
                        <td className="py-1.5">{e.rep ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{inr(e.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : items.length === 0 ? (
              <p className="text-sm text-zinc-500">No open pipeline here.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                      <th className="py-1.5 font-medium">Record</th>
                      <th className="py-1.5 font-medium">Customer</th>
                      <th className="py-1.5 font-medium">Rep</th>
                      <th className="py-1.5 font-medium">Expected</th>
                      <th className="py-1.5 text-right font-medium">Value</th>
                      <th className="py-1.5 text-right font-medium">Probability</th>
                      <th className="py-1.5 text-right font-medium">Weighted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={`${i.source}-${i.id}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="py-1.5">
                          {i.href ? (
                            <Link href={i.href} className="text-indigo-700 hover:underline dark:text-indigo-300">
                              {i.number}
                            </Link>
                          ) : (
                            i.number
                          )}
                          <div className="text-xs text-zinc-500">
                            {i.source === "QUOTATION" ? `Quotation · ${i.status.toLowerCase().replace(/_/g, " ")}` : "Opportunity"}
                            {i.opportunityNumber && i.source === "QUOTATION" ? ` · for ${i.opportunityNumber}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5">{i.customer}</td>
                        <td className="py-1.5">{i.rep ?? "—"}</td>
                        <td className="py-1.5">
                          {formatDate(i.adjustedDate)}
                          {i.overdue && <span className="ml-1"><Badge tone="amber">Overdue</Badge></span>}
                          {i.stale && <span className="ml-1"><Badge>Stale</Badge></span>}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{inr(i.value)}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {i.adjustedProbability}%<div className="text-xs text-zinc-500">{i.probabilitySource === "OPPORTUNITY" ? "opportunity" : "default"}</div>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{inr(i.weighted)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {snapshot && f && (
        <Modal open onClose={() => setSnapshot(null)} title={`Save a snapshot of ${f.period.label}`}>
          {snapshot.done ? (
            <div className="space-y-3 text-sm">
              <p>Saved. It keeps this forecast exactly as it is now, so it can be compared with the actual result when the period ends.</p>
              <div className="flex justify-end gap-2">
                <Link href={`/sales-marketing/forecast/snapshots/${snapshot.done}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Open snapshot
                </Link>
                <Button variant="secondary" onClick={() => setSnapshot(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                setSnapshot({ ...snapshot, busy: true, error: null });
                const res = await fetch("/api/v1/sales-marketing/forecast/snapshots", { method: "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: JSON.stringify({ periodType: f.period.type, periodStart: f.period.start, note: snapshot.note }) });
                if (!res.ok) return setSnapshot({ ...snapshot, busy: false, error: await getApiErrorMessage(res) });
                setSnapshot({ ...snapshot, busy: false, done: (await res.json()).data.id });
              }}
            >
              <p className="text-sm text-zinc-600 dark:text-zinc-300">The snapshot covers the whole company and is never changed afterwards. One is also taken automatically at the start of every period.</p>
              <FormField label="Note (optional)" htmlFor="snap-note">
                <input id="snap-note" maxLength={500} value={snapshot.note} onChange={(e) => setSnapshot({ ...snapshot, note: e.target.value })} className={textInputClass()} />
              </FormField>
              {snapshot.error && <p className="text-sm text-red-600 dark:text-red-400">{snapshot.error}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setSnapshot(null)}>
                  Close
                </Button>
                <Button type="submit" isLoading={snapshot.busy}>
                  Save snapshot
                </Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDate, formatDateTime } from "@/lib/date-format";
import type { Period } from "@/modules/sales-marketing/performance/performance-periods";
import { SALES_TARGET_METRICS, type MetricUnit, type SalesTargetMetricKey, type SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { AttainmentCell, Badge, CARD, PeriodPicker, fmt, gapText, selectClass, type AttainmentView } from "./performance-ui";

type Row = AttainmentView & { documents: number; targetId: string | null; rank: number };
interface Board {
  metric: SalesTargetMetricKey;
  metricLabel: string;
  metricDefinition: string;
  dateBasis: string;
  unit: MetricUnit;
  period: Period;
  progress: { state: string; totalDays: number; elapsedDays: number; remainingDays: number };
  viewAll: boolean;
  me: (Row & { userId: string; name: string }) | null;
  reps: (Row & { userId: string; name: string; isMe: boolean })[];
  teams: (Row & { managerId: string; name: string; members: number; isMine: boolean })[];
  territories: (Row & { territoryId: string; name: string; active: boolean })[];
  company: (AttainmentView & { documents: number; targetId: string | null; noRep: { value: number; documents: number }; noTerritory: { value: number; documents: number } }) | null;
  calculatedAt: string;
}
interface Drill {
  title: string;
  query: Record<string, string>;
}
interface DocumentsResult {
  label: string;
  unit: MetricUnit;
  documents: { id: string; kind: string; number: string; date: string; customer: string; rep: string | null; territory: string | null; value: number; status: string; href: string | null }[] | null;
  truncated: boolean;
  reason: string | null;
}

function BoardTable<T extends Row>({ title, rows, unit, name, onDrill, empty }: { title: string; rows: T[]; unit: MetricUnit; name: (r: T) => React.ReactNode; onDrill: (r: T) => void; empty: string }) {
  return (
    <section className={`${CARD} overflow-x-auto`} aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="w-10 py-1.5 font-medium">#</th>
              <th className="py-1.5 font-medium">Name</th>
              <th className="py-1.5 text-right font-medium">Actual</th>
              <th className="py-1.5 text-right font-medium">Target</th>
              <th className="py-1.5 pl-3 font-medium">Gap</th>
              <th className="py-1.5 font-medium">Attainment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1.5 text-zinc-500">{r.rank}</td>
                <td className="py-1.5">{name(r)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(unit, r.actual)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.targetId ? (
                    <Link href={`/sales-marketing/targets/${r.targetId}`} className="text-indigo-700 hover:underline dark:text-indigo-300">
                      {r.target === null ? "Not approved" : fmt(unit, r.target)}
                    </Link>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="py-1.5 pl-3 text-xs">{gapText(unit, r.gap)}</td>
                <td className="py-1.5">
                  <AttainmentCell a={r} />
                </td>
                <td className="py-1.5 text-right">
                  <Button size="xs" variant="secondary" disabled={r.documents === 0} onClick={() => onDrill(r)}>
                    {r.documents} doc{r.documents === 1 ? "" : "s"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Team performance: rep ranking, teams, territories and (view_all) the company, with drill-down to the documents behind each figure. */
export function PerformanceBoardClient({ fiscalStartMonth, today, initial }: { fiscalStartMonth: number; today: string; initial: { metric: SalesTargetMetricKey; periodType: SalesTargetPeriodTypeKey; periodStart: string } }) {
  const [metric, setMetric] = useState<SalesTargetMetricKey>(initial.metric);
  const [period, setPeriod] = useState({ periodType: initial.periodType, periodStart: initial.periodStart });
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; board: Board }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [docs, setDocs] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: DocumentsResult } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ metric, ...period });
    window.history.replaceState(null, "", `?${qs}`);
    fetch(`/api/v1/sales-marketing/performance/board?${qs}`, { headers: { "x-toast": "off" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setState({ kind: "error", message: body?.error?.message ?? "Could not load the figures." });
        else setState({ kind: "ready", board: body.data });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [metric, period, retry]);

  const openDrill = (d: Drill) => {
    setDrill(d);
    setDocs({ kind: "loading" });
    const qs = new URLSearchParams({ metric, ...period, ...d.query });
    fetch(`/api/v1/sales-marketing/performance/documents?${qs}`, { headers: { "x-toast": "off" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        setDocs(res.ok ? { kind: "ready", data: body.data } : { kind: "error", message: body?.error?.message ?? "Could not load the documents." });
      })
      .catch(() => setDocs({ kind: "error", message: "Could not reach the server." }));
  };

  const b = state.kind === "ready" ? state.board : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Metric" value={metric} onChange={(e) => (setState({ kind: "loading" }), setMetric(e.target.value as SalesTargetMetricKey))} className={selectClass}>
          {SALES_TARGET_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <PeriodPicker {...period} fiscalStartMonth={fiscalStartMonth} today={today} onChange={(p) => (setState({ kind: "loading" }), setPeriod(p))} />
      </div>

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "error" && <ErrorState message={state.message} onRetry={() => (setState({ kind: "loading" }), setRetry((r) => r + 1))} />}
      {b && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <section className={CARD} aria-label="My figures">
              <h2 className="text-sm font-semibold">Me · {b.period.label}</h2>
              {b.me ? (
                <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-zinc-500">Actual</div>
                    <button type="button" className="text-xl font-semibold tabular-nums text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => openDrill({ title: "My documents", query: { repId: b.me!.userId } })}>
                      {fmt(b.unit, b.me.actual)}
                    </button>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Target</div>
                    <div className="text-xl font-semibold tabular-nums">{b.me.target === null ? "—" : fmt(b.unit, b.me.target)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Attainment</div>
                    <AttainmentCell a={b.me} />
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">You don&apos;t have Sales &amp; Marketing access as a rep.</p>
              )}
            </section>
            <section className={CARD} aria-label="Period">
              <h2 className="text-sm font-semibold">{b.metricLabel}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {formatDate(b.period.start)} – {formatDate(b.period.end)} ·{" "}
                {b.progress.state === "CURRENT" ? `day ${b.progress.elapsedDays} of ${b.progress.totalDays}` : b.progress.state === "UPCOMING" ? "not started" : "ended"}. {b.metricDefinition} Date: {b.dateBasis.toLowerCase()}.
              </p>
              {b.company && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    Company: <strong className="tabular-nums">{fmt(b.unit, b.company.actual)}</strong>
                    {b.company.target !== null && <span className="text-zinc-500"> of {fmt(b.unit, b.company.target)}</span>}
                  </span>
                  {b.company.percent !== null && <Badge tone="indigo">{b.company.percent}%</Badge>}
                  <Button size="xs" variant="secondary" disabled={!b.company.documents} onClick={() => openDrill({ title: "Whole company", query: { bucket: "company" } })}>
                    {b.company.documents} doc{b.company.documents === 1 ? "" : "s"}
                  </Button>
                  {b.company.noRep.documents > 0 && (
                    <Button size="xs" variant="secondary" onClick={() => openDrill({ title: "No sales rep", query: { bucket: "rep" } })}>
                      No rep: {fmt(b.unit, b.company.noRep.value)}
                    </Button>
                  )}
                  {b.company.noTerritory.documents > 0 && (
                    <Button size="xs" variant="secondary" onClick={() => openDrill({ title: "No territory", query: { bucket: "territory" } })}>
                      No territory: {fmt(b.unit, b.company.noTerritory.value)}
                    </Button>
                  )}
                </div>
              )}
            </section>
          </div>

          <BoardTable
            title="Sales reps"
            rows={b.reps}
            unit={b.unit}
            empty="No reps in your view."
            name={(r) => (
              <span>
                {r.name}
                {r.isMe && <span className="ml-1 text-xs text-zinc-500">(you)</span>}
              </span>
            )}
            onDrill={(r) => openDrill({ title: r.name, query: { repId: r.userId } })}
          />
          <BoardTable title="Teams" rows={b.teams} unit={b.unit} empty="No teams in your view. Teams come from the CRM reporting tree (Employees → reporting lines)." name={(r) => <span>{r.name} <span className="text-xs text-zinc-500">· {r.members} people</span></span>} onDrill={(r) => openDrill({ title: r.name, query: { teamManagerId: r.managerId } })} />
          <BoardTable
            title="Territories"
            rows={b.territories}
            unit={b.unit}
            empty={b.viewAll ? "No territories yet." : "You aren't assigned to a territory."}
            name={(r) => (
              <span>
                {r.name}
                {!r.active && <span className="ml-1 text-xs text-zinc-500">(inactive)</span>}
              </span>
            )}
            onDrill={(r) => openDrill({ title: r.name, query: { territoryId: r.territoryId } })}
          />
          <p className="text-xs text-zinc-500">
            Calculated live {formatDateTime(b.calculatedAt)}. Each order is credited to one rep and at most one territory (stored on the order); a team is its manager plus everyone below them in the CRM reporting tree, so team totals never count an order twice.
          </p>
        </>
      )}

      {drill && docs && (
        <Modal open onClose={() => setDrill(null)} title={`${drill.title} · ${b?.metricLabel ?? ""}`} maxWidthClass="max-w-4xl" closeOnBackdropClick>
          {docs.kind === "loading" && <LoadingState />}
          {docs.kind === "error" && <ErrorState message={docs.message} />}
          {docs.kind === "ready" &&
            (docs.data.documents === null ? (
              <p className="text-sm text-zinc-500">{docs.data.reason}</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                      <th className="py-1.5 font-medium">Document</th>
                      <th className="py-1.5 font-medium">Date</th>
                      <th className="py-1.5 font-medium">Customer</th>
                      <th className="py-1.5 font-medium">Rep</th>
                      <th className="py-1.5 font-medium">Territory</th>
                      <th className="py-1.5 text-right font-medium">Counts as</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.data.documents.map((d) => (
                      <tr key={d.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="py-1.5">
                          {d.href ? (
                            <Link href={d.href} className="text-indigo-700 hover:underline dark:text-indigo-300">
                              {d.number}
                            </Link>
                          ) : (
                            d.number
                          )}
                          <div className="text-xs text-zinc-500">{d.status.toLowerCase().replace(/_/g, " ")}</div>
                        </td>
                        <td className="py-1.5">{d.date ? formatDate(d.date) : "—"}</td>
                        <td className="py-1.5">{d.customer}</td>
                        <td className="py-1.5">{d.rep ?? "—"}</td>
                        <td className="py-1.5">{d.territory ?? "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(docs.data.unit, d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="py-1.5 text-right text-xs text-zinc-500">
                        Total{docs.data.truncated ? " (first 500)" : ""}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{fmt(docs.data.unit, Math.round(docs.data.documents.reduce((s, d) => s + d.value, 0) * 100) / 100)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ))}
        </Modal>
      )}
    </div>
  );
}

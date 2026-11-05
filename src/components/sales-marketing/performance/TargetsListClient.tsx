"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDateTime } from "@/lib/date-format";
import { periodContaining } from "@/modules/sales-marketing/performance/performance-periods";
import { REVISION_STATUS_LABELS, SALES_TARGET_METRICS, SALES_TARGET_SCOPES, type MetricUnit, type SalesTargetPeriodTypeKey, type SalesTargetRevisionStatusKey } from "@/modules/sales-marketing/performance/performance-registry";
import { AttainmentCell, Badge, CARD, PeriodPicker, fmt, gapText, selectClass, type AttainmentView } from "./performance-ui";

interface Row extends AttainmentView {
  id: string;
  scopeLabel: string;
  subject: string;
  metricLabel: string;
  unit: MetricUnit;
  periodLabel: string;
  archived: boolean;
  status: SalesTargetRevisionStatusKey;
  openRevisionStatus: SalesTargetRevisionStatusKey | null;
}

const STATUS_TONE: Record<string, "green" | "amber" | "zinc"> = { APPROVED: "green", PENDING_APPROVAL: "amber", DRAFT: "zinc" };

/** Sales targets with live attainment, filtered by period, scope, metric and status. */
export function TargetsListClient({ fiscalStartMonth, today }: { fiscalStartMonth: number; today: string }) {
  const [period, setPeriod] = useState<{ periodType: SalesTargetPeriodTypeKey; periodStart: string }>({ periodType: "MONTH", periodStart: periodContaining("MONTH", today, fiscalStartMonth).start });
  const [scope, setScope] = useState("");
  const [metric, setMetric] = useState("");
  const [status, setStatus] = useState("live");
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; rows: Row[]; truncated: boolean; calculatedAt: string }>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ periodType: period.periodType, periodStart: period.periodStart, scope, metric, status });
    fetch(`/api/v1/sales-marketing/performance/targets?${qs}`, { headers: { "x-toast": "off" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setState({ kind: "error", message: body?.error?.message ?? "Could not load targets." });
        else setState({ kind: "ready", rows: body.data, truncated: body.truncated, calculatedAt: body.calculatedAt });
      })
      .catch(() => !cancelled && setState({ kind: "error", message: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [period, scope, metric, status, retry]);

  const reload = () => setState({ kind: "loading" });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <PeriodPicker {...period} fiscalStartMonth={fiscalStartMonth} today={today} onChange={(p) => (reload(), setPeriod(p))} />
        <select aria-label="Scope" value={scope} onChange={(e) => (reload(), setScope(e.target.value))} className={selectClass}>
          <option value="">All scopes</option>
          {SALES_TARGET_SCOPES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select aria-label="Metric" value={metric} onChange={(e) => (reload(), setMetric(e.target.value))} className={selectClass}>
          <option value="">All metrics</option>
          {SALES_TARGET_METRICS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => (reload(), setStatus(e.target.value))} className={selectClass}>
          <option value="live">Not archived</option>
          <option value="approved">Approved</option>
          <option value="pending">Waiting for approval</option>
          <option value="draft">Draft only</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      {state.kind === "loading" && <LoadingState />}
      {state.kind === "error" && <ErrorState message={state.message} onRetry={() => (reload(), setRetry((r) => r + 1))} />}
      {state.kind === "ready" && (
        <div className={`${CARD} overflow-x-auto p-0`}>
          {state.rows.length === 0 ? (
            <p className="p-4 text-sm text-zinc-500">No targets for this selection.</p>
          ) : (
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 text-right font-medium">Target</th>
                  <th className="px-3 py-2 text-right font-medium">Actual</th>
                  <th className="px-3 py-2 font-medium">Gap</th>
                  <th className="px-3 py-2 font-medium">Attainment</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                    <td className="px-3 py-2">
                      <Link href={`/sales-marketing/targets/${r.id}`} className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                        {r.subject}
                      </Link>
                      <div className="text-xs text-zinc-500">{r.scopeLabel}</div>
                    </td>
                    <td className="px-3 py-2">{r.metricLabel}</td>
                    <td className="px-3 py-2">{r.periodLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.unit, r.target)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.unit, r.actual)}</td>
                    <td className="px-3 py-2 text-xs">{gapText(r.unit, r.gap)}</td>
                    <td className="px-3 py-2">
                      <AttainmentCell a={r} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        {r.archived ? <Badge>Archived</Badge> : <Badge tone={STATUS_TONE[r.status] ?? "zinc"}>{REVISION_STATUS_LABELS[r.status]}</Badge>}
                        {r.openRevisionStatus && <Badge tone="amber">Change {REVISION_STATUS_LABELS[r.openRevisionStatus].toLowerCase()}</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {state.kind === "ready" && (
        <p className="text-xs text-zinc-500">
          Actuals are calculated live from Sales Orders, quotations and invoices ({formatDateTime(state.calculatedAt)}).{state.truncated ? " Showing the first 500 targets — narrow the filters." : ""}
        </p>
      )}
    </div>
  );
}

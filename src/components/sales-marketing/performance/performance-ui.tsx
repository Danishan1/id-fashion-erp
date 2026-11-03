"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { formatDateTime } from "@/lib/date-format";
import { periodOptions } from "@/modules/sales-marketing/performance/performance-periods";
import { EVENT_LABELS, PERIOD_TYPES, formatMetricValue, type MetricUnit, type PerformanceEventType, type SalesTargetPeriodTypeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { Badge } from "../pricing/pricing-ui";

/** Shared bits of the Phase 05 screens. */

export { Badge, CARD, TextDialog, type TextDialogSpec } from "../pricing/pricing-ui";

export const selectClass = `${textInputClass()} !w-auto min-w-[9rem]`;

export const fmt = (unit: MetricUnit, v: number | null | undefined) => (v === null || v === undefined ? "—" : formatMetricValue(unit, v));
export const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`);

export interface AttainmentView {
  target: number | null;
  actual: number;
  gap: number | null;
  percent: number | null;
  expectedToDate: number | null;
  pace: "AHEAD" | "BEHIND" | "MET" | "MISSED" | null;
}

const PACE: Record<NonNullable<AttainmentView["pace"]>, { label: string; tone: "green" | "amber" | "red" }> = {
  AHEAD: { label: "On pace", tone: "green" },
  BEHIND: { label: "Behind pace", tone: "amber" },
  MET: { label: "Met", tone: "green" },
  MISSED: { label: "Missed", tone: "red" },
};

/** Attainment % with a bar (capped visually at 100 %, the number is not) and the pace badge. */
export function AttainmentCell({ a }: { a: AttainmentView }) {
  if (a.percent === null) return <span className="text-zinc-400">{a.target === null ? "No approved target" : "—"}</span>;
  const width = Math.min(100, Math.max(0, a.percent));
  const bar = a.percent >= 100 ? "bg-green-500" : a.pace === "BEHIND" || a.pace === "MISSED" ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div className="min-w-[8rem]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium tabular-nums">{pct(a.percent)}</span>
        {a.pace && <Badge tone={PACE[a.pace].tone}>{PACE[a.pace].label}</Badge>}
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800" role="progressbar" aria-valuenow={a.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Attainment">
        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** Gap in words: "₹900 to go" / "₹100 over". */
export function gapText(unit: MetricUnit, gap: number | null) {
  if (gap === null) return "—";
  if (gap > 0) return `${fmt(unit, gap)} to go`;
  if (gap < 0) return `${fmt(unit, -gap)} over`;
  return "On target";
}

/** Period type + period pickers. Periods follow the company fiscal year. */
export function PeriodPicker({
  periodType,
  periodStart,
  onChange,
  fiscalStartMonth,
  today,
  back = 12,
  ahead = 3,
}: {
  periodType: SalesTargetPeriodTypeKey;
  periodStart: string;
  onChange: (next: { periodType: SalesTargetPeriodTypeKey; periodStart: string }) => void;
  fiscalStartMonth: number;
  today: string;
  back?: number;
  ahead?: number;
}) {
  const options = periodOptions(periodType, today, fiscalStartMonth, back, ahead);
  return (
    <div className="flex flex-wrap gap-2">
      <select
        aria-label="Period type"
        value={periodType}
        onChange={(e) => {
          const t = e.target.value as SalesTargetPeriodTypeKey;
          onChange({ periodType: t, periodStart: periodOptions(t, today, fiscalStartMonth, 0, 0)[0].start });
        }}
        className={selectClass}
      >
        {PERIOD_TYPES.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      <select aria-label="Period" value={periodStart} onChange={(e) => onChange({ periodType, periodStart: e.target.value })} className={selectClass}>
        {options.map((p) => (
          <option key={p.start} value={p.start}>
            {p.label}
            {p.start <= today && today <= p.end ? " (current)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface PerformanceEvent {
  id: string;
  type: string;
  comment: string | null;
  metadata: unknown;
  at: string;
  by: string;
}

function eventDetail(e: PerformanceEvent): string | null {
  const m = (e.metadata ?? {}) as Record<string, unknown>;
  if (e.type === "REP_ASSIGNED") return `${m.user}${m.isPrimary ? " (primary)" : ""} from ${m.startDate}${m.endDate ? ` to ${m.endDate}` : ""}`;
  if (e.type === "REP_ASSIGNMENT_ENDED") return `${m.user} until ${m.endDate}`;
  if (e.type === "REP_ASSIGNMENT_REMOVED") return String(m.user ?? "");
  if (e.type === "CUSTOMER_ASSIGNED") return String(m.customer ?? "");
  if (e.type === "CUSTOMER_MOVED") return `${m.customer}${m.from ? ` (from ${m.from})` : ""}`;
  if (e.type === "CUSTOMER_REMOVED") return `${m.customer}${m.movedTo ? ` (moved to ${m.movedTo})` : ""}`;
  if (e.type === "SALES_CREDIT_CHANGED") {
    const b = (m.before ?? {}) as Record<string, string | null>;
    const a = (m.after ?? {}) as Record<string, string | null>;
    return `${b.rep ?? "no rep"} / ${b.territory ?? "no territory"} → ${a.rep ?? "no rep"} / ${a.territory ?? "no territory"}`;
  }
  if (m.revision) return `Revision ${m.revision}${typeof m.value === "number" ? ` · ${m.value.toLocaleString("en-IN")}` : ""}`;
  return null;
}

export function EventList({ events }: { events: PerformanceEvent[] }) {
  if (!events.length) return <p className="text-sm text-zinc-500">No history yet.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {events.map((e) => {
        const detail = eventDetail(e);
        return (
          <li key={e.id}>
            <span className="font-medium">{EVENT_LABELS[e.type as PerformanceEventType] ?? e.type}</span>
            {detail && <span className="text-zinc-600 dark:text-zinc-300"> · {detail}</span>}
            {e.comment && <span className="text-zinc-600 dark:text-zinc-300"> — {e.comment}</span>}
            <div className="text-xs text-zinc-500">
              {e.by} · {formatDateTime(e.at)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

/** Reps (active users with Sales & Marketing access) and active territories for pickers. */
export function usePerformanceOptions(enabled = true) {
  const [reps, setReps] = useState<Option[]>([]);
  const [territories, setTerritories] = useState<Option[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const opts = { headers: { "x-toast": "off" } };
    const get = (url: string) => fetch(url, opts).then((r) => (r.ok ? r.json() : { data: [] })).then((b) => (b.data ?? []) as Record<string, string>[]);
    Promise.all([get("/api/v1/sales-marketing/performance/reps"), get("/api/v1/sales-marketing/performance/territories/options")])
      .then(([r, t]) => {
        setReps(r.map((u) => ({ id: u.id, label: u.fullName })));
        setTerritories(t.map((x) => ({ id: x.id, label: x.name, sublabel: x.code })));
      })
      .catch(() => undefined);
  }, [enabled]);
  return { reps, territories };
}

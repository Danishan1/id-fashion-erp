import { formatDate, formatDateTime } from "@/lib/date-format";
import { Badge, CARD } from "../performance/performance-ui";

interface Err {
  error: number;
  percentError: number | null;
}
interface Row {
  key: string;
  name: string;
  actual: number;
  pipeline: { forecast: number; weightedPipeline: number; items: number };
  trend: { available: boolean; value: number | null };
  target: number | null;
  actualNow: number | null;
  accuracy: { pipeline: Err; trend: Err | null } | null;
}
export interface SnapshotDetailView {
  kind: "MANUAL" | "AUTO";
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  takenAt: string;
  late: boolean;
  note: string | null;
  by: string;
  ended: boolean;
  assumptions: { settings?: { probabilityApproved: number; probabilityIssued: number; probabilityAccepted: number; trendLookback: number } };
  company: Row | null;
  reps: Row[];
  teams: Row[];
  territories: Row[];
  items: { included: { number: string; value: number; probability: number; weighted: number; inPeriod: boolean }[]; excluded: unknown[] };
}

const inr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);

function Table({ title, rows, ended }: { title: string; rows: Row[]; ended: boolean }) {
  if (!rows.length) return null;
  return (
    <section className={`${CARD} overflow-x-auto`} aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
            <th className="py-1.5 font-medium">Name</th>
            <th className="py-1.5 text-right font-medium">Booked then</th>
            <th className="py-1.5 text-right font-medium">Forecast then</th>
            <th className="py-1.5 text-right font-medium">Trend then</th>
            <th className="py-1.5 text-right font-medium">Target then</th>
            {ended && <th className="py-1.5 text-right font-medium">Actual</th>}
            {ended && <th className="py-1.5 text-right font-medium">Error (pipeline)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              <td className="py-1.5">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(r.actual)}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(r.pipeline.forecast)}</td>
              <td className="py-1.5 text-right tabular-nums">{r.trend.available ? inr(r.trend.value) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{inr(r.target)}</td>
              {ended && <td className="py-1.5 text-right tabular-nums">{inr(r.actualNow)}</td>}
              {ended && (
                <td className="py-1.5 text-right tabular-nums">
                  {r.accuracy ? (
                    <>
                      {inr(r.accuracy.pipeline.error)} <span className="text-xs text-zinc-500">{pct(r.accuracy.pipeline.percentError)}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A stored forecast snapshot (never recalculated) with accuracy once its period has ended. */
export function ForecastSnapshotDetail({ s }: { s: SnapshotDetailView }) {
  const st = s.assumptions.settings;
  const counted = s.items.included.filter((i) => i.inPeriod);
  return (
    <div className="space-y-4">
      <section className={`${CARD} space-y-1 text-sm`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{s.periodLabel}</span>
          <Badge tone={s.kind === "AUTO" ? "indigo" : "zinc"}>{s.kind === "AUTO" ? "Automatic" : "Manual"}</Badge>
          {s.late && <Badge tone="amber">Late — taken after the period started</Badge>}
          {s.ended ? <Badge tone="green">Period ended — compared with the actual</Badge> : <Badge>Period not ended</Badge>}
        </div>
        <div className="text-xs text-zinc-500">
          {formatDate(s.periodStart)} – {formatDate(s.periodEnd)} · taken {formatDateTime(s.takenAt)} by {s.by}
          {s.note ? ` — ${s.note}` : ""}
        </div>
        {st && (
          <div className="text-xs text-zinc-500">
            Assumptions then: quotation probabilities approved {st.probabilityApproved}%, issued {st.probabilityIssued}%, accepted {st.probabilityAccepted}%; trend over {st.trendLookback} periods. {counted.length} pipeline items were counted ({inr(counted.reduce((a, i) => a + i.weighted, 0))} weighted in what you can see),{" "}
            {s.items.excluded.length} left out.
          </div>
        )}
        <p className="text-xs text-zinc-500">These figures are stored exactly as calculated at that moment and are never recalculated. &quot;Actual&quot; is booked order value now.</p>
      </section>
      {s.company && <Table title="Company" rows={[s.company]} ended={s.ended} />}
      <Table title="Sales reps" rows={s.reps} ended={s.ended} />
      <Table title="Teams" rows={s.teams} ended={s.ended} />
      <Table title="Territories" rows={s.territories} ended={s.ended} />
    </div>
  );
}

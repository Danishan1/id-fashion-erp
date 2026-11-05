import { Badge } from "../performance/performance-ui";

export interface ComparedRow {
  key: string;
  name: string;
  baseline: { forecast: number; weightedPipeline: number; trend: number | null };
  scenario: { forecast: number; weightedPipeline: number; trend: number | null };
  difference: number;
  differencePercent: number | null;
  target: number | null;
}
export interface ComparisonView {
  period: { label: string };
  calculatedAt: string;
  company: ComparedRow | null;
  me: ComparedRow | null;
  reps: ComparedRow[];
  teams: ComparedRow[];
  territories: ComparedRow[];
}

const inr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Baseline vs scenario — always marked hypothetical. */
export function ScenarioComparison({ c }: { c: ComparisonView }) {
  const rows = [...(c.company ? [{ ...c.company, name: "Whole company" }] : []), ...c.reps, ...c.teams, ...c.territories];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="amber">Hypothetical</Badge>
        <span className="text-xs text-zinc-500">{c.period.label} — nothing in CRM, quotations, orders or targets is changed.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="py-1.5 font-medium">Name</th>
              <th className="py-1.5 text-right font-medium">Baseline forecast</th>
              <th className="py-1.5 text-right font-medium">Scenario forecast</th>
              <th className="py-1.5 text-right font-medium">Difference</th>
              <th className="py-1.5 text-right font-medium">Trend: baseline → scenario</th>
              <th className="py-1.5 text-right font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-1.5">{r.name}</td>
                <td className="py-1.5 text-right tabular-nums">{inr(r.baseline.forecast)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{inr(r.scenario.forecast)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.difference > 0 ? "+" : r.difference < 0 ? "−" : ""}
                  {inr(Math.abs(r.difference))}
                  {r.differencePercent !== null && <div className="text-xs text-zinc-500">{r.differencePercent > 0 ? "+" : ""}{r.differencePercent}%</div>}
                </td>
                <td className="py-1.5 text-right text-xs tabular-nums">
                  {inr(r.baseline.trend)} → {inr(r.scenario.trend)}
                </td>
                <td className="py-1.5 text-right tabular-nums">{inr(r.target)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

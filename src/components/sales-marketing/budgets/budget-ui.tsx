"use client";

/** Shared bits of the campaign budget screens (Phase 12). */

export const ALERT_LABELS: Record<string, string> = {
  WARN_THRESHOLD: "Nearly used",
  OVER_BUDGET: "Over budget",
  OVER_ALLOCATED: "Lines over budget",
  ENDED_WITH_OPEN_COMMITMENTS: "Ended, orders open",
};

export const SPEND_KIND_LABELS = { EXPENSE: "Expense", PURCHASE_ORDER: "Purchase order", PURCHASE_INVOICE: "Purchase invoice" } as const;
export type SpendKindKey = keyof typeof SPEND_KIND_LABELS;

/** Share of the limit spent or committed. Amber from 80%, red above 100%. */
export function UsedBar({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-xs text-zinc-400">—</span>;
  const tone = percent > 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2" title={`${percent}% spent or committed`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{percent}%</span>
    </div>
  );
}

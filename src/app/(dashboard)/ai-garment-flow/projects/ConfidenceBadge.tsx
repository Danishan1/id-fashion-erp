const CONFIDENCE_META = {
  CONFIRMED_VISUALLY: {
    label: "Confirmed Visually",
    symbol: "✓", // check mark — never rely on color alone to convey meaning
    className: "bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300",
  },
  LIKELY_INFERRED: {
    label: "Likely / Inferred",
    symbol: "~",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  },
  NOT_DETERMINABLE: {
    label: "Not Determinable",
    symbol: "?",
    className: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
  },
} as const;

export type AnalysisConfidence = keyof typeof CONFIDENCE_META;

/** A confidence classification is always shown as symbol + text label together — color alone never carries the meaning. */
export function ConfidenceBadge({ confidence }: { confidence: AnalysisConfidence }) {
  const meta = CONFIDENCE_META[confidence] ?? CONFIDENCE_META.NOT_DETERMINABLE;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

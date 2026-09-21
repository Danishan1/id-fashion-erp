"use client";

import { parseJson } from "./shared";

const RATING_META: Record<string, { label: string; className: string }> = {
  COMPATIBLE: { label: "Compatible", className: "bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300" },
  MINOR_CONCERN: { label: "Minor Concern", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" },
  INCOMPATIBLE: { label: "Incompatible", className: "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300" },
};

function RatingBadge({ rating }: { rating: string }) {
  const meta = RATING_META[rating] ?? { label: rating, className: "bg-zinc-200 text-zinc-600" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>;
}

interface CompatibilityItem {
  id: string;
  subjectType: "FABRIC" | "MATERIAL_LINE";
  aiRating: string;
  aiReasoning: string;
  /** Nullable — a check row created before this field existed won't have one; the UI simply omits the suggestion line rather than showing a blank/placeholder. */
  aiSuggestion: string | null;
}

interface CompatibilityCheck {
  id: string;
  overallSummary: string | null;
  overallRating: string | null;
  overallSuggestion: string | null;
  items: CompatibilityItem[];
}

interface Props {
  projectId: string;
  hasFabricOrMaterial: boolean;
  hasApprovedDna: boolean;
  check: CompatibilityCheck | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

export function CompatibilityWarningPanel({ projectId, hasFabricOrMaterial, hasApprovedDna, check, busy, run }: Props) {
  const runCheck = () =>
    run("run-compat", () => fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/compatibility-check`, { method: "POST" }).then(parseJson));

  const disabled = busy === "run-compat" || !hasFabricOrMaterial || !hasApprovedDna;
  const blockedReason = !hasApprovedDna
    ? "Approve the Design DNA analysis first (Step 3 — Design Lock Review)."
    : !hasFabricOrMaterial
      ? "Select a fabric or add a material first (Step 4 — Fabric & Material Selection)."
      : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        AI reviews whether the selected fabric/materials suit this garment&apos;s locked construction (e.g. a
        stiff fabric against a drape-dependent silhouette) — this never blocks generation outright, it only
        flags a concern for you to acknowledge before continuing.
      </p>
      {blockedReason && <p className="text-sm text-amber-700 dark:text-amber-400">{blockedReason}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={runCheck}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        title={blockedReason ?? undefined}
      >
        {busy === "run-compat" ? "Checking…" : check ? "Re-run Compatibility Check" : "Run Compatibility Check"}
      </button>

      {check && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {check.overallRating && <RatingBadge rating={check.overallRating} />}
              {check.overallSummary && <p className="text-sm text-zinc-700 dark:text-zinc-300">{check.overallSummary}</p>}
            </div>
            {check.overallSuggestion && (
              <p className="text-sm text-indigo-700 dark:text-indigo-300">
                <span className="font-medium">Suggestion: </span>
                {check.overallSuggestion}
              </p>
            )}
          </div>
          <div className="space-y-2">
            {check.items.map((item) => (
              <div key={item.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">{item.subjectType === "FABRIC" ? "Fabric" : "Material"}</span>
                  <RatingBadge rating={item.aiRating} />
                </div>
                <p className="mt-1 text-zinc-700 dark:text-zinc-300">{item.aiReasoning}</p>
                {item.aiSuggestion && (
                  <p className="mt-1 text-indigo-700 dark:text-indigo-300">
                    <span className="font-medium">Suggestion: </span>
                    {item.aiSuggestion}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

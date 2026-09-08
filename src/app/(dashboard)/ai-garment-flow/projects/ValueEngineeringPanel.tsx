"use client";

import { useEffect, useState } from "react";

interface ValueEngineeringSuggestion {
  id: string;
  materialDescription: string;
  suggestedChange: string;
  costImpactDirection: "LOWER" | "SIMILAR" | "HIGHER";
  qualityRiskNotes: string;
  reasoning: string;
}

interface ValueEngineeringAnalysis {
  id: string;
  overallSummary: string;
  createdAt: string;
  suggestions: ValueEngineeringSuggestion[];
}

const IMPACT_BADGE: Record<ValueEngineeringSuggestion["costImpactDirection"], string> = {
  LOWER: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  SIMILAR: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  HIGHER: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};

export function ValueEngineeringPanel({ projectId, setError }: { projectId: string; setError: (e: string | null) => void }) {
  const [analysis, setAnalysis] = useState<ValueEngineeringAnalysis | null | undefined>(undefined);
  const [additionalGuidance, setAdditionalGuidance] = useState("");
  const [generating, setGenerating] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/value-engineering`);
    const body = await res.json();
    if (res.ok) setAnalysis(body.data ?? null);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/value-engineering`)
      .then((res) => res.json())
      .then((body) => setAnalysis(body.data ?? null));
  }, [projectId]);

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/value-engineering`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalGuidance: additionalGuidance || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to run this value engineering review.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Analyse for Value Engineering</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Reviews this style&apos;s real, approved BOM for genuine cost-reduction opportunities — an alternative material or
          construction simplification per line, where one genuinely exists. Advisory only: nothing here ever edits the real BOM —
          apply an idea yourself in the BOM editor if you choose to.
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Additional guidance (optional)</label>
          <textarea
            rows={2}
            value={additionalGuidance}
            onChange={(e) => setAdditionalGuidance(e.target.value)}
            placeholder="e.g. Focus on the fabric line, it dominates this style's cost"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="button"
          disabled={generating}
          onClick={generate}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Analysing…" : "ANALYSE FOR VALUE ENGINEERING"}
        </button>
      </div>

      {analysis === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : analysis === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No value engineering review yet.</p>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{analysis.overallSummary}</p>

          {analysis.suggestions.length === 0 ? (
            <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
              No specific cost-reduction opportunities were found — this BOM already reads as efficient.
            </p>
          ) : (
            <div className="space-y-2">
              {analysis.suggestions.map((s) => (
                <div key={s.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{s.materialDescription}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${IMPACT_BADGE[s.costImpactDirection]}`}>
                      {s.costImpactDirection === "LOWER" ? "Likely Lower Cost" : s.costImpactDirection === "HIGHER" ? "Likely Higher Cost" : "Similar Cost"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{s.suggestedChange}</p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Quality/Risk: {s.qualityRiskNotes}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{s.reasoning}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

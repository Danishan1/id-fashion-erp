"use client";

import { useEffect, useState } from "react";

type BuyerCommentCategory = "FIT" | "CONSTRUCTION" | "FABRIC" | "COLOR" | "TRIM" | "PRICING" | "OTHER";

const CATEGORY_LABEL: Record<BuyerCommentCategory, string> = {
  FIT: "Fit",
  CONSTRUCTION: "Construction",
  FABRIC: "Fabric",
  COLOR: "Color",
  TRIM: "Trim",
  PRICING: "Pricing",
  OTHER: "Other",
};

interface BuyerCommentCategorySummary {
  id: string;
  category: BuyerCommentCategory;
  summary: string;
  evidenceExcerpt: string;
}

interface BuyerCommentsAnalysis {
  id: string;
  overallSummary: string;
  createdAt: string;
  categories: BuyerCommentCategorySummary[];
}

export function BuyerCommentsPanel({ projectId, setError }: { projectId: string; setError: (e: string | null) => void }) {
  const [analysis, setAnalysis] = useState<BuyerCommentsAnalysis | null | undefined>(undefined);
  const [generating, setGenerating] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/buyer-comments`);
    const body = await res.json();
    if (res.ok) setAnalysis(body.data ?? null);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/buyer-comments`)
      .then((res) => res.json())
      .then((body) => setAnalysis(body.data ?? null));
  }, [projectId]);

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/buyer-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to summarise buyer comments.");
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
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Summarise Buyer Comments</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Reads the real comment thread and decision notes already recorded on the linked Sample Request and produces a
          categorized summary — Fit / Construction / Fabric / Color / Trim / Pricing / Other. Every point is grounded in a real
          quote or close paraphrase of the actual feedback; nothing is invented.
        </p>
        <button
          type="button"
          disabled={generating}
          onClick={generate}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Summarising…" : "SUMMARISE BUYER COMMENTS"}
        </button>
      </div>

      {analysis === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : analysis === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No buyer comments summary yet.</p>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{analysis.overallSummary}</p>

          {analysis.categories.length === 0 ? (
            <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
              No specific categorized feedback was found in the recorded comments/decision notes.
            </p>
          ) : (
            <div className="space-y-2">
              {analysis.categories.map((c) => (
                <div key={c.id} className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                    {CATEGORY_LABEL[c.category]}
                  </span>
                  <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">{c.summary}</p>
                  <p className="mt-1 text-xs italic text-zinc-500 dark:text-zinc-400">&ldquo;{c.evidenceExcerpt}&rdquo;</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

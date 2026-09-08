"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface CostAnalysis {
  id: string;
  estimatedCostPerUnitLow: string | number;
  estimatedCostPerUnitHigh: string | number;
  costBreakdownCommentary: string;
  pricePositioningCommentary: string;
  marginFeasibilityCommentary: string;
  riskNotes: string;
  createdAt: string;
}

export function CostAnalysisPanel({
  projectId,
  currencyCode,
  setError,
  reloadProject,
}: {
  projectId: string;
  currencyCode: string | null;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [analysis, setAnalysis] = useState<CostAnalysis | null | undefined>(undefined);
  const [additionalGuidance, setAdditionalGuidance] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmContinue, setConfirmContinue] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/cost-analysis`);
    const body = await res.json();
    if (res.ok) setAnalysis(body.data ?? null);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/cost-analysis`)
      .then((res) => res.json())
      .then((body) => setAnalysis(body.data ?? null));
  }, [projectId]);

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/cost-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalGuidance: additionalGuidance || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to analyse cost.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function continueToSampling() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/complete-costing-step`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to continue to Sampling & Buyer Review.");
      setConfirmContinue(false);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const currency = currencyCode || "";

  return (
    <div className="mt-4 space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Analyse Cost with AI</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Produces an early, advisory cost-per-unit estimate and commentary from the approved design (and its resolved BOM, fabric
          detail, and any real Sampling costing already entered). This is never a substitute for Sampling&apos;s own real costing
          engine, linked below.
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Additional guidance (optional)</label>
          <textarea
            rows={2}
            value={additionalGuidance}
            onChange={(e) => setAdditionalGuidance(e.target.value)}
            placeholder="e.g. Target a premium positioning, not a mass-market price point"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="button"
          disabled={generating}
          onClick={generate}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Analysing…" : "ANALYSE COST WITH AI"}
        </button>
      </div>

      {analysis === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : analysis === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No cost analysis yet.</p>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Estimated cost per unit: {String(analysis.estimatedCostPerUnitLow)} – {String(analysis.estimatedCostPerUnitHigh)} {currency}
          </p>
          <p className="text-xs italic text-zinc-500 dark:text-zinc-400">
            An advisory estimate pending real technical costing — not a substitute for it.
          </p>
          <div>
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Cost Breakdown</p>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{analysis.costBreakdownCommentary}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Price Positioning</p>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{analysis.pricePositioningCommentary}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Margin Feasibility</p>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{analysis.marginFeasibilityCommentary}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Risk Notes</p>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{analysis.riskNotes}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirmContinue(true)}
        className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      >
        Continue to Sampling & Buyer Review
      </button>

      <ConfirmModal
        open={confirmContinue}
        title="Continue to Sampling & Buyer Review?"
        message="This requires real costing to already be entered and calculated on the linked Sample Request. Moves this project's workflow forward — the physical sample's own progress and the buyer's decision are then tracked automatically from the linked Sample Request."
        confirmLabel="Continue"
        isBusy={busy}
        onConfirm={continueToSampling}
        onCancel={() => setConfirmContinue(false)}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface SuitabilityItem {
  id: string;
  productType: { id: string; code: string; name: string };
  aiRating: "HIGHLY_SUITABLE" | "SUITABLE" | "MARGINALLY_SUITABLE" | "NOT_SUITABLE";
  aiReasoning: string;
  approvedRating: "HIGHLY_SUITABLE" | "SUITABLE" | "MARGINALLY_SUITABLE" | "NOT_SUITABLE";
  userEdited: boolean;
}

interface Suitability {
  id: string;
  status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
  analysisVersion: number;
  overallSummary: string | null;
  approvedBy: { fullName: string } | null;
  approvedAt: string | null;
  items: SuitabilityItem[];
}

const STATUS_LABELS: Record<Suitability["status"], string> = {
  DRAFT: "Not assessed yet",
  AI_ANALYSED: "AI Analysed — awaiting review",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  STALE: "Out of date",
};

const STATUS_BADGE_CLASS: Record<Suitability["status"], string> = {
  DRAFT: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  AI_ANALYSED: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  UNDER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  STALE: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

const RATING_META: Record<SuitabilityItem["aiRating"], { label: string; symbol: string; className: string }> = {
  HIGHLY_SUITABLE: {
    label: "Highly Suitable",
    symbol: "✓✓",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  SUITABLE: {
    label: "Suitable",
    symbol: "✓",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-500/10 dark:text-sky-300",
  },
  MARGINALLY_SUITABLE: {
    label: "Marginally Suitable",
    symbol: "~",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  },
  NOT_SUITABLE: {
    label: "Not Suitable",
    symbol: "✗",
    className: "bg-rose-100 text-rose-800 dark:bg-rose-500/10 dark:text-rose-300",
  },
};

const RATING_OPTIONS = Object.keys(RATING_META) as SuitabilityItem["aiRating"][];

/** Symbol + text label together, never relying on color alone — matches ConfidenceBadge's own established convention. */
function RatingBadge({ rating }: { rating: SuitabilityItem["aiRating"] }) {
  const meta = RATING_META[rating];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

/**
 * Mirrors ReferenceAnalysisPanel.tsx/FabricAnalysisPanel.tsx's own AI-assess
 * / status badge / per-item edit-and-reset / Approve shape, scoped to the
 * company's own real ProductType master rows rather than free-text
 * observations — each item's rating is overridable, its AI-written
 * reasoning stays a fixed read-only annotation (mirrors
 * AiGarmentFabricObservation's own aiManufacturingRelevance never being
 * independently editable either).
 */
export function ProductSuitabilityPanel({ projectId }: { projectId: string }) {
  const [suitability, setSuitability] = useState<Suitability | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [approving, setApproving] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/product-suitability`);
    const body = await res.json();
    if (res.ok) setSuitability(body.data);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/product-suitability`)
      .then((res) => res.json())
      .then((body) => setSuitability(body.data));
  }, [projectId]);

  async function runAssessment() {
    if (assessing) return;
    setError(null);
    setAssessing(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/product-suitability/run`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "The assessment could not be completed. Please try again.");
      setSuitability(body.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAssessing(false);
    }
  }

  async function approve() {
    setError(null);
    setApproving(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/product-suitability/approve`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve the assessment.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }

  if (suitability === undefined) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">Loading…</p>;
  }

  const canApprove = suitability !== null && (suitability.status === "AI_ANALYSED" || suitability.status === "UNDER_REVIEW");

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          disabled={assessing}
          onClick={runAssessment}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400"
        >
          {assessing ? "Assessing which garment types suit this fabric…" : "ASSESS SUITABILITY WITH AI"}
        </button>
        {suitability && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[suitability.status]}`}>
            {STATUS_LABELS[suitability.status]}
          </span>
        )}
      </div>

      {suitability === null && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          No suitability assessment yet. This runs against the project&apos;s own approved Fabric Analysis and this
          company&apos;s active Product Type master list.
        </p>
      )}

      {suitability && (
        <>
          {suitability.status === "STALE" && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
              This assessment is out of date — run a fresh assessment before continuing.
            </p>
          )}

          {suitability.overallSummary && (
            <section className="rounded-xl border border-amber-200/70 bg-amber-50/30 p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
              <h3 className="mb-2 text-sm font-semibold text-stone-900 dark:text-stone-50">Overall Summary</h3>
              <p className="text-sm italic text-stone-700 dark:text-stone-300">{suitability.overallSummary}</p>
            </section>
          )}

          <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
            <h3 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-50">
              Suitability by Garment Type ({suitability.items.length})
            </h3>
            <div className="space-y-3">
              {suitability.items.map((item) => (
                <SuitabilityItemRow key={item.id} item={item} onChanged={load} setError={setError} />
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
            <div className="text-sm text-stone-600 dark:text-stone-300">
              {suitability.status === "APPROVED" ? (
                <span>
                  Approved by {suitability.approvedBy?.fullName ?? "—"} on{" "}
                  {suitability.approvedAt ? new Date(suitability.approvedAt).toLocaleString() : "—"}.
                </span>
              ) : (
                <span>Review and correct ratings above, then approve to continue.</span>
              )}
            </div>
            <button
              type="button"
              disabled={!canApprove || approving}
              onClick={approve}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
            >
              {approving ? "Approving…" : suitability.status === "APPROVED" ? "Approved" : "APPROVE ASSESSMENT & CONTINUE"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SuitabilityItemRow({
  item,
  onChanged,
  setError,
}: {
  item: SuitabilityItem;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function changeRating(rating: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/product-suitability/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedRating: rating }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save the correction.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetToAi() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/product-suitability/items/${item.id}/reset`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to reset the rating.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/40 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-stone-900 dark:text-stone-50">
          {item.productType.name} <span className="text-xs text-stone-500 dark:text-stone-400">({item.productType.code})</span>
        </p>
        <div className="flex items-center gap-2">
          <select
            value={item.approvedRating}
            disabled={busy}
            onChange={(e) => void changeRating(e.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
          >
            {RATING_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {RATING_META[r].label}
              </option>
            ))}
          </select>
          <RatingBadge rating={item.approvedRating} />
        </div>
      </div>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{item.aiReasoning}</p>
      {item.userEdited && (
        <div className="mt-1 flex items-center gap-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Overridden — AI originally rated this <span className="italic">{RATING_META[item.aiRating].label}</span>.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={resetToAi}
            className="text-xs font-medium text-stone-500 hover:underline dark:text-stone-400"
          >
            Reset to AI rating
          </button>
        </div>
      )}
    </div>
  );
}

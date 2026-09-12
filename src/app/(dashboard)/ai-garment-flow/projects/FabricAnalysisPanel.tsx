"use client";

import { useEffect, useState } from "react";
import { FABRIC_FEATURE_REGISTRY, type FabricAnalysisSection } from "@/core/ai/fabric-analysis/feature-registry";
import type { AnalysisConfidence } from "./ConfidenceBadge";

// A local, fabric-scoped restyle of the shared ConfidenceBadge — deliberately
// NOT imported from ./ConfidenceBadge (only its type is), since that shared
// component is also used by ReferenceAnalysisPanel.tsx and must keep its own
// default visual presentation untouched by this warm-theme pass.
const FABRIC_CONFIDENCE_META: Record<AnalysisConfidence, { label: string; symbol: string; className: string }> = {
  CONFIRMED_VISUALLY: {
    label: "Confirmed Visually",
    symbol: "✓",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300",
  },
  LIKELY_INFERRED: {
    label: "Likely / Inferred",
    symbol: "~",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  },
  NOT_DETERMINABLE: {
    label: "Not Determinable",
    symbol: "?",
    className: "bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300",
  },
};

function FabricConfidenceBadge({ confidence }: { confidence: AnalysisConfidence }) {
  const meta = FABRIC_CONFIDENCE_META[confidence] ?? FABRIC_CONFIDENCE_META.NOT_DETERMINABLE;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

interface FabricObservation {
  id: string;
  featureKey: string;
  aiObservation: string;
  aiConfidence: AnalysisConfidence;
  aiManufacturingRelevance: string;
  approvedObservation: string;
  userEdited: boolean;
}

interface FabricAnalysis {
  id: string;
  status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
  analysisVersion: number;
  model: string;
  missingInformation: string[];
  fabricSummary: string | null;
  approvedBy: { fullName: string } | null;
  approvedAt: string | null;
  observations: FabricObservation[];
}

const ANALYSIS_STATUS_LABELS: Record<FabricAnalysis["status"], string> = {
  DRAFT: "Not analysed yet",
  AI_ANALYSED: "AI Analysed — awaiting review",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  STALE: "Out of date — fabric swatch image changed",
};

const ANALYSIS_STATUS_BADGE_CLASS: Record<FabricAnalysis["status"], string> = {
  DRAFT: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
  AI_ANALYSED: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  UNDER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  STALE: "bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

const SECTION_ORDER: FabricAnalysisSection[] = ["STRUCTURE", "VISUAL", "PERFORMANCE"];
const SECTION_TITLES: Record<FabricAnalysisSection, string> = {
  STRUCTURE: "Fabric Structure",
  VISUAL: "Visual Characteristics",
  PERFORMANCE: "Performance Estimates",
};

/**
 * Mirrors ReferenceAnalysisPanel.tsx's exact shape — the same AI-analyse
 * button / status badge / per-observation edit-and-reset / Approve flow,
 * scoped to Process 7's own 13 fabric fields (Structure/Visual/Performance
 * only — the original Manufacturing Considerations section was dropped per
 * explicit user feedback) instead of Process 1's 36 garment-construction
 * fields, and with no "suggested garment types" section — that decision
 * belongs to the separate Product Suitability process, not this one.
 *
 * Default view is a clean name/value summary (no confidence badges, no
 * separate duplicate table) — the full per-observation confidence/edit/reset
 * detail is still there, just tucked behind a collapsed "Edit details"
 * disclosure for corrections, rather than shown up front.
 */
export function FabricAnalysisPanel({ projectId, hasFabricSwatchImage }: { projectId: string; hasFabricSwatchImage: boolean }) {
  const [analysis, setAnalysis] = useState<FabricAnalysis | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-analysis`);
    const body = await res.json();
    if (res.ok) setAnalysis(body.data);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-analysis`)
      .then((res) => res.json())
      .then((body) => setAnalysis(body.data));
  }, [projectId]);

  async function runAnalysis() {
    if (analysing) return;
    setError(null);
    setAnalysing(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-analysis/run`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "AI analysis could not be completed. Please try again.");
      setAnalysis(body.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalysing(false);
    }
  }

  async function approve() {
    setError(null);
    setApproving(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-analysis/approve`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve the analysis.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApproving(false);
    }
  }

  if (analysis === undefined) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            disabled={!hasFabricSwatchImage || analysing}
            onClick={runAnalysis}
            className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-stone-800 disabled:opacity-50 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400"
          >
            {analysing ? "Analysing fabric structure and characteristics…" : "ANALYSE FABRIC WITH AI"}
          </button>
          {!hasFabricSwatchImage && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Upload a fabric swatch image before running the analysis.</p>
          )}
        </div>
        {analysis && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ANALYSIS_STATUS_BADGE_CLASS[analysis.status]}`}>
            {ANALYSIS_STATUS_LABELS[analysis.status]}
          </span>
        )}
      </div>

      {analysis && (
        <>
          {analysis.status === "STALE" && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
              The fabric swatch image was replaced since this analysis was run — it is kept for reference only. Run a
              fresh analysis before continuing.
            </p>
          )}

          <FabricSummaryCard analysis={analysis} />

          {analysis.fabricSummary && (
            <AnalysisSection title="Fabric Summary">
              <p className="text-sm italic text-stone-700 dark:text-stone-300">{analysis.fabricSummary}</p>
            </AnalysisSection>
          )}

          {analysis.missingInformation.length > 0 && (
            <AnalysisSection title="Missing Information">
              <ul className="list-inside list-disc text-sm text-stone-600 dark:text-stone-300">
                {analysis.missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </AnalysisSection>
          )}

          <div className="rounded-xl border border-stone-200 dark:border-stone-700">
            <button
              type="button"
              onClick={() => setEditOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-stone-700 dark:text-stone-200"
            >
              <span>Edit details</span>
              <span className="text-stone-400">{editOpen ? "▲" : "▼"}</span>
            </button>
            {editOpen && (
              <div className="space-y-4 border-t border-stone-200 p-4 dark:border-stone-700">
                {SECTION_ORDER.map((section) => (
                  <AnalysisSection key={section} title={SECTION_TITLES[section]}>
                    <ObservationGrid analysis={analysis} section={section} onChanged={load} setError={setError} />
                  </AnalysisSection>
                ))}
              </div>
            )}
          </div>

          <ApprovalControls analysis={analysis} approving={approving} onApprove={approve} />
        </>
      )}
    </div>
  );
}

function FabricSummaryCard({ analysis }: { analysis: FabricAnalysis }) {
  const rows = FABRIC_FEATURE_REGISTRY.map((feature) => ({
    feature,
    observation: analysis.observations.find((o) => o.featureKey === feature.key),
  })).filter((r) => r.observation);

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(({ feature, observation }) => (
          <div key={feature.key}>
            <dt className="text-xs font-medium text-stone-500 dark:text-stone-400">{feature.label}</dt>
            <dd className="text-sm text-stone-900 dark:text-stone-50">{observation!.approvedObservation}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function AnalysisSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
      <h3 className="mb-3 text-sm font-semibold text-stone-900 dark:text-stone-50">{title}</h3>
      {children}
    </section>
  );
}

function ObservationGrid({
  analysis,
  section,
  onChanged,
  setError,
}: {
  analysis: FabricAnalysis;
  section: FabricAnalysisSection;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const featureKeys = FABRIC_FEATURE_REGISTRY.filter((f) => f.section === section).map((f) => f.key);
  const rows = featureKeys
    .map((key) => analysis.observations.find((o) => o.featureKey === key))
    .filter((o): o is FabricObservation => Boolean(o));

  if (rows.length === 0) {
    return <p className="text-sm text-stone-500 dark:text-stone-400">No observations in this section.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {rows.map((obs) => (
        <EditableObservation key={obs.id} observation={obs} onChanged={onChanged} setError={setError} />
      ))}
    </div>
  );
}

function EditableObservation({
  observation,
  onChanged,
  setError,
}: {
  observation: FabricObservation;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const feature = FABRIC_FEATURE_REGISTRY.find((f) => f.key === observation.featureKey);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(observation.approvedObservation);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/fabric-analysis/observations/${observation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedObservation: value }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save the correction.");
      setEditing(false);
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
      const res = await fetch(`/api/v1/ai-garment-projects/fabric-analysis/observations/${observation.id}/reset`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to reset the observation.");
      setValue(observation.aiObservation);
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/40 p-3 dark:border-stone-700 dark:bg-stone-900/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{feature?.label ?? observation.featureKey}</p>
        <FabricConfidenceBadge confidence={observation.aiConfidence} />
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            className="block w-full rounded-lg border border-stone-300 px-2 py-1 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-stone-900 px-3 py-1 text-xs font-medium text-white hover:bg-stone-800 disabled:opacity-50 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400"
            >
              Save Correction
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setValue(observation.approvedObservation);
                setEditing(false);
              }}
              className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-stone-900 dark:text-stone-50">{observation.approvedObservation}</p>
          {observation.userEdited && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              Edited — AI original: <span className="italic">&ldquo;{observation.aiObservation}&rdquo;</span>
            </p>
          )}
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{observation.aiManufacturingRelevance}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
            >
              Edit
            </button>
            {observation.userEdited && (
              <button
                type="button"
                disabled={busy}
                onClick={resetToAi}
                className="text-xs font-medium text-stone-500 hover:underline dark:text-stone-400"
              >
                Reset to AI observation
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ApprovalControls({
  analysis,
  approving,
  onApprove,
}: {
  analysis: FabricAnalysis;
  approving: boolean;
  onApprove: () => void;
}) {
  const canApprove = analysis.status === "AI_ANALYSED" || analysis.status === "UNDER_REVIEW";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
      <div className="text-sm text-stone-600 dark:text-stone-300">
        {analysis.status === "APPROVED" ? (
          <span>
            Approved by {analysis.approvedBy?.fullName ?? "—"} on{" "}
            {analysis.approvedAt ? new Date(analysis.approvedAt).toLocaleString() : "—"}.
          </span>
        ) : (
          <span>Review and correct observations above, then approve to continue.</span>
        )}
      </div>
      <button
        type="button"
        disabled={!canApprove || approving}
        onClick={onApprove}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
      >
        {approving ? "Approving…" : analysis.status === "APPROVED" ? "Approved" : "APPROVE ANALYSIS & CONTINUE"}
      </button>
    </div>
  );
}

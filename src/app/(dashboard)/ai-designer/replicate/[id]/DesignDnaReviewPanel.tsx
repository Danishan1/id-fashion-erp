"use client";

import { useState } from "react";
import { FEATURE_LABELS, type FeatureKey } from "@/core/ai-designer/replicate-design/dna-analysis/feature-registry";
import { textInputClass } from "@/components/ui/FormField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { parseJson } from "./shared";

const CONFIDENCE_META = {
  CONFIRMED_VISUALLY: { label: "Confirmed Visually", symbol: "✓", className: "bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300" },
  LIKELY_INFERRED: { label: "Likely / Inferred", symbol: "~", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" },
  NOT_DETERMINABLE: { label: "Not Determinable", symbol: "?", className: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300" },
} as const;

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const meta = CONFIDENCE_META[confidence as keyof typeof CONFIDENCE_META] ?? CONFIDENCE_META.NOT_DETERMINABLE;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

interface Observation {
  id: string;
  featureKey: string;
  aiObservation: string;
  aiConfidence: string;
  approvedObservation: string;
  userEdited: boolean;
  isLocked: boolean;
}

interface DnaAnalysis {
  id: string;
  status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
  designDnaSummary: string | null;
  observations: Observation[];
}

interface Props {
  projectId: string;
  hasReferenceImage: boolean;
  analysis: DnaAnalysis | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  AI_ANALYSED: "AI Analysed — not yet reviewed",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved & Locked In",
  STALE: "Stale — the reference photo changed since this ran",
};

export function DesignDnaReviewPanel({ projectId, hasReferenceImage, analysis, busy, run }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const runAnalysis = () => run("run-dna", () => fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/dna-analysis`, { method: "POST" }).then(parseJson));

  const saveEdit = (observationId: string) =>
    run(`edit-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/dna-analysis/observations/${observationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedObservation: draft }),
      }).then(parseJson)
    ).then(() => setEditingId(null));

  const resetToAi = (observationId: string) =>
    run(`reset-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/dna-analysis/observations/${observationId}/reset`, { method: "POST" }).then(parseJson)
    );

  const toggleLock = (observationId: string, isLocked: boolean) =>
    run(`lock-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/dna-analysis/observations/${observationId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLocked }),
      }).then(parseJson)
    );

  const approve = () => run("approve-dna", () => fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/dna-analysis/approve`, { method: "POST" }).then(parseJson));

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        AI identifies the garment&apos;s visible structure only — silhouette, neckline, sleeves, closures, and
        so on — for recreating the same garment, never redesigning it. Each feature can be corrected and is
        locked (🔒) by default; a locked feature is treated as a hard constraint when generating.
      </p>

      {!hasReferenceImage && (
        <p className="text-sm text-amber-700 dark:text-amber-400">Upload a front reference photo first (Step 1 — Upload Reference Garment).</p>
      )}
      <button
        type="button"
        disabled={busy === "run-dna" || !hasReferenceImage}
        onClick={runAnalysis}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        title={!hasReferenceImage ? "Upload a front reference photo first" : undefined}
      >
        {busy === "run-dna" ? "Analyzing…" : analysis ? "Re-run Design DNA Analysis" : "Run Design DNA Analysis"}
      </button>

      {analysis && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{STATUS_LABEL[analysis.status] ?? analysis.status}</span>
            {(analysis.status === "AI_ANALYSED" || analysis.status === "UNDER_REVIEW") && (
              <button
                type="button"
                disabled={busy === "approve-dna"}
                onClick={approve}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {busy === "approve-dna" ? "Approving…" : "Approve Design DNA"}
              </button>
            )}
          </div>

          {analysis.designDnaSummary && (
            <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              {analysis.designDnaSummary}
            </p>
          )}

          <div className="space-y-2">
            {analysis.observations.map((obs) => (
              <div key={obs.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {FEATURE_LABELS[obs.featureKey as FeatureKey] ?? obs.featureKey}
                  </span>
                  <div className="flex items-center gap-2">
                    <ConfidenceBadge confidence={obs.aiConfidence} />
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      <ToggleSwitch checked={obs.isLocked} onToggle={() => toggleLock(obs.id, !obs.isLocked)} label={obs.isLocked ? "Locked" : "Unlocked"} />
                      {obs.isLocked ? "Locked" : "Unlocked"}
                    </label>
                  </div>
                </div>

                {editingId === obs.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea rows={2} className={textInputClass()} value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy === `edit-${obs.id}`}
                        onClick={() => saveEdit(obs.id)}
                        className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-md border px-2 py-1 text-xs">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{obs.approvedObservation}</p>
                    <div className="flex shrink-0 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(obs.id);
                          setDraft(obs.approvedObservation);
                        }}
                        className="text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Edit
                      </button>
                      {obs.userEdited && (
                        <button
                          type="button"
                          disabled={busy === `reset-${obs.id}`}
                          onClick={() => resetToAi(obs.id)}
                          className="text-zinc-500 hover:underline"
                        >
                          Reset to AI
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {obs.userEdited && editingId !== obs.id && (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Manually corrected — AI originally said: &quot;{obs.aiObservation}&quot;
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

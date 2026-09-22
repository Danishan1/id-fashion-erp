"use client";

import { useState } from "react";
import { SKETCH_FEATURE_LABELS, type SketchFeatureKey } from "@/core/ai-designer/sketch-analysis/feature-registry";
import { textInputClass } from "@/components/ui/FormField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

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

interface SketchAnalysis {
  id: string;
  status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
  sketchAnalysisSummary: string | null;
  observations: Observation[];
}

interface Props {
  projectId: string;
  hasSketchImage: boolean;
  analysis: SketchAnalysis | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  AI_ANALYSED: "AI Analysed — not yet reviewed",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved & Locked In",
  STALE: "Stale — the sketch changed since this ran",
};

/**
 * Sketch / Drawing → Garment, Step 2 — mirrors DesignDnaReviewPanel.tsx
 * (Replicate Design's own proven per-observation edit/reset/lock/approve
 * UI) almost line for line, in this module's own vocabulary and API paths.
 * A locked (🔒) feature is what Generate Design later treats as a hard
 * constraint the sketch's own detail must be preserved — see
 * detectDesignOverrides()/buildSketchGenerationPrompt() in the service.
 */
export function SketchAnalysisPanel({ projectId, hasSketchImage, analysis, busy, run }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const runAnalysis = () => run("run-sketch-analysis", () => fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis`, { method: "POST" }).then(parseJson));

  const saveEdit = (observationId: string) =>
    run(`edit-sketch-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis/observations/${observationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedObservation: draft }),
      }).then(parseJson)
    ).then(() => setEditingId(null));

  const resetToAi = (observationId: string) =>
    run(`reset-sketch-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis/observations/${observationId}/reset`, { method: "POST" }).then(parseJson)
    );

  const toggleLock = (observationId: string, isLocked: boolean) =>
    run(`lock-sketch-${observationId}`, () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis/observations/${observationId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLocked }),
      }).then(parseJson)
    );

  const approve = () => run("approve-sketch-analysis", () => fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis/approve`, { method: "POST" }).then(parseJson));

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        AI records the sketch&apos;s visible structure only — silhouette, neckline, sleeves, closures, and so
        on — as a locked baseline for generating a realistic garment from it, never redesigning it. Each
        feature can be corrected and is locked (🔒) by default; a locked feature is preserved unless you
        explicitly pick a different value for it in Product Design.
      </p>

      <button
        type="button"
        disabled={busy === "run-sketch-analysis" || !hasSketchImage}
        onClick={runAnalysis}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        title={!hasSketchImage ? "Upload a sketch first" : undefined}
      >
        {busy === "run-sketch-analysis" ? "Analyzing…" : analysis ? "Re-run Sketch Analysis" : "Analyze Sketch With AI"}
      </button>

      {analysis && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{STATUS_LABEL[analysis.status] ?? analysis.status}</span>
            {(analysis.status === "AI_ANALYSED" || analysis.status === "UNDER_REVIEW") && (
              <button
                type="button"
                disabled={busy === "approve-sketch-analysis"}
                onClick={approve}
                className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {busy === "approve-sketch-analysis" ? "Approving…" : "Approve Sketch Analysis"}
              </button>
            )}
          </div>

          {analysis.sketchAnalysisSummary && (
            <p className="rounded-md bg-zinc-50 p-3 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              {analysis.sketchAnalysisSummary}
            </p>
          )}

          <div className="space-y-2">
            {analysis.observations.map((obs) => (
              <div key={obs.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {SKETCH_FEATURE_LABELS[obs.featureKey as SketchFeatureKey] ?? obs.featureKey}
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
                        disabled={busy === `edit-sketch-${obs.id}`}
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
                          disabled={busy === `reset-sketch-${obs.id}`}
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

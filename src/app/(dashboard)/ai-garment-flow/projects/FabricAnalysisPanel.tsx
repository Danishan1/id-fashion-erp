"use client";

import { useEffect, useMemo, useState } from "react";
import { FABRIC_FEATURE_REGISTRY, type FabricAnalysisSection } from "@/core/ai/fabric-analysis/feature-registry";
import { ConfidenceBadge, type AnalysisConfidence } from "./ConfidenceBadge";

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
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  AI_ANALYSED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  UNDER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  STALE: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

const SECTION_ORDER: FabricAnalysisSection[] = ["STRUCTURE", "VISUAL", "PERFORMANCE", "MANUFACTURING"];
const SECTION_TITLES: Record<FabricAnalysisSection, string> = {
  STRUCTURE: "Fabric Structure",
  VISUAL: "Visual Characteristics",
  PERFORMANCE: "Performance Estimates",
  MANUFACTURING: "Manufacturing Considerations",
};

type SortColumn = "feature" | "confidence";

/**
 * Mirrors ReferenceAnalysisPanel.tsx's exact shape — the same AI-analyse
 * button / status badge / per-observation edit-and-reset / Approve flow,
 * scoped to Process 7's own 17 fabric fields instead of Process 1's 36
 * garment-construction fields, and with no "suggested garment types"
 * section — that decision belongs to the separate Product Suitability
 * process, not this one.
 */
export function FabricAnalysisPanel({ projectId, hasFabricSwatchImage }: { projectId: string; hasFabricSwatchImage: boolean }) {
  const [analysis, setAnalysis] = useState<FabricAnalysis | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [approving, setApproving] = useState(false);

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
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            disabled={!hasFabricSwatchImage || analysing}
            onClick={runAnalysis}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
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
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              The fabric swatch image was replaced since this analysis was run — it is kept for reference only. Run a
              fresh analysis before continuing.
            </p>
          )}

          {SECTION_ORDER.map((section) => (
            <AnalysisSection key={section} title={SECTION_TITLES[section]}>
              <ObservationGrid analysis={analysis} section={section} onChanged={load} setError={setError} />
            </AnalysisSection>
          ))}

          <AnalysisSection title="Fabric Summary">
            <p className="text-sm italic text-zinc-700 dark:text-zinc-300">{analysis.fabricSummary}</p>
          </AnalysisSection>

          <AnalysisSection title="Missing Information">
            {analysis.missingInformation.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">None noted.</p>
            ) : (
              <ul className="list-inside list-disc text-sm text-zinc-600 dark:text-zinc-300">
                {analysis.missingInformation.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </AnalysisSection>

          <AnalysisSection title="Fabric Analysis">
            <AnalysisCard observations={analysis.observations} />
          </AnalysisSection>

          <ApprovalControls analysis={analysis} approving={approving} onApprove={approve} />
        </>
      )}
    </div>
  );
}

function AnalysisSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h3>
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
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No observations in this section.</p>;
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
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{feature?.label ?? observation.featureKey}</p>
        <ConfidenceBadge confidence={observation.aiConfidence} />
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            rows={2}
            className="block w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
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
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-zinc-900 dark:text-zinc-50">{observation.approvedObservation}</p>
          {observation.userEdited && (
            <p className="mt-1 text-xs text-indigo-600 dark:text-indigo-400">
              Edited — AI original: <span className="italic">&ldquo;{observation.aiObservation}&rdquo;</span>
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{observation.aiManufacturingRelevance}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Edit
            </button>
            {observation.userEdited && (
              <button
                type="button"
                disabled={busy}
                onClick={resetToAi}
                className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
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

function AnalysisCard({ observations }: { observations: FabricObservation[] }) {
  const [sortColumn, setSortColumn] = useState<SortColumn>("feature");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const rows = useMemo(() => {
    const withLabels = observations.map((o) => ({
      ...o,
      label: FABRIC_FEATURE_REGISTRY.find((f) => f.key === o.featureKey)?.label ?? o.featureKey,
      order: FABRIC_FEATURE_REGISTRY.findIndex((f) => f.key === o.featureKey),
    }));
    const sorted = [...withLabels].sort((a, b) => {
      if (sortColumn === "confidence") return a.aiConfidence.localeCompare(b.aiConfidence);
      return a.order - b.order;
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [observations, sortColumn, sortDir]);

  function toggleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
        <thead>
          <tr>
            <th className="cursor-pointer px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400" onClick={() => toggleSort("feature")}>
              Feature {sortColumn === "feature" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Observation</th>
            <th className="cursor-pointer px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400" onClick={() => toggleSort("confidence")}>
              Confidence {sortColumn === "confidence" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Manufacturing Relevance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">{row.label}</td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                {row.approvedObservation}
                {row.userEdited && <span className="ml-1 text-xs text-indigo-600 dark:text-indigo-400">(edited)</span>}
              </td>
              <td className="px-3 py-2">
                <ConfidenceBadge confidence={row.aiConfidence} />
              </td>
              <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{row.aiManufacturingRelevance}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-sm text-zinc-600 dark:text-zinc-300">
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
        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        {approving ? "Approving…" : analysis.status === "APPROVED" ? "Approved" : "APPROVE ANALYSIS & CONTINUE"}
      </button>
    </div>
  );
}

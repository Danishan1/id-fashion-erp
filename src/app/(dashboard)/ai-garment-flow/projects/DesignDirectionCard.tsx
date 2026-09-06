"use client";

import { useState } from "react";
import { textInputClass } from "@/components/ui/FormField";

export interface DesignDirection {
  id: string;
  version: number;
  status: "GENERATED" | "APPROVED" | "REJECTED" | "SAVED_FOR_LATER";
  aiGeneratedAt: string;
  userNotes: string | null;
  userEdited: boolean;
  designDirectionName: string;
  commercialClassification: "SAFE_COMMERCIAL" | "BALANCED" | "FASHION_FORWARD";
  targetConsumer: string;
  silhouette: string;
  garmentLength: string;
  fit: string;
  neckline: string;
  collar: string;
  sleeve: string;
  shoulderConstruction: string;
  frontConstruction: string;
  backConstruction: string;
  closure: string;
  pocket: string;
  waistTreatment: string;
  hem: string;
  keyNewDesignFeature: string;
  suggestedFabricCharacter: string;
  suggestedTrims: string;
  productionComplexity: "LOW" | "MEDIUM" | "HIGH";
  expectedFabricConsumption: "LOW" | "MEDIUM" | "HIGH";
  targetPriceCompatibilityLevel: "LOW" | "MEDIUM" | "HIGH";
  commercialRationale: string;
  manufacturingRisk: string;
  differentiationFromReference: string;
  commercialPotentialScore: number;
  buyerFitScore: number;
  manufacturingEaseScore: number;
  targetPriceCompatibilityScore: number;
  fabricEfficiencyScore: number;
  designFreshnessScore: number;
  overallScore: number;
  isRecommendedForVisualisation: boolean;
}

const STATUS_LABELS: Record<DesignDirection["status"], string> = {
  GENERATED: "Generated",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SAVED_FOR_LATER: "Saved for Later",
};
const STATUS_BADGE_CLASS: Record<DesignDirection["status"], string> = {
  GENERATED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  SAVED_FOR_LATER: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};
const CLASSIFICATION_LABELS: Record<DesignDirection["commercialClassification"], string> = {
  SAFE_COMMERCIAL: "Safe Commercial",
  BALANCED: "Balanced",
  FASHION_FORWARD: "Fashion Forward",
};

const CONTENT_FIELDS: { key: keyof DesignDirection; label: string }[] = [
  { key: "targetConsumer", label: "Target Consumer" },
  { key: "silhouette", label: "Silhouette" },
  { key: "garmentLength", label: "Garment Length" },
  { key: "fit", label: "Fit" },
  { key: "neckline", label: "Neckline" },
  { key: "collar", label: "Collar" },
  { key: "sleeve", label: "Sleeve" },
  { key: "shoulderConstruction", label: "Shoulder Construction" },
  { key: "frontConstruction", label: "Front Construction" },
  { key: "backConstruction", label: "Back Construction" },
  { key: "closure", label: "Closure" },
  { key: "pocket", label: "Pocket" },
  { key: "waistTreatment", label: "Waist Treatment" },
  { key: "hem", label: "Hem" },
  { key: "keyNewDesignFeature", label: "Key New Design Feature" },
  { key: "suggestedFabricCharacter", label: "Suggested Fabric Character" },
  { key: "suggestedTrims", label: "Suggested Trims" },
];

function levelBadgeClass(level: "LOW" | "MEDIUM" | "HIGH"): string {
  if (level === "LOW") return "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300";
  if (level === "MEDIUM") return "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300";
}

export function DesignDirectionCard({
  direction,
  onChanged,
  setError,
}: {
  direction: DesignDirection;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function startEdit() {
    const initial: Record<string, string> = {};
    for (const f of CONTENT_FIELDS) initial[f.key as string] = String(direction[f.key]);
    initial.designDirectionName = direction.designDirectionName;
    initial.userNotes = direction.userNotes ?? "";
    setDraft(initial);
    setEditing(true);
  }

  async function saveEdit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save changes.");
      setEditing(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "APPROVE" | "REJECT" | "SAVE_FOR_LATER") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save the decision.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}/regenerate`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to regenerate this design direction.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {editing ? (
            <input
              className={`${textInputClass()} font-semibold`}
              value={draft.designDirectionName}
              onChange={(e) => setDraft((d) => ({ ...d, designDirectionName: e.target.value }))}
            />
          ) : (
            <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              {direction.designDirectionName}
              {direction.isRecommendedForVisualisation && (
                <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                  RECOMMENDED FOR VISUALISATION
                </span>
              )}
            </h4>
          )}
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {CLASSIFICATION_LABELS[direction.commercialClassification]} · v{direction.version} · Generated{" "}
            {new Date(direction.aiGeneratedAt).toLocaleString()}
            {direction.userEdited && " · Edited"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[direction.status]}`}>
            {STATUS_LABELS[direction.status]}
          </span>
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
            {direction.overallScore}/100
          </span>
        </div>
      </div>

      {editing ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CONTENT_FIELDS.map((f) => (
            <label key={f.key as string} className="block text-xs">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">{f.label}</span>
              <textarea
                rows={2}
                className={`${textInputClass()} mt-0.5`}
                value={draft[f.key as string] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key as string]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {CONTENT_FIELDS.map((f) => (
            <p key={f.key as string}>
              <span className="font-medium text-zinc-600 dark:text-zinc-400">{f.label}: </span>
              <span className="text-zinc-900 dark:text-zinc-50">{String(direction[f.key])}</span>
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${levelBadgeClass(direction.productionComplexity)}`}>
          Production Complexity: {direction.productionComplexity}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${levelBadgeClass(direction.expectedFabricConsumption)}`}>
          Fabric Consumption: {direction.expectedFabricConsumption}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${levelBadgeClass(direction.targetPriceCompatibilityLevel)}`}>
          Price Compatibility: {direction.targetPriceCompatibilityLevel}
        </span>
      </div>

      <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
        <p><span className="font-medium">Commercial Rationale: </span>{direction.commercialRationale}</p>
        <p><span className="font-medium">Manufacturing Risk: </span>{direction.manufacturingRisk}</p>
        <p><span className="font-medium">Differentiation from Reference: </span>{direction.differentiationFromReference}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-800/50 sm:grid-cols-3">
        <ScoreItem label="Commercial Potential" value={direction.commercialPotentialScore} />
        <ScoreItem label="Buyer Fit" value={direction.buyerFitScore} />
        <ScoreItem label="Manufacturing Ease" value={direction.manufacturingEaseScore} />
        <ScoreItem label="Price Compatibility" value={direction.targetPriceCompatibilityScore} />
        <ScoreItem label="Fabric Efficiency" value={direction.fabricEfficiencyScore} />
        <ScoreItem label="Design Freshness" value={direction.designFreshnessScore} />
      </div>

      <label className="block text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">User Notes</span>
        {editing ? (
          <textarea
            rows={2}
            className={`${textInputClass()} mt-0.5`}
            value={draft.userNotes ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, userNotes: e.target.value }))}
          />
        ) : (
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">{direction.userNotes || "—"}</p>
        )}
      </label>

      <div className="flex flex-wrap gap-2 pt-1">
        {editing ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={saveEdit}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("APPROVE")}
              className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("REJECT")}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={startEdit}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={regenerate}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {busy ? "Working…" : "Regenerate"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("SAVE_FOR_LATER")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Save for Later
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ScoreItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="font-semibold text-zinc-900 dark:text-zinc-50">{value}/10</p>
    </div>
  );
}

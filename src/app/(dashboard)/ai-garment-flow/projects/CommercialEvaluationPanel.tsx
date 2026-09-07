"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface EligibleDesign {
  id: string;
  designDirectionName: string;
  commercialClassification: string;
  overallScore: number;
}

type CommercialRank = "FIRST_CHOICE" | "SECOND_CHOICE" | "THIRD_CHOICE" | "NOT_RANKED";

interface EvaluationItem {
  id: string;
  designDirectionId: string;
  designDirection: { id: string; designDirectionName: string; overallScore: number; commercialClassification: string };
  targetCustomerFitScore: number;
  buyerFitScore: number;
  fabricSuitabilityScore: number;
  commercialAppealScore: number;
  manufacturingSimplicityScore: number;
  fabricConsumptionEfficiencyScore: number;
  patternMakingComplexityScore: number;
  sewingComplexityScore: number;
  trimComplexityScore: number;
  targetPriceCompatibilityScore: number;
  bulkProductionScalabilityScore: number;
  designFreshnessScore: number;
  commercialDevelopmentScore: number;
  strengths: string;
  weaknesses: string;
  manufacturingRisks: string;
  potentialCostRisks: string;
  suggestedImprovement: string;
  aiRank: CommercialRank;
  userRank: CommercialRank | null;
}

interface Evaluation {
  id: string;
  overallRankingRationale: string;
  createdAt: string;
  items: EvaluationItem[];
}

const RANK_LABEL: Record<CommercialRank, string> = {
  FIRST_CHOICE: "First Choice",
  SECOND_CHOICE: "Second Choice",
  THIRD_CHOICE: "Third Choice",
  NOT_RANKED: "Not Ranked",
};

const RANK_BADGE: Record<CommercialRank, string> = {
  FIRST_CHOICE: "bg-amber-100 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  SECOND_CHOICE: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  THIRD_CHOICE: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
  NOT_RANKED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const SCORE_COLUMNS: { key: keyof EvaluationItem; label: string }[] = [
  { key: "targetCustomerFitScore", label: "Target Customer Fit" },
  { key: "buyerFitScore", label: "Buyer Fit" },
  { key: "fabricSuitabilityScore", label: "Fabric Suitability" },
  { key: "commercialAppealScore", label: "Commercial Appeal" },
  { key: "manufacturingSimplicityScore", label: "Manufacturing Simplicity" },
  { key: "fabricConsumptionEfficiencyScore", label: "Consumption Efficiency" },
  { key: "patternMakingComplexityScore", label: "Pattern Making Complexity" },
  { key: "sewingComplexityScore", label: "Sewing Complexity" },
  { key: "trimComplexityScore", label: "Trim Complexity" },
  { key: "targetPriceCompatibilityScore", label: "Target Price Compatibility" },
  { key: "bulkProductionScalabilityScore", label: "Bulk Production Scalability" },
  { key: "designFreshnessScore", label: "Design Freshness" },
];

export function CommercialEvaluationPanel({
  projectId,
  setError,
  reloadProject,
}: {
  projectId: string;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [eligible, setEligible] = useState<EligibleDesign[] | undefined>(undefined);
  const [evaluation, setEvaluation] = useState<Evaluation | null | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [factoryCapability, setFactoryCapability] = useState("");
  const [comparing, setComparing] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [confirmSelectItemId, setConfirmSelectItemId] = useState<string | null>(null);

  async function loadEvaluation() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/commercial-evaluation`);
    const body = await res.json();
    if (res.ok) setEvaluation(body.data ?? null);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/commercial-evaluation/eligible-designs`)
      .then((res) => res.json())
      .then((body) => setEligible(body.data ?? []));
    fetch(`/api/v1/ai-garment-projects/${projectId}/commercial-evaluation`)
      .then((res) => res.json())
      .then((body) => setEvaluation(body.data ?? null));
  }, [projectId]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 8 ? prev : [...prev, id]));
  }

  async function compare() {
    setError(null);
    setComparing(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/commercial-evaluation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designDirectionIds: selectedIds, factoryCapability }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to compare these designs commercially.");
      setEvaluation(body.data);
      setSelectedIds([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setComparing(false);
    }
  }

  async function overrideRank(itemId: string, userRank: CommercialRank | null) {
    setError(null);
    setBusyItemId(itemId);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/commercial-evaluation-items/${itemId}/rank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRank: userRank === "NOT_RANKED" ? null : userRank }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to update this ranking.");
      await loadEvaluation();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyItemId(null);
    }
  }

  async function confirmSelectDesign() {
    if (!confirmSelectItemId) return;
    const item = evaluation?.items.find((i) => i.id === confirmSelectItemId);
    if (!item) return;
    setError(null);
    setBusyItemId(confirmSelectItemId);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/select-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designDirectionId: item.designDirectionId, confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to select this design for development.");
      setConfirmSelectItemId(null);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyItemId(null);
    }
  }

  if (eligible === undefined) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Select 2–8 Designs to Compare</h4>
        {eligible.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            No APPROVED design directions exist yet — approve at least two on the Development Brief step first.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {eligible.map((d) => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700"
                >
                  <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => toggleSelected(d.id)} />
                  <span className="flex-1 truncate text-zinc-800 dark:text-zinc-100">{d.designDirectionName}</span>
                  <span className="shrink-0 text-xs text-zinc-400">{d.overallScore}/100</span>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Factory Capability (optional)</label>
              <input
                type="text"
                value={factoryCapability}
                onChange={(e) => setFactoryCapability(e.target.value)}
                placeholder="e.g. Strong in knits, limited embroidery capacity"
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
            <button
              type="button"
              disabled={comparing || selectedIds.length < 2}
              onClick={compare}
              className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {comparing ? "Comparing…" : "COMPARE COMMERCIALLY"}
            </button>
            {selectedIds.length > 0 && selectedIds.length < 2 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Select at least 2 designs.</p>
            )}
          </>
        )}
      </div>

      {evaluation === undefined ? null : evaluation === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No commercial comparison has been run yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-500/10">
            <h4 className="text-sm font-semibold text-indigo-800 dark:text-indigo-200">Commercial Reasoning</h4>
            <p className="mt-1 text-sm text-indigo-900 dark:text-indigo-100">{evaluation.overallRankingRationale}</p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Design</th>
                  {SCORE_COLUMNS.map((col) => (
                    <th key={col.key} className="whitespace-nowrap px-2 py-2 text-center font-medium text-zinc-500 dark:text-zinc-400">
                      {col.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-2 py-2 text-center font-medium text-zinc-500 dark:text-zinc-400">Score /100</th>
                  <th className="whitespace-nowrap px-2 py-2 text-center font-medium text-zinc-500 dark:text-zinc-400">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {evaluation.items.map((item) => {
                  const effectiveRank = item.userRank ?? item.aiRank;
                  return (
                    <tr key={item.id}>
                      <td className="whitespace-nowrap px-2 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                        {item.designDirection.designDirectionName}
                      </td>
                      {SCORE_COLUMNS.map((col) => (
                        <td key={col.key} className="px-2 py-2 text-center text-zinc-700 dark:text-zinc-300">
                          {item[col.key] as number}
                        </td>
                      ))}
                      <td className="px-2 py-2 text-center font-semibold text-zinc-900 dark:text-zinc-50">
                        {item.commercialDevelopmentScore}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${RANK_BADGE[effectiveRank]}`}>
                          {RANK_LABEL[effectiveRank]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            {evaluation.items.map((item) => {
              const effectiveRank = item.userRank ?? item.aiRank;
              return (
                <div key={item.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {item.designDirection.designDirectionName}
                    </h5>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RANK_BADGE[effectiveRank]}`}>
                      AI: {RANK_LABEL[item.aiRank]}
                    </span>
                  </div>
                  <dl className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                    <div>
                      <dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Strengths: </dt>
                      <dd className="inline">{item.strengths}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Weaknesses: </dt>
                      <dd className="inline">{item.weaknesses}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Manufacturing Risks: </dt>
                      <dd className="inline">{item.manufacturingRisks}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Potential Cost Risks: </dt>
                      <dd className="inline">{item.potentialCostRisks}</dd>
                    </div>
                    <div>
                      <dt className="inline font-medium text-zinc-700 dark:text-zinc-200">Suggested Improvement: </dt>
                      <dd className="inline">{item.suggestedImprovement}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Override Rank:</label>
                    <select
                      value={item.userRank ?? ""}
                      disabled={busyItemId === item.id}
                      onChange={(e) => overrideRank(item.id, e.target.value === "" ? null : (e.target.value as CommercialRank))}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="">Use AI&apos;s rank ({RANK_LABEL[item.aiRank]})</option>
                      <option value="FIRST_CHOICE">First Choice</option>
                      <option value="SECOND_CHOICE">Second Choice</option>
                      <option value="THIRD_CHOICE">Third Choice</option>
                    </select>
                    <button
                      type="button"
                      disabled={busyItemId === item.id}
                      onClick={() => setConfirmSelectItemId(item.id)}
                      className="ml-auto rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                    >
                      SELECT DESIGN FOR DEVELOPMENT
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmSelectItemId !== null}
        title="Select this design for development?"
        message="This records the chosen design as this project's SELECTED DESIGN and moves the workflow forward to Apply Fabric. This is the final, user-approved choice — it does not have to match either ranking shown above."
        confirmLabel="Select for Development"
        isBusy={busyItemId === confirmSelectItemId}
        onConfirm={confirmSelectDesign}
        onCancel={() => setConfirmSelectItemId(null)}
      />
    </div>
  );
}

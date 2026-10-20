"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface MeasurementValue {
  id: string;
  sizeId: string;
  aiValueText: string;
  approvedValueText: string;
  userEdited: boolean;
  size: { id: string; code: string; name: string };
}

interface MeasurementPoint {
  id: string;
  measurementName: string;
  howToMeasure: string;
  toleranceText: string;
  sortOrder: number;
  values: MeasurementValue[];
}

interface TechnicalSpecification {
  id: string;
  designDirectionId: string;
  generalNotes: string | null;
  decision: "PENDING" | "APPROVED";
  createdAt: string;
  points: MeasurementPoint[];
}

export function TechnicalSpecificationPanel({
  projectId,
  setError,
  reloadProject,
}: {
  projectId: string;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [specs, setSpecs] = useState<TechnicalSpecification[] | undefined>(undefined);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [cellBusyId, setCellBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/technical-specifications`);
    const body = await res.json();
    if (res.ok) setSpecs(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/technical-specifications`)
      .then((res) => res.json())
      .then((body) => setSpecs(body.data ?? []));
  }, [projectId]);

  async function generateSpec() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/technical-specifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalNotes: additionalNotes || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to generate this technical specification.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function approve(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/technical-specifications/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVE", confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve this technical specification.");
      setConfirmApproveId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function finalize(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/approve-technical-specification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technicalSpecificationId: id, confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve the technical specification.");
      setConfirmFinalizeId(null);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveValue(valueId: string) {
    setError(null);
    setCellBusyId(valueId);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/technical-specifications/values/${valueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedValueText: editingText }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save this value.");
      setEditingValueId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCellBusyId(null);
    }
  }

  async function resetValue(valueId: string) {
    setError(null);
    setCellBusyId(valueId);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/technical-specifications/values/${valueId}/reset`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to reset this value.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCellBusyId(null);
    }
  }

  const approvedSpec = specs?.find((s) => s.decision === "APPROVED") ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Generate Draft Specification</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Drafts a Point-of-Measure (POM) chart for this design, graded across this company&apos;s own configured sizes — an advisory
          starting draft pending real technical measurement, not a confirmed production spec. Edit any value below to correct it.
        </p>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Which measurement points matter most (optional)
          </label>
          <textarea
            rows={2}
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            placeholder="e.g. Focus on chest and sleeve — this is an outerwear style"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <button
          type="button"
          disabled={generating}
          onClick={generateSpec}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Generating…" : "GENERATE DRAFT SPECIFICATION"}
        </button>
      </div>

      {specs === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : specs.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No technical specification has been generated yet.</p>
      ) : (
        <div className="space-y-4">
          {specs.map((spec) => (
            <div key={spec.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              {spec.generalNotes && (
                <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  {spec.generalNotes}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 dark:border-zinc-700">
                      <th className="p-1.5 text-left font-semibold text-zinc-600 dark:text-zinc-300">Measurement Point</th>
                      <th className="p-1.5 text-left font-semibold text-zinc-600 dark:text-zinc-300">How to Measure</th>
                      <th className="p-1.5 text-left font-semibold text-zinc-600 dark:text-zinc-300">Tolerance</th>
                      {spec.points[0]?.values.map((v) => (
                        <th key={v.sizeId} className="p-1.5 text-center font-semibold text-zinc-600 dark:text-zinc-300">
                          {v.size.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spec.points.map((point) => (
                      <tr key={point.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="p-1.5 font-medium text-zinc-900 dark:text-zinc-50">{point.measurementName}</td>
                        <td className="p-1.5 text-zinc-500 dark:text-zinc-400">{point.howToMeasure}</td>
                        <td className="p-1.5 text-zinc-500 dark:text-zinc-400">{point.toleranceText}</td>
                        {point.values.map((v) => (
                          <td key={v.id} className="p-1.5 text-center">
                            {editingValueId === v.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                                />
                                <button
                                  type="button"
                                  disabled={cellBusyId === v.id}
                                  onClick={() => saveValue(v.id)}
                                  className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingValueId(null)}
                                  className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                title={v.userEdited ? "Edited — click to change, or reset to the AI's original suggestion" : "Click to edit"}
                                onClick={() => {
                                  setEditingValueId(v.id);
                                  setEditingText(v.approvedValueText);
                                }}
                                className={`rounded px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                                  v.userEdited ? "font-semibold text-indigo-600 dark:text-indigo-400" : "text-zinc-700 dark:text-zinc-300"
                                }`}
                              >
                                {v.approvedValueText}
                                {v.userEdited && (
                                  <span
                                    role="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      resetValue(v.id);
                                    }}
                                    className="ml-1 text-xs text-zinc-400 underline"
                                  >
                                    reset
                                  </span>
                                )}
                              </button>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    spec.decision === "APPROVED"
                      ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {spec.decision}
                </span>
                <button
                  type="button"
                  disabled={busyId === spec.id || spec.decision === "APPROVED"}
                  onClick={() => setConfirmApproveId(spec.id)}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                >
                  Approve
                </button>
                {spec.decision === "APPROVED" && (
                  <button
                    type="button"
                    disabled={busyId === spec.id}
                    onClick={() => setConfirmFinalizeId(spec.id)}
                    className="ml-auto rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                  >
                    APPROVE TECHNICAL SPECIFICATION
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmApproveId !== null}
        title="Approve this technical specification?"
        message="This marks this version as the accepted measurement chart for this design. You can still generate and approve a different attempt later if needed."
        confirmLabel="Approve"
        isBusy={busyId === confirmApproveId}
        onConfirm={() => confirmApproveId && approve(confirmApproveId)}
        onCancel={() => setConfirmApproveId(null)}
      />

      <ConfirmModal
        open={confirmFinalizeId !== null}
        title="Approve Technical Specification?"
        message="This finalizes this measurement chart for the project. Its values remain an advisory draft — verify against your own grade rules before cutting."
        confirmLabel="Approve Technical Specification"
        isBusy={busyId === confirmFinalizeId}
        onConfirm={() => confirmFinalizeId && finalize(confirmFinalizeId)}
        onCancel={() => setConfirmFinalizeId(null)}
      />

      {approvedSpec && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Currently approved: technical specification from {new Date(approvedSpec.createdAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

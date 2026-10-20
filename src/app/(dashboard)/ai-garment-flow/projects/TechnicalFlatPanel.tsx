"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

interface TechnicalFlat {
  id: string;
  designDirectionId: string;
  baseImageAttachmentId: string;
  resultImageAttachmentId: string;
  additionalNotes: string | null;
  decision: "PENDING" | "APPROVED";
  createdAt: string;
}

function imageUrl(attachmentId: string): string {
  return `/api/v1/ai-garment-projects/attachments/${attachmentId}/download?disposition=inline`;
}

export function TechnicalFlatPanel({
  projectId,
  setError,
  reloadProject,
}: {
  projectId: string;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [flats, setFlats] = useState<TechnicalFlat[] | undefined>(undefined);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/technical-flats`);
    const body = await res.json();
    if (res.ok) setFlats(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/technical-flats`)
      .then((res) => res.json())
      .then((body) => setFlats(body.data ?? []));
  }, [projectId]);

  async function generateFlat() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/technical-flats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalNotes: additionalNotes || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create this technical flat.");
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
      const res = await fetch(`/api/v1/ai-garment-projects/technical-flats/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVE", confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve this technical flat.");
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
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/approve-technical-flat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ technicalFlatId: id, confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve the technical flat.");
      setConfirmFinalizeId(null);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const approvedFlat = flats?.find((f) => f.decision === "APPROVED") ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Create Technical Flat</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Regenerates the currently approved garment visual as a professional flat / CAD-style technical line drawing (front and back,
          construction detail — not a photorealistic render) — the standard tech-pack deliverable. Use this same form to Regenerate.
        </p>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Additional construction details to call out (optional)
          </label>
          <textarea
            rows={2}
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            placeholder="e.g. Show the back yoke seam and the collar topstitching clearly"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <button
          type="button"
          disabled={generating}
          onClick={generateFlat}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Generating…" : "CREATE TECHNICAL FLAT"}
        </button>
      </div>

      {flats === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : flats.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No technical flat has been generated yet.</p>
      ) : (
        <div className="space-y-4">
          {flats.map((flat) => (
            <div key={flat.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Selected Garment Visual</p>
                  <img
                    src={imageUrl(flat.baseImageAttachmentId)}
                    alt="Garment visual this flat was generated from"
                    className="w-full cursor-zoom-in rounded border border-zinc-200 dark:border-zinc-700"
                    onClick={() => setPreview({ url: imageUrl(flat.baseImageAttachmentId), fileName: `${flat.id}-base.png` })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Technical Flat</p>
                  <img
                    src={imageUrl(flat.resultImageAttachmentId)}
                    alt="Technical flat"
                    className="w-full cursor-zoom-in rounded border border-zinc-200 dark:border-zinc-700"
                    onClick={() => setPreview({ url: imageUrl(flat.resultImageAttachmentId), fileName: `${flat.id}-flat.png` })}
                  />
                </div>
              </div>

              {flat.additionalNotes && (
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Notes: {flat.additionalNotes}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    flat.decision === "APPROVED"
                      ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {flat.decision}
                </span>
                <button
                  type="button"
                  disabled={busyId === flat.id || flat.decision === "APPROVED"}
                  onClick={() => setConfirmApproveId(flat.id)}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                >
                  Approve
                </button>
                {flat.decision === "APPROVED" && (
                  <button
                    type="button"
                    disabled={busyId === flat.id}
                    onClick={() => setConfirmFinalizeId(flat.id)}
                    className="ml-auto rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                  >
                    APPROVE TECHNICAL FLAT
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmApproveId !== null}
        title="Approve this technical flat?"
        message="This marks this version as the accepted technical flat for this design. You can still generate and approve a different attempt later if needed."
        confirmLabel="Approve"
        isBusy={busyId === confirmApproveId}
        onConfirm={() => confirmApproveId && approve(confirmApproveId)}
        onCancel={() => setConfirmApproveId(null)}
      />

      <ConfirmModal
        open={confirmFinalizeId !== null}
        title="Approve Technical Flat?"
        message="This finalizes this technical flat and moves the project's workflow forward to BOM."
        confirmLabel="Approve Technical Flat"
        isBusy={busyId === confirmFinalizeId}
        onConfirm={() => confirmFinalizeId && finalize(confirmFinalizeId)}
        onCancel={() => setConfirmFinalizeId(null)}
      />

      {preview && (
        <FilePreviewModal
          key={preview.url}
          open={true}
          onClose={() => setPreview(null)}
          previewUrl={preview.url}
          downloadUrl={preview.url.replace("?disposition=inline", "")}
          fileName={preview.fileName}
          mimeType="image/png"
        />
      )}

      {approvedFlat && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Currently approved: technical flat from {new Date(approvedFlat.createdAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

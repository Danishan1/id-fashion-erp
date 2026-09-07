"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

interface FabricApplication {
  id: string;
  designDirectionId: string;
  baseImageAttachmentId: string;
  swatchAttachmentId: string;
  resultImageAttachmentId: string;
  fabricCode: string | null;
  composition: string | null;
  width: string | null;
  gsm: string | null;
  wovenOrKnit: string | null;
  stretch: string | null;
  drape: string | null;
  transparency: string | null;
  surfaceCharacter: string | null;
  printPattern: string | null;
  directionality: string | null;
  specialPlacement: string | null;
  availableQuantity: string | number | null;
  costPerMetre: string | number | null;
  decision: "PENDING" | "APPROVED";
  createdAt: string;
}

const EMPTY_FORM = {
  fabricCode: "",
  composition: "",
  width: "",
  gsm: "",
  wovenOrKnit: "",
  stretch: "",
  drape: "",
  transparency: "",
  surfaceCharacter: "",
  printPattern: "",
  directionality: "",
  specialPlacement: "",
  availableQuantity: "",
  costPerMetre: "",
};

const FIELD_LABELS: { key: keyof typeof EMPTY_FORM; label: string; placeholder: string }[] = [
  { key: "fabricCode", label: "Fabric Code", placeholder: "e.g. CTN-PRINT-014" },
  { key: "composition", label: "Composition (if known)", placeholder: "e.g. 100% Cotton — leave blank if unknown" },
  { key: "width", label: "Width", placeholder: "e.g. 58 inches" },
  { key: "gsm", label: "GSM (if known)", placeholder: "e.g. 180 — leave blank if unknown" },
  { key: "wovenOrKnit", label: "Woven / Knit", placeholder: "e.g. Woven" },
  { key: "stretch", label: "Stretch", placeholder: "e.g. 2-way stretch, moderate" },
  { key: "drape", label: "Drape", placeholder: "e.g. Fluid, soft drape" },
  { key: "transparency", label: "Transparency", placeholder: "e.g. Opaque" },
  { key: "surfaceCharacter", label: "Surface Character", placeholder: "e.g. Matte, slight texture" },
  { key: "printPattern", label: "Print / Pattern", placeholder: "e.g. Small floral, all-over" },
  { key: "directionality", label: "Directionality", placeholder: "e.g. Stripe running vertically" },
  { key: "specialPlacement", label: "Special Placement Requirement", placeholder: "e.g. Motif must be centred on the chest" },
];

function imageUrl(attachmentId: string): string {
  return `/api/v1/ai-garment-projects/attachments/${attachmentId}/download?disposition=inline`;
}

export function FabricApplicationPanel({
  projectId,
  setError,
  reloadProject,
}: {
  projectId: string;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [applications, setApplications] = useState<FabricApplication[] | undefined>(undefined);
  const [form, setForm] = useState(EMPTY_FORM);
  const [swatchFile, setSwatchFile] = useState<File | null>(null);
  const [swatchInputKey, setSwatchInputKey] = useState(0);
  const [applying, setApplying] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-applications`);
    const body = await res.json();
    if (res.ok) setApplications(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-applications`)
      .then((res) => res.json())
      .then((body) => setApplications(body.data ?? []));
  }, [projectId]);

  async function applyFabric() {
    if (!swatchFile) {
      setError("Upload a fabric swatch image first.");
      return;
    }
    setError(null);
    setApplying(true);
    try {
      const fd = new FormData();
      fd.append("file", swatchFile);
      for (const [key, value] of Object.entries(form)) {
        if (value) fd.append(key, value);
      }
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-applications`, { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to apply this fabric.");
      setSwatchFile(null);
      setSwatchInputKey((k) => k + 1);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function approve(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/fabric-applications/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVE", confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve this fabric application.");
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
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/approve-design-and-fabric`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fabricApplicationId: id, confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve design & fabric.");
      setConfirmFinalizeId(null);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const approvedApplication = applications?.find((a) => a.decision === "APPROVED") ?? null;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Upload Fabric Swatch</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Every field below is optional — leave anything unknown blank rather than guessing. Use this same form to Regenerate, Change
          Fabric (upload a different swatch), or Adjust Print Scale/Placement (edit those fields and re-submit).
        </p>

        <input
          key={swatchInputKey}
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setSwatchFile(e.target.files?.[0] ?? null)}
          className="mt-3 block text-sm text-zinc-700 dark:text-zinc-300"
        />

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FIELD_LABELS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{f.label}</label>
              <input
                type="text"
                value={form[f.key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Available Quantity</label>
            <input
              type="number"
              min={0}
              value={form.availableQuantity}
              onChange={(e) => setForm((prev) => ({ ...prev, availableQuantity: e.target.value }))}
              placeholder="Leave blank if unknown"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Cost Per Metre</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.costPerMetre}
              onChange={(e) => setForm((prev) => ({ ...prev, costPerMetre: e.target.value }))}
              placeholder="Leave blank if unknown"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={applying || !swatchFile}
          onClick={applyFabric}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {applying ? "Applying…" : "APPLY FABRIC"}
        </button>
      </div>

      {applications === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : applications.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No fabric has been applied yet.</p>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <div key={app.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Before Fabric Application</p>
                  <img
                    src={imageUrl(app.baseImageAttachmentId)}
                    alt="Before fabric application"
                    className="w-full cursor-zoom-in rounded border border-zinc-200 dark:border-zinc-700"
                    onClick={() => setPreview({ url: imageUrl(app.baseImageAttachmentId), fileName: `${app.id}-before.png` })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">After Fabric Application</p>
                  <img
                    src={imageUrl(app.resultImageAttachmentId)}
                    alt="After fabric application"
                    className="w-full cursor-zoom-in rounded border border-zinc-200 dark:border-zinc-700"
                    onClick={() => setPreview({ url: imageUrl(app.resultImageAttachmentId), fileName: `${app.id}-after.png` })}
                  />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                {app.fabricCode && <span>Fabric: {app.fabricCode}</span>}
                {app.composition && <span>· {app.composition}</span>}
                {app.gsm && <span>· {app.gsm} GSM</span>}
                <span className="ml-auto text-zinc-400">Swatch: </span>
                <img
                  src={imageUrl(app.swatchAttachmentId)}
                  alt="Fabric swatch"
                  className="h-6 w-6 cursor-zoom-in rounded border border-zinc-200 object-cover dark:border-zinc-700"
                  onClick={() => setPreview({ url: imageUrl(app.swatchAttachmentId), fileName: `${app.id}-swatch.png` })}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    app.decision === "APPROVED"
                      ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {app.decision}
                </span>
                <button
                  type="button"
                  disabled={busyId === app.id || app.decision === "APPROVED"}
                  onClick={() => setConfirmApproveId(app.id)}
                  className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
                >
                  Approve
                </button>
                {app.decision === "APPROVED" && (
                  <button
                    type="button"
                    disabled={busyId === app.id}
                    onClick={() => setConfirmFinalizeId(app.id)}
                    className="ml-auto rounded bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                  >
                    APPROVE DESIGN &amp; FABRIC
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={confirmApproveId !== null}
        title="Approve this fabric application?"
        message="This marks this version as the accepted fabric-applied garment for this design. You can still generate and approve a different attempt later if needed."
        confirmLabel="Approve"
        isBusy={busyId === confirmApproveId}
        onConfirm={() => confirmApproveId && approve(confirmApproveId)}
        onCancel={() => setConfirmApproveId(null)}
      />

      <ConfirmModal
        open={confirmFinalizeId !== null}
        title="Approve Design & Fabric?"
        message="This finalizes both the selected design and this fabric application, and moves the project's workflow forward to Technical Development. The garment design itself is never overwritten — this is recorded as a new approved development version."
        confirmLabel="Approve Design & Fabric"
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

      {approvedApplication && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Currently approved: fabric application from {new Date(approvedApplication.createdAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

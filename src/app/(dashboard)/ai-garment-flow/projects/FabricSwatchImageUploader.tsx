"use client";

import { useEffect, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = ".jpg,.jpeg,.png,.webp";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

interface FabricSwatchImageMeta {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  uploadedBy: { fullName: string } | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A single "current" fabric swatch image per project (Upload / Preview /
 * Replace / Delete), not a gallery — mirrors ReferenceImageUploader.tsx's
 * exact shape, since Fabric Analysis needs the same "one definitive image
 * to analyse" concept Process 1 already solved this problem for. Replaces
 * the foundation phase's generic multi-file gallery for this step.
 */
export function FabricSwatchImageUploader({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [image, setImage] = useState<FabricSwatchImageMeta | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-swatch-image`);
    const body = await res.json();
    if (res.ok) setImage(body.data);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-swatch-image`)
      .then((res) => res.json())
      .then((body) => setImage(body.data));
  }, [projectId]);

  async function handleFileChosen(file: File) {
    setError(null);

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError("The image format is not supported. Upload a JPG, PNG, or WEBP file.");
      setInputKey((k) => k + 1);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`This file is too large. The maximum allowed size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`);
      setInputKey((k) => k + 1);
      return;
    }

    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-swatch-image`, {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed.");
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setInputKey((k) => k + 1);
    }
  }

  async function handleDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/fabric-swatch-image`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to delete the fabric swatch image.");
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {image === undefined ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">Loading…</p>
      ) : image ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 shadow-sm dark:border-stone-700 dark:bg-stone-900/40">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="overflow-hidden rounded-lg border border-amber-200 shadow-sm dark:border-stone-700"
            >
              <img
                src={`/api/v1/ai-garment-projects/attachments/${image.id}/download?disposition=inline`}
                alt={image.fileName}
                className="h-20 w-20 object-cover"
              />
            </button>
            <div className="text-sm">
              <p className="font-medium text-stone-900 dark:text-stone-50">{image.fileName}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {formatBytes(image.fileSizeBytes)} · uploaded by {image.uploadedBy?.fullName ?? "—"} on{" "}
                {new Date(image.uploadedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <label className="cursor-pointer rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-amber-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800">
              {busy ? "Working…" : "Replace"}
              <input
                key={inputKey}
                type="file"
                accept={ALLOWED_EXTENSIONS}
                disabled={busy}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileChosen(file);
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={handleDelete}
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-10 text-center text-sm text-stone-600 transition hover:border-amber-500 hover:bg-amber-50 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-400 dark:hover:border-amber-600">
          <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-amber-500" aria-hidden="true">
            <path
              d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-medium">{busy ? "Uploading…" : "Click to upload a fabric swatch photo"}</span>
          <span className="text-xs text-stone-400 dark:text-stone-500">JPG, JPEG, PNG, or WEBP</span>
          <input
            key={inputKey}
            type="file"
            accept={ALLOWED_EXTENSIONS}
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileChosen(file);
            }}
          />
        </label>
      )}

      <p className="text-xs text-stone-500 dark:text-stone-400">
        This should be a clear, well-lit photo of the physical fabric swatch this project is based on.
      </p>

      {showPreview && image && (
        <FilePreviewModal
          key={image.id}
          open
          onClose={() => setShowPreview(false)}
          previewUrl={`/api/v1/ai-garment-projects/attachments/${image.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/ai-garment-projects/attachments/${image.id}/download`}
          fileName={image.fileName}
          mimeType={image.mimeType}
        />
      )}
    </div>
  );
}

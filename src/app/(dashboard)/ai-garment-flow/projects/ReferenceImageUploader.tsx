"use client";

import { useEffect, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = ".jpg,.jpeg,.png,.webp";
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

interface ReferenceImageMeta {
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
 * Screen 2 — Upload Reference. A single "current" reference image per
 * project (Upload / Preview / Replace / Delete), not a gallery — matches
 * the brief's explicit Screen 2 spec. Client-side format/size checks are a
 * courtesy for a fast, clear error; the server (setReferenceImage) is the
 * real gate and re-validates both independently.
 */
export function ReferenceImageUploader({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const [image, setImage] = useState<ReferenceImageMeta | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/reference-image`);
    const body = await res.json();
    if (res.ok) setImage(body.data);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/reference-image`)
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
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/reference-image`, {
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
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/reference-image`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to delete the reference image.");
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
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      )}

      {image === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : image ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="rounded border border-zinc-200 dark:border-zinc-700"
            >
              <img
                src={`/api/v1/ai-garment-projects/attachments/${image.id}/download?disposition=inline`}
                alt={image.fileName}
                className="h-16 w-16 rounded object-cover"
              />
            </button>
            <div className="text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{image.fileName}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {formatBytes(image.fileSizeBytes)} · uploaded by {image.uploadedBy?.fullName ?? "—"} on{" "}
                {new Date(image.uploadedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <label className="cursor-pointer rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
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
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-zinc-300 p-8 text-sm text-zinc-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-zinc-700 dark:text-zinc-400">
          {busy ? "Uploading…" : "Click to upload a reference image (JPG, JPEG, PNG, or WEBP)"}
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

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Reference imagery should be used for analysis and inspiration. Users are responsible for ensuring they
        have appropriate rights to use uploaded material.
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

"use client";

import { useEffect, useRef, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface AttachmentRow {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  contextLabel: string | null;
  uploadedAt: string;
  uploadedBy: { fullName: string };
}

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Reference images, tech packs, PDFs, buyer documents — stored through the
 * shared AttachmentService (RelatedModule.LEAD), exactly like every other
 * module's attachments. `openPickerSignal` lets the header's "Upload File"
 * quick action open the file chooser directly.
 */
export function LeadFilesTab({ leadId, openPickerSignal, onChanged }: { leadId: string; openPickerSignal: number; onChanged?: () => void }) {
  const [files, setFiles] = useState<AttachmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<AttachmentRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AttachmentRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputKey, setInputKey] = useState(0);

  const load = () =>
    fetch(`/api/v1/leads/${leadId}/attachments`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setFiles(body.data ?? []))
      .catch(() => setError("Could not load files."));

  useEffect(() => {
    fetch(`/api/v1/leads/${leadId}/attachments`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setFiles(body.data ?? []))
      .catch(() => setError("Could not load files."));
  }, [leadId]);

  useEffect(() => {
    if (openPickerSignal > 0) inputRef.current?.click();
  }, [openPickerSignal]);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/v1/leads/${leadId}/attachments`, { method: "POST", body: form }).catch(() => null);
    setUploading(false);
    setInputKey((k) => k + 1);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Upload failed.");
      return;
    }
    load();
    onChanged?.();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const res = await fetch(`/api/v1/leads/attachments/${pendingDelete.id}`, { method: "DELETE" }).catch(() => null);
    setPendingDelete(null);
    if (!res || !res.ok) {
      setError("Delete failed.");
      return;
    }
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          key={inputKey}
          ref={inputRef}
          type="file"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          disabled={uploading}
          className="text-sm"
        />
        {uploading && <span className="text-xs text-zinc-500">Uploading…</span>}
        <span className="text-xs text-zinc-500">Reference images, tech packs, PDFs, buyer documents, specification sheets.</span>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {files === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-zinc-500">No files uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <button type="button" onClick={() => setPreview(f)} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  {f.fileName}
                </button>
                <div className="text-xs text-zinc-500">
                  {formatSize(f.fileSizeBytes)} · {f.uploadedBy.fullName} · {new Date(f.uploadedAt).toLocaleString()}
                  {f.contextLabel ? ` · during ${f.contextLabel}` : ""}
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <a href={`/api/v1/leads/attachments/${f.id}/download`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                  Download
                </a>
                <button type="button" onClick={() => setPendingDelete(f)} className="font-medium text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <FilePreviewModal
          key={preview.id}
          open
          onClose={() => setPreview(null)}
          previewUrl={`/api/v1/leads/attachments/${preview.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/leads/attachments/${preview.id}/download`}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
        />
      )}
      <ConfirmModal
        open={!!pendingDelete}
        title="Delete file"
        message={`Delete "${pendingDelete?.fileName}"? This cannot be undone.`}
        confirmLabel="Delete"
        isDangerous
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

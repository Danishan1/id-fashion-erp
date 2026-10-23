"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { VoiceRecorder } from "@/components/ui/VoiceRecorder";

export interface RecordAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  contextLabel: string | null;
  uploadedBy: { id: string; fullName: string } | null;
}

/** Accepted by the server (FileStorage) — bills, photos, documents and voice notes. */
export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.csv,audio/*,.m4a,.mp3,.wav,.ogg,.webm";

const isAudio = (mime: string) => mime.startsWith("audio/");

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const fileUrl = (id: string, inline: boolean) =>
  `/api/v1/record-attachments/file/${id}${inline ? "?disposition=inline" : ""}`;

interface AttachmentsPanelProps {
  /** Slug of the record type, e.g. "expense", "expense-payment", "employee-advance". */
  module: string;
  recordId: string;
  /** Show upload / record / delete controls. */
  canEdit: boolean;
  title?: string;
  /** Compact = no outer card/heading (for use inside a modal or table row). */
  compact?: boolean;
  /** Turns a raw status snapshot into a readable label. */
  labelForContext?: (contextLabel: string) => string;
}

/**
 * Shared files + voice-notes section for any record registered in
 * src/core/attachments/attachment-targets.ts. Lists files (audio plays inline),
 * previews documents/photos, uploads several files at once, records voice
 * notes from the microphone, and deletes.
 */
export function AttachmentsPanel({
  module,
  recordId,
  canEdit,
  title = "Attachments & Voice Notes",
  compact = false,
  labelForContext,
}: AttachmentsPanelProps) {
  const [items, setItems] = useState<RecordAttachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecordAttachment | null>(null);
  const [toDelete, setToDelete] = useState<RecordAttachment | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseUrl = `/api/v1/record-attachments/${module}/${recordId}`;

  const load = useCallback(() => {
    return fetch(baseUrl, { headers: { "x-toast": "off" } })
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body?.error?.message ?? "Could not load attachments.");
        setItems(body.data ?? []);
      })
      .catch((err: Error) => setError(err.message));
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch(baseUrl, { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      setInputKey((k) => k + 1);
    }
  }

  async function remove(att: RecordAttachment) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(fileUrl(att.id, false), { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Delete failed.");
      setToDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={inputKey}
            ref={fileInput}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => void upload(Array.from(e.target.files ?? []))}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {busy ? "Uploading…" : "Upload files"}
          </button>
          <VoiceRecorder disabled={busy} onRecorded={(file) => void upload([file])} />
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {items === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">No files or voice notes yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((att) => (
            <li key={att.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                {isAudio(att.mimeType) ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Voice note</p>
                    <audio controls preload="none" src={fileUrl(att.id, true)} className="h-9 w-full max-w-sm" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPreview(att)}
                    className="truncate text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {att.fileName}
                  </button>
                )}
                <p className="text-xs text-zinc-500">
                  {formatFileSize(att.fileSizeBytes)}
                  {att.uploadedBy ? ` · ${att.uploadedBy.fullName}` : ""}
                  {att.contextLabel ? ` · ${labelForContext ? labelForContext(att.contextLabel) : att.contextLabel}` : ""}
                  {` · ${new Date(att.uploadedAt).toLocaleString("en-IN")}`}
                </p>
              </div>
              <a href={fileUrl(att.id, false)} className="text-xs text-zinc-600 hover:underline dark:text-zinc-400">
                Download
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setToDelete(att)}
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <FilePreviewModal
          key={preview.id}
          open
          onClose={() => setPreview(null)}
          previewUrl={fileUrl(preview.id, true)}
          downloadUrl={fileUrl(preview.id, false)}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
        />
      )}
      <ConfirmModal
        open={toDelete !== null}
        title="Delete attachment"
        message={toDelete ? `Delete "${toDelete.fileName}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        isDangerous
        onConfirm={() => toDelete && void remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );

  if (compact) return content;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {content}
    </section>
  );
}

/** A file picker + voice recorder that only collects files locally (for a
 * form that uploads them together with the record it creates). */
export function StagedFilesPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const [inputKey, setInputKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          key={inputKey}
          ref={fileInput}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            onChange([...files, ...Array.from(e.target.files ?? [])]);
            setInputKey((k) => k + 1);
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Add files
        </button>
        <VoiceRecorder onRecorded={(file) => onChange([...files, file])} />
      </div>
      {files.length > 0 && (
        <ul className="space-y-1 text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3">
              {isAudio(f.type) ? (
                <audio controls src={URL.createObjectURL(f)} className="h-9 max-w-xs" />
              ) : (
                <span className="truncate text-zinc-800 dark:text-zinc-200">{f.name}</span>
              )}
              <span className="text-xs text-zinc-500">{formatFileSize(f.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Uploads already-picked files to a record (e.g. right after creating it). */
export async function uploadFilesToRecord(module: string, recordId: string, files: File[]) {
  if (files.length === 0) return;
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`/api/v1/record-attachments/${module}/${recordId}`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? "The record was saved, but its files could not be uploaded.");
  }
}

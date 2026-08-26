"use client";

import { useEffect, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";

interface Person {
  fullName: string;
}

interface AttachmentRow {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: Person;
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmployeeAttachmentsSection({ employeeId }: { employeeId: string }) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/employees/${employeeId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/employees/${employeeId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [employeeId]);

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/employees/${employeeId}/attachments`, { method: "POST", body: formData });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to upload the file."));
      setIsBusy(false);
      return;
    }

    setUploadFile(null);
    setUploadInputKey((k) => k + 1);
    await fetchAttachments();
    setIsBusy(false);
  };

  const deleteAttachment = async (attachmentId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/employees/attachments/${attachmentId}`, { method: "DELETE" });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to delete the file."));
      setIsBusy(false);
      return;
    }

    await fetchAttachments();
    setIsBusy(false);
  };

  return (
    <div className="max-w-xl">
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attachments</h2>
      <div className="space-y-2">
        {attachments.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
        {attachments.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <div>
              <button type="button" onClick={() => setPreviewAttachment(a)} className="font-medium text-indigo-600 hover:text-indigo-500">
                {a.fileName}
              </button>
              <p className="text-xs text-zinc-400">
                {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName} · {new Date(a.uploadedAt).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => deleteAttachment(a.id)}
              disabled={isBusy}
              className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          key={uploadInputKey}
          type="file"
          onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
          className="text-sm text-zinc-600 dark:text-zinc-300"
        />
        <button
          type="button"
          onClick={uploadAttachment}
          disabled={isBusy || !uploadFile}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
        >
          Upload
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-400">ID proof, offer letter, certificates — JPEG, PNG, WEBP, PDF, Word, or Excel, up to 20 MB.</p>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/employees/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/employees/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}
    </div>
  );
}

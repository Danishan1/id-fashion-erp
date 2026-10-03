"use client";

import { useCallback, useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { toast } from "@/components/ui/Toast";
import { readApiError } from "@/lib/api-client";

interface DocumentDto {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  contextLabel: string | null;
  uploadedAt: string;
  uploadedById: string;
  uploadedBy: { id: string; fullName: string };
}

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/**
 * Documents of one CRM record (contact, company…) through the ERP's shared
 * attachment service (same file types and 20 MB limit as every module).
 * `baseUrl` is the record's API path, e.g. /api/v1/crm/companies/<id>.
 */
export function CrmDocumentsPanel({ baseUrl, canUpload, canEdit, viewAll, currentUserId, onChanged }: { baseUrl: string; canUpload: boolean; canEdit: boolean; viewAll: boolean; currentUserId: string; onChanged?: () => void }) {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DocumentDto | null>(null);

  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    crmRequest<DocumentDto[]>(`${baseUrl}/documents`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setDocs(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, tick]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    if (label.trim()) form.append("label", label.trim());
    const res = await fetch(`${baseUrl}/documents`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) return toast.error((await readApiError(res, "Upload failed.")).message);
    toast.success("Document uploaded.");
    setFile(null);
    setLabel("");
    setInputKey((k) => k + 1);
    load();
    onChanged?.();
  };

  const remove = async (d: DocumentDto) => {
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/documents/${d.id}`, { method: "DELETE", successMessage: "Document removed." });
    setBusy(false);
    if (res.ok) {
      load();
      onChanged?.();
    }
  };

  if (error) return <CrmErrorState message={error} onRetry={load} />;
  if (!docs) return <CrmLoadingState />;

  return (
    <div className="space-y-3">
      {docs.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No documents yet.</p>}
      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <div className="min-w-0">
              <button type="button" onClick={() => setPreview(d)} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {d.fileName}
              </button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {[d.contextLabel, size(d.fileSizeBytes), d.uploadedBy.fullName].filter(Boolean).join(" · ")} · <ClientDateTime value={d.uploadedAt} />
              </p>
            </div>
            {canEdit && (d.uploadedById === currentUserId || viewAll) && (
              <button type="button" onClick={() => remove(d)} disabled={busy} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="crm-doc-file" className="sr-only">
              File
            </label>
            <input id="crm-doc-file" key={inputKey} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm text-zinc-600 dark:text-zinc-300" />
            <label htmlFor="crm-doc-label" className="sr-only">
              Label
            </label>
            <input id="crm-doc-label" className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" placeholder="Label (optional)" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
            <Button size="sm" onClick={upload} disabled={!file} isLoading={busy} loadingLabel="Uploading…">
              Upload
            </Button>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">JPEG, PNG, WEBP, PDF, Word, or Excel — up to 20 MB.</p>
        </div>
      )}
      {preview && (
        <FilePreviewModal
          key={preview.id}
          open
          onClose={() => setPreview(null)}
          previewUrl={`/api/v1/crm/documents/${preview.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/crm/documents/${preview.id}/download`}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
        />
      )}
    </div>
  );
}

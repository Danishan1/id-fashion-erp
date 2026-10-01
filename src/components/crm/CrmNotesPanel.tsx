"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { crmRequest } from "./crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "./CrmStates";

export interface CrmNoteDto {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  createdBy: { id: string; fullName: string };
  canEdit: boolean;
  canDelete: boolean;
}

/**
 * Notes for one CRM record (lead today; contacts, companies and opportunities
 * reuse it). `listUrl` serves GET (list) and POST (add); edits and deletes go
 * to /api/v1/crm/notes/:id. `onChanged` lets the page refresh its timeline.
 */
export function CrmNotesPanel({ listUrl, canAdd, onChanged }: { listUrl: string; canAdd: boolean; onChanged?: () => void }) {
  const [notes, setNotes] = useState<CrmNoteDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<CrmNoteDto | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setNotes(null);
    setReloadTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    crmRequest<CrmNoteDto[]>(listUrl, { toast: "off" }).then((res) => {
      if (cancelled) return;
      if (res.ok) setNotes(res.data);
      else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [listUrl, reloadTick]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return setDraftError("Write something first.");
    setBusy(true);
    setDraftError(null);
    const res = await crmRequest<CrmNoteDto>(listUrl, {
      method: "POST",
      body: { body: draft },
      successMessage: "Note added.",
    });
    setBusy(false);
    if (!res.ok) return setDraftError(res.error.fieldErrors?.body ?? res.error.message);
    setDraft("");
    setNotes((prev) => [res.data, ...(prev ?? [])]);
    onChanged?.();
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!editing.body.trim()) return setDraftError("A note can't be empty.");
    setBusy(true);
    const res = await crmRequest<CrmNoteDto>(`/api/v1/crm/notes/${editing.id}`, {
      method: "PATCH",
      body: { body: editing.body },
      successMessage: "Note updated.",
    });
    setBusy(false);
    if (!res.ok) return;
    setNotes((prev) => (prev ?? []).map((n) => (n.id === res.data.id ? res.data : n)));
    setEditing(null);
    onChanged?.();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/notes/${deleting.id}`, {
      method: "DELETE",
      successMessage: "Note deleted.",
    });
    setBusy(false);
    if (!res.ok) return;
    setNotes((prev) => (prev ?? []).filter((n) => n.id !== deleting.id));
    setDeleting(null);
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      {canAdd && (
        <form onSubmit={add} className="space-y-2">
          <label htmlFor="crm-note-new" className="sr-only">
            New note
          </label>
          <textarea
            id="crm-note-new"
            rows={3}
            maxLength={10000}
            className={textInputClass(Boolean(draftError))}
            placeholder="Add a note — call summary, requirement details, next steps…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {draftError && <p className="text-sm text-red-600 dark:text-red-400">{draftError}</p>}
          <div className="flex justify-end">
            <Button type="submit" isLoading={busy && !editing} loadingLabel="Saving…" disabled={!draft.trim()}>
              Add note
            </Button>
          </div>
        </form>
      )}

      {error ? (
        <CrmErrorState message={error} onRetry={load} />
      ) : notes === null ? (
        <CrmLoadingState />
      ) : notes.length === 0 ? (
        <CrmEmptyState title="No notes yet" description={canAdd ? "Notes you add appear here, newest first." : "Nobody has added a note to this record."} />
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {notes.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">{n.createdBy.fullName}</span> · <ClientDateTime value={n.createdAt} />
                  {n.editedAt && " · edited"}
                </span>
                {editing?.id !== n.id && (n.canEdit || n.canDelete) && (
                  <span className="flex gap-3">
                    {n.canEdit && (
                      <button type="button" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing({ id: n.id, body: n.body })}>
                        Edit
                      </button>
                    )}
                    {n.canDelete && (
                      <button type="button" className="font-medium text-red-600 hover:underline dark:text-red-400" onClick={() => setDeleting(n)}>
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editing?.id === n.id ? (
                <div className="mt-2 space-y-2">
                  <label htmlFor={`crm-note-${n.id}`} className="sr-only">
                    Edit note
                  </label>
                  <textarea
                    id={`crm-note-${n.id}`}
                    rows={3}
                    maxLength={10000}
                    className={textInputClass()}
                    value={editing.body}
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </Button>
                    <Button onClick={saveEdit} isLoading={busy} loadingLabel="Saving…">
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete note?"
        message="The note is removed from this record. The change is kept in the audit log."
        confirmLabel="Delete"
        isDangerous
        isBusy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { useSettingsList } from "./useSettingsList";

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  usageCount: number;
}

/** Tags are created where they're used (lead form / Edit tags); here they're renamed or deleted. */
export function TagsTab({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState("");
  const { rows, error, reload } = useSettingsList<TagRow>(`/api/v1/crm/tags?search=${encodeURIComponent(search)}`);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<TagRow | null>(null);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    if (!editing?.name.trim()) return;
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/tags/${editing.id}`, { method: "PATCH", body: { name: editing.name }, successMessage: "Tag renamed." });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      reload();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await crmRequest(`/api/v1/crm/tags/${deleting.id}`, { method: "DELETE", successMessage: "Tag deleted." });
    setBusy(false);
    if (res.ok) {
      setDeleting(null);
      reload();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Tags are shared by all CRM records. Add new ones from a lead&apos;s form or its Edit tags action.</p>
        <label htmlFor="tag-search" className="sr-only">
          Search tags
        </label>
        <input id="tag-search" type="search" placeholder="Search tags…" className={`${textInputClass()} max-w-xs`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error ? (
        <CrmErrorState message={error} onRetry={reload} />
      ) : !rows ? (
        <CrmLoadingState />
      ) : rows.length === 0 ? (
        <CrmEmptyState title={search ? "No tags match your search" : "No tags yet"} description={search ? undefined : "Tags appear here once someone adds one to a lead."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Used on</th>
                {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">
                    {editing?.id === t.id ? (
                      <div className="flex items-center gap-2">
                        <label htmlFor={`tag-${t.id}`} className="sr-only">
                          Tag name
                        </label>
                        <input
                          id={`tag-${t.id}`}
                          className={`${textInputClass()} max-w-xs`}
                          value={editing.name}
                          maxLength={50}
                          autoFocus
                          onChange={(e) => setEditing({ id: t.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void rename();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                        <Button onClick={rename} isLoading={busy} loadingLabel="Saving…">
                          Save
                        </Button>
                        <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {t.usageCount} record{t.usageCount === 1 ? "" : "s"}
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing({ id: t.id, name: t.name })}>
                        Rename
                      </button>
                      <button type="button" className="ml-3 text-xs font-medium text-red-600 hover:underline dark:text-red-400" onClick={() => setDeleting(t)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmModal
        open={Boolean(deleting)}
        title={`Delete tag "${deleting?.name ?? ""}"?`}
        message={deleting?.usageCount ? `It will be removed from ${deleting.usageCount} record(s). This can't be undone.` : "This can't be undone."}
        confirmLabel="Delete"
        isDangerous
        isBusy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

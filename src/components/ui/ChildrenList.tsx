"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ChildFormModal } from "@/components/ui/ChildFormModal";
import { Button } from "@/components/ui/Button";
import type { LookupField } from "@/components/ui/SimpleLookupManager";

export interface ChildColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

export interface ChildrenListProps<T extends { id: string; isActive?: boolean }> {
  /** List endpoint, scoped to the parent — e.g. `/api/v1/warehouses/{id}/locations`. Also the base for POST (create) and PATCH `${fetchUrl}/{id}` (edit). */
  fetchUrl: string;
  columns: ChildColumn<T>[];
  fields: LookupField[];
  /** Singular label used in the Add/Edit sub-modal's title, e.g. "Location" -> "Add Location". */
  entityLabel?: string;
  addLabel?: string;
  emptyMessage?: string;
  /** Set to false for a child entity with no soft-delete column at all. */
  hasActiveToggle?: boolean;
  /** Bump from the caller to force a refetch (e.g. after the parent itself changed). */
  refreshKey?: number;
}

/**
 * The actual "list of a parent's children" content — list + "+ Add" +
 * per-row Edit/Deactivate, each wired to its own Add/Edit ChildFormModal and
 * a deactivate ConfirmModal. Deliberately has NO outer <Modal> of its own, so
 * it can be embedded two ways: standalone inside ManageChildrenModal's own
 * wrapping Modal (the List → Actions → separate modal pattern), or directly
 * inside another form's already-open modal (e.g. Warehouse's own Create/Edit
 * modal showing its Locations right there, per the 2026-09-02 UX change —
 * no pagination, since child collections like Locations are small.
 */
export function ChildrenList<T extends { id: string; isActive?: boolean }>({
  fetchUrl,
  columns,
  fields,
  entityLabel = "Record",
  addLabel = `+ Add ${entityLabel}`,
  emptyMessage = "No records yet.",
  hasActiveToggle = true,
  refreshKey,
}: ChildrenListProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<T | null>(null);
  // Bumped on every openAdd()/openEdit() call — passed as ChildFormModal's
  // `key` so it fully remounts on every open (even re-editing the same row
  // twice in a row), instead of an effect resetting its state. This is what
  // makes Cancel-then-reopen-the-same-row correctly show fresh server data
  // rather than the discarded, previously-edited-but-cancelled values.
  const [formRevision, setFormRevision] = useState(0);
  const [pendingToggleRow, setPendingToggleRow] = useState<T | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    // Deferred a tick so the initial setIsLoading/setLoadError below don't
    // run synchronously within the effect body itself (react-hooks/set-
    // state-in-effect) — same idiom SimpleLookupManager's own load() already
    // uses (`setTimeout(load, 0)`).
    const timeout = setTimeout(() => {
      setIsLoading(true);
      setLoadError(null);
      fetch(fetchUrl)
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load.");
          setRows(body.data ?? []);
        })
        .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load."))
        .finally(() => setIsLoading(false));
    }, 0);
    return () => clearTimeout(timeout);
  }, [fetchUrl, refreshKey, localRefresh]);

  const rowLabel = (row: T) => {
    const r = row as Record<string, unknown>;
    return String(r.name ?? r.code ?? "this record");
  };

  const openAdd = () => {
    setEditTarget(null);
    setFormRevision((r) => r + 1);
    setFormOpen(true);
  };

  const openEdit = (row: T) => {
    setEditTarget(row);
    setFormRevision((r) => r + 1);
    setFormOpen(true);
  };

  const handleFormSuccess = () => {
    setFormOpen(false);
    setLocalRefresh((k) => k + 1);
  };

  const confirmToggleActive = async () => {
    if (!pendingToggleRow) return;
    setIsToggling(true);
    setToggleError(null);
    const res = await fetch(`${fetchUrl}/${pendingToggleRow.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !pendingToggleRow.isActive }),
    });
    setIsToggling(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setToggleError(body?.error?.message ?? "Failed to update status.");
      return;
    }
    setPendingToggleRow(null);
    setLocalRefresh((k) => k + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={openAdd} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          {addLabel}
        </button>
      </div>

      {loadError && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadError}
          </p>
          <Button variant="secondary" size="xs" onClick={() => setLocalRefresh((k) => k + 1)}>
            Retry
          </Button>
        </div>
      )}
      {toggleError && <p className="text-sm text-red-600 dark:text-red-400">{toggleError}</p>}

      <div className="max-h-[40vh] overflow-y-auto overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-2 font-medium">
                  {c.header}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loadError && isLoading && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loadError && !isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-8 text-center">
                  <div className="space-y-3">
                    <p className="text-sm text-zinc-500">{emptyMessage}</p>
                    <Button onClick={openAdd}>{addLabel}</Button>
                  </div>
                </td>
              </tr>
            )}
            {!loadError &&
              !isLoading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => openEdit(row)} className="text-indigo-600 hover:text-indigo-500">
                        Edit
                      </button>
                      {hasActiveToggle && (
                        <ToggleSwitch
                          checked={Boolean(row.isActive)}
                          onToggle={() => setPendingToggleRow(row)}
                          label={row.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <ChildFormModal
        key={formRevision}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editTarget ? `Edit ${entityLabel}` : `Add ${entityLabel}`}
        fields={fields}
        initialValues={editTarget ?? undefined}
        submitUrl={editTarget ? `${fetchUrl}/${editTarget.id}` : fetchUrl}
        method={editTarget ? "PATCH" : "POST"}
        onSuccess={handleFormSuccess}
      />

      <ConfirmModal
        open={pendingToggleRow !== null}
        title={pendingToggleRow?.isActive ? `Deactivate this ${entityLabel.toLowerCase()}?` : `Activate this ${entityLabel.toLowerCase()}?`}
        message={
          pendingToggleRow?.isActive
            ? `"${pendingToggleRow ? rowLabel(pendingToggleRow) : ""}" will be deactivated and hidden from active selection lists. You can reactivate it later.`
            : `"${pendingToggleRow ? rowLabel(pendingToggleRow) : ""}" will be marked active again.`
        }
        confirmLabel={pendingToggleRow?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pendingToggleRow?.isActive)}
        isBusy={isToggling}
        onConfirm={confirmToggleActive}
        onCancel={() => setPendingToggleRow(null)}
      />
    </div>
  );
}

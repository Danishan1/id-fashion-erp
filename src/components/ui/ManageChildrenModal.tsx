"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ChildFormModal } from "@/components/ui/ChildFormModal";
import type { LookupField } from "@/components/ui/SimpleLookupManager";

export interface ChildColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface ManageChildrenModalProps<T extends { id: string; isActive?: boolean }> {
  open: boolean;
  onClose: () => void;
  /** Full title including parent context, e.g. "Locations — WIP Store (WH03)". */
  title: string;
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
 * Generic "manage a parent's children" modal — List (Actions ⋮) → this →
 * Add/Edit-child modal, per the ERP-wide CRUD standard (Warehouse → Locations
 * is the reference implementation). This is SimpleLookupManager's list half,
 * generalized to a parent-scoped fetchUrl instead of a single global lookup,
 * wrapped in its own outer Modal so a caller can open it directly from a
 * DataTable row action. No pagination — child collections like Locations are
 * small; a flat list is intentional, matching every other List→Action→Modal
 * child-management flow already shipped in this app (Supplier's Categories/
 * Materials, Customer's Buyers).
 */
export function ManageChildrenModal<T extends { id: string; isActive?: boolean }>({
  open,
  onClose,
  title,
  fetchUrl,
  columns,
  fields,
  entityLabel = "Record",
  addLabel = `+ Add ${entityLabel}`,
  emptyMessage = "No records yet.",
  hasActiveToggle = true,
  refreshKey,
}: ManageChildrenModalProps<T>) {
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
    if (!open) return;
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
  }, [open, fetchUrl, refreshKey, localRefresh]);

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
    <>
      <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-2xl">
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={openAdd} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              {addLabel}
            </button>
          </div>

          {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
          {toggleError && <p className="text-sm text-red-600 dark:text-red-400">{toggleError}</p>}

          <div className="max-h-[50vh] overflow-y-auto overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
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
                    <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-zinc-500">
                      {emptyMessage}
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

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

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
    </>
  );
}

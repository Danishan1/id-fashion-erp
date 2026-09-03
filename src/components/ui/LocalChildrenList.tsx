"use client";

import { useState } from "react";
import { ChildFormModal } from "@/components/ui/ChildFormModal";
import type { ChildColumn } from "@/components/ui/ChildrenList";
import type { LookupField } from "@/components/ui/SimpleLookupManager";

export interface LocalChildrenListProps<T extends Record<string, unknown>> {
  /** The staged, not-yet-persisted rows — lives in the caller's own state. */
  value: T[];
  onChange: (next: T[]) => void;
  columns: ChildColumn<T>[];
  fields: LookupField[];
  entityLabel?: string;
  addLabel?: string;
  emptyMessage?: string;
}

/**
 * ChildrenList's sibling for a parent that doesn't have an id yet — e.g.
 * Warehouse's own Create modal building up a Storage Locations list before
 * the warehouse is saved (2026-09-02). Add/Edit reuses ChildFormModal in its
 * local-submit mode (`onSubmitLocal`, no network call); Remove is immediate,
 * no confirmation, since undoing a staged-but-unsaved row is trivial. The
 * caller submits `value` together with the parent's own fields in one
 * request — see WarehousesListClient's `extraFields` usage on WarehouseForm.
 */
export function LocalChildrenList<T extends Record<string, unknown>>({
  value,
  onChange,
  columns,
  fields,
  entityLabel = "Record",
  addLabel = `+ Add ${entityLabel}`,
  emptyMessage = "No records yet.",
}: LocalChildrenListProps<T>) {
  const [formOpen, setFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [formRevision, setFormRevision] = useState(0);

  const openAdd = () => {
    setEditIndex(null);
    setFormRevision((r) => r + 1);
    setFormOpen(true);
  };

  const openEdit = (index: number) => {
    setEditIndex(index);
    setFormRevision((r) => r + 1);
    setFormOpen(true);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleLocalSubmit = (payload: Record<string, string>) => {
    if (editIndex === null) {
      onChange([...value, payload as unknown as T]);
    } else {
      onChange(value.map((row, i) => (i === editIndex ? (payload as unknown as T) : row)));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={openAdd} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          {addLabel}
        </button>
      </div>

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
            {value.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-zinc-500">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {value.map((row, index) => (
              <tr key={index} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                  </td>
                ))}
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => openEdit(index)} className="text-indigo-600 hover:text-indigo-500">
                      Edit
                    </button>
                    <button type="button" onClick={() => removeAt(index)} className="text-red-600 hover:text-red-500">
                      Remove
                    </button>
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
        title={editIndex === null ? `Add ${entityLabel}` : `Edit ${entityLabel}`}
        fields={fields}
        initialValues={editIndex !== null ? (value[editIndex] as Record<string, unknown>) : undefined}
        onSubmitLocal={handleLocalSubmit}
        onSuccess={() => setFormOpen(false)}
      />
    </div>
  );
}

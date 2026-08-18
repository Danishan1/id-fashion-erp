"use client";

import { useEffect, useState, type FormEvent } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { suggestCodeFromName } from "@/lib/code-suggest";

export interface LookupField {
  key: string;
  label: string;
  type?: "text" | "number" | "color" | "date" | "select";
  required?: boolean;
  placeholder?: string;
  /** For type "select": static options, or a URL returning {data: {id,name}[]} to fetch options from. */
  options?: { value: string; label: string }[];
  optionsUrl?: string;
}

export interface LookupRow {
  id: string;
  [key: string]: unknown;
}

interface SimpleLookupManagerProps {
  fetchUrl: string;
  fields: LookupField[];
  displayColumns?: { key: string; header: string }[];
  hasActiveToggle?: boolean;
  /** Prepended to the auto-suggested Code when creating a new record (e.g. "BR-"). */
  codePrefix?: string;
}

function emptyValues(fields: LookupField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, ""]));
}

export function SimpleLookupManager({
  fetchUrl,
  fields,
  displayColumns,
  hasActiveToggle = true,
  codePrefix = "",
}: SimpleLookupManagerProps) {
  const hasCodeField = fields.some((f) => f.key === "code");
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(emptyValues(fields));
  const [isCodeManuallyEdited, setIsCodeManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [pendingToggleRow, setPendingToggleRow] = useState<LookupRow | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const columns = displayColumns ?? fields.map((f) => ({ key: f.key, header: f.label }));

  useEffect(() => {
    fields
      .filter((f) => f.type === "select" && f.optionsUrl)
      .forEach((f) => {
        fetch(`${f.optionsUrl}?pageSize=200`)
          .then((res) => res.json())
          .then((body) =>
            setDynamicOptions((prev) => ({
              ...prev,
              [f.key]: (body.data ?? []).map((row: LookupRow) => ({
                value: row.id,
                label: String(row.name ?? row.code ?? row.id),
              })),
            }))
          )
          .catch(() => setDynamicOptions((prev) => ({ ...prev, [f.key]: [] })));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const load = () => {
    setIsLoading(true);
    fetch(`${fetchUrl}?pageSize=200`)
      .then((res) => res.json())
      .then((body) => setRows(body.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(load, 0);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  const startCreate = () => {
    setEditingId(null);
    setValues(emptyValues(fields));
    setIsCodeManuallyEdited(false);
    setShowForm(true);
    setError(null);
  };

  const startEdit = (row: LookupRow) => {
    setEditingId(row.id);
    setValues(
      Object.fromEntries(
        fields.map((f) => {
          const raw = String(row[f.key] ?? "");
          return [f.key, f.type === "date" ? raw.slice(0, 10) : raw];
        })
      )
    );
    setIsCodeManuallyEdited(true); // never auto-overwrite an existing record's code
    setShowForm(true);
    setError(null);
  };

  const handleFieldChange = (key: string, value: string) => {
    if (key === "code") {
      setIsCodeManuallyEdited(true);
      setValues((prev) => ({ ...prev, code: value }));
      return;
    }
    if (key === "name" && hasCodeField && !isCodeManuallyEdited) {
      setValues((prev) => ({ ...prev, name: value, code: suggestCodeFromName(value, codePrefix) }));
      return;
    }
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const url = editingId ? `${fetchUrl}/${editingId}` : fetchUrl;
    const method = editingId ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save.");
      return;
    }

    setShowForm(false);
    load();
  };

  const confirmToggleActive = async () => {
    if (!pendingToggleRow) return;
    setIsToggling(true);
    await fetch(`${fetchUrl}/${pendingToggleRow.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...Object.fromEntries(fields.map((f) => [f.key, pendingToggleRow[f.key]])),
        isActive: !pendingToggleRow.isActive,
      }),
    });
    setIsToggling(false);
    setPendingToggleRow(null);
    load();
  };

  const rowLabel = (row: LookupRow) => String(row.name ?? row.code ?? "this record");

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
        <button onClick={startCreate} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          + Add
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
        >
          {fields.map((f) => (
            <div key={f.key} className="flex-1 min-w-[120px]">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">{f.label}</label>
              {f.type === "select" ? (
                <select
                  required={f.required}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">{f.placeholder ?? "— Select —"}</option>
                  {(f.options ?? dynamicOptions[f.key] ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => handleFieldChange(f.key, e.target.value)}
                  className={textInputClass()}
                />
              )}
            </div>
          ))}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {editingId ? "Update" : "Add"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          >
            Cancel
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-2 font-medium">
                  {c.header}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-zinc-500">
                  No records found.
                </td>
              </tr>
            )}
            {!isLoading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2 text-zinc-700 dark:text-zinc-200">
                      {String(row[c.key] ?? "")}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-3">
                      <button onClick={() => startEdit(row)} className="text-indigo-600 hover:text-indigo-500">
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

      <ConfirmModal
        open={pendingToggleRow !== null}
        title={pendingToggleRow?.isActive ? "Deactivate record?" : "Activate record?"}
        message={
          pendingToggleRow?.isActive
            ? `"${rowLabel(pendingToggleRow ?? {} as LookupRow)}" will be deactivated and hidden from active selection lists. You can reactivate it later.`
            : `"${rowLabel(pendingToggleRow ?? {} as LookupRow)}" will be marked active again.`
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

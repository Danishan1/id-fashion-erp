"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

type HierarchyModule = "PRODUCTION" | "CRM" | "HRMS";
const MODULES: { key: HierarchyModule; label: string }[] = [
  { key: "PRODUCTION", label: "Production" },
  { key: "CRM", label: "CRM" },
  { key: "HRMS", label: "HRMS" },
];

interface Line {
  id: string;
  module: HierarchyModule;
  startDate: string;
  endDate: string | null;
  manager: { id: string; fullName: string; employeeCode: string };
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
}

/**
 * P3: who this employee reports to in each module. A module with no line
 * uses the general "Reports To" above. A manager sees everyone below them.
 */
export function ReportingLinesSection({
  employeeId,
  generalManagerName,
  canEdit,
}: {
  employeeId: string;
  generalManagerName: string | null;
  canEdit: boolean;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [editing, setEditing] = useState<HierarchyModule | null>(null);
  const [managerId, setManagerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/employees/${employeeId}/reporting-lines`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setLoadError(body?.error?.message ?? "Couldn't load reporting lines.");
        else setLines(body?.data ?? []);
      })
      .catch(() => !cancelled && setLoadError("Couldn't load reporting lines."));
    return () => {
      cancelled = true;
    };
  }, [employeeId, reloadKey]);

  const openEditor = (module: HierarchyModule) => {
    const current = lines?.find((l) => l.module === module);
    setManagerId(current?.manager.id ?? "");
    setStartDate(current?.startDate.slice(0, 10) ?? "");
    setEndDate(current?.endDate?.slice(0, 10) ?? "");
    setError(null);
    setEditing(module);
    if (employees.length === 0) {
      fetch("/api/v1/employees?pageSize=500")
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => setEmployees(body.data ?? []))
        .catch(() => {});
    }
  };

  const save = async (module: HierarchyModule, manager: string | null) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/reporting-lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module,
          managerId: manager,
          ...(manager && startDate ? { startDate } : {}),
          ...(manager ? { endDate: endDate || null } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to save.");
        return;
      }
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const editingLabel = MODULES.find((m) => m.key === editing)?.label ?? "";

  return (
    <div className="max-w-xl">
      <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Reporting Lines</h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Who this employee reports to in each module. A manager sees everyone below them. A module with no line uses
        the general Reports To{generalManagerName ? ` (${generalManagerName})` : ""}.
      </p>
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {lines && (
        <table className="w-full text-sm">
          <tbody>
            {MODULES.map(({ key, label }) => {
              const line = lines.find((l) => l.module === key);
              return (
                <tr key={key} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="py-2 pr-3 font-medium text-zinc-700 dark:text-zinc-200">{label}</td>
                  <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                    {line ? (
                      <>
                        {line.manager.fullName}{" "}
                        <span className="text-zinc-500 dark:text-zinc-400">
                          ({line.manager.employeeCode}) · from {line.startDate.slice(0, 10)}
                          {line.endDate ? ` to ${line.endDate.slice(0, 10)}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {generalManagerName ? `Uses Reports To (${generalManagerName})` : "No manager"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEditor(key)}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        {line ? "Change" : "Set"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={`${editingLabel} manager`} maxWidthClass="max-w-lg">
        {editing && (
          <div className="space-y-4">
            <FormField label="Manager" htmlFor="lineManager" required>
              <SearchableSelect
                id="lineManager"
                value={managerId}
                onChange={setManagerId}
                options={employees
                  .filter((e) => e.id !== employeeId)
                  .map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }))}
                placeholder="Search employee…"
              />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="From" htmlFor="lineStart">
                <input id="lineStart" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={textInputClass()} />
              </FormField>
              <FormField label="Until (optional)" htmlFor="lineEnd">
                <input id="lineEnd" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={textInputClass()} />
              </FormField>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center justify-between gap-3">
              {lines?.some((l) => l.module === editing) ? (
                <button
                  type="button"
                  onClick={() => save(editing, null)}
                  disabled={saving}
                  className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-60"
                >
                  Remove line
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => save(editing, managerId)}
                  disabled={saving || !managerId}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { MODULES, ACTIONS, permissionKey, type Module } from "@/config/rbac";

interface CatalogEntry {
  key: string;
  module: string;
  granted: boolean;
}

export function RolePermissionMatrix({
  roleId,
  initialCatalog,
  canManage,
}: {
  roleId: string;
  initialCatalog: CatalogEntry[];
  // Fully pre-computed by the page (2026-09-25) — already accounts for the
  // base administration_roles:edit grant AND the two hard locks
  // (SUPER_ADMIN's own row, and a role the current actor holds themselves),
  // so this component itself makes no further judgment call. See page.tsx
  // for the explanatory messaging shown above this table for each lock.
  canManage: boolean;
}) {
  const initialGranted = useMemo(() => new Set(initialCatalog.filter((c) => c.granted).map((c) => c.key)), [initialCatalog]);
  const [granted, setGranted] = useState<Set<string>>(initialGranted);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const editable = canManage;

  function toggle(key: string) {
    if (!editable) return;
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleRow(module: Module) {
    if (!editable) return;
    const keysInRow = ACTIONS.map((a) => permissionKey(module, a));
    const allGranted = keysInRow.every((k) => granted.has(k));
    setGranted((prev) => {
      const next = new Set(prev);
      keysInRow.forEach((k) => (allGranted ? next.delete(k) : next.add(k)));
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/administration/roles/${roleId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantedKeys: Array.from(granted) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save permissions");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save permissions");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-zinc-500">Module</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-2 text-center font-medium text-zinc-500">
                  {a}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {MODULES.map((module) => (
              <tr key={module}>
                <td className="whitespace-nowrap px-3 py-2">
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => toggleRow(module)}
                    className="text-left text-zinc-900 hover:underline disabled:no-underline dark:text-zinc-100"
                    title="Toggle every action for this module"
                  >
                    {module.replace(/_/g, " ")}
                  </button>
                </td>
                {ACTIONS.map((action) => {
                  const key = permissionKey(module, action);
                  return (
                    <td key={key} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={granted.has(key)}
                        onChange={() => toggle(key)}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Permissions"}
          </button>
        </div>
      )}
    </div>
  );
}

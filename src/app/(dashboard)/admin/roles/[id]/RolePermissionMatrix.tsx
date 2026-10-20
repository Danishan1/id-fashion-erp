"use client";

import { useMemo, useState } from "react";
import { ACTIONS, permissionKey, type Action, type Module } from "@/config/rbac";
import { PERMISSION_GROUPS, moduleLabel, relevantActions } from "@/config/permission-groups";

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
  // P6: only meaningful actions per module are offered unless this is on.
  const [showAllActions, setShowAllActions] = useState(false);
  const [filter, setFilter] = useState("");

  /** Actions shown for a module: meaningful ones plus anything already granted. */
  const actionsFor = (module: Module): Action[] =>
    showAllActions ? [...ACTIONS] : ACTIONS.filter((a) => relevantActions(module).includes(a) || granted.has(permissionKey(module, a)));

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
    const keysInRow = actionsFor(module).map((a) => permissionKey(module, a));
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter modules…"
          aria-label="Filter modules"
          className="w-full max-w-xs rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={showAllActions} onChange={(e) => setShowAllActions(e.target.checked)} />
          Show all actions
        </label>
      </div>

      {PERMISSION_GROUPS.map((group) => {
        const term = filter.trim().toLowerCase();
        const modules = group.modules.filter(
          (m) => !term || m.includes(term.replace(/ /g, "_")) || moduleLabel(m).toLowerCase().includes(term) || group.label.toLowerCase().includes(term)
        );
        if (modules.length === 0) return null;
        return (
          <section key={group.key} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <h3 className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
              {group.label}
            </h3>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {modules.map((module) => {
                const actions = actionsFor(module);
                return (
                  <li key={module} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                    <button
                      type="button"
                      disabled={!editable}
                      onClick={() => toggleRow(module)}
                      className="w-44 shrink-0 text-left text-sm font-medium text-zinc-900 hover:underline disabled:no-underline dark:text-zinc-100"
                      title="Toggle every action shown for this module"
                    >
                      {moduleLabel(module)}
                    </button>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {actions.map((action) => {
                        const key = permissionKey(module, action);
                        return (
                          <label key={key} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                            <input
                              type="checkbox"
                              disabled={!editable}
                              checked={granted.has(key)}
                              onChange={() => toggle(key)}
                              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700"
                            />
                            {action.replace(/_/g, " ")}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

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

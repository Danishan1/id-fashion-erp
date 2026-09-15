"use client";

import { useState } from "react";

interface BranchEntry {
  id: string;
  name: string;
  code: string;
  granted: boolean;
}

interface BranchAccess {
  isRestricted: boolean;
  branches: BranchEntry[];
}

export function RoleBranchAccessPanel({
  roleId,
  initialAccess,
  canManage,
}: {
  roleId: string;
  initialAccess: BranchAccess;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAccess.branches.filter((b) => b.granted).map((b) => b.id)));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(id: string) {
    if (!canManage) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/administration/roles/${roleId}/branches`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchIds: Array.from(selected) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save branch access");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save branch access");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Branch Access</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Restricts anyone holding this role to only the selected branches&apos; own records (e.g. a &ldquo;Store
          Manager&rdquo; role checked to just Gurugram Factory won&apos;t see Warehouses/Stock/Material Requests
          belonging to any other branch, even though they hold the same underlying module permissions.{" "}
          <strong>Select nothing to leave this role unrestricted</strong> (sees every branch, the default for every
          role today).
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <div className="flex flex-wrap gap-2">
        {initialAccess.branches.map((branch) => (
          <label
            key={branch.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              selected.has(branch.id)
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            } ${!canManage ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              disabled={!canManage}
              checked={selected.has(branch.id)}
              onChange={() => toggle(branch.id)}
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700"
            />
            {branch.name}
          </label>
        ))}
      </div>

      <p className="text-xs text-zinc-400">
        {selected.size === 0
          ? "Currently unrestricted — this role sees every branch."
          : `Currently restricted to ${selected.size} of ${initialAccess.branches.length} branch(es).`}
      </p>

      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Branch Access"}
          </button>
        </div>
      )}
    </div>
  );
}

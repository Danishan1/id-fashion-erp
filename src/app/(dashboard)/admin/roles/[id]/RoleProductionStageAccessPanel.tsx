"use client";

import { useState } from "react";

interface StageEntry {
  id: string;
  name: string;
  code: string;
  granted: boolean;
}

interface StageAccess {
  isRestricted: boolean;
  stages: StageEntry[];
}

export function RoleProductionStageAccessPanel({
  roleId,
  initialAccess,
  canManage,
}: {
  roleId: string;
  initialAccess: StageAccess;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialAccess.stages.filter((s) => s.granted).map((s) => s.id)));
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
      const res = await fetch(`/api/v1/administration/roles/${roleId}/production-stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageIds: Array.from(selected) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Failed to save production stage access");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save production stage access");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Production Stage Access</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Restricts anyone holding this role to only the selected production stages — e.g. a &ldquo;Cutting Supervisor&rdquo; role
          checked to just Cutting won&apos;t see or be able to act on Lots/Job Orders sitting at Stitching, Finishing, or any
          other stage, even though they hold the same underlying Production permissions. <strong>Select nothing to leave this
          role unrestricted</strong> (sees every stage, the default for every role today).
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}

      <div className="flex flex-wrap gap-2">
        {initialAccess.stages.map((stage) => (
          <label
            key={stage.id}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
              selected.has(stage.id)
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            } ${!canManage ? "opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              disabled={!canManage}
              checked={selected.has(stage.id)}
              onChange={() => toggle(stage.id)}
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50 dark:border-zinc-700"
            />
            {stage.name}
          </label>
        ))}
      </div>

      <p className="text-xs text-zinc-400">
        {selected.size === 0 ? "Currently unrestricted — this role sees every production stage." : `Currently restricted to ${selected.size} of ${initialAccess.stages.length} stage(s).`}
      </p>

      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Stage Access"}
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SUBMODULE_KEYS, SUBMODULE_REGISTRY, type SubmoduleKey } from "@/config/submodule-registry";

interface VisibilityState {
  isVisible: boolean;
  isLocked: boolean;
}
type VisibilityMap = Partial<Record<SubmoduleKey, VisibilityState>>;

/**
 * Lets a Super Admin hide, per company, tabbed-masters submodules this
 * company doesn't use -- starting with Fabric Configuration's GSM/Dye/Weave
 * Type/Width/Composition. Once a submodule already has real data, it locks
 * (toggle disabled, "Locked" caption) -- see SubmoduleVisibilityService for
 * why that's derived live rather than stored.
 */
export function AdminModuleVisibilityPanel({ canManage }: { canManage: boolean }) {
  const [map, setMap] = useState<VisibilityMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<SubmoduleKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/submodule-visibility")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load.");
        setMap(body.data ?? {});
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Failed to load."));
  }, []);

  const groups = new Map<string, SubmoduleKey[]>();
  for (const key of SUBMODULE_KEYS) {
    const group = SUBMODULE_REGISTRY[key].group;
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }

  const confirmToggle = async () => {
    if (!pendingKey || !map) return;
    const current = map[pendingKey];
    const nextVisible = !(current?.isVisible ?? true);

    setIsSaving(true);
    setActionError(null);
    const res = await fetch(`/api/v1/submodule-visibility/${pendingKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible: nextVisible }),
    });
    setIsSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error?.message ?? "Failed to update.");
      setPendingKey(null);
      return;
    }

    const body = await res.json();
    setMap(body.data);
    setPendingKey(null);
  };

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  if (!map) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Hide master-data types this company doesn&apos;t use — they disappear from their Masters tab and from every
        form that offers them. Once a type has real data, its visibility locks and can no longer be changed.
      </p>
      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {[...groups.entries()].map(([group, keys]) => (
        <div key={group}>
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{group}</h3>
          <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {keys.map((key) => {
              const state = map[key] ?? { isVisible: true, isLocked: false };
              return (
                <div key={key} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-zinc-900 dark:text-zinc-50">{SUBMODULE_REGISTRY[key].label}</p>
                    {state.isLocked && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">Locked — has existing data</p>
                    )}
                  </div>
                  <ToggleSwitch
                    checked={state.isVisible}
                    disabled={!canManage || state.isLocked}
                    label={state.isVisible ? "Visible — click to hide" : "Hidden — click to show"}
                    onToggle={() => setPendingKey(key)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <ConfirmModal
        open={pendingKey !== null}
        title={
          pendingKey && (map[pendingKey]?.isVisible ?? true)
            ? `Hide "${SUBMODULE_REGISTRY[pendingKey].label}"?`
            : `Show "${pendingKey ? SUBMODULE_REGISTRY[pendingKey].label : ""}"?`
        }
        message={
          pendingKey && (map[pendingKey]?.isVisible ?? true)
            ? `"${SUBMODULE_REGISTRY[pendingKey].label}" will disappear from its Masters tab and from every form that offers it, for every user in this company.`
            : `"${pendingKey ? SUBMODULE_REGISTRY[pendingKey].label : ""}" will become visible again everywhere.`
        }
        confirmLabel={pendingKey && (map[pendingKey]?.isVisible ?? true) ? "Hide" : "Show"}
        isDangerous={Boolean(pendingKey && (map[pendingKey]?.isVisible ?? true))}
        isBusy={isSaving}
        onConfirm={confirmToggle}
        onCancel={() => setPendingKey(null)}
      />
    </div>
  );
}

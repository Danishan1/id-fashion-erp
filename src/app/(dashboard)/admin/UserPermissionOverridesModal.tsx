"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ACTIONS, type Action, type Module } from "@/config/rbac";
import { PERMISSION_GROUPS, moduleLabel, relevantActions } from "@/config/permission-groups";

interface Override {
  id: string;
  effect: "GRANT" | "DENY";
  reason: string;
  createdAt: string;
  action: string;
  permission: { key: string; module: string };
  createdBy: { id: string; fullName: string } | null;
}

/**
 * P6: per-user exceptions to their roles. GRANT adds one permission, DENY
 * removes one even if a role grants it (a DENY always wins).
 */
export function UserPermissionOverridesModal({
  user,
  onClose,
}: {
  user: { id: string; fullName: string } | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Override[] | null>(null);
  const [module, setModule] = useState<Module | "">("");
  const [action, setAction] = useState<Action | "">("");
  const [effect, setEffect] = useState<"GRANT" | "DENY">("DENY");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch(`/api/v1/administration/users/${user.id}/permission-overrides`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error?.message ?? "Couldn't load overrides.");
          setRows([]);
        } else setRows(body?.data ?? []);
      })
      .catch(() => !cancelled && setError("Couldn't load overrides."));
    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  const actionOptions = useMemo(() => (module ? relevantActions(module) : []), [module]);
  const otherActions = useMemo(() => (module ? ACTIONS.filter((a) => !actionOptions.includes(a)) : []), [module, actionOptions]);

  const save = async () => {
    if (!user || busy || !module || !action) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${user.id}/permission-overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, action, effect, reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to save.");
        return;
      }
      setModule("");
      setAction("");
      setReason("");
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/administration/users/${user.id}/permission-overrides/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to remove.");
        return;
      }
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!user} onClose={onClose} title={`Permission overrides — ${user?.fullName ?? ""}`} maxWidthClass="max-w-2xl">
      <div className="space-y-5">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Exceptions to this user&apos;s roles. <strong>Grant</strong> adds one permission; <strong>Deny</strong> removes one
          even if a role grants it. A deny always wins.
        </p>

        {rows === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No overrides — this user has exactly what their roles grant.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span
                    className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.effect === "DENY"
                        ? "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300"
                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
                    }`}
                  >
                    {r.effect === "DENY" ? "Deny" : "Grant"}
                  </span>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {moduleLabel(r.permission.module)} · {r.action.replace(/_/g, " ")}
                  </span>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {r.reason} — {r.createdBy?.fullName ?? "—"}, {new Date(r.createdAt).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  disabled={busy}
                  className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-60"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Add or change an override</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Module" htmlFor="ovModule" required>
              <select
                id="ovModule"
                value={module}
                onChange={(e) => {
                  setModule(e.target.value as Module | "");
                  setAction("");
                }}
                className={textInputClass()}
              >
                <option value="">— Select —</option>
                {PERMISSION_GROUPS.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.modules.map((m) => (
                      <option key={m} value={m}>
                        {moduleLabel(m)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </FormField>
            <FormField label="Action" htmlFor="ovAction" required>
              <select
                id="ovAction"
                value={action}
                onChange={(e) => setAction(e.target.value as Action | "")}
                disabled={!module}
                className={textInputClass()}
              >
                <option value="">— Select —</option>
                {actionOptions.map((a) => (
                  <option key={a} value={a}>
                    {a.replace(/_/g, " ")}
                  </option>
                ))}
                {otherActions.length > 0 && (
                  <optgroup label="Other actions">
                    {otherActions.map((a) => (
                      <option key={a} value={a}>
                        {a.replace(/_/g, " ")}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </FormField>
            <FormField label="Effect" htmlFor="ovEffect" required>
              <select id="ovEffect" value={effect} onChange={(e) => setEffect(e.target.value as "GRANT" | "DENY")} className={textInputClass()}>
                <option value="DENY">Deny</option>
                <option value="GRANT">Grant</option>
              </select>
            </FormField>
          </div>
          <FormField label="Reason" htmlFor="ovReason" required>
            <input id="ovReason" value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !module || !action || reason.trim().length < 3}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save override"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

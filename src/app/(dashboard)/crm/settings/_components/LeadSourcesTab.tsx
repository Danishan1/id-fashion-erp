"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { useSettingsList } from "./useSettingsList";

interface SourceRow {
  id: string;
  key: string;
  name: string;
  isSystem: boolean;
  isActive: boolean;
}

const URL_BASE = "/api/v1/crm/settings/lead-sources";

function SourceModal({ source, onClose, onSaved }: { source: SourceRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(source?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await crmRequest(source ? `${URL_BASE}/${source.id}` : URL_BASE, { method: source ? "PATCH" : "POST", body: { name }, successMessage: source ? "Source renamed." : "Source added." });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.name ?? res.error.message);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={source ? `Rename "${source.name}"` : "Add lead source"}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="source-name" required>
          <input id="source-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
          {source && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Key &quot;{source.key}&quot; stays the same, so imports and connectors keep working.</p>}
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {source ? "Save" : "Add source"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LeadSourcesTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<SourceRow>(URL_BASE);
  const [editing, setEditing] = useState<SourceRow | "new" | null>(null);

  const toggle = async (s: SourceRow) => {
    const res = await crmRequest(`${URL_BASE}/${s.id}`, { method: "PATCH", body: { isActive: !s.isActive }, successMessage: s.isActive ? "Source deactivated." : "Source activated." });
    if (res.ok) reload();
  };

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Where leads come from. System sources (manual, import, API, connectors) can be renamed but not deactivated.</p>
        {canEdit && <Button onClick={() => setEditing("new")}>Add source</Button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Active</th>
              {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((s) => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{s.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{s.key}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">{s.isSystem ? "System" : "Custom"}</td>
                <td className="px-3 py-2">
                  <ToggleSwitch checked={s.isActive} disabled={!canEdit || s.isSystem} label={`${s.name} active`} onToggle={() => toggle(s)} />
                </td>
                {canEdit && (
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(s)}>
                      Rename
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <SourceModal
          source={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

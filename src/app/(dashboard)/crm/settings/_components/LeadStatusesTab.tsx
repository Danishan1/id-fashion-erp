"use client";

import { useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { LEAD_STATUS_COLORS } from "@/modules/crm/settings/crm-defaults";
import { useSettingsList } from "./useSettingsList";

interface StatusRow {
  id: string;
  key: string;
  name: string;
  kind: "OPEN" | "CONVERTED" | "LOST";
  color: string | null;
  isDefault: boolean;
  isActive: boolean;
}

const KIND_LABELS = { OPEN: "Open", CONVERTED: "Converted", LOST: "Lost" } as const;
const URL_BASE = "/api/v1/crm/settings/lead-statuses";

function StatusModal({ status, onClose, onSaved }: { status: StatusRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(status?.name ?? "");
  const [kind, setKind] = useState<StatusRow["kind"]>(status?.kind ?? "OPEN");
  const [color, setColor] = useState(status?.color ?? "neutral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = status ? { name, kind: kind === status.kind ? undefined : kind, color } : { name, kind, color };
    const res = await crmRequest(status ? `${URL_BASE}/${status.id}` : URL_BASE, { method: status ? "PATCH" : "POST", body, successMessage: status ? "Status updated." : "Status added." });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.name ?? res.error.message);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={status ? `Edit "${status.name}"` : "Add lead status"}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="status-name" required>
          <input id="status-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </FormField>
        <FormField label="Meaning" htmlFor="status-kind">
          <select id="status-kind" className={textInputClass()} value={kind} onChange={(e) => setKind(e.target.value as StatusRow["kind"])}>
            {Object.entries(KIND_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Open statuses are active work. Converted is set by Convert. Lost closes the lead.</p>
        </FormField>
        <FormField label="Colour" htmlFor="status-color">
          <div id="status-color" className="flex flex-wrap gap-2">
            {LEAD_STATUS_COLORS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="radio" name="status-color" checked={color === c} onChange={() => setColor(c)} />
                <CrmBadge label={name || "Sample"} tone={c as CrmBadgeTone} />
              </label>
            ))}
          </div>
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {status ? "Save" : "Add status"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function LeadStatusesTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload, setRows } = useSettingsList<StatusRow>(URL_BASE);
  const [editing, setEditing] = useState<StatusRow | "new" | null>(null);

  const patch = async (s: StatusRow, body: Record<string, unknown>, message: string) => {
    const res = await crmRequest(`${URL_BASE}/${s.id}`, { method: "PATCH", body, successMessage: message });
    if (res.ok) reload();
  };

  const move = async (index: number, delta: number) => {
    if (!rows) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setRows(next);
    const res = await crmRequest(`${URL_BASE}/reorder`, { method: "POST", body: { ids: next.map((r) => r.id) }, toast: "errors" });
    if (!res.ok) reload();
  };

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">The order here is the order in lead pickers and filters. Statuses in use can be deactivated but not deleted.</p>
        {canEdit && <Button onClick={() => setEditing("new")}>Add status</Button>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Key</th>
              <th className="px-3 py-2">Meaning</th>
              <th className="px-3 py-2">Default</th>
              <th className="px-3 py-2">Active</th>
              {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((s, i) => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td className="px-3 py-2">
                  <CrmBadge label={s.name} tone={(s.color ?? "neutral") as CrmBadgeTone} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{s.key}</td>
                <td className="px-3 py-2">{KIND_LABELS[s.kind]}</td>
                <td className="px-3 py-2">
                  {s.isDefault ? (
                    <span className="text-xs font-medium text-green-700 dark:text-green-400">Default for new leads</span>
                  ) : canEdit && s.isActive && s.kind === "OPEN" ? (
                    <button type="button" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => patch(s, { isDefault: true }, `"${s.name}" is now the default.`)}>
                      Make default
                    </button>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <ToggleSwitch
                    checked={s.isActive}
                    disabled={!canEdit}
                    label={`${s.name} active`}
                    onToggle={() => patch(s, { isActive: !s.isActive }, s.isActive ? "Status deactivated." : "Status activated.")}
                  />
                </td>
                {canEdit && (
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${s.name} down`}
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                      className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                    >
                      ↓
                    </button>
                    <button type="button" className="ml-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <StatusModal
          status={editing === "new" ? null : editing}
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

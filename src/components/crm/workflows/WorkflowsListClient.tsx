"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CrmBadge } from "@/components/crm/CrmBadge";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/date-format";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";
import { WORKFLOWS_API, toneOf, useWorkflowMeta, type DefaultWorkflowDto, type WorkflowDto, type WorkflowListRowDto } from "./workflow-types";

/** Phase 18 — workflow list (status / trigger filters, search, run counts). */
export function WorkflowsListClient({ permissions }: { permissions: CrmPagePermissions }) {
  const { meta, error, reload } = useWorkflowMeta();
  // `?new=1` (dashboard quick action) opens the "New workflow" dialog for users who may create one.
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(searchParams.get("new") === "1" && permissions.settingsEdit);
  const [showDefaults, setShowDefaults] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [turningOff, setTurningOff] = useState<WorkflowListRowDto | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const refresh = () => setRefreshKey((k) => k + 1);
  /** On = published; off = disabled. Paused workflows are turned on (resumed). */
  const setOn = async (r: WorkflowListRowDto, on: boolean) => {
    setToggling(r.id);
    const res = await crmRequest(`${WORKFLOWS_API}/${r.id}/${on ? "resume" : "disable"}`, { method: "POST", body: { version: r.version }, successMessage: on ? `"${r.name}" turned on` : `"${r.name}" turned off` });
    setToggling(null);
    setTurningOff(null);
    if (res.ok) refresh();
  };
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!meta) return <CrmLoadingState />;
  const filters: CrmFilterDefinition[] = [
    { type: "select", key: "statuses", label: "Status", options: meta.statuses.map((s) => ({ value: s.key, label: s.label })), anyLabel: "All but archived" },
    { type: "select", key: "triggers", label: "Trigger", options: meta.triggers.map((t) => ({ value: t.key, label: `${t.group}: ${t.label}` })) },
  ];
  const tone = (s: string) => toneOf(meta.statuses.find((x) => x.key === s)?.tone);
  return (
    <div className="space-y-3">
      <CrmTable<WorkflowListRowDto>
        fetchUrl={WORKFLOWS_API}
        refreshKey={refreshKey}
        filters={filters}
        searchPlaceholder="Search workflows…"
        rowHref={(r) => `/crm/workflows/${r.id}`}
        newAction={permissions.settingsEdit ? { label: "New workflow", onClick: () => setCreating(true) } : undefined}
        initialSort={{ sortBy: "updatedAt", sortOrder: "desc" }}
        toolbar={
          <>
          <Button variant="secondary" onClick={() => setShowDefaults(true)}>
            Default automations
          </Button>
          <Link className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" href="/crm/workflows/executions">
            All executions
          </Link>
          </>
        }
        columns={[
          {
            key: "name",
            header: "Name",
            sortable: true,
            render: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/crm/workflows/${r.id}`}>
                  {r.name}
                </Link>
                {r.templateKey && <CrmBadge label="Default" tone="indigo" />}
              </span>
            ),
          },
          ...(permissions.settingsEdit
            ? [
                {
                  key: "onOff",
                  header: "On",
                  render: (r: WorkflowListRowDto) =>
                    r.publishedVersionNumber && r.status !== "ARCHIVED" ? (
                      <OnOffSwitch on={r.status === "PUBLISHED"} label={r.name} busy={toggling === r.id} onChange={(on) => (on ? setOn(r, true) : setTurningOff(r))} />
                    ) : (
                      <span className="text-xs text-zinc-500" title="Publish the workflow before turning it on">—</span>
                    ),
                },
              ]
            : []),
          { key: "triggerLabel", header: "Trigger", render: (r) => r.triggerLabel },
          { key: "status", header: "Status", sortable: true, render: (r) => <span className="flex items-center gap-1"><CrmBadge label={r.statusLabel} tone={tone(r.status)} />{r.hasDraft && r.publishedVersionNumber ? <CrmBadge label="Unpublished changes" tone="amber" /> : null}</span> },
          { key: "version", header: "Live version", render: (r) => (r.publishedVersionNumber ? `v${r.publishedVersionNumber}` : "—") },
          { key: "stats", header: "Runs (active / done / failed)", render: (r) => `${r.stats.active} / ${r.stats.completed} / ${r.stats.failed}` },
          { key: "lastTriggeredAt", header: "Last triggered", sortable: true, render: (r) => (r.lastTriggeredAt ? formatDateTime(r.lastTriggeredAt) : "—") },
          { key: "updatedAt", header: "Updated", sortable: true, render: (r) => formatDateTime(r.updatedAt) },
        ]}
      />
      {creating && <NewWorkflowDialog meta={meta} onClose={() => setCreating(false)} />}
      {showDefaults && <DefaultWorkflowsDialog canEdit={permissions.settingsEdit} onClose={() => setShowDefaults(false)} onInstalled={refresh} />}
      {turningOff && (
        <ConfirmModal
          open
          title={`Turn off "${turningOff.name}"?`}
          message="New triggers are ignored and its queued or waiting runs are cancelled. You can turn it back on at any time."
          confirmLabel="Turn off"
          isDangerous
          isBusy={toggling === turningOff.id}
          onConfirm={() => setOn(turningOff, false)}
          onCancel={() => setTurningOff(null)}
        />
      )}
    </div>
  );
}

function NewWorkflowDialog({ meta, onClose }: { meta: NonNullable<ReturnType<typeof useWorkflowMeta>["meta"]>; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState(meta.triggers[0]?.key ?? "lead.created");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groups = [...new Set(meta.triggers.map((t) => t.group))];
  const submit = async () => {
    setBusy(true);
    const r = await crmRequest<WorkflowDto>(WORKFLOWS_API, { method: "POST", body: { name, description: description || undefined, trigger }, successMessage: "Workflow created" });
    setBusy(false);
    if (r.ok) router.push(`/crm/workflows/${r.data.id}`);
    else setErr(r.error.message);
  };
  return (
    <Modal open onClose={onClose} title="New workflow" maxWidthClass="max-w-lg">
      <div className="space-y-3">
        <FormField label="Name" htmlFor="nw-name" required>
          <input id="nw-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </FormField>
        <FormField label="Description" htmlFor="nw-desc">
          <textarea id="nw-desc" rows={2} className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Trigger" htmlFor="nw-trigger">
          <select id="nw-trigger" className={textInputClass()} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {meta.triggers.filter((t) => t.group === g).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FormField>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={busy} disabled={!name.trim()}>
            Create draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OnOffSwitch({ on, label, busy, onChange }: { on: boolean; label: string; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange(!on);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-600"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

/** Default automations: see the catalogue and add the ones this company doesn't have yet. */
function DefaultWorkflowsDialog({ canEdit, onClose, onInstalled }: { canEdit: boolean; onClose: () => void; onInstalled: () => void }) {
  const [rows, setRows] = useState<DefaultWorkflowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    crmRequest<DefaultWorkflowDto[]>(`${WORKFLOWS_API}/defaults`).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setError(r.error.message);
      setRows(r.data);
      setSelected(new Set(r.data.filter((d) => !d.installed).map((d) => d.key)));
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  const missing = rows?.filter((d) => !d.installed) ?? [];
  const install = async () => {
    setBusy(true);
    setResult(null);
    const r = await crmRequest<{ installed: { key: string }[]; skipped: { key: string; reason: string }[] }>(`${WORKFLOWS_API}/defaults`, { method: "POST", body: { keys: [...selected] }, toast: "errors" });
    setBusy(false);
    if (!r.ok) return;
    const failed = r.data.skipped.filter((s) => s.reason !== "Already added.");
    setResult(`${r.data.installed.length} added.${failed.length ? ` ${failed.length} could not be added: ${failed.map((f) => `${f.key} (${f.reason})`).join("; ")}` : ""}`);
    onInstalled();
    setTick((t) => t + 1);
  };
  const groups = [...new Set((rows ?? []).map((d) => d.category))];
  return (
    <Modal open onClose={onClose} title="Default automations" maxWidthClass="max-w-3xl">
      <div className="mt-2 space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Ready-made workflows for common CRM routines. Each one becomes a normal workflow you can turn on or off, edit or archive. Added ones run as you; those marked <em>Starts on</em> begin running immediately, the rest are added switched off for you to review.
        </p>
        {error ? (
          <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
        ) : !rows ? (
          <CrmLoadingState />
        ) : (
          <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
            {groups.map((g) => (
              <section key={g}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g}</h3>
                <ul className="space-y-1.5">
                  {rows
                    .filter((d) => d.category === g)
                    .map((d) => (
                      <li key={d.key} className="flex items-start gap-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          id={`def-${d.key}`}
                          disabled={!canEdit || Boolean(d.installed)}
                          checked={Boolean(d.installed) || selected.has(d.key)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(d.key);
                            else next.delete(d.key);
                            setSelected(next);
                          }}
                        />
                        <label htmlFor={`def-${d.key}`} className="min-w-0 flex-1 text-sm">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{d.name}</span>
                            {d.installed ? <CrmBadge label={`Added · ${d.installed.statusLabel}`} tone="green" /> : <CrmBadge label={d.enabledByDefault ? "Starts on" : "Starts off"} tone={d.enabledByDefault ? "indigo" : "neutral"} />}
                          </span>
                          <span className="block text-xs text-zinc-500">
                            {d.triggerLabel} · {d.steps} step{d.steps === 1 ? "" : "s"} — {d.description}
                          </span>
                        </label>
                        {d.installed && (
                          <Link className="shrink-0 text-xs text-indigo-700 hover:underline dark:text-indigo-300" href={`/crm/workflows/${d.installed.id}`}>
                            Open
                          </Link>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {result && (
          <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">
            {result}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!canEdit && <span className="mr-auto text-xs text-zinc-500">You need CRM settings edit rights to add automations.</span>}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button onClick={install} isLoading={busy} disabled={!selected.size || !missing.length}>
              {missing.length ? `Add ${selected.size} automation${selected.size === 1 ? "" : "s"}` : "All added"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}


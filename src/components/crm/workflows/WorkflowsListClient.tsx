"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/date-format";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";
import { WORKFLOWS_API, toneOf, useWorkflowMeta, type WorkflowDto, type WorkflowListRowDto } from "./workflow-types";

/** Phase 18 — workflow list (status / trigger filters, search, run counts). */
export function WorkflowsListClient({ permissions }: { permissions: CrmPagePermissions }) {
  const { meta, error, reload } = useWorkflowMeta();
  const [creating, setCreating] = useState(false);
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
        filters={filters}
        searchPlaceholder="Search workflows…"
        rowHref={(r) => `/crm/workflows/${r.id}`}
        newAction={permissions.settingsEdit ? { label: "New workflow", onClick: () => setCreating(true) } : undefined}
        initialSort={{ sortBy: "updatedAt", sortOrder: "desc" }}
        toolbar={
          <Link className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" href="/crm/workflows/executions">
            All executions
          </Link>
        }
        columns={[
          { key: "name", header: "Name", sortable: true, render: (r) => <Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/crm/workflows/${r.id}`}>{r.name}</Link> },
          { key: "triggerLabel", header: "Trigger", render: (r) => r.triggerLabel },
          { key: "status", header: "Status", sortable: true, render: (r) => <span className="flex items-center gap-1"><CrmBadge label={r.statusLabel} tone={tone(r.status)} />{r.hasDraft && r.publishedVersionNumber ? <CrmBadge label="Unpublished changes" tone="amber" /> : null}</span> },
          { key: "version", header: "Live version", render: (r) => (r.publishedVersionNumber ? `v${r.publishedVersionNumber}` : "—") },
          { key: "stats", header: "Runs (active / done / failed)", render: (r) => `${r.stats.active} / ${r.stats.completed} / ${r.stats.failed}` },
          { key: "lastTriggeredAt", header: "Last triggered", sortable: true, render: (r) => (r.lastTriggeredAt ? formatDateTime(r.lastTriggeredAt) : "—") },
          { key: "updatedAt", header: "Updated", sortable: true, render: (r) => formatDateTime(r.updatedAt) },
        ]}
      />
      {creating && <NewWorkflowDialog meta={meta} onClose={() => setCreating(false)} />}
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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { formatDateTime } from "@/lib/date-format";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";
import { definitionEntities, type WorkflowDefinition } from "@/modules/crm/workflows/workflow-definition";
import { ExecutionTrace } from "./ExecutionTrace";
import { IssueList, WorkflowEditor } from "./WorkflowEditor";
import { WORKFLOWS_API, toneOf, useWorkflowMeta, type DefinitionIssueDto, type ExecutionDetailDto, type ExecutionRowDto, type WorkflowDto, type WorkflowMetaDto, type WorkflowVersionDto } from "./workflow-types";

type Tab = "builder" | "test" | "versions" | "executions" | "settings";

const LIFECYCLE_ACTIONS: { to: string; path: string; label: string; danger?: boolean; confirm?: string }[] = [
  { to: "PAUSED", path: "pause", label: "Pause", confirm: "New triggers are ignored and running executions hold until you resume." },
  { to: "PUBLISHED", path: "resume", label: "Resume" },
  { to: "DISABLED", path: "disable", label: "Disable", danger: true, confirm: "New triggers are ignored and every queued, waiting or paused execution is cancelled." },
  { to: "ARCHIVED", path: "archive", label: "Archive", danger: true, confirm: "The workflow stops, its waiting executions are cancelled, and it is hidden from the list. You can restore it later." },
  { to: "DRAFT", path: "restore", label: "Restore" },
];

/** Phase 18 — one workflow: editor, test run, versions, executions, secret. */
export function WorkflowDetailClient({ id, permissions }: { id: string; permissions: CrmPagePermissions }) {
  const router = useRouter();
  const { meta, error: metaError } = useWorkflowMeta();
  const [wf, setWf] = useState<WorkflowDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [def, setDef] = useState<WorkflowDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<DefinitionIssueDto[]>([]);
  const [warnings, setWarnings] = useState<DefinitionIssueDto[]>([]);
  const [tab, setTab] = useState<Tab>("builder");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<(typeof LIFECYCLE_ACTIONS)[number] | null>(null);

  const load = useCallback(
    () =>
      crmRequest<WorkflowDto>(`${WORKFLOWS_API}/${id}`).then((r) => {
        if (!r.ok) return setError(r.error.message);
        setWf(r.data);
        setDef((r.data.draft ?? r.data.published)?.definition ?? null);
        setDirty(false);
      }),
    [id]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (error || metaError) return <CrmErrorState message={(error ?? metaError)!} onRetry={load} />;
  if (!wf || !meta || !def) return <CrmLoadingState />;

  const canEdit = permissions.settingsEdit && wf.status !== "ARCHIVED";
  const meta_ = meta;
  const statusTone = toneOf(meta.statuses.find((s) => s.key === wf.status)?.tone);

  const saveDraft = async () => {
    setBusy("save");
    const r = await crmRequest<{ workflow: WorkflowDto; issues: DefinitionIssueDto[] }>(`${WORKFLOWS_API}/${id}/draft`, { method: "PUT", body: { version: wf.version, definition: def }, successMessage: "Draft saved" });
    setBusy(null);
    if (!r.ok) return;
    setWf(r.data.workflow);
    setIssues(r.data.issues);
    setWarnings([]);
    setDirty(false);
  };
  const validate = async () => {
    if (dirty) await saveDraft();
    setBusy("validate");
    const r = await crmRequest<{ valid: boolean; errors: DefinitionIssueDto[]; warnings: DefinitionIssueDto[] }>(`${WORKFLOWS_API}/${id}/validate`, { method: "POST", toast: "errors" });
    setBusy(null);
    if (r.ok) {
      setIssues(r.data.errors);
      setWarnings(r.data.warnings);
    }
  };
  const publish = async () => {
    setBusy("publish");
    const current = dirty ? await crmRequest<{ workflow: WorkflowDto }>(`${WORKFLOWS_API}/${id}/draft`, { method: "PUT", body: { version: wf.version, definition: def }, toast: "errors" }) : null;
    if (current && !current.ok) return setBusy(null);
    const version = current?.ok ? current.data.workflow.version : wf.version;
    const r = await crmRequest<{ workflow: WorkflowDto; warnings: DefinitionIssueDto[] }>(`${WORKFLOWS_API}/${id}/publish`, { method: "POST", body: { version }, toast: "off" });
    setBusy(null);
    if (r.ok) {
      setIssues([]);
      setWarnings(r.data.warnings);
      await load();
    } else {
      const d = r.error.details as { errors?: DefinitionIssueDto[]; warnings?: DefinitionIssueDto[] } | null;
      setIssues(d?.errors ?? [{ path: "", message: r.error.message }]);
      setWarnings(d?.warnings ?? []);
      await load();
    }
  };
  const discard = async () => {
    setBusy("discard");
    const r = await crmRequest<WorkflowDto>(`${WORKFLOWS_API}/${id}/draft`, { method: "DELETE", body: { version: wf.version }, successMessage: "Draft discarded" });
    setBusy(null);
    if (r.ok) await load();
  };
  const lifecycle = async (a: (typeof LIFECYCLE_ACTIONS)[number]) => {
    setBusy(a.path);
    const r = await crmRequest<WorkflowDto>(`${WORKFLOWS_API}/${id}/${a.path}`, { method: "POST", body: { version: wf.version }, successMessage: `Workflow ${a.label.toLowerCase()}d` });
    setBusy(null);
    setConfirm(null);
    if (r.ok) await load();
  };
  const duplicate = async () => {
    const r = await crmRequest<{ id: string }>(`${WORKFLOWS_API}/${id}/duplicate`, { method: "POST", body: {}, successMessage: "Workflow duplicated" });
    if (r.ok) router.push(`/crm/workflows/${r.data.id}`);
  };

  const editingVersion = wf.draft ?? wf.published;
  const tabs: { key: Tab; label: string }[] = [
    { key: "builder", label: "Builder" },
    { key: "test", label: "Test run" },
    { key: "versions", label: "Versions" },
    { key: "executions", label: `Executions (${wf.stats.total})` },
    { key: "settings", label: "Details & secret" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{wf.name}</h2>
            <CrmBadge label={wf.statusLabel} tone={statusTone} />
            {wf.published && <CrmBadge label={`Live v${wf.published.versionNumber}`} tone="green" />}
            {wf.draft && <CrmBadge label={`Draft v${wf.draft.versionNumber}`} tone="amber" />}
            {dirty && <CrmBadge label="Unsaved changes" tone="red" />}
          </div>
          <p className="text-xs text-zinc-500">
            {wf.triggerLabel} · runs as {wf.runAs?.name ?? "— (set when published)"} · {wf.stats.active} active, {wf.stats.completed} completed, {wf.stats.failed} failed
            {wf.lastTriggeredAt ? ` · last triggered ${formatDateTime(wf.lastTriggeredAt)}` : ""}
          </p>
        </div>
        {permissions.settingsEdit && (
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="secondary" onClick={saveDraft} isLoading={busy === "save"} disabled={!dirty}>
                Save draft
              </Button>
            )}
            {canEdit && (
              <Button variant="secondary" onClick={validate} isLoading={busy === "validate"}>
                Validate
              </Button>
            )}
            {canEdit && (wf.draft || dirty) && (
              <Button onClick={publish} isLoading={busy === "publish"}>
                Publish
              </Button>
            )}
            {canEdit && wf.draft && wf.published && (
              <Button variant="secondary" onClick={discard} isLoading={busy === "discard"}>
                Discard draft
              </Button>
            )}
            {LIFECYCLE_ACTIONS.filter((a) => wf.allowedTransitions.includes(a.to)).map((a) => (
              <Button key={a.path} variant={a.danger ? "danger" : "secondary"} isLoading={busy === a.path} onClick={() => (a.confirm ? setConfirm(a) : lifecycle(a))}>
                {a.label}
              </Button>
            ))}
            <Button variant="secondary" onClick={duplicate}>
              Duplicate
            </Button>
          </div>
        )}
      </div>

      {(issues.length > 0 || warnings.length > 0) && (
        <div className="space-y-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          {issues.length > 0 && <p className="text-sm font-medium text-red-600">{issues.length} problem(s) to fix</p>}
          <IssueList issues={issues} />
          {warnings.length > 0 && <p className="text-sm font-medium text-amber-700">Warnings</p>}
          <IssueList issues={warnings} tone="amber" />
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`px-3 py-2 text-sm ${tab === t.key ? "border-b-2 border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "text-zinc-500"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "builder" && (
        <>
          {!wf.draft && wf.published && canEdit && <p className="text-xs text-zinc-500">You are looking at the live version. Saving creates a new draft — the live version keeps running until you publish.</p>}
          <WorkflowEditor
            value={def}
            onChange={(d) => {
              setDef(d);
              setDirty(true);
            }}
            meta={meta_}
            issues={issues}
            readOnly={!canEdit}
          />
          {editingVersion?.changeNote && <p className="text-xs text-zinc-500">Change note: {editingVersion.changeNote}</p>}
        </>
      )}
      {tab === "test" && <TestPanel wf={wf} def={def} dirty={dirty} meta={meta_} canEdit={permissions.settingsEdit} />}
      {tab === "versions" && <VersionsPanel id={id} />}
      {tab === "executions" && <ExecutionsPanel id={id} meta={meta_} />}
      {tab === "settings" && <DetailsPanel wf={wf} canEdit={canEdit} onSaved={load} />}

      {confirm && (
        <ConfirmModal open title={`${confirm.label} workflow?`} message={confirm.confirm ?? ""} confirmLabel={confirm.label} isDangerous={confirm.danger} isBusy={busy === confirm.path} onConfirm={() => lifecycle(confirm)} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}

const PICKERS: Record<string, { url: string; toOption: (r: Record<string, unknown>) => CrmPickedRecord }> = {
  LEAD: { url: "/api/v1/crm/leads?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.fullName ?? r.companyName ?? r.id), sublabel: (r.leadNumber as string) ?? null }) },
  CONTACT: { url: "/api/v1/crm/contacts/lookup", toOption: (r) => ({ id: String(r.id), label: String(r.fullName ?? r.id), sublabel: (r.email as string) ?? null }) },
  COMPANY: { url: "/api/v1/crm/companies/lookup", toOption: (r) => ({ id: String(r.id), label: String(r.name ?? r.id), sublabel: (r.city as string) ?? null }) },
  OPPORTUNITY: { url: "/api/v1/crm/opportunities?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.name ?? r.id), sublabel: (r.opportunityNumber as string) ?? null }) },
  ACTIVITY: { url: "/api/v1/crm/activities?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.subject ?? r.id), sublabel: (r.type as string) ?? null }) },
  CONVERSATION: { url: "/api/v1/crm/conversations?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.displayName ?? r.displayIdentifier ?? r.id), sublabel: (r.channelType as string) ?? null }) },
};

function TestPanel({ wf, def, dirty, meta, canEdit }: { wf: WorkflowDto; def: WorkflowDefinition; dirty: boolean; meta: WorkflowMetaDto; canEdit: boolean }) {
  const entities = definitionEntities(def);
  const [entityType, setEntityType] = useState(entities[0] ?? "LEAD");
  const [record, setRecord] = useState<CrmPickedRecord | null>(null);
  const [source, setSource] = useState<"draft" | "published">(wf.draft ? "draft" : "published");
  const [payload, setPayload] = useState("");
  const [busy, setBusy] = useState<"test" | "run" | null>(null);
  const [result, setResult] = useState<{ execution: ExecutionDetailDto; enrolment: { wouldEnrol: boolean; explanation: string[] } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const picker = PICKERS[entityType];

  const run = async (kind: "test" | "run") => {
    if (!record) return;
    let triggerPayload: Record<string, unknown> | undefined;
    if (kind === "test" && payload.trim()) {
      try {
        triggerPayload = JSON.parse(payload);
      } catch {
        return setErr("The trigger payload isn't valid JSON.");
      }
    }
    setErr(null);
    setBusy(kind);
    const r =
      kind === "test"
        ? await crmRequest<{ execution: ExecutionDetailDto; enrolment: { wouldEnrol: boolean; explanation: string[] } | null }>(`${WORKFLOWS_API}/${wf.id}/test`, { method: "POST", body: { entityType, entityId: record.id, source, triggerPayload }, toast: "errors" })
        : await crmRequest<ExecutionDetailDto>(`${WORKFLOWS_API}/${wf.id}/run`, { method: "POST", body: { entityType, entityId: record.id }, successMessage: "Workflow started" });
    setBusy(null);
    if (!r.ok) {
      const d = r.error.details as { errors?: DefinitionIssueDto[] } | null;
      return setErr([r.error.message, ...(d?.errors ?? []).map((e) => e.message)].join(" "));
    }
    setResult(kind === "test" ? (r.data as { execution: ExecutionDetailDto; enrolment: { wouldEnrol: boolean; explanation: string[] } | null }) : { execution: r.data as ExecutionDetailDto, enrolment: null });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A test is a dry run on a real record: conditions are checked for real, but every action only reports what it <em>would</em> do and waits are skipped. Nothing is changed, sent or called.
        {dirty && <strong className="text-amber-700"> Save the draft first — tests run the saved version.</strong>}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Record type" htmlFor="t-entity">
          <select
            id="t-entity"
            className={textInputClass()}
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value as typeof entityType);
              setRecord(null);
            }}
          >
            {(entities.length ? entities : ["LEAD"]).map((e) => (
              <option key={e} value={e}>
                {meta.entities.find((x) => x.key === e)?.label ?? e}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Record" htmlFor="t-record">
          {picker ? <CrmRecordPicker<Record<string, unknown> & { id: string }> id="t-record" lookupUrl={picker.url} value={record} onChange={(r) => setRecord(r)} toOption={picker.toOption} placeholder="Search…" /> : <span className="text-sm text-zinc-500">Not supported</span>}
        </FormField>
        <FormField label="Version" htmlFor="t-source">
          <select id="t-source" className={textInputClass()} value={source} onChange={(e) => setSource(e.target.value as "draft" | "published")}>
            {wf.draft && <option value="draft">Draft v{wf.draft.versionNumber}</option>}
            {wf.published && <option value="published">Live v{wf.published.versionNumber}</option>}
          </select>
        </FormField>
      </div>
      <FormField label='Simulated trigger data (JSON, optional — e.g. { "toStageId": "…" })' htmlFor="t-payload">
        <textarea id="t-payload" rows={2} className={`${textInputClass()} font-mono text-xs`} value={payload} onChange={(e) => setPayload(e.target.value)} />
      </FormField>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <Button onClick={() => run("test")} isLoading={busy === "test"} disabled={!record}>
          Run test (dry run)
        </Button>
        {canEdit && wf.status === "PUBLISHED" && (
          <Button variant="secondary" onClick={() => run("run")} isLoading={busy === "run"} disabled={!record}>
            Start for real on this record
          </Button>
        )}
      </div>
      {result && (
        <div className="space-y-2">
          {result.enrolment && (
            <div className={`rounded-md p-2 text-sm ${result.enrolment.wouldEnrol ? "bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-300" : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"}`}>
              {result.enrolment.wouldEnrol ? "This record matches the enrolment conditions." : "This record would NOT be enrolled — the enrolment conditions don't match (the test ran anyway)."}
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.enrolment.explanation.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          <ExecutionTrace execution={result.execution} meta={meta} />
        </div>
      )}
    </div>
  );
}

function VersionsPanel({ id }: { id: string }) {
  const [rows, setRows] = useState<WorkflowVersionDto[] | null>(null);
  const [view, setView] = useState<WorkflowVersionDto | null>(null);
  useEffect(() => {
    crmRequest<WorkflowVersionDto[]>(`${WORKFLOWS_API}/${id}/versions`).then((r) => r.ok && setRows(r.data));
  }, [id]);
  if (!rows) return <CrmLoadingState />;
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="py-1">Version</th>
            <th>Status</th>
            <th>Steps</th>
            <th>Created</th>
            <th>Published</th>
            <th>Runs</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">v{v.versionNumber}</td>
              <td>
                <CrmBadge label={v.status === "PUBLISHED" ? "Live" : v.status === "SUPERSEDED" ? "Superseded" : "Draft"} tone={v.status === "PUBLISHED" ? "green" : v.status === "DRAFT" ? "amber" : "neutral"} />
              </td>
              <td>{v.definition.nodes.length}</td>
              <td>
                {formatDateTime(v.createdAt)} · {v.createdBy.name ?? "—"}
              </td>
              <td>{v.publishedAt ? `${formatDateTime(v.publishedAt)} · ${v.publishedBy?.name ?? "—"}` : "—"}</td>
              <td>{v.executions ?? 0}</td>
              <td className="max-w-xs truncate">{v.changeNote ?? ""}</td>
              <td>
                <Button variant="secondary" size="xs" onClick={() => setView(view?.id === v.id ? null : v)}>
                  {view?.id === v.id ? "Hide" : "View"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {view && <pre className="max-h-[480px] overflow-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-900">{JSON.stringify(view.definition, null, 2)}</pre>}
      <p className="text-xs text-zinc-500">Published versions can never be changed. Each execution keeps the version it started on.</p>
    </div>
  );
}

function ExecutionsPanel({ id, meta }: { id: string; meta: WorkflowMetaDto }) {
  return (
    <CrmTable<ExecutionRowDto>
      fetchUrl={`${WORKFLOWS_API}/${id}/executions`}
      syncWithUrl={false}
      filters={[
        { type: "select", key: "statuses", label: "Status", options: meta.executionStatuses.map((s) => ({ value: s.key, label: s.label })) },
        { type: "select", key: "mode", label: "Mode", options: [{ value: "LIVE", label: "Live" }, { value: "TEST", label: "Tests" }], anyLabel: "Live" },
      ]}
      rowHref={(r) => `/crm/workflows/executions/${r.id}`}
      initialSort={{ sortBy: "createdAt", sortOrder: "desc" }}
      columns={executionColumns(meta, false)}
    />
  );
}

export function executionColumns(meta: WorkflowMetaDto, showWorkflow: boolean) {
  return [
    ...(showWorkflow ? [{ key: "workflow", header: "Workflow", render: (r: ExecutionRowDto) => r.workflow.name }] : []),
    { key: "createdAt", header: "Started", sortable: true, render: (r: ExecutionRowDto) => <Link className="text-indigo-700 hover:underline dark:text-indigo-300" href={`/crm/workflows/executions/${r.id}`}>{formatDateTime(r.createdAt)}</Link> },
    { key: "record", header: "Record", render: (r: ExecutionRowDto) => (r.record ? (r.record.href ? <Link className="hover:underline" href={r.record.href}>{r.record.label}</Link> : r.record.label) : "—") },
    { key: "status", header: "Status", sortable: true, render: (r: ExecutionRowDto) => <CrmBadge label={r.statusLabel + (r.mode === "TEST" ? " (test)" : "")} tone={toneOf(meta.executionStatuses.find((s) => s.key === r.status)?.tone)} /> },
    { key: "version", header: "Version", render: (r: ExecutionRowDto) => `v${r.versionNumber}` },
    { key: "trigger", header: "Trigger", render: (r: ExecutionRowDto) => r.triggerLabel },
    { key: "nextRunAt", header: "Next run", sortable: true, render: (r: ExecutionRowDto) => (r.nextRunAt && !["COMPLETED", "FAILED", "CANCELLED", "EXITED"].includes(r.status) ? formatDateTime(r.nextRunAt) : "—") },
    { key: "error", header: "Error / exit", render: (r: ExecutionRowDto) => r.error?.message ?? r.exitReason ?? "" },
  ];
}

function DetailsPanel({ wf, canEdit, onSaved }: { wf: WorkflowDto; canEdit: boolean; onSaved: () => void }) {
  const [name, setName] = useState(wf.name);
  const [description, setDescription] = useState(wf.description ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await crmRequest(`${WORKFLOWS_API}/${wf.id}`, { method: "PATCH", body: { version: wf.version, name, description: description || null }, successMessage: "Saved" });
    setBusy(false);
    if (r.ok) onSaved();
  };
  const reveal = async (rotate: boolean) => {
    const r = await crmRequest<{ secret: string }>(`${WORKFLOWS_API}/${wf.id}/webhook-secret`, { method: rotate ? "POST" : "GET", ...(rotate ? { successMessage: "Secret rotated" } : {}) });
    if (r.ok) setSecret(r.data.secret);
  };
  return (
    <div className="max-w-2xl space-y-4">
      <FormField label="Name" htmlFor="d-name" required>
        <input id="d-name" disabled={!canEdit} className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Description" htmlFor="d-desc">
        <textarea id="d-desc" disabled={!canEdit} rows={3} className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      {canEdit && (
        <Button onClick={save} isLoading={busy} disabled={!name.trim()}>
          Save details
        </Button>
      )}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h3 className="text-sm font-semibold">Webhook signing secret</h3>
        <p className="text-xs text-zinc-500">
          &quot;Call a webhook&quot; steps sign every request with this secret: header <code>X-CRM-Signature: t=&lt;unix&gt;,v1=&lt;hex HMAC-SHA256 of &quot;t.body&quot;&gt;</code>. Receivers should reject requests older than 5 minutes and de-duplicate on <code>Idempotency-Key</code>.
        </p>
        {secret && <code className="block break-all rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">{secret}</code>}
        {canEdit && wf.hasWebhookSecret && (
          <div className="flex gap-2">
            <Button variant="secondary" size="xs" onClick={() => reveal(false)}>
              Reveal
            </Button>
            <Button variant="secondary" size="xs" onClick={() => reveal(true)}>
              Rotate
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        Created by {wf.createdBy.name ?? "—"}. {wf.publishedAt ? `Last published ${formatDateTime(wf.publishedAt)} by ${wf.publishedBy?.name ?? "—"}.` : "Never published."}
      </p>
    </div>
  );
}

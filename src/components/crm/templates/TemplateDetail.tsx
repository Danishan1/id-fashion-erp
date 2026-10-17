"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { toast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/date-format";
import type { TemplateAction } from "@/modules/crm/templates/template-registry";
import { DuplicateTemplateDialog, TemplateTestSendDialog } from "./TemplateDialogs";
import { PreviewContextPicker, TemplateIssueList, TemplatePreviewPane, TemplateStatusBadge, useTemplateMeta } from "./TemplateParts";
import { TEMPLATES_API, type TemplateDetailDto, type TemplatePreviewContext, type TemplatePreviewDto, type TemplateVersionDto } from "./template-types";

const ACTION_COPY: Record<TemplateAction, { label: string; title: string; message: string; danger?: boolean; done: string }> = {
  activate: { label: "Activate", title: "Activate this template?", message: "It will be offered when sending messages. New messages use the current version.", done: "Template activated." },
  deactivate: { label: "Deactivate", title: "Deactivate this template?", message: "It goes back to draft and won't be offered for new messages. Messages already sent are not changed.", done: "Template deactivated." },
  archive: { label: "Archive", title: "Archive this template?", message: "It won't be offered for new messages. Its versions and the messages sent from it are kept; you can restore it later.", danger: true, done: "Template archived." },
  restore: { label: "Restore", title: "Restore this template?", message: "It comes back as a draft. Activate it again to use it for sending.", done: "Template restored as a draft." },
};

function VersionCard({ v, channelType, canRestore, onRestore }: { v: TemplateVersionDto; channelType: string; canRestore: boolean; onRestore: (v: TemplateVersionDto) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">Version {v.versionNumber}</span>
        {v.isCurrent && <CrmBadge label="Current" tone="indigo" />}
        {v.restoredFromNumber && <span className="text-xs text-zinc-500">restored from v{v.restoredFromNumber}</span>}
        <span className="text-xs text-zinc-500">
          {formatDateTime(v.createdAt)} · {v.createdBy.name ?? "—"}
          {v.usageCount ? ` · used ${v.usageCount}×` : ""}
        </span>
        {v.changeNote && <span className="w-full text-xs text-zinc-600 dark:text-zinc-400">“{v.changeNote}”</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {channelType === "EMAIL" && (
            <p className="text-sm">
              <span className="text-xs text-zinc-500">Subject: </span>
              {v.subject}
            </p>
          )}
          <pre className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" data-testid={`version-${v.versionNumber}-body`}>
            {v.body}
          </pre>
          {Object.keys(v.providerMetadata).length > 0 && <p className="text-xs text-zinc-500">Provider settings: {Object.entries(v.providerMetadata).map(([k, val]) => `${k} = ${val}`).join(", ")}</p>}
          {canRestore && !v.isCurrent && (
            <Button size="xs" variant="secondary" onClick={() => onRestore(v)}>
              Restore as new version
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** Template detail: current content + live preview, actions, usage, metadata, version history and audit history. */
export function TemplateDetail({ templateId, canCreate, canEdit }: { templateId: string; canCreate: boolean; canEdit: boolean }) {
  const router = useRouter();
  const { meta } = useTemplateMeta();
  const [t, setT] = useState<TemplateDetailDto | null>(null);
  const [versions, setVersions] = useState<TemplateVersionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<TemplatePreviewContext | null>(null);
  const [preview, setPreview] = useState<TemplatePreviewDto | null>(null);
  const [pending, setPending] = useState<TemplateAction | null>(null);
  const [restoring, setRestoring] = useState<TemplateVersionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([crmRequest<TemplateDetailDto>(`${TEMPLATES_API}/${templateId}`), crmRequest<TemplateVersionDto[]>(`${TEMPLATES_API}/${templateId}/versions`)]).then(([d, v]) => {
      if (cancelled) return;
      if (!d.ok) return setError(d.error.message);
      setError(null);
      setT(d.data);
      if (v.ok) setVersions(v.data);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId, tick]);
  useEffect(() => {
    if (!t) return;
    let cancelled = false;
    crmRequest<TemplatePreviewDto>(`${TEMPLATES_API}/${t.id}/preview`, { method: "POST", toast: "off", body: ctx ? { context: ctx } : { sample: true } }).then((res) => {
      if (!cancelled) setPreview(res.ok ? res.data : { subject: null, body: "", ok: false, missing: [], warnings: [], errors: [{ code: "ERROR", severity: "error", source: "template", message: res.error.message }] });
    });
    return () => {
      cancelled = true;
    };
  }, [t, ctx]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((x) => x + 1)} />;
  if (!t) return <CrmLoadingState />;
  const refresh = () => {
    setTick((x) => x + 1);
    router.refresh();
  };

  const runAction = async () => {
    if (!pending) return;
    setBusy(true);
    const res = await crmRequest(`${TEMPLATES_API}/${t.id}/${pending}`, { method: "POST", toast: "off", body: { version: t.version } });
    setBusy(false);
    const a = pending;
    setPending(null);
    if (!res.ok) {
      const issues = (res.error.details?.errors as { message: string }[] | undefined)?.map((e) => e.message);
      return toast.error(issues?.length ? `${res.error.message} ${issues.join(" ")}` : res.error.message);
    }
    toast.success(ACTION_COPY[a].done);
    refresh();
  };
  const restoreVersion = async () => {
    if (!restoring) return;
    setBusy(true);
    const res = await crmRequest<{ versionNumber: number }>(`${TEMPLATES_API}/${t.id}/versions/${restoring.id}/restore`, { method: "POST", toast: "errors", body: { version: t.version } });
    setBusy(false);
    setRestoring(null);
    if (res.ok) {
      toast.success(`Version ${restoring.versionNumber} restored as version ${res.data.versionNumber}.`);
      refresh();
    }
  };

  const actions: TemplateAction[] = t.status === "DRAFT" ? ["activate", "archive"] : t.status === "ACTIVE" ? ["deactivate", "archive"] : ["restore"];
  const copy = pending ? ACTION_COPY[pending] : null;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <TemplateStatusBadge status={t.status} />
        <CrmBadge label={t.channelLabel} tone="indigo" />
        {t.category && <CrmBadge label={t.category.name + (t.category.archived ? " (archived)" : "")} />}
        <span className="text-sm text-zinc-500">Version {t.currentVersionNumber}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && t.status !== "ARCHIVED" && (
            <Link href={`/crm/templates/${t.id}/edit`} className={buttonClasses("secondary")}>
              Edit
            </Link>
          )}
          {canCreate && (
            <Button variant="secondary" onClick={() => setDuplicating(true)}>
              Duplicate
            </Button>
          )}
          {canCreate && t.status !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => setTesting(true)} disabled={!meta}>
              Test send
            </Button>
          )}
          {canEdit &&
            actions.map((a) => (
              <Button key={a} variant={a === "archive" ? "danger" : a === "activate" || a === "restore" ? "primary" : "secondary"} onClick={() => setPending(a)} disabled={a === "activate" && Boolean(t.validation && !t.validation.valid)} title={a === "activate" && t.validation && !t.validation.valid ? "Fix the errors first" : undefined}>
                {ACTION_COPY[a].label}
              </Button>
            ))}
        </div>
      </div>

      {t.status === "ARCHIVED" && <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Archived {t.archivedAt ? formatDateTime(t.archivedAt) : ""}{t.archivedBy?.name ? ` by ${t.archivedBy.name}` : ""}. It can’t be used for new messages; history is kept.</p>}
      {t.validation && !t.validation.valid && <TemplateIssueList errors={t.validation.errors} warnings={[]} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2" aria-labelledby="tpl-content">
          <h2 id="tpl-content" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Current text (version {t.currentVersionNumber})
          </h2>
          {t.channelType === "EMAIL" && <p className="text-sm"><span className="text-xs text-zinc-500">Subject: </span>{t.currentVersion?.subject}</p>}
          <pre className="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">{t.currentVersion?.body}</pre>
          {t.currentVersion && t.currentVersion.variables.length > 0 && <p className="text-xs text-zinc-500">Variables: {t.currentVersion.variables.map((v) => `{{${v}}}`).join(", ")}</p>}
          {t.validation && t.validation.warnings.length > 0 && <TemplateIssueList errors={[]} warnings={t.validation.warnings} />}
        </section>
        <section className="space-y-2" aria-labelledby="tpl-preview">
          <h2 id="tpl-preview" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Preview
          </h2>
          <PreviewContextPicker value={ctx} onChange={setCtx} />
          <TemplatePreviewPane preview={preview} channelType={t.channelType} />
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-2" aria-labelledby="tpl-usage">
          <h2 id="tpl-usage" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Usage
          </h2>
          {t.usage.map((u) => (
            <div key={u.key} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <p className="font-medium text-zinc-800 dark:text-zinc-100">{u.label}</p>
              <p className="text-zinc-600 dark:text-zinc-400">
                {u.count ? `${u.count} message${u.count === 1 ? "" : "s"}` : "Not used yet"}
                {u.lastUsedAt ? ` · last ${formatDateTime(u.lastUsedAt)}` : ""}
              </p>
              {u.count > 0 && <p className="text-xs text-zinc-500">{Object.entries(u.byVersion).map(([n, c]) => `v${n}: ${c}`).join(" · ")}</p>}
              {u.activeReferences.map((r, i) => (
                <p key={i} className="text-xs">
                  {r.href ? <Link href={r.href}>{r.label}</Link> : r.label}
                </p>
              ))}
            </div>
          ))}
          <p className="text-xs text-zinc-500">Sequences and workflows will list their references here when they arrive.</p>
        </section>
        <section className="space-y-1 text-sm lg:col-span-2" aria-labelledby="tpl-meta">
          <h2 id="tpl-meta" className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Details
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {t.description && (
              <>
                <dt className="text-zinc-500">Description</dt>
                <dd>{t.description}</dd>
              </>
            )}
            <dt className="text-zinc-500">Created</dt>
            <dd>
              {formatDateTime(t.createdAt)} by {t.createdBy.name ?? "—"}
            </dd>
            <dt className="text-zinc-500">Updated</dt>
            <dd>
              {formatDateTime(t.updatedAt)}
              {t.updatedBy?.name ? ` by ${t.updatedBy.name}` : ""}
            </dd>
            {t.activatedAt && (
              <>
                <dt className="text-zinc-500">Last activated</dt>
                <dd>
                  {formatDateTime(t.activatedAt)}
                  {t.activatedBy?.name ? ` by ${t.activatedBy.name}` : ""}
                </dd>
              </>
            )}
            {t.duplicatedFrom && (
              <>
                <dt className="text-zinc-500">Copied from</dt>
                <dd>
                  <Link className="text-indigo-600 hover:underline" href={`/crm/templates/${t.duplicatedFrom.id}`}>
                    {t.duplicatedFrom.name}
                  </Link>
                </dd>
              </>
            )}
          </dl>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2" aria-labelledby="tpl-versions">
          <h2 id="tpl-versions" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Version history ({t.versionCount})
          </h2>
          {!versions ? (
            <CrmLoadingState />
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <VersionCard key={v.id} v={v} channelType={t.channelType} canRestore={canEdit && t.status !== "ARCHIVED"} onRestore={setRestoring} />
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2" aria-labelledby="tpl-history">
          <h2 id="tpl-history" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            History
          </h2>
          <CrmTimeline entityType="TEMPLATE" entityId={t.id} refreshKey={tick} emptyTitle="No history yet" />
        </section>
      </div>

      <ConfirmModal open={Boolean(copy)} title={copy?.title ?? ""} message={copy?.message ?? ""} confirmLabel={copy?.label} isDangerous={copy?.danger} isBusy={busy} onCancel={() => setPending(null)} onConfirm={runAction} />
      <ConfirmModal
        open={Boolean(restoring)}
        title={`Restore version ${restoring?.versionNumber}?`}
        message={`Its text is saved as a new version ${t.currentVersionNumber + 1}. No version is changed or deleted.${t.status === "ACTIVE" ? " New messages will use it straight away." : ""}`}
        confirmLabel="Restore"
        isBusy={busy}
        onCancel={() => setRestoring(null)}
        onConfirm={restoreVersion}
      />
      {meta && testing && <TemplateTestSendDialog open={testing} onClose={() => setTesting(false)} template={t} meta={meta} onSent={() => setTick((x) => x + 1)} />}
      {duplicating && <DuplicateTemplateDialog open={duplicating} onClose={() => setDuplicating(false)} template={t} onDone={(id) => router.push(`/crm/templates/${id}`)} />}
    </div>
  );
}

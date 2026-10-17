"use client";

import { useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { crmRequest } from "@/components/crm/crm-api";
import { textInputClass } from "@/components/ui/FormField";
import { TEMPLATE_STATUSES, type TemplateIssue, type TemplateStatus } from "@/modules/crm/templates/template-registry";
import { STATUS_TONE, TEMPLATES_API, type TemplateMetaDto, type TemplatePreviewContext, type TemplatePreviewDto } from "./template-types";

/** Channels, variables, categories… loaded once per screen. */
export function useTemplateMeta() {
  const [meta, setMeta] = useState<TemplateMetaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    crmRequest<TemplateMetaDto>(`${TEMPLATES_API}/meta`).then((res) => {
      if (cancelled) return;
      if (res.ok) setMeta(res.data);
      else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [tick]);
  return { meta, error, reload: () => setTick((t) => t + 1) };
}

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return <CrmBadge label={TEMPLATE_STATUSES[status]?.label ?? status} tone={STATUS_TONE[status] ?? "neutral"} />;
}

/** Errors (red) and warnings (amber); provider-level issues are labelled as such. */
export function TemplateIssueList({ errors, warnings, compact }: { errors: TemplateIssue[]; warnings: TemplateIssue[]; compact?: boolean }) {
  if (!errors.length && !warnings.length) return compact ? null : <p className="text-xs text-green-700 dark:text-green-400">✓ No problems found.</p>;
  return (
    <ul className="space-y-1 text-sm" aria-label="Template problems">
      {errors.map((e, i) => (
        <li key={`e${i}`} role="alert" className="rounded-md bg-red-50 px-2.5 py-1.5 text-red-800 dark:bg-red-500/10 dark:text-red-200">
          <span className="font-medium">{e.source === "provider" ? "Provider: " : "Error: "}</span>
          {e.message}
        </li>
      ))}
      {warnings.map((w, i) => (
        <li key={`w${i}`} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-medium">{w.source === "provider" ? "Provider note: " : "Note: "}</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Merge-field picker grouped by record. Inserts {{record.field}} at the caret.
 * Only fields the registry exposes are offered (no free database access).
 */
export function VariablePicker({ meta, onPick, disabled }: { meta: TemplateMetaDto; onPick: (key: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        {"{ }"} Insert variable
      </button>
      {open && (
        <div role="dialog" aria-label="Insert variable" className="absolute right-0 z-30 mt-1 max-h-80 w-72 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input autoFocus aria-label="Filter variables" className={`${textInputClass()} mb-2 py-1 text-xs`} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {meta.entities.map((ent) => {
            const vars = ent.variables.filter((v) => !f || v.label.toLowerCase().includes(f) || v.key.includes(f) || ent.label.toLowerCase().includes(f));
            if (!vars.length) return null;
            return (
              <div key={ent.key} className="mb-2">
                <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{ent.label}</p>
                <ul>
                  {vars.map((v) => (
                    <li key={v.key}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                        onClick={() => {
                          onPick(v.key);
                          setOpen(false);
                          setFilter("");
                        }}
                      >
                        <span className="text-zinc-800 dark:text-zinc-100">{v.label}</span>
                        <code className="truncate text-[10px] text-zinc-400">{`{{${v.key}}}`}</code>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="border-t border-zinc-100 px-1 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800">
            Missing values print nothing. Add a fallback after a bar: <code>{"{{contact.first_name|there}}"}</code>
            {meta.unavailable.map((u) => (
              <span key={u.key} className="mt-1 block">
                {u.reason}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

type RecordKind = "contactId" | "companyId" | "opportunityId" | "leadId";
const RECORD_KINDS: { key: RecordKind; label: string; url: string; toOption: (r: Record<string, unknown>) => CrmPickedRecord }[] = [
  { key: "contactId", label: "Contact", url: "/api/v1/crm/contacts/lookup", toOption: (r) => ({ id: String(r.id), label: String(r.fullName ?? ""), sublabel: ((r.crmCompany as { name?: string } | null)?.name ?? (r.email as string | null)) || null }) },
  { key: "companyId", label: "Company", url: "/api/v1/crm/companies/lookup", toOption: (r) => ({ id: String(r.id), label: String(r.name ?? ""), sublabel: (r.city as string | null) ?? null }) },
  { key: "opportunityId", label: "Opportunity", url: "/api/v1/crm/opportunities?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.name ?? ""), sublabel: (r.opportunityNumber as string | null) ?? null }) },
  { key: "leadId", label: "Lead", url: "/api/v1/crm/leads?pageSize=15", toOption: (r) => ({ id: String(r.id), label: String(r.fullName ?? ""), sublabel: (r.leadNumber as string | null) ?? null }) },
];

/** "Sample data" or a real record the user can see (the server checks access again). */
export function PreviewContextPicker({ value, onChange }: { value: TemplatePreviewContext | null; onChange: (ctx: TemplatePreviewContext | null) => void }) {
  const [kind, setKind] = useState<RecordKind | "sample">(value ? ((Object.keys(value)[0] as RecordKind) ?? "sample") : "sample");
  const [picked, setPicked] = useState<CrmPickedRecord | null>(null);
  const def = RECORD_KINDS.find((k) => k.key === kind);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-zinc-500" htmlFor="tpl-preview-kind">
        Preview with
      </label>
      <select
        id="tpl-preview-kind"
        className={`${textInputClass()} w-auto py-1 text-xs`}
        value={kind}
        onChange={(e) => {
          const k = e.target.value as RecordKind | "sample";
          setKind(k);
          setPicked(null);
          if (k === "sample") onChange(null);
        }}
      >
        <option value="sample">Sample data</option>
        {RECORD_KINDS.map((k) => (
          <option key={k.key} value={k.key}>
            A real {k.label.toLowerCase()}
          </option>
        ))}
      </select>
      {def && (
        <div className="min-w-[14rem] flex-1">
          <CrmRecordPicker<Record<string, unknown> & { id: string }>
            id={`tpl-preview-${def.key}`}
            lookupUrl={def.url}
            value={picked}
            placeholder={`Search ${def.label.toLowerCase()}s…`}
            toOption={def.toOption}
            onChange={(r) => {
              setPicked(r);
              onChange(r ? { [def.key]: r.id } : null);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Rendered result: subject, text, SMS parts, missing values and problems. */
export function TemplatePreviewPane({ preview, loading, channelType }: { preview: TemplatePreviewDto | null; loading?: boolean; channelType: string }) {
  if (!preview) return <p className="text-sm text-zinc-500">{loading ? "Rendering preview…" : "Nothing to preview yet."}</p>;
  return (
    <div className="space-y-2" aria-busy={loading}>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
        {channelType === "EMAIL" && (
          <p className="mb-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
            <span className="text-xs text-zinc-500">Subject: </span>
            <span className="font-medium text-zinc-900 dark:text-zinc-50" data-testid="preview-subject">
              {preview.subject || <em className="text-zinc-400">(empty)</em>}
            </span>
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-100" data-testid="preview-body">
          {preview.body || <em className="text-zinc-400">(empty)</em>}
        </p>
      </div>
      <p className="text-xs text-zinc-500">
        {preview.body.length.toLocaleString("en-IN")} characters
        {preview.sms ? ` · ${preview.sms.segments} SMS part${preview.sms.segments === 1 ? "" : "s"} (${preview.sms.encoding})` : ""}
        {preview.missing.length > 0 && ` · ${preview.missing.length} variable${preview.missing.length === 1 ? "" : "s"} without a value`}
      </p>
      <TemplateIssueList errors={preview.errors} warnings={preview.warnings} />
    </div>
  );
}

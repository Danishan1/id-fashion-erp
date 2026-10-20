"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { BULK_CAPABILITIES_API, BULK_JOBS_API, BULK_JOBS_PAGE, BULK_PREVIEW_API, type BulkActionCapabilityDto, type BulkCapabilitiesDto, type BulkJobDto, type BulkParamFieldDto, type BulkPreviewDto } from "./bulk-ui-types";

/**
 * Phase 14 — the reusable entry point to the Bulk Action Engine for any list
 * page: pick the records (ticked rows, or everything matching the list's
 * current filters), pick an action the server says is available, fill its
 * settings, review the count and summary, confirm, and the job runs in the
 * background. Everything shown (actions, reasons, fields, options) comes from
 * the capabilities API, so a new registered action appears here with no UI work.
 */
export function BulkActionsButton({
  entityType,
  selectedIds,
  filterQuery,
  onSubmitted,
  label = "Bulk actions",
  size = "sm",
}: {
  entityType: string;
  selectedIds: string[];
  /** The list's current filters + search, as the list API's query string. */
  filterQuery: string;
  onSubmitted?: (job: BulkJobDto) => void;
  label?: string;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <BulkActionDialog entityType={entityType} selectedIds={selectedIds} filterQuery={filterQuery} onClose={() => setOpen(false)} onSubmitted={onSubmitted} />}
    </>
  );
}

type Scope = "IDS" | "FILTER";
type Values = Record<string, unknown>;

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function BulkActionDialog({
  entityType,
  selectedIds,
  filterQuery,
  onClose,
  onSubmitted,
}: {
  entityType: string;
  selectedIds: string[];
  filterQuery: string;
  onClose: () => void;
  onSubmitted?: (job: BulkJobDto) => void;
}) {
  const [caps, setCaps] = useState<BulkCapabilitiesDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "IDS" : "FILTER");
  const [actionKey, setActionKey] = useState("");
  const [values, setValues] = useState<Values>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkPreviewDto | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<BulkJobDto | null>(null);
  // One key per dialog: a double click or a network retry can't create two jobs.
  const idempotencyKey = useRef(newKey());

  useEffect(() => {
    let live = true;
    void crmRequest<BulkCapabilitiesDto>(`${BULK_CAPABILITIES_API}?entityType=${encodeURIComponent(entityType)}`, { toast: "off" }).then((r) => {
      if (!live) return;
      if (r.ok) setCaps(r.data);
      else setLoadError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [entityType]);

  const action: BulkActionCapabilityDto | null = useMemo(() => caps?.actions.find((a) => a.key === actionKey) ?? null, [caps, actionKey]);
  const available = caps?.actions.filter((a) => a.available) ?? [];
  const unavailable = caps?.actions.filter((a) => !a.available) ?? [];
  const plural = caps?.entity.pluralLabel.toLowerCase() ?? "records";

  const selection = scope === "IDS" ? { mode: "IDS" as const, ids: selectedIds } : { mode: "FILTER" as const, filterQuery };

  const params = (): Values => {
    if (!action) return {};
    const out: Values = {};
    for (const f of action.fields) {
      const v = values[f.key];
      if (f.type === "tags") {
        out.tagIds = Array.isArray(v) ? v : [];
        if (f.allowNew) {
          out.tagNames = String(values.__newTags ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } else if (f.type === "number") {
        if (v !== undefined && v !== "") out[f.key] = Number(v);
      } else if (f.type === "user") {
        out[f.key] = v === "__none__" ? null : v === undefined || v === "" ? undefined : v;
      } else if (v !== undefined && v !== "") out[f.key] = v;
    }
    return out;
  };

  const runPreview = async () => {
    if (!action) return;
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    const r = await crmRequest<BulkPreviewDto>(BULK_PREVIEW_API, { method: "POST", body: { entityType, actionKey: action.key, selection, params: params() }, toast: "off" });
    setBusy(false);
    if (!r.ok) {
      setFormError(r.error.message);
      setFieldErrors(r.error.fieldErrors);
      return;
    }
    setPreview(r.data);
    setConfirmText("");
    setConfirmed(false);
  };

  const submit = async () => {
    if (!action || !preview) return;
    setBusy(true);
    setFormError(null);
    const r = await crmRequest<BulkJobDto>(BULK_JOBS_API, {
      method: "POST",
      body: { entityType, actionKey: action.key, selection, params: params(), idempotencyKey: idempotencyKey.current, ...(preview.confirmation === "type_count" ? { confirmCount: Number(confirmText) } : {}) },
      toast: "off",
    });
    setBusy(false);
    if (!r.ok) {
      setFormError(r.error.message);
      return;
    }
    setSubmitted(r.data);
    onSubmitted?.(r.data);
  };

  const canStart = preview && preview.count > 0 && (preview.confirmation === "none" || (preview.confirmation === "confirm" && confirmed) || (preview.confirmation === "type_count" && Number(confirmText) === preview.count));

  return (
    <Modal open onClose={onClose} title={submitted ? "Bulk job started" : preview ? `Review: ${preview.actionLabel}` : "Bulk action"} maxWidthClass="max-w-xl">
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {!caps && !loadError && <p className="text-sm text-zinc-500">Loading actions…</p>}

      {submitted && (
        <div className="space-y-3 text-sm">
          <p>
            <strong>{submitted.actionLabel}</strong> will run on {submitted.totalCount} {plural} in the background. You can leave this page; you&apos;ll get a notification when it finishes.
          </p>
          {submitted.duplicate && <p className="text-amber-700 dark:text-amber-300">This request was already submitted — showing the existing job.</p>}
          {submitted.queued === false && <p className="text-amber-700 dark:text-amber-300">The background worker isn&apos;t reachable right now. The job is saved and will start automatically when it is.</p>}
          {submitted.warnings?.map((w) => (
            <p key={w} className="text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Link href={`${BULK_JOBS_PAGE}/${submitted.id}`} className={buttonClasses("primary", "sm")}>
              View progress
            </Link>
          </div>
        </div>
      )}

      {caps && !submitted && !preview && (
        <div className="space-y-4">
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium">Records</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="bulk-scope" checked={scope === "IDS"} disabled={!selectedIds.length} onChange={() => setScope("IDS")} />
              Selected {plural} ({selectedIds.length})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="bulk-scope" checked={scope === "FILTER"} onChange={() => setScope("FILTER")} />
              All {plural} matching the current search and filters
            </label>
            {scope === "FILTER" && <p className="text-xs text-zinc-500">The matching records are fixed when you start: records added later are not included.</p>}
          </fieldset>

          <FormField label="Action" htmlFor="bulk-action" required>
            <select
              id="bulk-action"
              value={actionKey}
              onChange={(e) => {
                setActionKey(e.target.value);
                setValues({});
                setFieldErrors({});
                setFormError(null);
              }}
              className={textInputClass()}
            >
              <option value="">Choose an action…</option>
              {available.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </FormField>
          {action && <p className="-mt-2 text-xs text-zinc-500">{action.description}</p>}

          {action?.fields.map((f) => <ParamField key={f.key} field={f} values={values} setValues={setValues} error={fieldErrors[f.key] ?? fieldErrors[`params.${f.key}`]} />)}

          {unavailable.length > 0 && (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">Not available ({unavailable.length})</summary>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {unavailable.map((a) => (
                  <li key={a.key}>
                    <span className="font-medium">{a.label}:</span> {a.unavailableReason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={runPreview} disabled={!action || busy}>
              {busy ? "Checking…" : "Review"}
            </Button>
          </div>
        </div>
      )}

      {preview && !submitted && (
        <div className="space-y-3 text-sm">
          <p>
            <strong>{preview.count.toLocaleString()}</strong> {plural} will be processed{preview.summary ? <>: {preview.summary}</> : null}.
          </p>
          {preview.count === 0 && <p className="text-red-600 dark:text-red-400">There is nothing to process.</p>}
          {preview.sample.length > 0 && (
            <p className="text-xs text-zinc-500">
              For example: {preview.sample.join(", ")}
              {preview.count > preview.sample.length ? ", …" : ""}
            </p>
          )}
          {preview.warnings.map((w) => (
            <p key={w} className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {w}
            </p>
          ))}
          <p className="text-xs text-zinc-500">Each record is checked and changed separately: records that can&apos;t be changed are skipped or reported with the reason; the others still go through. Cancelling stops the remaining records but doesn&apos;t undo finished ones.</p>
          {preview.confirmation === "confirm" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Yes, apply this to {preview.count.toLocaleString()} {plural}.
            </label>
          )}
          {preview.confirmation === "type_count" && (
            <FormField label={`Type ${preview.count} to confirm`} htmlFor="bulk-confirm-count" required>
              <input id="bulk-confirm-count" inputMode="numeric" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={textInputClass()} autoComplete="off" />
            </FormField>
          )}
          {formError && <p className="text-red-600 dark:text-red-400">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
              Back
            </Button>
            <Button variant={preview.destructive ? "danger" : "primary"} onClick={submit} disabled={!canStart || busy}>
              {busy ? "Starting…" : `Start on ${preview.count.toLocaleString()} ${plural}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ParamField({ field, values, setValues, error }: { field: BulkParamFieldDto; values: Values; setValues: (fn: (v: Values) => Values) => void; error?: string }) {
  const id = `bulk-param-${field.key}`;
  const set = (v: unknown) => setValues((prev) => ({ ...prev, [field.key]: v }));
  const value = values[field.key];
  const required = "required" in field ? Boolean(field.required) : false;

  if (field.type === "tags") {
    const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
    return (
      <FormField label={field.label} htmlFor={id} error={error ?? undefined}>
        <div id={id} className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
          {field.options.length === 0 && <p className="text-xs text-zinc-500">No tags yet.</p>}
          {field.options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  set([...next]);
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
        {field.allowNew && (
          <input
            aria-label="New tags (comma separated)"
            placeholder="New tags, comma separated"
            value={String(values.__newTags ?? "")}
            onChange={(e) => setValues((prev) => ({ ...prev, __newTags: e.target.value }))}
            className={`${textInputClass()} mt-2`}
          />
        )}
      </FormField>
    );
  }

  if (field.type === "user" || field.type === "select") {
    const groups = field.type === "select" ? [...new Set(field.options.map((o) => o.group).filter(Boolean))] : [];
    return (
      <FormField label={field.label} htmlFor={id} required={required} error={error ?? undefined}>
        <select id={id} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={textInputClass(Boolean(error))}>
          <option value="">{field.type === "select" ? (field.placeholder ?? "Choose…") : "Choose a user…"}</option>
          {field.type === "user" && field.allowNone && <option value="__none__">{field.noneLabel ?? "None"}</option>}
          {groups.length
            ? groups.map((g) => (
                <optgroup key={g} label={g}>
                  {(field.options as { value: string; label: string; group?: string }[])
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))
            : field.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
        </select>
        {field.help && <p className="mt-1 text-xs text-zinc-500">{field.help}</p>}
      </FormField>
    );
  }

  return (
    <FormField label={field.label} htmlFor={id} required={required} error={error ?? undefined}>
      <input
        id={id}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        min={field.type === "number" ? field.min : undefined}
        max={field.type === "number" ? field.max : undefined}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        value={String(value ?? "")}
        onChange={(e) => set(e.target.value)}
        placeholder={field.type === "text" || field.type === "number" ? "Leave empty to keep as is" : undefined}
        className={textInputClass(Boolean(error))}
      />
      {field.help && <p className="mt-1 text-xs text-zinc-500">{field.help}</p>}
    </FormField>
  );
}

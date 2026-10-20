"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTagInput, type CrmTagChip } from "@/components/crm/CrmTagInput";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { TOAST_HEADER } from "@/lib/api-client";
import { downloadCsvFile } from "@/lib/csv";
import { CUSTOM_FIELD_PREFIX, LEAD_TARGET_FIELDS, validateLeadMapping, type LeadTargetField } from "@/modules/crm/ingestion/lead-field-catalog";
import { useLeadLookups } from "../../_components/useLeadLookups";
import { ImportStatusBadge } from "./ImportBadges";
import { ImportCounts, ImportProgress } from "./ImportCounts";
import { ImportRowsTable, type RowFilter } from "./ImportRowsTable";
import { FINISHED_STATUSES, POLICY_INFO, type DuplicatePolicy, type ImportJobDetailDto } from "./import-types";
import { useImportJob } from "./useImportJob";

const STEPS = ["Upload", "Source", "Map columns", "Preview", "Duplicates", "Import", "Result"] as const;
type Step = (typeof STEPS)[number];

function Stepper({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Import steps">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i === idx ? "step" : undefined}>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
              i < idx ? "border-indigo-600 bg-indigo-600 text-white" : i === idx ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-zinc-300 text-zinc-400 dark:border-zinc-700"
            }`}
          >
            {i < idx ? "✓" : i + 1}
          </span>
          <span className={i === idx ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"}>{s}</span>
          {i < STEPS.length - 1 && <span className="text-zinc-300 dark:text-zinc-700">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function downloadTemplate() {
  downloadCsvFile(
    "lead-import-template.csv",
    ["Name", "Company", "Designation", "Mobile", "Email", "City", "State", "Country", "Requirement", "Estimated value", "Source", "Tags", "Next follow up"],
    [["Asha Rao", "Rao Exports", "Buyer", "+91 98765 43210", "asha@example.com", "Tiruppur", "Tamil Nadu", "India", "5,000 polo shirts", "250000", "Trade fair", "export, vip", "15/10/2026"]]
  );
}

// ── Step 1: upload ───────────────────────────────────────────────

function UploadStep({ onUploaded }: { onUploaded: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) return setError("Choose a .csv or .xlsx file.");
    if (f.size > 20 * 1024 * 1024) return setError("The file is larger than 20 MB. Split it into smaller files.");
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/v1/crm/imports", { method: "POST", body: form, headers: { [TOAST_HEADER]: "off" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message ?? body?.error?.message ?? "Upload failed.");
      onUploaded(body.data.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Panel title="Upload a file" description="CSV or Excel (.xlsx), up to 20 MB and 25,000 rows. The first row must contain column names. Nothing is imported until you confirm.">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-10 text-center ${dragging ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10" : "border-zinc-300 dark:border-zinc-700"}`}
      >
        <p className="text-sm text-zinc-700 dark:text-zinc-200">{file ? <span className="font-medium">{file.name}</span> : "Drag a file here, or"}</p>
        <input ref={input} id="import-file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <label htmlFor="import-file" className={buttonClasses("secondary")}>
          {file ? "Choose another file" : "Choose file"}
        </label>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={downloadTemplate} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Download a sample file
        </button>
        <Button onClick={upload} disabled={!file} isLoading={busy} loadingLabel="Reading file…">
          Upload and continue
        </Button>
      </div>
    </Panel>
  );
}

// ── Step 2: source & options ─────────────────────────────────────

function SourceStep({ job, onSaved }: { job: ImportJobDetailDto; onSaved: (j: ImportJobDetailDto) => void }) {
  const { meta, users } = useLeadLookups();
  const [sourceId, setSourceId] = useState(job.sourceId ?? "");
  const [owner, setOwner] = useState<string>(job.options.defaultOwnerUserId === null ? "__none" : (job.options.defaultOwnerUserId ?? ""));
  const [tags, setTags] = useState<CrmTagChip[]>((job.options.tagNames ?? []).map((name) => ({ name, color: null })));
  const [dateOrder, setDateOrder] = useState(job.options.dateOrder ?? "DMY");
  const [fixNameCase, setFixNameCase] = useState(job.options.fixNameCase ?? true);
  const [emptyTokens, setEmptyTokens] = useState((job.options.emptyTokens ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!meta) return <CrmLoadingState />;
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${job.id}`, {
      method: "PATCH",
      toast: "errors",
      body: {
        mapping: job.mapping,
        sourceId: sourceId || null,
        duplicatePolicy: job.duplicatePolicy,
        options: {
          ...(owner === "__none" ? { defaultOwnerUserId: null } : owner ? { defaultOwnerUserId: owner } : {}),
          tagNames: tags.map((t) => t.name),
          dateOrder,
          fixNameCase,
          emptyTokens: emptyTokens.split(",").map((t) => t.trim()).filter(Boolean),
        },
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved({ ...job, ...res.data });
  };

  return (
    <Panel title="Where are these leads from?" description="Rows that name their own source (a Source column) keep it; every other row gets the source chosen here.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Lead source" htmlFor="import-source">
          <select id="import-source" className={textInputClass()} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Import (default)</option>
            {meta.sources
              .filter((s) => s.isActive !== false)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </FormField>
        <FormField label="Owner for rows without an owner" htmlFor="import-owner">
          <SearchableSelect
            id="import-owner"
            value={owner}
            onChange={setOwner}
            options={[{ id: "__none", label: "— Leave unassigned —" }, ...users.map((u) => ({ id: u.id, label: u.fullName }))]}
            emptyOptionLabel="Me (the person importing)"
            placeholder="Search people…"
          />
        </FormField>
        <FormField label="Add tags to every imported lead" htmlFor="import-tags">
          <CrmTagInput id="import-tags" value={tags} onChange={setTags} />
        </FormField>
        <FormField label="Dates in the file are written as" htmlFor="import-dates">
          <select id="import-dates" className={textInputClass()} value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "DMY" | "MDY")}>
            <option value="DMY">Day/Month/Year (15/10/2026)</option>
            <option value="MDY">Month/Day/Year (10/15/2026)</option>
          </select>
        </FormField>
        <FormField label="Also treat these values as empty" htmlFor="import-empty">
          <input id="import-empty" className={textInputClass()} value={emptyTokens} placeholder="e.g. TBD, not given" onChange={(e) => setEmptyTokens(e.target.value)} />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Blank cells, N/A, NA, NULL, None and “-” are always treated as empty.</p>
        </FormField>
        <label className="flex items-start gap-2 self-end pb-2 text-sm text-zinc-700 dark:text-zinc-200">
          <input type="checkbox" className="mt-0.5" checked={fixNameCase} onChange={(e) => setFixNameCase(e.target.checked)} />
          <span>
            Tidy names typed in ALL CAPS or all lower case
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">“ASHISH KUMAR” → “Ashish Kumar”. Company names are never changed.</span>
          </span>
        </label>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={save} isLoading={busy} loadingLabel="Saving…">
          Next: map columns
        </Button>
      </div>
    </Panel>
  );
}

// ── Step 3: mapping ──────────────────────────────────────────────

function MapStep({ job, onBack, onValidated }: { job: ImportJobDetailDto; onBack: () => void; onValidated: (j: ImportJobDetailDto) => void }) {
  const [mapping, setMapping] = useState<Record<string, string>>(job.mapping);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customTargets = job.customFields.filter((c) => c.isActive).map((c) => ({ key: c.key, label: c.label, isActive: c.isActive }));
  const issues = useMemo(() => validateLeadMapping(mapping, customTargets), [mapping, customTargets]);
  const blocking = issues.filter((i) => i.level === "error");
  const used = new Set(Object.values(mapping).filter(Boolean));
  const groups = useMemo(() => {
    const g = new Map<string, LeadTargetField[]>();
    for (const f of LEAD_TARGET_FIELDS) g.set(f.group, [...(g.get(f.group) ?? []), f]);
    return [...g.entries()];
  }, []);
  const samples = (h: string) =>
    job.sample
      .map((r) => r[h])
      .filter(Boolean)
      .slice(0, 3);

  const check = async () => {
    setBusy(true);
    setError(null);
    const saved = await crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${job.id}`, {
      method: "PATCH",
      toast: "errors",
      body: { mapping, sourceId: job.sourceId, duplicatePolicy: job.duplicatePolicy, options: { ...stripMeta(job.options) } },
    });
    if (!saved.ok) {
      setBusy(false);
      return setError(saved.error.message);
    }
    const res = await crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${job.id}/validate`, { method: "POST", toast: "errors" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onValidated(res.data);
  };

  return (
    <Panel title="Match your columns to CRM fields" description={`${job.headers.length} columns found in ${job.fileName}. We suggested matches from the column names — check them, change any, or choose Ignore.`}>
      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Column in your file</th>
              <th className="px-3 py-2">Sample values</th>
              <th className="px-3 py-2">CRM field</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {job.headers.map((h, i) => (
              <tr key={h} className={mapping[h] ? "" : "bg-zinc-50/60 dark:bg-zinc-900/40"}>
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{h}</td>
                <td className="max-w-xs px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="line-clamp-2">{samples(h).join(" · ") || "—"}</span>
                </td>
                <td className="px-3 py-2">
                  <label htmlFor={`map-${i}`} className="sr-only">
                    CRM field for {h}
                  </label>
                  <select id={`map-${i}`} className={`${textInputClass()} min-w-[14rem]`} value={mapping[h] ?? ""} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                    <option value="">— Ignore this column —</option>
                    {groups.map(([group, fields]) => (
                      <optgroup key={group} label={group}>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key} disabled={used.has(f.key) && mapping[h] !== f.key}>
                            {f.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {customTargets.length > 0 && (
                      <optgroup label="Custom fields">
                        {customTargets.map((c) => {
                          const v = `${CUSTOM_FIELD_PREFIX}${c.key}`;
                          return (
                            <option key={v} value={v} disabled={used.has(v) && mapping[h] !== v}>
                              {c.label}
                            </option>
                          );
                        })}
                      </optgroup>
                    )}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issues.length > 0 && (
        <ul className="space-y-1 text-sm">
          {issues.map((i) => (
            <li key={i.message} className={i.level === "error" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}>
              {i.level === "error" ? "Required: " : "Note: "}
              {i.message}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={check} disabled={blocking.length > 0} isLoading={busy} loadingLabel="Checking rows…">
          Check {job.totalRows.toLocaleString("en-IN")} rows
        </Button>
      </div>
    </Panel>
  );
}

/** The job's options without the server-only metadata (encoding, delimiter, branch) that the setup endpoint doesn't accept. */
function stripMeta(o: ImportJobDetailDto["options"]) {
  const rest: Record<string, unknown> = { ...o };
  for (const k of ["encoding", "delimiter", "branchId"]) delete rest[k];
  return rest;
}


// ── Steps 4–6: preview, duplicates, import ───────────────────────

function PreviewStep({ job, onBack, onNext }: { job: ImportJobDetailDto; onBack: () => void; onNext: () => void }) {
  const [filter, setFilter] = useState<RowFilter>(job.errorRows ? "ERROR" : "all");
  return (
    <Panel title="Preview" description="Every row was checked on the server. Rows with errors won't be imported — fix them in your file and import them again, or carry on with the rest.">
      <ImportCounts job={job} mode="validation" />
      <ImportRowsTable jobId={job.id} mode="preview" filter={filter} onFilterChange={setFilter} />
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back to mapping
        </Button>
        <Button onClick={onNext} disabled={job.validRows + job.warningRows === 0}>
          Next: duplicates
        </Button>
      </div>
    </Panel>
  );
}

function DuplicatesStep({ job, onBack, onSaved }: { job: ImportJobDetailDto; onBack: () => void; onSaved: (j: ImportJobDetailDto) => void }) {
  const [policy, setPolicy] = useState<DuplicatePolicy>(job.duplicatePolicy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    const res = await crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${job.id}`, {
      method: "PATCH",
      toast: "errors",
      body: { mapping: job.mapping, sourceId: job.sourceId, duplicatePolicy: policy, options: stripMeta(job.options) },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved({ ...job, ...res.data });
  };
  return (
    <Panel
      title="What should happen to duplicates?"
      description={
        job.duplicateRows
          ? `${job.duplicateRows.toLocaleString("en-IN")} row(s) look like leads or contacts you already have, or repeat an earlier row of this file. Matching uses your duplicate rules (CRM Settings → Duplicate rules).`
          : "No duplicates were found in the preview. Rows are checked again while importing, so choose what should happen if one appears."
      }
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Duplicate policy</legend>
        {(Object.keys(POLICY_INFO) as DuplicatePolicy[]).map((p) => (
          <label key={p} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${policy === p ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10" : "border-zinc-200 dark:border-zinc-800"}`}>
            <input type="radio" name="dup-policy" className="mt-1" checked={policy === p} onChange={() => setPolicy(p)} />
            <span>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{POLICY_INFO[p].label}</span>
              <span className="block text-sm text-zinc-600 dark:text-zinc-300">{POLICY_INFO[p].help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack}>
          Back to preview
        </Button>
        <Button onClick={save} isLoading={busy} loadingLabel="Saving…">
          Next: review and import
        </Button>
      </div>
    </Panel>
  );
}

function ConfirmStep({ job, onBack, onStarted }: { job: ImportJobDetailDto; onBack: () => void; onStarted: (j: ImportJobDetailDto) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importable = job.validRows + job.warningRows;
  const start = async () => {
    setBusy(true);
    setError(null);
    const res = await crmRequest<ImportJobDetailDto>(`/api/v1/crm/imports/${job.id}/start`, { method: "POST", toast: "errors" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onStarted(res.data);
  };
  return (
    <Panel title="Ready to import">
      <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-200">
        <li>
          <strong>{importable.toLocaleString("en-IN")}</strong> of {job.totalRows.toLocaleString("en-IN")} rows will be processed{job.errorRows ? `; ${job.errorRows.toLocaleString("en-IN")} row(s) with errors will be reported as failed` : ""}.
        </li>
        <li>
          Duplicates: <strong>{POLICY_INFO[job.duplicatePolicy].label}</strong>.
        </li>
        <li>
          Lead source: <strong>{job.source?.name ?? "Import"}</strong> (unless a row names its own).
        </li>
        <li>Every row is listed in the result with what happened to it. Nothing is merged or deleted.</li>
      </ul>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-between gap-2">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={start} disabled={importable === 0} isLoading={busy} loadingLabel="Starting…">
          Start import
        </Button>
      </div>
    </Panel>
  );
}

// ── Result ───────────────────────────────────────────────────────

export function ImportResultSummary({ job }: { job: ImportJobDetailDto }) {
  const problems = job.skippedRows + job.flaggedRows + job.failedRows + job.errorRows + job.warningRows;
  return (
    <div className="space-y-3">
      <ImportCounts job={job} mode="outcome" />
      {job.errorSummary && <p className="text-sm text-red-600 dark:text-red-400">{job.errorSummary}</p>}
      {job.flaggedRows > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {job.flaggedRows.toLocaleString("en-IN")} row(s) are waiting for your decision. Open the import and use the Flagged filter.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {problems > 0 && (
          <>
            <a href={`/api/v1/crm/imports/${job.id}/error-file?format=csv`} className={buttonClasses("secondary")}>
              Download error file (CSV)
            </a>
            <a href={`/api/v1/crm/imports/${job.id}/error-file?format=xlsx`} className={buttonClasses("secondary")}>
              Error file (Excel)
            </a>
          </>
        )}
        <a href={`/api/v1/crm/imports/${job.id}/error-file?format=xlsx&which=all`} className={buttonClasses("secondary")}>
          Full results (Excel)
        </a>
        {job.importedRows + job.updatedRows > 0 && (
          <Link href={`/crm/leads?importJobId=${job.id}&archived=include`} className={buttonClasses("secondary")}>
            View imported leads
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Wizard ───────────────────────────────────────────────────────

export function ImportWizard({ initialJobId }: { initialJobId: string | null }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJobId);
  const { job, setJob, error, reload } = useImportJob(jobId);
  const [pendingStep, setPendingStep] = useState<"Source" | "Map columns">("Source");
  const [readyStep, setReadyStep] = useState<"Preview" | "Duplicates" | "Import">("Preview");
  /** Going back from the preview to change source / mapping; re-checking rebuilds the preview. */
  const [editing, setEditing] = useState<"Source" | "Map columns" | null>(null);

  if (!jobId) {
    return (
      <div className="space-y-4">
        <Stepper current="Upload" />
        <UploadStep
          onUploaded={(id) => {
            setJobId(id);
            router.replace(`/crm/leads/import?job=${id}`);
          }}
        />
      </div>
    );
  }
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!job) return <CrmLoadingState />;

  let step: Step = "Upload";
  let body: React.ReactNode = null;
  if (job.status === "PENDING" || (job.status === "READY" && editing)) {
    const current = job.status === "READY" ? (editing as "Source" | "Map columns") : pendingStep;
    const go = (s: "Source" | "Map columns") => (job.status === "READY" ? setEditing(s) : setPendingStep(s));
    step = current;
    body =
      current === "Source" ? (
        <SourceStep
          job={job}
          onSaved={(j) => {
            setJob(j);
            if (j.status === "PENDING") {
              setEditing(null);
              setPendingStep("Map columns");
            } else setEditing("Map columns");
          }}

        />
      ) : (
        <MapStep
          job={job}
          onBack={() => go("Source")}
          onValidated={(j) => {
            setJob(j);
            setEditing(null);
            setReadyStep("Preview");
          }}
        />
      );
  } else if (job.status === "VALIDATING") {
    step = "Preview";
    body = (
      <Panel title="Checking your file" description={`${job.totalRows.toLocaleString("en-IN")} rows are being checked in the background.`}>
        <ImportProgress job={job} />
      </Panel>
    );
  } else if (job.status === "READY") {
    step = readyStep;
    const backToMapping = () => setEditing("Map columns");
    body =

      readyStep === "Preview" ? (
        <PreviewStep job={job} onBack={backToMapping} onNext={() => setReadyStep("Duplicates")} />
      ) : readyStep === "Duplicates" ? (
        <DuplicatesStep job={job} onBack={() => setReadyStep("Preview")} onSaved={(j) => (setJob(j), setReadyStep("Import"))} />
      ) : (
        <ConfirmStep job={job} onBack={() => setReadyStep("Duplicates")} onStarted={(j) => setJob(j)} />
      );
  } else if (job.status === "PROCESSING") {
    step = "Import";
    body = (
      <Panel title={`Importing ${job.fileName}`}>
        <ImportProgress job={job} />
        <ImportCounts job={job} mode="outcome" />
        <CancelButton jobId={job.id} onDone={reload} disabled={Boolean(job.cancelRequestedAt)} />
      </Panel>
    );
  } else if (FINISHED_STATUSES.includes(job.status)) {
    step = "Result";
    body = (
      <Panel title="Import finished">
        <ImportResultSummary job={job} />
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href={`/crm/leads/imports/${job.id}`} className={buttonClasses("primary")}>
            See every row
          </Link>
          <Link href="/crm/leads/import" className={buttonClasses("secondary")} onClick={() => setJobId(null)}>
            Import another file
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Stepper current={step} />
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{job.fileName}</span>
        <span>·</span>
        <span>
          {job.totalRows.toLocaleString("en-IN")} rows · {job.fileType}
        </span>
        <ImportStatusBadge status={job.status} />
      </div>
      {body}
    </div>
  );
}

export function CancelButton({ jobId, onDone, disabled }: { jobId: string; onDone: () => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={disabled}
      isLoading={busy}
      loadingLabel="Cancelling…"
      onClick={async () => {
        setBusy(true);
        await crmRequest(`/api/v1/crm/imports/${jobId}/cancel`, { method: "POST", successMessage: "Cancellation requested." });
        setBusy(false);
        onDone();
      }}
    >
      {disabled ? "Stopping…" : "Cancel import"}
    </Button>
  );
}

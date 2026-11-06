"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ResultView } from "./ResultView";
import { AN_API, CARD, daysAgo, exportFile, send, today, useApi, type Catalog, type PeriodSpec, type ReportResult, type SavedDefinition, type SavedReport } from "./analytics-ui";

/**
 * Phase 17 — the report builder. Only governed choices: a dataset (one grain),
 * its metrics, up to two of its dimensions, filters on its dimensions, a time
 * grain and a bounded period. No formulas, no SQL. Runs with your permissions.
 */

interface Draft {
  dataset: string;
  metrics: string[];
  groupBy: string[];
  timeGrain: string;
  timeField: string;
  period: PeriodSpec;
  from: string;
  to: string;
  compare: "none" | "previous_period" | "previous_year";
  filters: Record<string, string[]>;
}

const fromDefinition = (d: SavedDefinition): Draft => ({
  dataset: d.query.dataset,
  metrics: d.query.metrics,
  groupBy: d.query.groupBy ?? [],
  timeGrain: d.query.timeGrain ?? "month",
  timeField: d.query.timeField ?? "",
  period: d.period,
  from: d.query.from,
  to: d.query.to,
  compare: d.query.compare ?? "none",
  filters: d.query.filters ?? {},
});

export function ReportBuilder({ catalog, initial, onSaved }: { catalog: Catalog; initial?: SavedReport | null; onSaved?: (r: SavedReport) => void }) {
  const firstDs = catalog.datasets.find((d) => d.available) ?? catalog.datasets[0];
  const [draft, setDraft] = useState<Draft>(() =>
    initial
      ? fromDefinition(initial.definition)
      : { dataset: firstDs.key, metrics: [firstDs.metrics.find((m) => m.available)?.id ?? firstDs.metrics[0].id], groupBy: ["period"], timeGrain: "month", timeField: "", period: { mode: "relative", preset: "this_fiscal_year" }, from: daysAgo(89), to: today(), compare: "none", filters: {} }
  );
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const ds = catalog.datasets.find((d) => d.key === draft.dataset)!;
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const query = useMemo(() => {
    const q: Record<string, unknown> = { dataset: draft.dataset, metrics: draft.metrics, groupBy: draft.groupBy, timeGrain: draft.timeGrain, from: draft.from, to: draft.to, compare: draft.compare, filters: Object.fromEntries(Object.entries(draft.filters).filter(([, v]) => v.length)) };
    if (draft.timeField) q.timeField = draft.timeField;
    return q as SavedDefinition["query"];
  }, [draft]);

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      // A relative period is resolved by the server (India date, the company's financial year).
      const body = draft.period.mode === "relative" ? { ...query, preset: draft.period.preset } : query;
      setResult(await send<ReportResult>(`${AN_API}/run`, "POST", body));
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const changeDataset = (key: string) => {
    const next = catalog.datasets.find((d) => d.key === key)!;
    set({ dataset: key, metrics: [next.metrics.find((m) => m.available)?.id ?? next.metrics[0].id], groupBy: next.engine === "service" ? [] : ["period"], timeField: "", filters: {} });
    setResult(null);
  };
  const toggleMetric = (id: string) => set({ metrics: draft.metrics.includes(id) ? draft.metrics.filter((m) => m !== id) : [...draft.metrics, id].slice(0, catalog.limits.maxMetrics) });
  const dims = ds.dimensions.filter((d) => !(ds.engine === "service" && d.key === "period"));

  return (
    <div className="space-y-4">
      <div className={`${CARD} grid gap-4 lg:grid-cols-3`}>
        <div className="space-y-3">
          <FormField label="Data" htmlFor="an-ds">
            <select id="an-ds" className={textInputClass()} value={draft.dataset} onChange={(e) => changeDataset(e.target.value)}>
              {catalog.datasets.map((d) => (
                <option key={d.key} value={d.key} disabled={!d.available}>
                  {d.label}
                  {!d.available ? " (no access)" : ""}
                </option>
              ))}
            </select>
          </FormField>
          <p className="text-xs text-zinc-500">
            {ds.grain.charAt(0).toUpperCase() + ds.grain.slice(1)}. {ds.description}
          </p>
          {Object.keys(ds.timeFields).length > 1 && (
            <FormField label="Date used" htmlFor="an-tf">
              <select id="an-tf" className={textInputClass()} value={draft.timeField || ds.defaultTimeField} onChange={(e) => set({ timeField: e.target.value })}>
                {Object.entries(ds.timeFields).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <PeriodPicker catalog={catalog} draft={draft} set={set} />
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Metrics (up to {catalog.limits.maxMetrics})</div>
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {ds.metrics.map((m) => (
              <label key={m.id} className={`flex items-start gap-2 text-sm ${m.available ? "" : "opacity-50"}`} title={m.available ? `${m.description} — ${m.formula}` : (m.unavailableReason ?? "No access")}>
                <input type="checkbox" className="mt-0.5" checked={draft.metrics.includes(m.id)} disabled={!m.available} onChange={() => toggleMetric(m.id)} />
                <span>
                  {m.label}
                  <span className="block text-xs text-zinc-500">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">Group by (up to {catalog.limits.maxGroupBy})</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {dims.map((d) => {
                const on = draft.groupBy.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ groupBy: on ? draft.groupBy.filter((g) => g !== d.key) : [...draft.groupBy, d.key].slice(-catalog.limits.maxGroupBy) })}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-indigo-600 bg-indigo-600 text-white" : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
          {draft.groupBy.includes("period") && (
            <FormField label="Time grain" htmlFor="an-grain">
              <select id="an-grain" className={textInputClass()} value={draft.timeGrain} onChange={(e) => set({ timeGrain: e.target.value })}>
                {Object.entries(catalog.timeGrains).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Compare with" htmlFor="an-cmp">
            <select id="an-cmp" className={textInputClass()} value={draft.compare} onChange={(e) => set({ compare: e.target.value as Draft["compare"] })}>
              <option value="none">No comparison</option>
              <option value="previous_period">Previous period (same length)</option>
              <option value="previous_year">Same period last year</option>
            </select>
          </FormField>
          <Filters dataset={draft.dataset} dims={dims.filter((d) => d.key !== "period" && d.kind !== "text")} filters={draft.filters} onChange={(filters) => set({ filters })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runNow} disabled={busy || !draft.metrics.length}>
          {busy ? "Running…" : "Run report"}
        </Button>
        {catalog.can.create && (
          <Button variant="secondary" onClick={() => setSaveOpen(true)} disabled={!draft.metrics.length || (initial ? !initial.isMine : false)}>
            {initial ? "Save changes" : "Save report"}
          </Button>
        )}
        {catalog.can.export && result && (
          <>
            <Button variant="secondary" onClick={() => exportFile({ query: result.query, title: initial?.name ?? `${ds.label} report`, format: "XLSX", reportId: initial?.id }).catch((e) => setError(e.message))}>
              Excel
            </Button>
            <Button variant="secondary" onClick={() => exportFile({ query: result.query, title: initial?.name ?? `${ds.label} report`, format: "CSV", reportId: initial?.id }).catch((e) => setError(e.message))}>
              CSV
            </Button>
          </>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {result && (
        <div className={CARD}>
          <ResultView result={result} catalog={catalog} />
        </div>
      )}
      {saveOpen && <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} catalog={catalog} initial={initial ?? null} definition={{ query, period: draft.period }} onSaved={(r) => (setSaveOpen(false), onSaved?.(r))} />}
    </div>
  );
}

function PeriodPicker({ catalog, draft, set }: { catalog: Catalog; draft: Draft; set: (p: Partial<Draft>) => void }) {
  return (
    <div className="space-y-2">
      <FormField label="Period" htmlFor="an-period">
        <select
          id="an-period"
          className={textInputClass()}
          value={draft.period.mode === "relative" ? draft.period.preset : "fixed"}
          onChange={(e) => set({ period: e.target.value === "fixed" ? { mode: "fixed" } : { mode: "relative", preset: e.target.value } })}
        >
          {Object.entries(catalog.presets).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
          <option value="fixed">Fixed dates…</option>
        </select>
      </FormField>
      {draft.period.mode === "fixed" && (
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="From" type="date" className={textInputClass()} value={draft.from} onChange={(e) => set({ from: e.target.value })} />
          <input aria-label="To" type="date" className={textInputClass()} value={draft.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      )}
      <p className="text-xs text-zinc-500">India dates, inclusive; at most {catalog.limits.maxRangeDays} days. A saved report keeps a relative period moving.</p>
    </div>
  );
}

function Filters({ dataset, dims, filters, onChange }: { dataset: string; dims: { key: string; label: string }[]; filters: Record<string, string[]>; onChange: (f: Record<string, string[]>) => void }) {
  const [dim, setDim] = useState<string>("");
  const opts = useApi<{ value: string; label: string }[]>(dim ? `${AN_API}/options?dataset=${dataset}&dimension=${dim}` : null);
  if (!dims.length) return null;
  const active = Object.entries(filters).filter(([, v]) => v.length);
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">Filters</div>
      {active.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between rounded bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-800">
          <span>
            {dims.find((d) => d.key === k)?.label ?? k}: {v.length} selected
          </span>
          <button type="button" className="text-red-600" onClick={() => onChange({ ...filters, [k]: [] })} aria-label={`Clear ${k} filter`}>
            ✕
          </button>
        </div>
      ))}
      <select aria-label="Filter on" className={textInputClass()} value={dim} onChange={(e) => setDim(e.target.value)}>
        <option value="">Add a filter…</option>
        {dims.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
      {dim && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-zinc-700">
          {!opts.data && <p className="text-xs text-zinc-500">Loading…</p>}
          {opts.data?.map((o) => {
            const sel = filters[dim] ?? [];
            return (
              <label key={o.value} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={sel.includes(o.value)} onChange={() => onChange({ ...filters, [dim]: sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value] })} />
                {o.label}
              </label>
            );
          })}
          {opts.data && !opts.data.length && <p className="text-xs text-zinc-500">No choices.</p>}
        </div>
      )}
    </div>
  );
}

function SaveDialog({ open, onClose, catalog, initial, definition, onSaved }: { open: boolean; onClose: () => void; catalog: Catalog; initial: SavedReport | null; definition: SavedDefinition; onSaved: (r: SavedReport) => void }) {
  const users = useApi<{ id: string; fullName: string }[]>(open ? "/api/v1/users" : null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [sharing, setSharing] = useState<SavedReport["sharing"]>(initial?.sharing ?? "PRIVATE");
  const [shared, setShared] = useState<string[]>(initial?.sharedUserIds ?? []);
  const [recipients, setRecipients] = useState<string[]>(initial?.recipientUserIds ?? []);
  const [format, setFormat] = useState<"CSV" | "XLSX">(initial?.deliveryFormat ?? "XLSX");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name, description: description || null, definition, sharing, sharedUserIds: sharing === "USERS" ? shared : [], recipientUserIds: recipients, deliveryFormat: format };
      onSaved(initial ? await send<SavedReport>(`${AN_API}/reports/${initial.id}`, "PATCH", { ...body, version: initial.version }) : await send<SavedReport>(`${AN_API}/reports`, "POST", body));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={initial ? "Save report changes" : "Save report"} maxWidthClass="max-w-lg">
      <div className="space-y-3">
        <FormField label="Name" htmlFor="an-name" required>
          <input id="an-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </FormField>
        <FormField label="Description" htmlFor="an-desc">
          <input id="an-desc" className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </FormField>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Who can open it</legend>
          {(["PRIVATE", "USERS", "COMPANY"] as const).map((s) => (
            <label key={s} className={`flex items-center gap-2 text-sm ${s !== "PRIVATE" && !catalog.can.edit ? "opacity-50" : ""}`}>
              <input type="radio" name="an-sharing" checked={sharing === s} disabled={s !== "PRIVATE" && !catalog.can.edit} onChange={() => setSharing(s)} />
              {s === "PRIVATE" ? "Only me" : s === "USERS" ? "Chosen people" : "Everyone with Analytics access"}
            </label>
          ))}
          {sharing === "USERS" && <PeopleList users={users.data} value={shared} onChange={setShared} label="Share with" />}
          <p className="text-xs text-zinc-500">Everyone sees the report with their own access — sharing never shows anyone data they can&apos;t already see.</p>
        </fieldset>
        {catalog.can.edit && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Delivery recipients (optional)</legend>
            <PeopleList users={users.data} value={recipients} onChange={setRecipients} label="Recipients" />
            <div className="flex items-center gap-3 text-xs">
              Format:
              {(["XLSX", "CSV"] as const).map((f) => (
                <label key={f} className="flex items-center gap-1">
                  <input type="radio" name="an-format" checked={format === f} onChange={() => setFormat(f)} /> {f === "XLSX" ? "Excel" : "CSV"}
                </label>
              ))}
            </div>
            <p className="text-xs text-zinc-500">Each recipient gets their own copy, prepared with their own access, as an in-app download valid {catalog.limits.deliveryFileDays} days. Schedule it from Saved reports.</p>
          </fieldset>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || name.trim().length < 3}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PeopleList({ users, value, onChange, label }: { users: { id: string; fullName: string }[] | null; value: string[]; onChange: (v: string[]) => void; label: string }) {
  return (
    <div className="max-h-36 overflow-y-auto rounded border border-zinc-200 p-2 dark:border-zinc-700" aria-label={label}>
      {!users && <p className="text-xs text-zinc-500">Loading…</p>}
      {users?.map((u) => (
        <label key={u.id} className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={value.includes(u.id)} onChange={() => onChange(value.includes(u.id) ? value.filter((x) => x !== u.id) : [...value, u.id])} />
          {u.fullName}
        </label>
      ))}
    </div>
  );
}

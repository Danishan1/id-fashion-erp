"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ConditionBuilder } from "@/components/crm/workflows/ConditionBuilder";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import type { ConditionGroup } from "@/modules/crm/workflows/workflow-conditions";
import { SM_WF_EVENT_TYPES, type SmWfSettingField } from "@/modules/sales-marketing/workflows/sm-workflow-registry";
import { Badge, CARD, SM_WF_API, SM_WF_PAGE, permText, send, useApi, type DefinitionDto, type VersionDto } from "./sm-workflow-ui";

interface Draft {
  settings: Record<string, unknown>;
  entry: ConditionGroup;
  changeNote: string;
}
const toDraft = (v: VersionDto | null): Draft => ({ settings: { ...(v?.settings ?? {}) }, entry: v?.conditions.entry ?? { kind: "group", logic: "AND", conditions: [] }, changeNote: "" });

/** Phase 15 — one workflow: what it does, its settings and entry conditions (versioned), switching it on / off, and starting it on a record. */
export function SmWorkflowDefinitionClient({ workflowKey }: { workflowKey: string }) {
  const api = `${SM_WF_API}/definitions/${workflowKey}`;
  const { data: d, error, reload, setData } = useApi<DefinitionDto>(api);
  const users = useApi<{ id: string; fullName: string }[]>("/api/v1/users");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftOf, setDraftOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [errors, setErrors] = useState<{ path: string; message: string }[]>([]);
  const [confirm, setConfirm] = useState<"activate" | "deactivate" | null>(null);

  // Reset the form whenever the loaded definition's version changes (after a save, activation or reload).
  const stamp = d ? `${d.version}` : null;
  if (d && draftOf !== stamp) {
    setDraftOf(stamp);
    setDraft(toDraft(d.draft ?? d.activeVersion));
  }

  const fields = useMemo(() => new Map((d?.conditionFields ?? []).map((f) => [f.key, f])), [d?.conditionFields]);

  if (error && !d) return <ErrorState message={error} onRetry={reload} />;
  if (!d || !draft) return <LoadingState />;

  const readOnly = !d.canEdit;
  const run = async (fn: () => Promise<DefinitionDto | void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) setData(r);
      setMsg({ tone: "ok", text: ok });
      setErrors([]);
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const body = { settings: draft.settings, conditions: { entry: draft.entry } };
  const validate = () =>
    run(async () => {
      const r = await send<{ valid: boolean; errors: { path: string; message: string }[] }>(api, "POST", { action: "validate", ...body });
      setErrors(r.errors);
      if (!r.valid) throw new Error("Some settings need fixing (see below).");
    }, "Settings and conditions are valid.");
  const save = () => run(() => send<DefinitionDto>(api, "PUT", { version: d.version, ...body, changeNote: draft.changeNote }), "Saved as a draft. Switch it on to use these settings.");
  const activate = () => run(() => send<DefinitionDto>(api, "POST", { action: "activate", version: d.version }), "Switched on. New events start this version.");
  const deactivate = () => run(() => send<DefinitionDto>(api, "POST", { action: "deactivate", version: d.version }), "Switched off. Running workflows continue on their version.");
  const setSetting = (k: string, v: unknown) => setDraft({ ...draft, settings: { ...draft.settings, [k]: v } });

  return (
    <div className="space-y-4">
      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"}`}>
          {msg.text}
        </p>
      )}

      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={d.status === "ACTIVE" ? "green" : "zinc"}>{d.status === "ACTIVE" ? `On · version ${d.activeVersion?.versionNumber}` : "Off"}</Badge>
              {d.draft && d.status === "ACTIVE" && <Badge tone="amber">Draft v{d.draft.versionNumber} not switched on</Badge>}
            </div>
            <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.description}</p>
            {d.runAs && (
              <p className="mt-1 text-xs text-zinc-500">
                Runs as {d.runAs.name ?? "—"} (who switched it on){d.activatedAt && <> · since <ClientDateTime value={d.activatedAt} /></>}
              </p>
            )}
            {d.runAsIssue && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{d.runAsIssue} New steps stop with “needs attention” until someone with the permissions switches it on again.</p>}
          </div>
          {!readOnly && (
            <div className="flex gap-2">
              {d.status === "ACTIVE" && (
                <Button variant="secondary" disabled={busy} onClick={() => setConfirm("deactivate")}>
                  Switch off
                </Button>
              )}
              {(d.status !== "ACTIVE" || d.draft || d.runAsIssue) && (
                <Button disabled={busy} onClick={() => setConfirm("activate")}>
                  {d.status === "ACTIVE" ? (d.draft ? `Switch on v${d.draft.versionNumber}` : "Switch on again as me") : "Switch on"}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${CARD} lg:col-span-2 space-y-4`}>
          <h2 className="font-semibold">Settings {d.draft ? `(draft v${d.draft.versionNumber})` : d.activeVersion ? `(v${d.activeVersion.versionNumber} — saving creates a draft)` : ""}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {d.settingFields.map((f) => (
              <SettingInput key={f.key} field={f} value={draft.settings[f.key]} onChange={(v) => setSetting(f.key, v)} users={users.data ?? []} readOnly={readOnly} error={errors.find((e) => e.path === `settings.${f.key}`)?.message} />
            ))}
          </div>
          <div>
            <h3 className="text-sm font-medium">Start only when</h3>
            <p className="mb-2 text-xs text-zinc-500">Leave empty to start for every {d.entityLabel.toLowerCase()} the event happens to. Only the fields listed can be used. A person starting it on a record skips these conditions.</p>
            <ConditionBuilder value={draft.entry} onChange={(entry) => setDraft({ ...draft, entry })} fields={fields} lookups={{}} maxDepth={2} readOnly={readOnly} />
            {errors.filter((e) => e.path.startsWith("conditions")).map((e) => (
              <p key={e.path + e.message} className="mt-1 text-xs text-red-600 dark:text-red-400">
                {e.message}
              </p>
            ))}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <label className="min-w-64 flex-1 text-sm">
                <span className="block text-xs text-zinc-500">What changed (optional)</span>
                <input className={textInputClass()} value={draft.changeNote} maxLength={500} onChange={(e) => setDraft({ ...draft, changeNote: e.target.value })} />
              </label>
              <Button variant="secondary" disabled={busy} onClick={validate}>
                Check
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setDraft(toDraft(d.draft ?? d.activeVersion))}>
                Undo changes
              </Button>
              <Button disabled={busy} onClick={save}>
                Save draft
              </Button>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className={CARD}>
            <h2 className="font-semibold">Steps</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              {d.steps.map((s) => (
                <li key={s.key}>{s.label}</li>
              ))}
            </ol>
            <h3 className="mt-3 text-sm font-medium">Starts when</h3>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {d.triggers.map((t) => (
                <li key={t}>{SM_WF_EVENT_TYPES[t as keyof typeof SM_WF_EVENT_TYPES] ?? t}</li>
              ))}
            </ul>
          </section>
          <section className={CARD}>
            <h2 className="font-semibold">Never does</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
              {d.boundaries.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
          <section className={CARD}>
            <h2 className="font-semibold">Permissions it needs</h2>
            <p className="mt-1 text-xs text-zinc-500">The person who switches it on must hold these; they are checked again before every step.</p>
            <ul className="mt-2 space-y-0.5 font-mono text-xs">
              {d.requiredPermissions.map((p) => (
                <li key={permText(p)}>{permText(p)}</li>
              ))}
              {d.taskPermissions.map((p) => (
                <li key={permText(p)}>
                  {permText(p)} <span className="font-sans text-zinc-500">(when tasks are on)</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {d.canEdit && d.status === "ACTIVE" && <StartOnRecord workflowKey={workflowKey} api={api} />}

      <section className={CARD}>
        <h2 className="font-semibold">Versions</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-medium">Version</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Change</th>
                <th className="py-1 pr-3 font-medium">Saved</th>
                <th className="py-1 pr-3 font-medium">Switched on</th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1 pr-3">v{v.versionNumber}</td>
                  <td className="py-1 pr-3">
                    <Badge tone={v.status === "ACTIVE" ? "green" : v.status === "DRAFT" ? "amber" : "zinc"}>{v.status === "ACTIVE" ? "In use" : v.status === "DRAFT" ? "Draft" : "Replaced"}</Badge>
                  </td>
                  <td className="py-1 pr-3">{v.changeNote ?? "—"}</td>
                  <td className="py-1 pr-3 text-xs">
                    {v.createdBy ?? "—"} · <ClientDateTime value={v.createdAt} />
                  </td>
                  <td className="py-1 pr-3 text-xs">{v.activatedAt ? <>{v.activatedBy ?? "—"} · <ClientDateTime value={v.activatedAt} /></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500">A version in use never changes; running workflows finish on the version they started with.</p>
      </section>

      <ConfirmModal
        open={confirm !== null}
        title={confirm === "activate" ? "Switch this workflow on?" : "Switch this workflow off?"}
        message={
          confirm === "activate"
            ? `It will run as you: tasks and notifications it creates are attributed to you, and it needs your permissions (${d.requiredPermissions.map(permText).join(", ")}). Events from before now are ignored.`
            : "No new workflows start. Running ones finish on their version — cancel them one by one if needed."
        }
        confirmLabel={confirm === "activate" ? "Switch on" : "Switch off"}
        isDangerous={confirm === "deactivate"}
        isBusy={busy}
        onConfirm={() => (confirm === "activate" ? activate() : deactivate())}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function SettingInput({ field, value, onChange, users, readOnly, error }: { field: SmWfSettingField; value: unknown; onChange: (v: unknown) => void; users: { id: string; fullName: string }[]; readOnly: boolean; error?: string }) {
  const id = `wf-setting-${field.key}`;
  const help = field.help && <p className="mt-1 text-xs text-zinc-500">{field.help}</p>;
  const err = error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (field.type === "boolean")
    return (
      <div className="sm:col-span-2">
        <label className="flex items-start gap-2 text-sm">
          <input id={id} type="checkbox" className="mt-1" disabled={readOnly} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
        {help}
        {err}
      </div>
    );
  if (field.type === "number")
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {field.label}
          {field.unit ? ` (${field.unit})` : ""}
        </label>
        <input
          id={id}
          type="number"
          className={textInputClass()}
          min={field.min}
          max={field.max}
          disabled={readOnly}
          placeholder={field.optional ? "Off" : undefined}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? (field.optional ? null : "") : Number(e.target.value))}
        />
        {help}
        {err}
      </div>
    );
  const selected = (Array.isArray(value) ? value : []) as string[];
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{field.label}</legend>
      {help}
      <div className="mt-1 flex flex-wrap gap-1">
        {selected.map((uid) => (
          <span key={uid} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
            {users.find((u) => u.id === uid)?.fullName ?? "Unknown user"}
            {!readOnly && (
              <button type="button" aria-label="Remove" className="text-zinc-500 hover:text-red-600" onClick={() => onChange(selected.filter((x) => x !== uid))}>
                ×
              </button>
            )}
          </span>
        ))}
        {!selected.length && <span className="text-xs text-zinc-500">No one</span>}
      </div>
      {!readOnly && selected.length < 10 && (
        <select aria-label={`Add to ${field.label}`} className={`${textInputClass()} mt-1 max-w-xs`} value="" onChange={(e) => e.target.value && onChange([...selected, e.target.value])}>
          <option value="">Add a person…</option>
          {users
            .filter((u) => !selected.includes(u.id))
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
        </select>
      )}
      {err}
    </fieldset>
  );
}

const PICKERS: Record<string, { label: string; url: string; pick: (r: Record<string, unknown>) => { title: string; sub: string } }> = {
  quotation_follow_up: { label: "enquiry", url: "/api/v1/sales-marketing/enquiries?pageSize=10", pick: (r) => ({ title: String(r.enquiryNumber ?? ""), sub: String(r.subject ?? "") }) },
  quotation_to_order: { label: "quotation", url: "/api/v1/sales-marketing/quotations?view=all&pageSize=10", pick: (r) => ({ title: String(r.quotationNumber ?? ""), sub: `${String((r.customer as { name?: string } | null)?.name ?? "")} · ${String(r.status ?? "").toLowerCase()}` }) },
  campaign_readiness: { label: "campaign", url: "/api/v1/sales-marketing/campaigns?pageSize=10", pick: (r) => ({ title: String(r.code ?? ""), sub: String(r.name ?? "") }) },
};

function StartOnRecord({ workflowKey, api }: { workflowKey: string; api: string }) {
  const router = useRouter();
  const picker = PICKERS[workflowKey];
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!picker)
    return (
      <section className={CARD}>
        <h2 className="font-semibold">Start on a record</h2>
        <p className="mt-1 text-sm text-zinc-500">This workflow starts from its events only (a budget alert, a finished calculation or bulk job).</p>
      </section>
    );
  const search = async () => {
    setError(null);
    const r = await fetch(`${picker.url}&search=${encodeURIComponent(q.trim())}`, { headers: { "x-toast": "off" } });
    const body = await r.json();
    if (!r.ok) setError(body?.error?.message ?? "Couldn't search.");
    else setRows(body.data);
  };
  const start = async (entityId: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: string; created: boolean }>(api, "POST", { action: "start", entityId });
      router.push(`${SM_WF_PAGE}/instances/${r.id}${r.created ? "" : "?existing=1"}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className={CARD}>
      <h2 className="font-semibold">Start on a {picker.label}</h2>
      <p className="mt-1 text-xs text-zinc-500">Starts now, without the entry conditions. If the {picker.label} already has this workflow running, you are taken to it instead.</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className={`${textInputClass()} max-w-sm`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${picker.label}`} aria-label={`Find a ${picker.label}`} />
        <Button type="submit" variant="secondary">
          Find
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && (
        <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
          {rows.length === 0 && <li className="py-2 text-zinc-500">Nothing found.</li>}
          {rows.map((r) => {
            const p = picker.pick(r);
            return (
              <li key={String(r.id)} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{p.title}</span> <span className="text-zinc-500">{p.sub}</span>
                </span>
                <Button size="xs" disabled={busy} onClick={() => start(String(r.id))}>
                  Start
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/date-format";
import { MODEL_STATUSES, RUN_STATUSES, VERSION_STATUSES } from "@/modules/sales-marketing/attribution/attribution-registry";
import { TextDialog, type TextDialogSpec } from "../pricing/pricing-ui";
import { Badge, CARD, FormButtons, FormField, RulesEditor, rulesPayload, rulesSummary, send, toRulesDraft, type Rules, type RulesDraft } from "./attribution-ui";

export interface ModelDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: keyof typeof MODEL_STATUSES;
  isDefault: boolean;
  version: number;
  owner: string;
  approvedVersionId: string | null;
  versions: { id: string; number: number; status: keyof typeof VERSION_STATUSES; rules: Rules; createdBy: string; createdAt: string; submittedBy: string | null; decidedBy: string | null; decidedAt: string | null; decisionComment: string | null; canApproveThis: boolean }[];
  runs: { id: string; versionNumber: number; status: keyof typeof RUN_STATUSES; trigger: string; from: string; to: string; conversions: number; attributed: number; unattributed: number; excluded: number; queuedAt: string; finishedAt: string | null; error: string | null }[];
  events: { id: string; type: string; comment: string | null; at: string; by: string }[];
  can: { edit: boolean; newVersion: boolean; approve: boolean; reject: boolean; recalculate: boolean; setDefault: boolean; retire: boolean };
}

const EVENTS: Record<string, string> = {
  CREATED: "Created",
  HEADER_UPDATED: "Details changed",
  VERSION_SAVED: "Draft saved",
  VERSION_CREATED: "New version started",
  SUBMITTED: "Submitted for approval",
  RETURNED_TO_DRAFT: "Returned to draft",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SET_DEFAULT: "Made the default",
  RETIRED: "Retired",
  RECALCULATION_REQUESTED: "Recalculation requested",
};

type Dialog = TextDialogSpec & { url: string };
const newKey = () => `attr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function AttributionModelDetailClient({ initial, today }: { initial: ModelDetail; today: string }) {
  const [m, setM] = useState(initial);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [recalc, setRecalc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/v1/sales-marketing/attribution/models/${m.id}`;

  async function run(url: string, method: "POST" | "PATCH", body: unknown = {}) {
    setBusy(true);
    setError(null);
    try {
      setM(await send<ModelDetail>(url, method, body));
      setDialog(null);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const reload = async () => setM(await fetch(base, { headers: { "x-toast": "off" } }).then((r) => r.json()).then((b) => b.data));

  return (
    <div className="space-y-4">
      <section className={`${CARD} flex flex-wrap items-start justify-between gap-3`}>
        <div className="space-y-1">
          <div className="flex gap-2">
            <Badge tone={MODEL_STATUSES[m.status].tone}>{MODEL_STATUSES[m.status].label}</Badge>
            {m.isDefault && <Badge tone="indigo">Default</Badge>}
          </div>
          {m.description && <p className="text-sm text-zinc-600 dark:text-zinc-300">{m.description}</p>}
          <p className="text-xs text-zinc-500">Owner: {m.owner}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.can.recalculate && (
            <Button size="sm" onClick={() => setRecalc(true)}>
              Recalculate
            </Button>
          )}
          {m.can.setDefault && (
            <Button size="sm" variant="secondary" isLoading={busy} onClick={() => run(`${base}/set-default`, "POST")}>
              Make default
            </Button>
          )}
          {m.can.retire && (
            <Button size="sm" variant="danger" onClick={() => setDialog({ action: "retire", url: `${base}/retire`, title: "Retire model", help: "No new calculations. Past runs and results stay.", field: { name: "reason", label: "Reason", required: true }, submitLabel: "Retire", danger: true })}>
              Retire
            </Button>
          )}
        </div>
      </section>

      <section className={`${CARD} space-y-3`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Versions</h2>
          {m.can.newVersion && (
            <Button size="sm" variant="secondary" isLoading={busy} onClick={() => run(`${base}/versions`, "POST")}>
              New version
            </Button>
          )}
        </div>
        <p className="text-xs text-zinc-500">An approved version never changes, and every run keeps the version it used — old results stay explainable. A new version applies to new calculations once approved.</p>
        {m.versions.map((v) => (
          <div key={v.id} className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                Version {v.number} <Badge tone={VERSION_STATUSES[v.status].tone}>{VERSION_STATUSES[v.status].label}</Badge>
              </span>
              <span className="text-xs text-zinc-500">
                {v.createdBy} · {formatDateTime(v.createdAt)}
                {v.decidedBy && v.decidedAt ? ` · decided by ${v.decidedBy} ${formatDateTime(v.decidedAt)}` : ""}
              </span>
            </div>
            {editing === v.id ? (
              <VersionEditor
                rules={v.rules}
                showNote={v.number > 1}
                busy={busy}
                error={error}
                onCancel={() => setEditing(null)}
                onSave={async (r) => {
                  if (await run(`${base}/versions/${v.id}`, "PATCH", rulesPayload(r))) setEditing(null);
                }}
              />
            ) : (
              <p className="text-sm">{rulesSummary(v.rules)}</p>
            )}
            {v.rules.changeNote && <p className="text-xs text-zinc-500">Change: {v.rules.changeNote}</p>}
            {v.decisionComment && <p className="text-xs text-zinc-500">Decision: {v.decisionComment}</p>}
            {editing !== v.id && (
              <div className="flex flex-wrap gap-2">
                {v.status === "DRAFT" && m.can.edit && (
                  <>
                    <Button size="xs" variant="secondary" onClick={() => setEditing(v.id)}>
                      Edit rules
                    </Button>
                    <Button size="xs" onClick={() => setDialog({ action: "submit", url: `${base}/versions/${v.id}/submit`, title: `Submit version ${v.number}`, field: { name: "comment", label: "Note for the approver", required: false }, submitLabel: "Submit" })}>
                      Submit for approval
                    </Button>
                  </>
                )}
                {v.status === "PENDING_APPROVAL" && (
                  <>
                    {v.canApproveThis && (
                      <Button size="xs" onClick={() => setDialog({ action: "approve", url: `${base}/versions/${v.id}/approve`, title: `Approve version ${v.number}`, help: "Its rules become the model's. Recalculate to see results with them.", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Approve" })}>
                        Approve
                      </Button>
                    )}
                    {m.can.reject && (
                      <Button size="xs" variant="danger" onClick={() => setDialog({ action: "reject", url: `${base}/versions/${v.id}/reject`, title: `Reject version ${v.number}`, field: { name: "reason", label: "Reason", required: true }, submitLabel: "Reject", danger: true })}>
                        Reject
                      </Button>
                    )}
                    <Button size="xs" variant="secondary" onClick={() => setDialog({ action: "return", url: `${base}/versions/${v.id}/return-to-draft`, title: "Return to draft", field: { name: "comment", label: "Comment", required: false }, submitLabel: "Return to draft" })}>
                      Return to draft
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className={`${CARD} space-y-2`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Calculations</h2>
          <Button size="xs" variant="secondary" onClick={reload}>
            Refresh
          </Button>
        </div>
        {m.runs.length === 0 ? (
          <p className="text-sm text-zinc-500">Not calculated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                  <th className="py-1.5 pr-3 font-medium">Period</th>
                  <th className="py-1.5 pr-3 font-medium">Version</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Credited / unattributed / excluded</th>
                  <th className="py-1.5 font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {m.runs.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="py-1.5 pr-3">
                      {r.from} – {r.to}
                      <div className="text-xs text-zinc-500">{r.trigger === "SCHEDULED" ? "nightly" : "requested"}</div>
                    </td>
                    <td className="py-1.5 pr-3">v{r.versionNumber}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={RUN_STATUSES[r.status].tone}>{RUN_STATUSES[r.status].label}</Badge>
                      {r.error && <div className="text-xs text-red-600">{r.error}</div>}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {r.attributed} / {r.unattributed} / {r.excluded}
                    </td>
                    <td className="py-1.5 text-xs text-zinc-500">{r.finishedAt ? formatDateTime(r.finishedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${CARD} space-y-2`}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">History</h2>
        <ul className="space-y-1.5 text-sm">
          {m.events.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{EVENTS[e.type] ?? e.type}</span>
              {e.comment && <span className="text-zinc-600 dark:text-zinc-300"> — {e.comment}</span>}
              <div className="text-xs text-zinc-500">
                {e.by} · {formatDateTime(e.at)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {error && !dialog && editing === null && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {dialog && <TextDialog spec={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSubmit={(body) => run(dialog.url, "POST", body)} />}
      {recalc && <RecalcDialog modelId={m.id} today={today} onClose={() => setRecalc(false)} onQueued={async () => (setRecalc(false), await reload())} />}
    </div>
  );
}

function VersionEditor({ rules, showNote, busy, error, onCancel, onSave }: { rules: Rules; showNote: boolean; busy: boolean; error: string | null; onCancel: () => void; onSave: (r: RulesDraft) => void }) {
  const [r, setR] = useState<RulesDraft>({ ...toRulesDraft(rules), changeNote: rules.changeNote ?? "" });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(r);
      }}
    >
      <RulesEditor value={r} onChange={setR} showChangeNote={showNote} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <FormButtons busy={busy} onCancel={onCancel} submitLabel="Save draft" />
    </form>
  );
}

function RecalcDialog({ modelId, today, onClose, onQueued }: { modelId: string; today: string; onClose: () => void; onQueued: () => void }) {
  const [from, setFrom] = useState(new Date(Date.parse(`${today}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const input = textInputClass();
  return (
    <Modal open onClose={onClose} title="Recalculate">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await send(`/api/v1/sales-marketing/attribution/models/${modelId}/runs`, "POST", { from, to, idempotencyKey: key });
            onQueued();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-300">New and changed records are read first. The result is a new run; earlier runs stay as they were.</p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Conversions from" htmlFor="rc-from" required>
            <input id="rc-from" type="date" required max={to} value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          </FormField>
          <FormField label="to" htmlFor="rc-to" required>
            <input id="rc-to" type="date" required max={today} value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </FormField>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <FormButtons busy={busy} onCancel={onClose} submitLabel="Start" />
      </form>
    </Modal>
  );
}

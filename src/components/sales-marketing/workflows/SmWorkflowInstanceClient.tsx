"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { Modal } from "@/components/ui/Modal";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { Badge, CARD, SM_WF_API, STEP_STATUS, TRIGGER_SOURCE, WfStatusBadge, send, useApi, type InstanceDto } from "./sm-workflow-ui";

const TASK_STATUS: Record<string, string> = { PENDING: "Open", IN_PROGRESS: "In progress", COMPLETED: "Done", CANCELLED: "Cancelled" };

/** Phase 15 — one running (or finished) workflow: where it is, what it did, its tasks, and the operator actions. */
export function SmWorkflowInstanceClient({ id, existing = false }: { id: string; existing?: boolean }) {
  const api = `${SM_WF_API}/instances/${id}`;
  const { data: i, error, reload, setData } = useApi<InstanceDto>(api);
  const [action, setAction] = useState<InstanceDto["actions"][number] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (error && !i) return <ErrorState message={error} onRetry={reload} />;
  if (!i) return <LoadingState />;

  const noteRequired = action?.key === "resolve";
  const doAction = async () => {
    if (!action) return;
    setBusy(true);
    setMsg(null);
    try {
      setData(await send<InstanceDto>(api, "POST", { action: action.key, note }));
      setMsg({ tone: "ok", text: `${action.label}: done.` });
      setAction(null);
      setNote("");
    } catch (e) {
      setMsg({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const live = !["COMPLETED", "CANCELLED"].includes(i.status);

  return (
    <div className="space-y-4">
      {existing && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">This record already had this workflow running — here it is.</p>}
      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${msg.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"}`}>
          {msg.text}
        </p>
      )}

      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <WfStatusBadge label={i.statusLabel} tone={i.statusTone} />
              {i.outcomeLabel && <Badge tone="zinc">{i.outcomeLabel}</Badge>}
              {i.compensationStatus === "FAILED" && <Badge tone="red">Undo failed</Badge>}
            </div>
            <p className="text-sm">
              {i.workflowName} · v{i.version} ·{" "}
              {i.entityHref ? (
                <Link href={i.entityHref} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {i.entityLabel ?? "Open record"}
                </Link>
              ) : (
                (i.entityLabel ?? i.entityId)
              )}
            </p>
            {i.outcomeMessage && <p className="text-sm text-zinc-600 dark:text-zinc-400">{i.outcomeMessage}</p>}
            {i.error && live && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {i.error.message} <span className="font-mono text-xs">({i.error.code})</span>
              </p>
            )}
            <p className="text-xs text-zinc-500">
              {TRIGGER_SOURCE[i.triggerSource] ?? i.triggerSource}
              {i.initiatedBy ? ` (${i.initiatedBy})` : ""} · started <ClientDateTime value={i.startedAt} />
              {i.completedAt && (
                <>
                  {" "}
                  · ended <ClientDateTime value={i.completedAt} />
                </>
              )}
              {live && i.nextRunAt && (
                <>
                  {" "}
                  · next check <ClientDateTime value={i.nextRunAt} />
                </>
              )}
              {i.attempts > 0 && ` · attempt ${i.attempts + 1}`}
            </p>
            <p className="font-mono text-xs text-zinc-400">{i.correlationId}</p>
          </div>
          {i.actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {i.actions.map((a) => (
                <Button key={a.key} size="sm" variant={a.key === "cancel" ? "danger" : "secondary"} title={a.help} onClick={() => setAction(a)}>
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={CARD}>
          <h2 className="font-semibold">Plan</h2>
          <ol className="mt-2 space-y-1 text-sm">
            {i.plan.map((s, n) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${s.state === "done" ? "bg-green-600 text-white" : s.state === "current" ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}
                >
                  {s.state === "done" ? "✓" : n + 1}
                </span>
                <span className={s.state === "current" ? "font-medium" : s.state === "pending" ? "text-zinc-500" : ""}>{s.label}</span>
                <span className="sr-only">({s.state})</span>
              </li>
            ))}
          </ol>
          {(i.references.quotationNumber || i.references.orderNumber || i.references.exception) && (
            <dl className="mt-3 space-y-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
              {i.references.quotationNumber && (
                <div>
                  <dt className="inline text-zinc-500">Quotation: </dt>
                  <dd className="inline">{i.references.quotationId ? <Link href={`/sales-marketing/quotations/${i.references.quotationId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">{i.references.quotationNumber}</Link> : i.references.quotationNumber}</dd>
                </div>
              )}
              {i.references.orderNumber && (
                <div>
                  <dt className="inline text-zinc-500">Sales Order: </dt>
                  <dd className="inline">{i.references.orderId ? <Link href={`/sales-orders/${i.references.orderId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">{i.references.orderNumber}</Link> : i.references.orderNumber}</dd>
                </div>
              )}
              {i.references.exception && (
                <div>
                  <dt className="inline text-zinc-500">Exception: </dt>
                  <dd className="inline">{i.references.exception}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        <section className={`${CARD} lg:col-span-2`}>
          <h2 className="font-semibold">Tasks</h2>
          {i.tasks.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">No CRM tasks.</p>
          ) : (
            <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {i.tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{t.subject}</span>
                  <span className="text-xs text-zinc-500">
                    {t.assignee ?? "Unassigned"}
                    {t.dueAt && (
                      <>
                        {" "}
                        · due <ClientDateTime value={t.dueAt} mode="date" />
                      </>
                    )}{" "}
                    · <Badge tone={t.status === "COMPLETED" ? "green" : t.status === "CANCELLED" ? "zinc" : "amber"}>{TASK_STATUS[t.status] ?? t.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {i.checklist && (
            <>
              <h3 className="mt-3 text-sm font-medium">Readiness checklist</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {i.checklist.map((c) => (
                  <li key={c.key} className="flex gap-2">
                    <span aria-hidden className={c.ok ? "text-green-600" : "text-red-600"}>
                      {c.ok ? "✓" : "✗"}
                    </span>
                    <span>
                      {c.label}
                      <span className="sr-only">{c.ok ? " (ready)" : " (not ready)"}</span>
                      {c.detail && <span className="text-zinc-500"> — {c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className={CARD}>
        <h2 className="font-semibold">History</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-medium">#</th>
                <th className="py-1 pr-3 font-medium">Step</th>
                <th className="py-1 pr-3 font-medium">Result</th>
                <th className="py-1 pr-3 font-medium">What happened</th>
                <th className="py-1 pr-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {i.steps.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1 pr-3 text-xs text-zinc-500">{s.sequence}</td>
                  <td className="py-1 pr-3">
                    {s.kind === "OPERATOR" || s.kind === "COMPENSATE" ? `${s.actor ?? "A person"}` : s.label}
                    {s.attempt > 1 && <div className="text-xs text-zinc-500">attempt {s.attempt}</div>}
                  </td>
                  <td className="py-1 pr-3">
                    <Badge tone={STEP_STATUS[s.status]?.tone ?? "zinc"}>{STEP_STATUS[s.status]?.label ?? s.status}</Badge>
                  </td>
                  <td className="py-1 pr-3">
                    {s.summary ?? "—"}
                    {s.errorMessage && s.errorMessage !== s.summary && <div className="text-xs text-red-600 dark:text-red-400">{s.errorMessage}</div>}
                  </td>
                  <td className="py-1 pr-3 text-xs">
                    <ClientDateTime value={s.finishedAt ?? s.lastCheckAt ?? s.startedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={action !== null} onClose={() => !busy && setAction(null)} title={action ? `${action.label}?` : ""}>
        {action && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{action.help}</p>
            <label className="block text-sm">
              <span className="block font-medium">
                Note{noteRequired ? "" : " (optional)"}
              </span>
              <textarea className={textInputClass()} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} required={noteRequired} />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>
                Back
              </Button>
              <Button variant={action.key === "cancel" ? "danger" : "primary"} disabled={busy || (noteRequired && note.trim().length < 3)} onClick={doAction}>
                {action.label}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

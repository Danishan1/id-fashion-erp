"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { DELIVERY_STATUSES, type DeliveryStatusKey } from "@/modules/sales-marketing/delivery/delivery-registry";
import { selectClass } from "../performance/performance-ui";
import { CARD, CHANNEL_LABELS, DeliveryStatusBadge, RunStatusBadge, fmtCount, fmtDateTime, send, skipReasonLabel, useApi } from "./delivery-ui";

interface Run {
  id: string;
  runNumber: number;
  channelType: string;
  providerLabel: string;
  status: string;
  scheduledFor: string | null;
  plannedCount: number;
  cancelRequestedAt: string | null;
  cancelReason: string | null;
  preparedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextDispatchAt: string | null;
  error: string | null;
  createdAt: string;
  campaign: { id: string; code: string; name: string; status: string };
  connection: { id: string; code: string; name: string };
  template: { id: string; name: string; versionNumber: number };
  initiatedBy: string;
  counts: { planned: number; eligible: number; excluded: number; pending: number; accepted: number; delivered: number; failed: number; unknown: number; cancelled: number };
  errorSummary: { code: string; count: number }[];
  capabilities: { deliveryReceipts: boolean };
}
interface DeliveryRow {
  id: string;
  contactId: string;
  contactName: string;
  destination: string | null;
  status: string;
  skipReason: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  statusAt: string | null;
}
interface EventRow {
  id: string;
  source: string;
  eventType: string;
  normalizedStatus: string | null;
  occurredAt: string;
  result: string | null;
  errorCode: string | null;
  detail: string | null;
}

const OPEN = ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"];

/** One delivery run (Phase 10): counts, actions, recipients and their events. */
export function RunDetailClient({ runId, canCancel, canEdit }: { runId: string; canCancel: boolean; canEdit: boolean }) {
  const { data: run, error, reload } = useApi<Run>(`/api/v1/sales-marketing/delivery/runs/${runId}`);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const { data: list } = useListApi<DeliveryRow>(`/api/v1/sales-marketing/delivery/runs/${runId}/deliveries?status=${status}&page=${page}&pageSize=50&t=${tick}`);
  const [openEvents, setOpenEvents] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "cancel" | "close-unknown" | "resend-unknown">(null);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!run) return <LoadingState />;
  const open = OPEN.includes(run.status);
  const refresh = () => (reload(), setTick((t) => t + 1));

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setDialog(null);
      setReason("");
      setAck(false);
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const c = run.counts;
  const stats: [string, number, string?][] = [
    ["Recipients", c.planned],
    ["Not sent (checks)", c.excluded],
    ["Waiting", c.pending],
    ["Accepted by provider", c.accepted, "Accepted, sent or delivered. Acceptance isn't proof of delivery."],
    ...(run.capabilities.deliveryReceipts ? ([["Delivered (reported)", c.delivered]] as [string, number][]) : []),
    ["Failed / bounced", c.failed],
    ["Outcome unknown", c.unknown, "The provider may or may not have the message. Never retried automatically."],
    ["Cancelled", c.cancelled],
  ];

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <RunStatusBadge status={run.status} />
              {run.cancelRequestedAt && open && <span className="text-xs text-amber-700 dark:text-amber-400">Cancelling…</span>}
            </div>
            <div>
              Campaign{" "}
              <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/sales-marketing/campaigns/${run.campaign.id}`}>
                {run.campaign.code} · {run.campaign.name}
              </Link>
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              {CHANNEL_LABELS[run.channelType] ?? run.channelType} via {run.connection.name} ({run.providerLabel}) · template {run.template.name} v{run.template.versionNumber}
            </div>
            <div className="text-zinc-600 dark:text-zinc-400">
              Started by {run.initiatedBy} on {fmtDateTime(run.createdAt)}
              {run.scheduledFor ? ` · scheduled for ${fmtDateTime(run.scheduledFor)}` : ""}
              {run.finishedAt ? ` · finished ${fmtDateTime(run.finishedAt)}` : ""}
              {open && run.nextDispatchAt ? ` · next step ${fmtDateTime(run.nextDispatchAt)}` : ""}
            </div>
            {run.cancelReason && <div className="text-zinc-600 dark:text-zinc-400">Cancel reason: {run.cancelReason}</div>}
            {run.error && <div className="text-red-700 dark:text-red-400">{run.error}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="secondary" onClick={refresh}>
              Refresh
            </Button>
            {canCancel && open && !run.cancelRequestedAt && (
              <Button size="xs" variant="danger" onClick={() => setDialog("cancel")}>
                Cancel run
              </Button>
            )}
            {canEdit && ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"].includes(run.status) && (
              <Button size="xs" variant="secondary" disabled={busy} onClick={() => act(() => send(`/api/v1/sales-marketing/delivery/runs/${run.id}/resume`, "POST"), "Resumed — pending recipients and those given up on after retries will be sent again.")}>
                Resume
              </Button>
            )}
            {canEdit && !open && c.unknown > 0 && (
              <>
                <Button size="xs" variant="secondary" onClick={() => setDialog("close-unknown")}>
                  Close unknown as failed
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setDialog("resend-unknown")}>
                  Resend unknown…
                </Button>
              </>
            )}
          </div>
        </div>
        {dialog && (
          <div className="mt-3 space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="font-medium">
              {dialog === "cancel" ? "Cancel this run" : dialog === "close-unknown" ? `Mark ${fmtCount(c.unknown)} unknown outcomes as failed` : `Send ${fmtCount(c.unknown)} unknown outcomes again`}
            </div>
            {dialog === "cancel" && <p className="text-zinc-600 dark:text-zinc-400">Messages not yet sent are cancelled. Messages already handed to the provider can&apos;t be recalled.</p>}
            {dialog === "resend-unknown" && (
              <label className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
                <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>I understand the provider may already have delivered some of these — those people would get the message twice.</span>
              </label>
            )}
            <input className={textInputClass()} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={dialog === "cancel" ? "danger" : "primary"}
                disabled={busy || reason.trim().length < 3 || (dialog === "resend-unknown" && !ack)}
                onClick={() =>
                  dialog === "cancel"
                    ? act(() => send(`/api/v1/sales-marketing/delivery/runs/${run.id}/cancel`, "POST", { reason }), "Cancellation requested.")
                    : act(
                        () => send(`/api/v1/sales-marketing/delivery/runs/${run.id}/resolve-unknown`, "POST", { resolution: dialog === "close-unknown" ? "MARK_FAILED" : "RESEND", acknowledgeDuplicateRisk: dialog === "resend-unknown" ? ack : undefined, reason }),
                        dialog === "close-unknown" ? "Unknown outcomes closed as failed." : "Unknown outcomes queued to send again."
                      )
                }
              >
                Confirm
              </Button>
              <Button size="sm" variant="secondary" onClick={() => (setDialog(null), setAck(false))}>
                Back
              </Button>
            </div>
          </div>
        )}
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{msg.text}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, n, hint]) => (
          <div key={label} className={CARD} title={hint}>
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{fmtCount(n)}</div>
          </div>
        ))}
      </div>
      {!run.capabilities.deliveryReceipts && <p className="text-xs text-zinc-500">This provider doesn&apos;t report delivery, so &quot;accepted&quot; is the last status we&apos;ll see.</p>}

      {run.errorSummary.length > 0 && (
        <div className={CARD}>
          <h3 className="mb-2 text-sm font-semibold">Problems by error</h3>
          <ul className="text-sm">
            {run.errorSummary.map((e) => (
              <li key={e.code}>
                {e.code}: {fmtCount(e.count)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={CARD}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Recipients</h3>
          <select aria-label="Status" className={selectClass} value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {(Object.keys(DELIVERY_STATUSES) as DeliveryStatusKey[]).map((k) => (
              <option key={k} value={k}>
                {DELIVERY_STATUSES[k].label}
              </option>
            ))}
          </select>
        </div>
        {!list ? (
          <LoadingState />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-1">Contact</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Detail</th>
                    <th>Updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((d) => (
                    <RecipientRow key={d.id} d={d} runId={run.id} open={openEvents === d.id} onToggle={() => setOpenEvents(openEvents === d.id ? null : d.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            {list.meta.totalPages > 1 && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Button size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page} of {list.meta.totalPages} · {fmtCount(list.meta.totalCount)} recipients
                </span>
                <Button size="xs" variant="secondary" disabled={page >= list.meta.totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecipientRow({ d, runId, open, onToggle }: { d: DeliveryRow; runId: string; open: boolean; onToggle: () => void }) {
  const { data: events } = useApi<EventRow[]>(open ? `/api/v1/sales-marketing/delivery/runs/${runId}/deliveries/${d.id}/events` : null);
  const detail = d.skipReason ? skipReasonLabel(d.skipReason) : d.errorMessage ? `${d.errorCode ?? ""} ${d.errorMessage}`.trim() : d.nextAttemptAt ? `Retry ${d.attempts + 1} at ${fmtDateTime(d.nextAttemptAt)}` : "";
  return (
    <>
      <tr className="border-t border-zinc-100 align-top dark:border-zinc-800">
        <td className="py-1">
          <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`/crm/contacts/${d.contactId}`}>
            {d.contactName}
          </Link>
        </td>
        <td className="font-mono text-xs">{d.destination ?? "—"}</td>
        <td>
          <DeliveryStatusBadge status={d.status} />
        </td>
        <td className="max-w-xs text-xs text-zinc-600 dark:text-zinc-400">{detail}</td>
        <td className="text-xs">{fmtDateTime(d.statusAt)}</td>
        <td>
          <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={onToggle}>
            {open ? "Hide" : "History"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-zinc-50 p-2 text-xs dark:bg-zinc-950">
            {!events ? (
              "Loading…"
            ) : events.length === 0 ? (
              "No events."
            ) : (
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id}>
                    {fmtDateTime(e.occurredAt)} · {e.source === "APP" ? "ERP" : "Provider"} · {e.eventType}
                    {e.normalizedStatus ? ` → ${e.normalizedStatus}` : ""}
                    {e.errorCode ? ` · ${e.errorCode}` : ""}
                    {e.detail ? ` · ${e.detail}` : ""}
                    {e.result ? ` · ${e.result.toLowerCase().replace(/_/g, " ")}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Like useApi, but keeps the whole { data, meta } body of a list endpoint. */
function useListApi<T>(url: string) {
  const [state, setState] = useState<{ data: T[]; meta: { totalPages: number; totalCount: number } } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(url, { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => alive && b && setState(b))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url]);
  return { data: state };
}

"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "LOCKED";

interface SupportSessionRow {
  id: string;
  mode: "READ_ONLY" | "READ_WRITE";
  startedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  endedAt: string | null;
  lastAccessedAt: string | null;
  writeStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "LOCKED";
  writeJustification: string | null;
  writeCodeExpiresAt: string | null;
  writeDecidedBy: string | null;
  isLive: boolean;
}

interface SupportRequestRow {
  id: string;
  reason: string;
  durationMinutes: number;
  status: RequestStatus;
  codeExpiresAt: string;
  attemptsLeft: number;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  requestedBy: { name: string; email: string };
  decidedBy: string | null;
  session: SupportSessionRow | null;
}

interface SupportEvent {
  seq: number;
  eventType: string;
  actorType: string;
  method: string | null;
  path: string | null;
  detail: unknown;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  REQUEST_CREATED: "Request created",
  REQUEST_CANCELLED: "Request cancelled by support",
  REQUEST_APPROVED: "Approved",
  REQUEST_REJECTED: "Rejected",
  REQUEST_EXPIRED: "Request expired",
  REQUEST_CODE_FAILED: "Wrong code entered",
  REQUEST_LOCKED: "Locked after too many wrong codes",
  SESSION_OPENED: "Support opened the session",
  SESSION_REVOKED: "Revoked",
  SESSION_ENDED: "Support ended the session",
  WRITE_REQUESTED: "Write access requested",
  WRITE_APPROVED: "Write access approved",
  WRITE_REJECTED: "Write access rejected",
  WRITE_CODE_FAILED: "Wrong write code entered",
  WRITE_LOCKED: "Write access locked",
  ACCESS: "Opened",
  ACCESS_DENIED: "Blocked (read-only)",
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
}

function statusLabel(row: SupportRequestRow): { text: string; tone: string } {
  if (row.session?.isLive) {
    return row.session.mode === "READ_WRITE"
      ? { text: "Active · read & write", tone: "bg-red-100 text-red-700" }
      : { text: "Active · read-only", tone: "bg-amber-100 text-amber-800" };
  }
  if (row.status === "APPROVED") {
    if (row.session?.revokedAt) return { text: "Revoked", tone: "bg-zinc-100 text-zinc-600" };
    if (row.session?.endedAt) return { text: "Ended", tone: "bg-zinc-100 text-zinc-600" };
    return { text: "Expired", tone: "bg-zinc-100 text-zinc-600" };
  }
  const map: Record<RequestStatus, { text: string; tone: string }> = {
    PENDING: { text: "Waiting for you", tone: "bg-indigo-100 text-indigo-700" },
    APPROVED: { text: "Approved", tone: "bg-green-100 text-green-700" },
    REJECTED: { text: "Rejected", tone: "bg-zinc-100 text-zinc-600" },
    EXPIRED: { text: "Expired", tone: "bg-zinc-100 text-zinc-600" },
    CANCELLED: { text: "Cancelled", tone: "bg-zinc-100 text-zinc-600" },
    LOCKED: { text: "Locked", tone: "bg-red-100 text-red-700" },
  };
  return map[row.status];
}

type Dialog =
  | { kind: "approve"; row: SupportRequestRow }
  | { kind: "reject"; row: SupportRequestRow }
  | { kind: "write-approve"; row: SupportRequestRow }
  | { kind: "write-reject"; row: SupportRequestRow }
  | { kind: "revoke"; row: SupportRequestRow }
  | { kind: "events"; row: SupportRequestRow };

export function SupportAccessPanel({ initialRequests }: { initialRequests: SupportRequestRow[] }) {
  const [requests, setRequests] = useState(initialRequests);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<{ events: SupportEvent[]; integrity: { valid: boolean; eventCount: number; brokenAtSeq: number | null } } | null>(null);

  async function reload() {
    const res = await fetch("/api/v1/support-access", { cache: "no-store" });
    if (res.ok) setRequests((await res.json()).data);
  }

  function open(next: Dialog) {
    setDialog(next);
    setCode("");
    setReason("");
    setError(null);
    setEvents(null);
    if (next.kind === "events") {
      void fetch(`/api/v1/support-access/requests/${next.row.id}/events`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => body && setEvents(body.data));
    }
  }

  function close() {
    setDialog(null);
  }

  async function submit(url: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? "Something went wrong.");
        await reload();
        return;
      }
      close();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const active = requests.filter((r) => r.status === "PENDING" || r.session?.isLive);
  const history = requests.filter((r) => !(r.status === "PENDING" || r.session?.isLive));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Needs your attention</h2>
        {active.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            No pending requests and no active support sessions.
          </p>
        ) : (
          active.map((row) => <RequestCard key={row.id} row={row} onAction={open} />)
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">History</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                <th className="px-4 py-2 font-medium">Requested</th>
                <th className="px-4 py-2 font-medium">Support person</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    Nothing yet.
                  </td>
                </tr>
              )}
              {history.map((row) => {
                const s = statusLabel(row);
                return (
                  <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2 whitespace-nowrap">{fmt(row.createdAt)}</td>
                    <td className="px-4 py-2">{row.requestedBy.name}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{row.reason}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.text}</span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => open({ kind: "events", row })} className="text-indigo-600 hover:underline">
                        Activity log
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={dialog?.kind === "approve" || dialog?.kind === "write-approve"}
        onClose={close}
        title={dialog?.kind === "write-approve" ? "Approve write access" : "Approve support access"}
      >
        {dialog && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              {dialog.kind === "write-approve"
                ? "Support will be able to create and edit records (never approve, post or delete). Enter the write code support gave you."
                : `${dialog.row.requestedBy.name} will be able to view your data (read-only) for ${dialog.row.durationMinutes} minutes. Enter the 6-digit code they gave you.`}
            </p>
            <input
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center font-mono text-xl tracking-[0.4em] dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="000000"
            />
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-zinc-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || code.length !== 6}
                onClick={() =>
                  submit(
                    dialog.kind === "write-approve"
                      ? `/api/v1/support-access/sessions/${dialog.row.session?.id}/write/approve`
                      : `/api/v1/support-access/requests/${dialog.row.id}/approve`,
                    { code }
                  )
                }
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Approve
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={dialog?.kind === "reject" || dialog?.kind === "write-reject"}
        onClose={close}
        title={dialog?.kind === "write-reject" ? "Reject write access" : "Reject support access"}
      >
        {dialog && (
          <div className="space-y-3 text-sm">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Reason (optional)"
            />
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-zinc-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  submit(
                    dialog.kind === "write-reject"
                      ? `/api/v1/support-access/sessions/${dialog.row.session?.id}/write/reject`
                      : `/api/v1/support-access/requests/${dialog.row.id}/reject`,
                    { reason: reason || undefined }
                  )
                }
                className="rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Reject
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={dialog?.kind === "revoke"} onClose={close} title="Revoke support access">
        {dialog && (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              {dialog.row.requestedBy.name} will lose access immediately — their next click is refused.
            </p>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-md border border-zinc-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => submit(`/api/v1/support-access/sessions/${dialog.row.session?.id}/revoke`, {})}
                className="rounded-md bg-red-600 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Revoke now
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={dialog?.kind === "events"} onClose={close} title="Support activity log" maxWidthClass="max-w-3xl">
        {!events ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className={events.integrity.valid ? "text-green-700" : "font-semibold text-red-600"}>
              {events.integrity.valid
                ? `Log verified — ${events.integrity.eventCount} entries, none altered.`
                : `Warning: the log was altered at entry #${events.integrity.brokenAtSeq}.`}
            </p>
            <div className="max-h-96 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <tbody>
                  {events.events.map((e) => (
                    <tr key={e.seq} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="px-2 py-1 text-zinc-400">#{e.seq}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{fmt(e.createdAt)}</td>
                      <td className="px-2 py-1">{EVENT_LABELS[e.eventType] ?? e.eventType}</td>
                      <td className="px-2 py-1 font-mono text-zinc-500">
                        {e.method ? `${e.method} ${e.path}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function RequestCard({ row, onAction }: { row: SupportRequestRow; onAction: (d: Dialog) => void }) {
  const s = statusLabel(row);
  const session = row.session;
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.requestedBy.name}</span>
        <span className="text-zinc-500">{row.requestedBy.email}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.text}</span>
      </div>
      <p className="text-zinc-700 dark:text-zinc-200">{row.reason}</p>
      <p className="text-xs text-zinc-500">
        Requested {fmt(row.createdAt)} · {row.durationMinutes} minutes
        {row.status === "PENDING" && ` · code valid until ${fmt(row.codeExpiresAt)}`}
        {session?.isLive && ` · ends ${fmt(session.expiresAt)}`}
      </p>
      {session?.isLive && session.writeStatus === "PENDING" && (
        <div className="rounded-md bg-red-50 p-2 text-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="font-medium">Write access requested:</span> {session.writeJustification}
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {row.status === "PENDING" && (
          <>
            <button type="button" onClick={() => onAction({ kind: "approve", row })} className="rounded-md bg-indigo-600 px-3 py-1.5 text-white">
              Approve with code
            </button>
            <button type="button" onClick={() => onAction({ kind: "reject", row })} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Reject
            </button>
          </>
        )}
        {session?.isLive && session.writeStatus === "PENDING" && (
          <>
            <button type="button" onClick={() => onAction({ kind: "write-approve", row })} className="rounded-md bg-red-600 px-3 py-1.5 text-white">
              Approve write access
            </button>
            <button type="button" onClick={() => onAction({ kind: "write-reject", row })} className="rounded-md border border-zinc-300 px-3 py-1.5">
              Reject write access
            </button>
          </>
        )}
        {session?.isLive && (
          <button type="button" onClick={() => onAction({ kind: "revoke", row })} className="rounded-md border border-red-300 px-3 py-1.5 text-red-700">
            Revoke access
          </button>
        )}
        <button type="button" onClick={() => onAction({ kind: "events", row })} className="px-3 py-1.5 text-indigo-600 hover:underline">
          Activity log
        </button>
      </div>
    </div>
  );
}

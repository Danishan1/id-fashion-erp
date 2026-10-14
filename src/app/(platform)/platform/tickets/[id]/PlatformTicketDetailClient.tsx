"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FilePicker,
  TicketStatusBadge,
  TicketThread,
  type ThreadMessage,
} from "@/components/support/TicketThread";
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS_PLATFORM,
  type TicketCategoryValue,
  type TicketPriorityValue,
  type TicketStatusValue,
} from "@/modules/support-tickets/support-ticket.schema";

interface TicketSummary {
  id: string;
  ticketNumber: string;
  subject: string;
  category: TicketCategoryValue;
  priority: TicketPriorityValue;
  status: TicketStatusValue;
  assignedToId: string;
  company: { id: string; name: string; isActive: boolean };
  createdBy: { fullName: string; email: string };
  createdAt: string;
}

const selectClass = "mt-1 w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function PlatformTicketDetailClient({
  ticket,
  messages,
  assignees,
  canRequestAccess,
}: {
  ticket: TicketSummary;
  messages: ThreadMessage[];
  assignees: { id: string; fullName: string }[];
  canRequestAccess: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isInternal, setIsInternal] = useState(false);
  const [replyStatus, setReplyStatus] = useState<string>("WAITING_ON_CUSTOMER");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closed = ticket.status === "CLOSED";

  async function update(patch: Record<string, string>) {
    setError(null);
    const res = await fetch(`/api/v1/platform/support-tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error?.message ?? "Couldn't update the ticket.");
      return;
    }
    router.refresh();
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("body", body);
      form.set("isInternal", String(isInternal));
      if (!isInternal) form.set("status", replyStatus);
      files.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/v1/platform/support-tickets/${ticket.id}/messages`, { method: "POST", body: form });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Couldn't send.");
        return;
      }
      setBody("");
      setFiles([]);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="min-w-0 space-y-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="font-mono text-xs text-zinc-500">{ticket.ticketNumber}</div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{ticket.subject}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <TicketStatusBadge status={ticket.status} label={TICKET_STATUS_LABELS_PLATFORM[ticket.status]} />
            <span>{TICKET_CATEGORY_LABELS[ticket.category]}</span>
          </div>
        </div>

        <TicketThread messages={messages} attachmentBaseUrl="/api/v1/platform/support-tickets/attachments" ownSide="PLATFORM" />

        {closed ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            This ticket is closed. The customer can raise a new one.
          </p>
        ) : (
          <div
            className={`space-y-3 rounded-lg border p-4 text-sm ${
              isInternal
                ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            }`}
          >
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input type="radio" checked={!isInternal} onChange={() => setIsInternal(false)} />
                Reply to customer
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={isInternal} onChange={() => setIsInternal(true)} />
                Internal note (not visible to the customer)
              </label>
            </div>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isInternal ? "Note for the platform team…" : "Write a reply…"}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <FilePicker files={files} onChange={setFiles} max={MAX_TICKET_ATTACHMENTS} />
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!isInternal && (
                <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
                  Then set status
                  <select
                    value={replyStatus}
                    onChange={(e) => setReplyStatus(e.target.value)}
                    className="rounded-md border border-zinc-300 px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABELS_PLATFORM[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                disabled={busy || !body.trim()}
                onClick={send}
                className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
              >
                {busy ? "Sending…" : isInternal ? "Add note" : "Send reply"}
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4 text-sm">
        <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Status</span>
            <select
              value={ticket.status}
              disabled={closed}
              onChange={(e) => update({ status: e.target.value })}
              className={selectClass}
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABELS_PLATFORM[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Priority</span>
            <select value={ticket.priority} onChange={(e) => update({ priority: e.target.value })} className={selectClass}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-600 dark:text-zinc-300">Assigned to</span>
            <select
              value={ticket.assignedToId}
              onChange={(e) => update({ assignedToPlatformUserId: e.target.value })}
              className={selectClass}
            >
              <option value="">Unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-1 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Customer</div>
          <Link href={`/platform/companies/${ticket.company.id}`} className="font-medium text-indigo-600 hover:underline">
            {ticket.company.name}
          </Link>
          {!ticket.company.isActive && <div className="text-xs font-medium text-red-600">Company suspended</div>}
          <div>{ticket.createdBy.fullName}</div>
          <div className="break-all text-zinc-500">{ticket.createdBy.email}</div>
          <div className="text-xs text-zinc-500">
            Raised{" "}
            {new Date(ticket.createdAt).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Kolkata",
            })}
          </div>
          {canRequestAccess && (
            <Link
              href={`/platform/support?companyId=${ticket.company.id}`}
              className="mt-2 inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Request support access
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}

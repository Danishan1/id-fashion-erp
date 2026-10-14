"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  FilePicker,
  TicketPriorityText,
  TicketStatusBadge,
  TicketThread,
  type ThreadMessage,
} from "@/components/support/TicketThread";
import {
  MAX_TICKET_ATTACHMENTS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
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
  createdBy: string;
  createdAt: string;
}

export function TicketDetailClient({ ticket, messages }: { ticket: TicketSummary; messages: ThreadMessage[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const closed = ticket.status === "CLOSED";

  async function reply() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("body", body);
      files.forEach((f) => form.append("files", f));
      const res = await fetch(`/api/v1/support-tickets/${ticket.id}/messages`, { method: "POST", body: form });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Couldn't send your reply.");
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

  async function close() {
    setConfirmClose(false);
    const res = await fetch(`/api/v1/support-tickets/${ticket.id}/close`, { method: "POST" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-xs text-zinc-500">{ticket.ticketNumber}</div>
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{ticket.subject}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              <TicketStatusBadge status={ticket.status} label={TICKET_STATUS_LABELS[ticket.status]} />
              <span>{TICKET_CATEGORY_LABELS[ticket.category]}</span>
              <span>
                Priority: <TicketPriorityText priority={ticket.priority} label={TICKET_PRIORITY_LABELS[ticket.priority]} />
              </span>
              <span>Raised by {ticket.createdBy}</span>
            </div>
          </div>
          {!closed && (
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Close ticket
            </button>
          )}
        </div>
      </div>

      <TicketThread messages={messages} attachmentBaseUrl="/api/v1/support-tickets/attachments" ownSide="CUSTOMER" />

      {closed ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          This ticket is closed. If you still need help, raise a new ticket.
        </p>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a reply…"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <FilePicker files={files} onChange={setFiles} max={MAX_TICKET_ATTACHMENTS} />
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !body.trim()}
              onClick={reply}
              className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmClose}
        title="Close this ticket?"
        message="Close it if your problem is solved. A closed ticket can't be reopened — you can always raise a new one."
        confirmLabel="Close ticket"
        onConfirm={close}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ActivityPanel } from "@/components/crm/activities/ActivityPanel";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTimeline } from "@/components/crm/CrmTimeline";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { AssignConversationDialog, ConversationTaskDialog, CreateContactDialog, LinkRecordsDialog, type UserOption } from "./ConversationDialogs";
import { ConversationThread } from "./ConversationThread";
import { CONVERSATIONS_API, STATUS_TONES, type ConversationDetailDto, type ConversationStatus, type ThreadMessage } from "./conversation-types";

type Dialog = { kind: "link" } | { kind: "contact" } | { kind: "assign" } | { kind: "task"; message?: ThreadMessage } | null;

const STATUS_ACTIONS: { to: ConversationStatus; label: string; from: ConversationStatus[] }[] = [
  { to: "CLOSED", label: "Close", from: ["OPEN", "PENDING"] },
  { to: "PENDING", label: "Mark pending", from: ["OPEN"] },
  { to: "OPEN", label: "Reopen", from: ["CLOSED", "PENDING"] },
  { to: "OPEN", label: "Restore", from: ["ARCHIVED"] },
  { to: "ARCHIVED", label: "Archive", from: ["OPEN", "PENDING", "CLOSED"] },
];

/**
 * One conversation as a CRM workspace: who it is with (contact / company /
 * opportunity), channel, assignee and status in the header with the context
 * actions; the thread and composer; and a details panel (participants, tasks,
 * history). Record pages are linked, never duplicated.
 */
export function ConversationView({ conversationId, users, currentUserId, onChanged }: { conversationId: string; users: UserOption[]; currentUserId: string; onChanged: () => void }) {
  const [c, setC] = useState<ConversationDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [threadKey, setThreadKey] = useState(0);
  const [details, setDetails] = useState<"tasks" | "people" | "history" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversationId}`);
    if (!res.ok) return setError(res.error.message);
    setError(null);
    setC(res.data);
  }, [conversationId]);
  // Keyed by conversation in the inbox, so a new conversation mounts fresh.
  useEffect(() => {
    let cancelled = false;
    crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversationId}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.error.message);
      setC(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const changed = (next?: ConversationDetailDto) => {
    if (next) setC(next);
    else void load();
    setThreadKey((k) => k + 1);
    onChanged();
  };

  if (error) return <CrmErrorState message={error} onRetry={load} />;
  if (!c) return <CrmLoadingState label="Loading conversation…" />;

  const setStatus = async (to: ConversationStatus) => {
    setBusy(true);
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${c.id}/status`, { method: "POST", body: { version: c.version, status: to }, toast: "off" });
    setBusy(false);
    if (!res.ok) return toast.error(res.error.message);
    toast.success(`Conversation ${to === "CLOSED" ? "closed" : to === "ARCHIVED" ? "archived" : to === "PENDING" ? "marked pending" : "reopened"}.`);
    changed(res.data);
  };
  const unmatched = c.matchStatus !== "MATCHED";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">{c.title}</h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {[c.displayIdentifier !== c.title ? c.displayIdentifier : null, c.subject].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <CrmBadge label={c.channel.typeLabel} tone="indigo" />
            <CrmBadge label={c.statusLabel} tone={STATUS_TONES[c.status]} />
            {unmatched && <CrmBadge label={c.matchLabel} tone="amber" />}
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <div className="flex gap-1">
            <dt className="text-zinc-500">Contact:</dt>
            <dd>{c.contact ? <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={c.contact.href}>{c.contact.fullName}</Link> : <span className="text-zinc-400">—</span>}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-zinc-500">Company:</dt>
            <dd>{c.company ? <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={c.company.href}>{c.company.name}</Link> : <span className="text-zinc-400">—</span>}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-zinc-500">Opportunity:</dt>
            <dd>{c.opportunity ? <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={c.opportunity.href}>{c.opportunity.label}</Link> : <span className="text-zinc-400">—</span>}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-zinc-500">Channel:</dt>
            <dd>{c.channel.name}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-zinc-500">Assigned:</dt>
            <dd>{c.assignedTo?.fullName ?? <span className="text-zinc-400">Unassigned</span>}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-1.5" aria-label="Conversation actions">
          {c.permissions.assign && (
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "assign" })}>
              {c.assignedTo ? "Reassign" : "Assign"}
            </Button>
          )}
          {c.permissions.link && (
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "link" })}>
              Link records
            </Button>
          )}
          {c.permissions.task && (
            <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "task" })}>
              Create task
            </Button>
          )}
          {c.permissions.status &&
            STATUS_ACTIONS.filter((a) => a.from.includes(c.status)).map((a) => (
              <Button key={a.label} size="xs" variant="secondary" disabled={busy} onClick={() => setStatus(a.to)}>
                {a.label}
              </Button>
            ))}
          <span className="ml-auto flex gap-1">
            {(["tasks", "people", "history"] as const).map((d) => (
              <button key={d} type="button" aria-pressed={details === d} onClick={() => setDetails(details === d ? null : d)} className={`rounded px-2 py-0.5 text-xs ${details === d ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                {d === "tasks" ? "Tasks" : d === "people" ? "Participants" : "History"}
              </button>
            ))}
          </span>
        </div>
        {unmatched && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" role="status">
            {c.matchStatus === "MULTIPLE" ? (
              <>
                <p className="font-medium">Several contacts match this sender. Choose the right one:</p>
                <ul className="mt-1 space-y-1">
                  {c.matchCandidates.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {m.fullName}
                        <span className="text-xs text-amber-700 dark:text-amber-300"> {[m.companyName, m.email, m.phone].filter(Boolean).join(" · ")}</span>
                      </span>
                      {c.permissions.link && (
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={async () => {
                            const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${c.id}/link`, { method: "POST", body: { version: c.version, contactId: m.id }, toast: "errors" });
                            if (res.ok) {
                              toast.success(`Linked to ${m.fullName}.`);
                              changed(res.data);
                            }
                          }}
                        >
                          Link
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Not linked to a contact yet. Link an existing contact or create one — nothing is created automatically.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.permissions.link && (
                <Button size="xs" onClick={() => setDialog({ kind: "link" })}>
                  Link existing contact
                </Button>
              )}
              {c.permissions.createContact && (
                <Button size="xs" variant="secondary" onClick={() => setDialog({ kind: "contact" })}>
                  Create contact
                </Button>
              )}
            </div>
          </div>
        )}
        {!c.contactability.allowed && (
          <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
            ⚠ {c.contactability.message}
          </p>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <ConversationThread conversation={c} refreshKey={threadKey} onActivity={() => changed()} onRead={onChanged} onTask={(m) => setDialog({ kind: "task", message: m })} />
        {details && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-3 lg:block dark:border-zinc-800 dark:bg-zinc-950" aria-label="Conversation details">
            {details === "tasks" && <ActivityPanel parent={{ entityType: "CONVERSATION", entityId: c.id, label: c.title }} canCreate={false} canEdit={c.permissions.task} currentUserId={currentUserId} pageSize={5} />}
            {details === "people" && (
              <ul className="space-y-2 text-sm">
                {c.participants.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.displayName ?? p.identifier ?? "Unknown"}</span>
                    <span className="block text-xs text-zinc-500">
                      {p.role === "AGENT" ? "Team member" : p.type === "ANONYMOUS" ? "Anonymous visitor" : p.contactId ? "Contact" : "Customer"}
                      {p.identifier ? ` · ${p.identifier}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {details === "history" && <CrmTimeline entityType="CONVERSATION" entityId={c.id} />}
          </aside>
        )}
      </div>
      {dialog?.kind === "link" && <LinkRecordsDialog conversation={c} onClose={() => setDialog(null)} onSaved={(n) => (setDialog(null), changed(n))} />}
      {dialog?.kind === "contact" && <CreateContactDialog conversation={c} onClose={() => setDialog(null)} onSaved={(n) => (setDialog(null), changed(n))} />}
      {dialog?.kind === "assign" && <AssignConversationDialog conversation={c} users={users} onClose={() => setDialog(null)} onSaved={(n) => (setDialog(null), changed(n))} />}
      {dialog?.kind === "task" && (
        <ConversationTaskDialog
          conversation={c}
          messageId={dialog.message?.id}
          quote={dialog.message?.body}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setDetails("tasks");
            changed();
          }}
        />
      )}
    </div>
  );
}

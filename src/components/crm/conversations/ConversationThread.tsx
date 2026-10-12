"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { TemplatePickerDialog, type PickedTemplate } from "@/components/crm/templates/TemplatePickerDialog";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { textInputClass } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { TOAST_HEADER } from "@/lib/api-client";
import { acceptFor, CONVERSATIONS_API, fullWhen, mergeThread, type ConversationDetailDto, type ThreadItem, type ThreadMessage, type ThreadNote } from "./conversation-types";

const POLL_MS = 10_000;

// ── Items ────────────────────────────────────────────────────────

function Attachments({ m }: { m: ThreadMessage }) {
  if (!m.attachments.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {m.attachments.map((a) =>
        a.stored && a.downloadUrl ? (
          <li key={a.id}>
            {a.kind === "IMAGE" ? (
              <a href={a.downloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated download route, not a static asset */}
                <img src={`${a.downloadUrl}?disposition=inline`} alt={a.fileName} className="max-h-48 max-w-full rounded border border-black/10" />
              </a>
            ) : (
              <a href={a.downloadUrl} className="text-sm font-medium underline underline-offset-2">
                {a.fileName}
              </a>
            )}
          </li>
        ) : (
          <li key={a.id} className="text-xs italic opacity-80">
            {a.fileName} — not stored in the CRM{a.kind ? ` (${a.kind.toLowerCase()})` : ""}
          </li>
        )
      )}
    </ul>
  );
}

function DeliveryState({ m, statuses }: { m: ThreadMessage; statuses: string[] }) {
  if (m.direction !== "OUTBOUND") return null;
  // Only show states the channel reports; "Sending…" and "Failed" always apply.
  if (m.status !== "QUEUED" && m.status !== "FAILED" && !statuses.includes(m.status)) return null;
  return <span className={m.status === "FAILED" ? "font-medium text-red-600 dark:text-red-400" : ""}>{m.statusLabel}</span>;
}

export function MessageBubble({ m, deliveryStatuses, onRetry, onTask, retrying }: { m: ThreadMessage; deliveryStatuses: string[]; onRetry?: (m: ThreadMessage) => void; onTask?: (m: ThreadMessage) => void; retrying?: boolean }) {
  const out = m.direction === "OUTBOUND";
  return (
    <li className={`flex ${out ? "justify-end" : "justify-start"}`} data-testid={`message-${m.id}`}>
      <div className={`group max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${out ? (m.status === "FAILED" ? "border border-red-300 bg-red-50 text-zinc-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-zinc-100" : "bg-indigo-600 text-white") : "border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"}`}>
        <div className={`mb-0.5 flex items-center gap-2 text-xs ${out && m.status !== "FAILED" ? "text-indigo-100" : "text-zinc-500 dark:text-zinc-400"}`}>
          <span className="font-medium">{out ? (m.senderUser?.fullName ?? "You") : m.senderName}</span>
          <time dateTime={m.occurredAt}>{fullWhen(m.occurredAt)}</time>
          {m.template && (
            <a href={`/crm/templates/${m.template.id}`} className="underline-offset-2 hover:underline" title={m.template.edited ? "Written from a template, then edited" : "Written from a template"} data-testid="message-template">
              ⧉ {m.template.name ?? "Template"}
              {m.template.versionNumber ? ` v${m.template.versionNumber}` : ""}
              {m.template.edited ? " (edited)" : ""}
            </a>
          )}
        </div>
        {m.subject && <p className="font-semibold">{m.subject}</p>}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {m.location && (
          <p>
            Location: {m.location.name ? `${m.location.name} — ` : ""}
            {m.location.latitude.toFixed(5)}, {m.location.longitude.toFixed(5)}
          </p>
        )}
        <Attachments m={m} />
        <div className={`mt-1 flex items-center justify-end gap-3 text-xs ${out && m.status !== "FAILED" ? "text-indigo-100" : "text-zinc-500 dark:text-zinc-400"}`}>
          {!out && onTask && (
            <button type="button" onClick={() => onTask(m)} className="opacity-0 hover:underline focus:opacity-100 group-hover:opacity-100">
              Create task
            </button>
          )}
          <DeliveryState m={m} statuses={deliveryStatuses} />
        </div>
        {m.status === "FAILED" && (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-red-700 dark:text-red-300" role="alert">
            <span>Message could not be sent. {m.error?.message}</span>
            {m.canRetry && onRetry && (
              <Button size="xs" variant="secondary" onClick={() => onRetry(m)} isLoading={retrying} loadingLabel="Retrying…">
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function NoteItem({ n, onEdit, onDelete }: { n: ThreadNote; onEdit: (n: ThreadNote) => void; onDelete: (n: ThreadNote) => void }) {
  return (
    <li className="mx-auto w-full max-w-[90%] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" data-testid={`note-${n.id}`}>
      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-amber-800 dark:text-amber-300">
        <span className="font-semibold uppercase tracking-wide">Internal note</span>
        <span>{n.author.fullName}</span>
        <time dateTime={n.createdAt}>{fullWhen(n.createdAt)}</time>
        {n.editedAt && <span>(edited)</span>}
        <span className="ml-auto flex gap-2">
          {n.canEdit && (
            <button type="button" className="hover:underline" onClick={() => onEdit(n)}>
              Edit
            </button>
          )}
          {n.canDelete && (
            <button type="button" className="hover:underline" onClick={() => onDelete(n)}>
              Delete
            </button>
          )}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words">{n.body}</p>
      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">Visible only to your team — never sent to the customer.</p>
    </li>
  );
}

// ── Composer ─────────────────────────────────────────────────────

async function postReply(conversationId: string, payload: { body: string; subject: string; clientMessageId: string; templateId?: string; templateVersionId?: string }, files: File[]) {
  const url = `${CONVERSATIONS_API}/${conversationId}/messages`;
  let init: RequestInit;
  if (files.length) {
    const form = new FormData();
    form.set("body", payload.body);
    if (payload.subject) form.set("subject", payload.subject);
    form.set("clientMessageId", payload.clientMessageId);
    if (payload.templateId && payload.templateVersionId) {
      form.set("templateId", payload.templateId);
      form.set("templateVersionId", payload.templateVersionId);
    }
    for (const f of files) form.append("files", f);
    init = { method: "POST", body: form, headers: { [TOAST_HEADER]: "off" } };
  } else init = { method: "POST", body: JSON.stringify({ body: payload.body, ...(payload.subject ? { subject: payload.subject } : {}), clientMessageId: payload.clientMessageId, ...(payload.templateId ? { templateId: payload.templateId, templateVersionId: payload.templateVersionId } : {}) }), headers: { "Content-Type": "application/json", [TOAST_HEADER]: "off" } };
  try {
    const res = await fetch(url, init);
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true as const, data: json.data as ThreadMessage };
    return { ok: false as const, message: (json?.error?.message as string) ?? (json?.message as string) ?? "The message could not be sent." };
  } catch {
    return { ok: false as const, message: "Couldn't reach the server. Your message is still here — try again." };
  }
}

/**
 * Generic composer: what it offers comes from the channel's capabilities
 * (subject, attachments, limits) and the server's permission / DND verdict —
 * never from the channel type. "Internal note" mode writes a CRM note.
 */
export function MessageComposer({ conversation, onSent, onNoted }: { conversation: ConversationDetailDto; onSent: (m: ThreadMessage) => void; onNoted: () => void }) {
  const caps = conversation.capabilities;
  const canReply = conversation.permissions.send;
  const [mode, setMode] = useState<"reply" | "note">(canReply ? "reply" : "note");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState(conversation.subject ? `Re: ${conversation.subject.replace(/^re:\s*/i, "")}` : "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per draft: a double click or a retry after a network error never sends twice.
  const [clientMessageId, setClientMessageId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  // Phase 12: the template (exact version) the reply was started from — sent along so history records it.
  const [template, setTemplate] = useState<PickedTemplate | null>(null);
  const [picking, setPicking] = useState(false);
  const blockedReason = !conversation.contactability.allowed ? conversation.contactability.message : !caps.canSend ? caps.sendUnavailableReason : conversation.status === "ARCHIVED" ? "This conversation is archived. Restore it to reply." : !conversation.permissions.send ? "You don't have permission to reply." : null;
  const effectiveMode = canReply ? mode : "note";

  const submit = async () => {
    setError(null);
    if (effectiveMode === "note") {
      if (!body.trim()) return setError("Write a note first.");
      setBusy(true);
      const res = await crmRequest(`${CONVERSATIONS_API}/${conversation.id}/notes`, { method: "POST", body: { body }, toast: "off" });
      setBusy(false);
      if (!res.ok) return setError(res.error.message);
      setBody("");
      return onNoted();
    }
    if (!body.trim() && !files.length) return setError("Write a message or attach a file.");
    if (body.length > caps.maxTextLength) return setError(`At most ${caps.maxTextLength} characters on this channel.`);
    setBusy(true);
    const res = await postReply(conversation.id, { body, subject: caps.supportsSubject ? subject : "", clientMessageId, ...(template ? { templateId: template.templateId, templateVersionId: template.versionId } : {}) }, files);
    setBusy(false);
    if (!res.ok) return setError(res.message);
    if (res.data.status === "FAILED") toast.error("Message could not be sent. It's kept in the thread — use Retry.");
    setBody("");
    setFiles([]);
    setTemplate(null);
    setClientMessageId(crypto.randomUUID());
    onSent(res.data);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)];
    if (next.length > caps.maxAttachments) return setError(`At most ${caps.maxAttachments} files per message on this channel.`);
    const total = next.reduce((s, f) => s + f.size, 0);
    if (total > caps.maxAttachmentBytes) return setError(`Attachments can be at most ${Math.round(caps.maxAttachmentBytes / 1024 / 1024)} MB in total on this channel.`);
    setError(null);
    setFiles(next);
  };

  return (
    <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div role="tablist" aria-label="Composer mode" className="mb-2 flex gap-3 text-sm">
        <button type="button" role="tab" aria-selected={effectiveMode === "reply"} disabled={!canReply} onClick={() => setMode("reply")} className={`border-b-2 px-1 pb-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${effectiveMode === "reply" ? "border-indigo-600 font-medium text-indigo-700 dark:text-indigo-300" : "border-transparent text-zinc-500"}`}>
          Reply
        </button>
        {conversation.permissions.note && (
          <button type="button" role="tab" aria-selected={effectiveMode === "note"} onClick={() => setMode("note")} className={`border-b-2 px-1 pb-0.5 ${effectiveMode === "note" ? "border-amber-500 font-medium text-amber-700 dark:text-amber-300" : "border-transparent text-zinc-500"}`}>
            Internal note
          </button>
        )}
        <span className="ml-auto self-center text-xs text-zinc-500 dark:text-zinc-400">
          {effectiveMode === "reply" ? `${conversation.channel.typeLabel} · to ${conversation.displayIdentifier ?? "customer"}` : "Only your team sees notes"}
        </span>
      </div>
      {/* DND is already explained in the conversation header; other reasons are shown here. */}
      {blockedReason && effectiveMode === "note" && !canReply && conversation.contactability.allowed && (
        <p className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          ⚠ {blockedReason}
        </p>
      )}
      {effectiveMode === "reply" && canReply && !blockedReason && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => setPicking(true)} className="rounded-md border border-zinc-300 px-2 py-0.5 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Use template
          </button>
          {template && (
            <span className="flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-200" data-testid="composer-template">
              From template: {template.name} (v{template.versionNumber}) — you can edit the text before sending
              <button type="button" aria-label="Stop using this template" onClick={() => setTemplate(null)} className="ml-1 hover:text-red-600">
                ✕
              </button>
            </span>
          )}
        </div>
      )}
      {picking && (
        <TemplatePickerDialog
          open={picking}
          onClose={() => setPicking(false)}
          conversationId={conversation.id}
          channelType={conversation.channel.channelType}
          channelLabel={conversation.channel.typeLabel}
          onPick={(t) => {
            setTemplate(t);
            setBody(t.body);
            if (caps.supportsSubject && t.subject) setSubject(t.subject);
            setError(null);
          }}
        />
      )}
      {effectiveMode === "reply" && caps.supportsSubject && (
        <input aria-label="Subject" className={`${textInputClass()} mb-2`} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={300} />
      )}
      <textarea
        aria-label={effectiveMode === "reply" ? "Message" : "Internal note"}
        className={`${textInputClass(Boolean(error))} min-h-[72px] ${effectiveMode === "note" ? "bg-amber-50/60 dark:bg-amber-500/5" : ""}`}
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={effectiveMode === "reply" ? "Type a message… (Ctrl+Enter to send)" : "Write an internal note…"}
        maxLength={10_000}
      />
      {files.length > 0 && effectiveMode === "reply" && (
        <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
              {f.name}
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-600">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div>
          {effectiveMode === "reply" && caps.supportsAttachments && (
            <>
              <input ref={fileInput} type="file" multiple className="hidden" accept={acceptFor(caps.attachmentKinds)} onChange={(e) => addFiles(e.target.files)} aria-label="Attach files" />
              <Button size="xs" variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
                Attach
              </Button>
            </>
          )}
        </div>
        <Button onClick={submit} isLoading={busy} loadingLabel={effectiveMode === "reply" ? "Sending…" : "Saving…"} disabled={effectiveMode === "reply" && !canReply}>
          {effectiveMode === "reply" ? "Send" : "Add note"}
        </Button>
      </div>
    </div>
  );
}

// ── Thread ───────────────────────────────────────────────────────

interface ThreadPage {
  items: ThreadItem[];
  nextCursor: string | null;
}

/**
 * Chronological thread: latest 50 first, older pages on demand (cursor),
 * polled every 10 s while visible (no realtime infrastructure exists in the
 * ERP). Marks inbound messages read up to the newest one on screen.
 */
export function ConversationThread({ conversation, refreshKey, onActivity, onRead, onTask }: { conversation: ConversationDetailDto; refreshKey: number; onActivity: () => void; onRead: () => void; onTask: (m: ThreadMessage) => void }) {
  const [items, setItems] = useState<ThreadItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<ThreadNote | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const keepFromBottom = useRef<number | null>(null);
  const readUpTo = useRef<string | null>(null);
  const id = conversation.id;

  const fetchPage = useCallback(async (before?: string) => {
    const qs = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
    return crmRequest<ThreadPage>(`${CONVERSATIONS_API}/${id}/messages?${qs}`);
  }, [id]);

  // First page. (The view is keyed by conversation, so switching remounts with fresh state.)
  useEffect(() => {
    let cancelled = false;
    fetchPage().then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.error.message);
      setItems(res.data.items);
      setCursor(res.data.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  // Refresh the newest page (poll + after actions) and merge.
  const refresh = useCallback(async () => {
    const res = await fetchPage();
    if (res.ok) setItems((cur) => (cur ? mergeThread(cur, res.data.items) : res.data.items));
  }, [fetchPage]);
  useEffect(() => {
    if (!refreshKey) return;
    let cancelled = false;
    fetchPage().then((res) => {
      if (!cancelled && res.ok) setItems((cur) => (cur ? mergeThread(cur, res.data.items) : res.data.items));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, fetchPage]);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Keep the view pinned to the newest message unless the user scrolled up; keep position when older pages load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !items) return;
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  // Read state: newest inbound message on screen.
  useEffect(() => {
    if (!items || !conversation.unreadCount) return;
    const latestInbound = [...items].reverse().find((i): i is ThreadMessage => i.kind === "message" && i.direction === "INBOUND");
    if (!latestInbound || readUpTo.current === latestInbound.id || document.visibilityState !== "visible") return;
    readUpTo.current = latestInbound.id;
    crmRequest(`${CONVERSATIONS_API}/${id}/read`, { method: "POST", body: { upToMessageId: latestInbound.id }, toast: "off" }).then((res) => res.ok && onRead());
  }, [items, conversation.unreadCount, id, onRead]);

  const loadOlder = async () => {
    if (!cursor) return;
    setLoadingOlder(true);
    const res = await fetchPage(cursor);
    setLoadingOlder(false);
    if (!res.ok) return toast.error(res.error.message);
    if (scroller.current) keepFromBottom.current = scroller.current.scrollHeight - scroller.current.scrollTop;
    setItems((cur) => mergeThread(cur ?? [], res.data.items));
    setCursor(res.data.nextCursor);
  };

  const retry = async (m: ThreadMessage) => {
    setRetrying(m.id);
    const res = await crmRequest<ThreadMessage>(`${CONVERSATIONS_API}/${id}/messages/${m.id}/retry`, { method: "POST", body: {}, toast: "errors" });
    setRetrying(null);
    if (!res.ok) return;
    if (res.data.status === "FAILED") toast.error("Still could not be sent.");
    else toast.success("Message sent.");
    setItems((cur) => mergeThread(cur ?? [], [res.data]));
    onActivity();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const res = await crmRequest(`/api/v1/crm/notes/${editing.id}`, { method: "PATCH", body: { body: editing.body }, toast: "errors" });
    if (!res.ok) return;
    setEditing(null);
    void refresh();
  };

  if (error) return <CrmErrorState message={error} />;
  const statuses = conversation.capabilities.deliveryStatuses;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 px-3 py-3 dark:bg-zinc-900/40"
        aria-label="Conversation thread"
        role="log"
      >
        {!items ? (
          <CrmLoadingState label="Loading messages…" />
        ) : (
          <>
            {cursor && (
              <div className="mb-3 text-center">
                <Button size="xs" variant="secondary" onClick={loadOlder} isLoading={loadingOlder} loadingLabel="Loading…">
                  Load older messages
                </Button>
              </div>
            )}
            {items.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">No messages yet.</p>}
            <ul className="space-y-3">
              {items.map((i) =>
                i.kind === "message" ? (
                  <MessageBubble key={`m-${i.id}`} m={i} deliveryStatuses={statuses} onRetry={retry} retrying={retrying === i.id} onTask={conversation.permissions.task ? onTask : undefined} />
                ) : i.kind === "note" ? (
                  editing?.id === i.id ? (
                    <li key={`n-${i.id}`} className="mx-auto w-full max-w-[90%] space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-500/40 dark:bg-amber-500/10">
                      <textarea aria-label="Edit note" className={textInputClass()} rows={3} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                      <div className="flex justify-end gap-2">
                        <Button size="xs" variant="secondary" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button size="xs" onClick={saveEdit}>
                          Save
                        </Button>
                      </div>
                    </li>
                  ) : (
                    <NoteItem key={`n-${i.id}`} n={i} onEdit={(n) => setEditing({ id: n.id, body: n.body })} onDelete={setDeleting} />
                  )
                ) : (
                  <li key={`e-${i.id}`} className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 dark:bg-zinc-800">
                      {i.summary}
                      {i.actor ? ` · ${i.actor.fullName}` : ""} · {fullWhen(i.occurredAt)}
                    </span>
                  </li>
                )
              )}
            </ul>
          </>
        )}
      </div>
      <MessageComposer
        key={conversation.id}
        conversation={conversation}
        onSent={(m) => {
          stick.current = true;
          setItems((cur) => mergeThread(cur ?? [], [m]));
          onActivity();
        }}
        onNoted={() => {
          stick.current = true;
          void refresh();
          onActivity();
        }}
      />
      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete this internal note?"
        message="It disappears from the conversation; the audit log keeps a record."
        confirmLabel="Delete note"
        isDangerous
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await crmRequest(`/api/v1/crm/notes/${deleting.id}`, { method: "DELETE", toast: "errors" });
          setDeleting(null);
          if (res.ok) setItems((cur) => (cur ?? []).filter((x) => !(x.kind === "note" && x.id === deleting.id)));
        }}
      />
    </div>
  );
}

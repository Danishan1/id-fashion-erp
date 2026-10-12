"use client";

import { useCallback, useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { ConversationView } from "@/components/crm/conversations/ConversationView";
import type { UserOption } from "@/components/crm/conversations/ConversationDialogs";
import { CONVERSATIONS_API, shortWhen, STATUS_TONES, type ConversationDto, type InboxCountsDto, type InboxFolder, type InboxMetaDto } from "@/components/crm/conversations/conversation-types";
import { textInputClass } from "@/components/ui/FormField";

const PAGE_SIZE = 30;
const POLL_MS = 15_000;
const FOLDERS: { key: InboxFolder; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mine", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" },
  { key: "unmatched", label: "Unmatched" },
];
const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Open & pending" },
  { key: "OPEN", label: "Open" },
  { key: "PENDING", label: "Pending" },
  { key: "CLOSED", label: "Closed" },
  { key: "ARCHIVED", label: "Archived" },
];

export interface InboxInitialState {
  folder?: string | null;
  channel?: string | null;
  status?: string | null;
  conversationId?: string | null;
}

function ConversationRow({ c, selected, onOpen }: { c: ConversationDto; selected: boolean; onOpen: () => void }) {
  const unread = c.unreadCount > 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className={`block w-full border-l-2 px-3 py-2.5 text-left ${selected ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-500/10" : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900"}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${unread ? "font-semibold text-zinc-900 dark:text-zinc-50" : "font-medium text-zinc-800 dark:text-zinc-200"}`}>{c.title}</span>
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{shortWhen(c.lastMessageAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-indigo-700 dark:text-indigo-300">{c.channel.typeLabel}</span>
          {c.company && <span className="truncate">· {c.company.name}</span>}
          {!c.contact && !c.company && c.displayIdentifier && c.displayIdentifier !== c.title && <span className="truncate">· {c.displayIdentifier}</span>}
        </span>
        <span className={`mt-0.5 block truncate text-sm ${unread ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}`}>
          {c.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
          {c.lastMessagePreview ?? ""}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {unread && (
            <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 font-semibold text-white" aria-label={`${c.unreadCount} unread`}>
              {c.unreadCount} unread
            </span>
          )}
          {c.matchStatus !== "MATCHED" && <CrmBadge label="Unmatched" tone="amber" />}
          {c.status !== "OPEN" && <CrmBadge label={c.statusLabel} tone={STATUS_TONES[c.status]} />}
          <span className="text-zinc-500 dark:text-zinc-400">{c.assignedTo ? `Assigned to ${c.assignedTo.fullName}` : "Unassigned"}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * The unified CRM inbox: one list for every channel (channel is a filter,
 * never a separate inbox), server-side search / filters / paging, unread
 * counts from COUNT queries, and the conversation workspace beside it.
 * No realtime infrastructure exists in the ERP, so the list polls.
 */
export function InboxClient({ currentUserId, initial = {} }: { currentUserId: string; initial?: InboxInitialState }) {
  const [folder, setFolder] = useState<InboxFolder>(FOLDERS.some((f) => f.key === initial.folder) ? (initial.folder as InboxFolder) : "all");
  const [channel, setChannel] = useState(initial.channel ?? "");
  const [status, setStatus] = useState(STATUS_FILTERS.some((f) => f.key === initial.status) ? (initial.status as string) : "");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<string | null>(initial.conversationId ?? null);
  const [meta, setMeta] = useState<InboxMetaDto | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [counts, setCounts] = useState<InboxCountsDto | null>(null);
  const [list, setList] = useState<{ key: string; rows: ConversationDto[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    crmRequest<InboxMetaDto>(`${CONVERSATIONS_API}/meta`).then((r) => r.ok && setMeta(r.data));
    fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((u) => setUsers((u.data ?? []).filter((x: { status?: string }) => !x.status || x.status === "ACTIVE").map((x: UserOption) => ({ id: x.id, fullName: x.fullName }))))
      .catch(() => undefined);
  }, []);

  // Debounced server-side search.
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const key = `${folder}|${channel}|${status}|${term}|${limit}|${tick}`;
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ folder, pageSize: String(limit), sortBy: "lastMessageAt", sortOrder: "desc" });
    if (channel) qs.set("channelIds", channel);
    if (status) qs.set("statuses", status);
    if (term) qs.set("search", term);
    Promise.all([fetch(`${CONVERSATIONS_API}?${qs}`).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) })), crmRequest<InboxCountsDto>(`${CONVERSATIONS_API}/counts`)]).then(([l, c]) => {
      if (cancelled) return;
      if (!l.ok) return setError(l.body?.error?.message ?? "Couldn't load conversations.");
      setError(null);
      setList({ key, rows: l.body.data ?? [], total: l.body.meta?.totalCount ?? 0 });
      if (c.ok) setCounts(c.data);
    });
    return () => {
      cancelled = true;
    };
  }, [folder, channel, status, term, limit, tick, key]);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && setTick((x) => x + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string | null) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set("folder", folder === "all" ? null : folder);
    set("channel", channel || null);
    set("status", status || null);
    set("c", selected);
    const path = url.pathname.startsWith("/crm/inbox/") ? "/crm/inbox" : url.pathname;
    window.history.replaceState(null, "", path + url.search);
  }, [folder, channel, status, selected]);

  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const pick = (f: InboxFolder) => {
    setFolder(f);
    setLimit(PAGE_SIZE);
  };
  const channelCount = (id: string) => counts?.channels.find((x) => x.channelId === id)?.open ?? 0;

  return (
    <div className="grid h-[calc(100vh-13rem)] min-h-[520px] grid-cols-1 overflow-hidden rounded-lg border border-zinc-200 bg-white lg:grid-cols-[200px_360px_1fr] dark:border-zinc-800 dark:bg-zinc-950">
      <nav aria-label="Inbox folders" className={`overflow-y-auto border-r border-zinc-200 p-2 dark:border-zinc-800 ${selected ? "hidden lg:block" : ""}`}>
        <ul className="space-y-0.5">
          {FOLDERS.map((f) => (
            <li key={f.key}>
              <button type="button" aria-current={folder === f.key ? "page" : undefined} onClick={() => pick(f.key)} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${folder === f.key ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}>
                <span>{f.label}</span>
                <span className="text-xs text-zinc-500" data-testid={`count-${f.key}`}>
                  {counts?.folders[f.key] ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Channels</p>
        <ul className="mt-1 space-y-0.5">
          <li>
            <button type="button" aria-current={!channel ? "page" : undefined} onClick={() => setChannel("")} className={`w-full rounded px-2 py-1.5 text-left text-sm ${!channel ? "font-medium text-indigo-700 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}>
              All channels
            </button>
          </li>
          {(meta?.channels ?? []).map((ch) => (
            <li key={ch.id}>
              <button type="button" aria-current={channel === ch.id ? "page" : undefined} onClick={() => setChannel(ch.id)} className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm ${channel === ch.id ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"}`}>
                <span className="min-w-0">
                  <span className="block truncate">{ch.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {ch.typeLabel}
                    {ch.status !== "ACTIVE" ? " · paused" : ""}
                  </span>
                </span>
                <span className="text-xs text-zinc-500">{channelCount(ch.id) || ""}</span>
              </button>
            </li>
          ))}
          {meta && meta.channels.length === 0 && <li className="px-2 text-xs text-zinc-500">No channels yet. An admin adds them in CRM Settings → Channels.</li>}
        </ul>
      </nav>

      <section aria-label="Conversations" className={`flex min-h-0 flex-col border-r border-zinc-200 dark:border-zinc-800 ${selected ? "hidden lg:flex" : "flex"}`}>
        <div className="space-y-2 border-b border-zinc-200 p-2 dark:border-zinc-800">
          <input type="search" aria-label="Search conversations" className={textInputClass()} placeholder="Search names, numbers, messages…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-2">
            <select aria-label="Status" className={textInputClass()} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select aria-label="Folder" className={`${textInputClass()} lg:hidden`} value={folder} onChange={(e) => pick(e.target.value as InboxFolder)}>
              {FOLDERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <CrmErrorState message={error} onRetry={refresh} />
          ) : !list ? (
            <CrmLoadingState />
          ) : list.rows.length === 0 ? (
            <CrmEmptyState title={term ? "No conversations match" : folder === "unmatched" ? "No unmatched conversations" : "No conversations here"} description={term ? "Try another name, number or word." : "Messages arriving on your channels appear here."} />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {list.rows.map((c) => (
                <ConversationRow key={c.id} c={c} selected={selected === c.id} onOpen={() => setSelected(c.id)} />
              ))}
            </ul>
          )}
          {list && list.total > list.rows.length && (
            <div className="p-2 text-center">
              <button type="button" onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, 100))} disabled={limit >= 100} className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400">
                {limit >= 100 ? "Refine the search to see more" : `Show more (${list.total - list.rows.length} more)`}
              </button>
            </div>
          )}
        </div>
      </section>

      <section aria-label="Conversation" className={`min-h-0 ${selected ? "flex flex-col" : "hidden lg:flex lg:flex-col"}`}>
        {selected ? (
          <>
            <button type="button" onClick={() => setSelected(null)} className="border-b border-zinc-200 px-3 py-2 text-left text-sm text-indigo-600 lg:hidden dark:border-zinc-800 dark:text-indigo-400">
              ← All conversations
            </button>
            <div className="min-h-0 flex-1">
              <ConversationView key={selected} conversationId={selected} users={users} currentUserId={currentUserId} onChanged={refresh} />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <CrmEmptyState title="Select a conversation" description="Messages from every channel — email, SMS, WhatsApp, social and website chat — arrive in this one inbox." />
          </div>
        )}
      </section>
    </div>
  );
}

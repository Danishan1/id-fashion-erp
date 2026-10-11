"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CONVERSATIONS_API, shortWhen, STATUS_TONES, type ConversationDto } from "./conversation-types";

type Parent = { entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY"; entityId: string };
const FILTER_KEY = { CONTACT: "contactId", COMPANY: "companyId", OPPORTUNITY: "opportunityId" } as const;

/**
 * Conversations of a contact / company / opportunity across every channel
 * (email, WhatsApp, chat…). The same rows as the inbox — opening one goes to
 * the inbox workspace; nothing is copied onto the record.
 */
export function ConversationsPanel({ parent, pageSize = 5 }: { parent: Parent; pageSize?: number }) {
  const [limit, setLimit] = useState(pageSize);
  const [data, setData] = useState<{ key: string; rows: ConversationDto[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${parent.entityId}:${limit}:${tick}`;

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ [FILTER_KEY[parent.entityType]]: parent.entityId, pageSize: String(limit), sortBy: "lastMessageAt", sortOrder: "desc" });
    fetch(`${CONVERSATIONS_API}?${qs}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) return setError(body?.error?.message ?? "Couldn't load conversations.");
        setError(null);
        setData({ key, rows: body.data ?? [], total: body.meta?.totalCount ?? 0 });
      })
      .catch(() => !cancelled && setError("Couldn't load conversations."));
    return () => {
      cancelled = true;
    };
  }, [parent.entityType, parent.entityId, limit, key]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!data || data.key !== key) return <CrmLoadingState />;
  if (!data.rows.length) return <CrmEmptyState title="No conversations yet" description="Messages with this record on any channel appear here and in the Inbox." />;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {data.rows.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-2 py-2">
            <Link href={`/crm/inbox/${c.id}`} className="min-w-0">
              <span className="block truncate text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                {c.channel.typeLabel} · {c.title}
                {c.unreadCount > 0 ? ` (${c.unreadCount} unread)` : ""}
              </span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
                {c.lastMessageDirection === "OUTBOUND" ? "You: " : ""}
                {c.lastMessagePreview} · {shortWhen(c.lastMessageAt)} · {c.assignedTo?.fullName ?? "Unassigned"}
              </span>
            </Link>
            <CrmBadge label={c.statusLabel} tone={STATUS_TONES[c.status]} />
          </li>
        ))}
      </ul>
      {data.total > data.rows.length && (
        <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Show more
        </button>
      )}
    </div>
  );
}

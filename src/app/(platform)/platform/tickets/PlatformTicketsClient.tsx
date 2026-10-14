"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TicketPriorityText, TicketStatusBadge } from "@/components/support/TicketThread";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS_PLATFORM,
  type TicketCategoryValue,
  type TicketPriorityValue,
  type TicketStatusValue,
} from "@/modules/support-tickets/support-ticket.schema";

interface InboxTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  category: TicketCategoryValue;
  priority: TicketPriorityValue;
  status: TicketStatusValue;
  lastMessageAt: string;
  lastMessageBy: "CUSTOMER" | "PLATFORM";
  company: { id: string; name: string };
  createdBy: { fullName: string };
  assignedTo: { id: string; fullName: string } | null;
}

const STATUS_FILTERS: [string, string][] = [
  ["ACTIVE", "Active"],
  ["OPEN", "Open"],
  ["IN_PROGRESS", "In progress"],
  ["WAITING_ON_CUSTOMER", "Waiting on customer"],
  ["RESOLVED", "Resolved"],
  ["CLOSED", "Closed"],
  ["ALL", "All"],
];

const selectClass = "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function PlatformTicketsClient() {
  const [status, setStatus] = useState("ACTIVE");
  const [assigned, setAssigned] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<InboxTicket[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<TicketStatusValue, number>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ status });
    if (assigned) params.set("assigned", assigned);
    if (query) params.set("search", query);
    let cancelled = false;
    fetch(`/api/v1/platform/support-tickets?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error?.message ?? "Couldn't load tickets.");
          return;
        }
        setError(null);
        setTickets(json.data.tickets);
        setCounts(json.data.counts);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [status, assigned, query]);

  const active = (counts.OPEN ?? 0) + (counts.IN_PROGRESS ?? 0) + (counts.WAITING_ON_CUSTOMER ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Support Tickets</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tickets raised by customer companies. {active} active · {counts.OPEN ?? 0} open · {counts.IN_PROGRESS ?? 0} in
          progress · {counts.WAITING_ON_CUSTOMER ?? 0} waiting on customer.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass} aria-label="Status">
          {STATUS_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={assigned} onChange={(e) => setAssigned(e.target.value)} className={selectClass} aria-label="Assignment">
          <option value="">Anyone</option>
          <option value="ME">Assigned to me</option>
          <option value="UNASSIGNED">Unassigned</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ticket no., subject or company"
            className={`${selectClass} w-64`}
          />
          <button type="submit" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
            Search
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Ticket</th>
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Subject</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Assigned</th>
              <th className="px-4 py-2 font-medium">Last update</th>
            </tr>
          </thead>
          <tbody>
            {tickets === null && !error && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {tickets?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                  No tickets match.
                </td>
              </tr>
            )}
            {tickets?.map((t) => (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50">
                <td className="px-4 py-2 font-mono">
                  <Link href={`/platform/tickets/${t.id}`} className="text-indigo-600 hover:underline">
                    {t.ticketNumber}
                  </Link>
                </td>
                <td className="px-4 py-2">{t.company.name}</td>
                <td className="px-4 py-2">
                  <Link href={`/platform/tickets/${t.id}`} className="text-zinc-900 hover:underline dark:text-zinc-50">
                    {t.subject}
                  </Link>
                  <div className="text-xs text-zinc-500">
                    {TICKET_CATEGORY_LABELS[t.category]} · {t.createdBy.fullName}
                    {t.lastMessageBy === "CUSTOMER" && t.status !== "CLOSED" && t.status !== "RESOLVED" && (
                      <span className="ml-2 font-medium text-red-600 dark:text-red-400">Needs reply</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <TicketPriorityText priority={t.priority} label={TICKET_PRIORITY_LABELS[t.priority]} />
                </td>
                <td className="px-4 py-2">
                  <TicketStatusBadge status={t.status} label={TICKET_STATUS_LABELS_PLATFORM[t.status]} />
                </td>
                <td className="px-4 py-2">{t.assignedTo?.fullName ?? <span className="text-zinc-400">—</span>}</td>
                <td className="px-4 py-2 text-zinc-500">
                  {new Date(t.lastMessageAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Kolkata",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

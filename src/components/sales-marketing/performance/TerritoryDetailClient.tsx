"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDate } from "@/lib/date-format";
import { Badge, CARD, EventList, usePerformanceOptions, type PerformanceEvent } from "./performance-ui";

export interface TerritoryDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  canSeePerformance: boolean;
  assignments: { id: string; userId: string; user: string; userActive: boolean; isPrimary: boolean; startDate: string; endDate: string | null; state: "UPCOMING" | "CURRENT" | "ENDED" }[];
  customers: { id: string; code: string; name: string; city: string | null; country: string | null; isActive: boolean }[];
  events: PerformanceEvent[];
}

interface CustomerHit {
  id: string;
  code: string;
  name: string;
  city: string | null;
  country: string | null;
  territory: { id: string; name: string } | null;
}

const STATE: Record<TerritoryDetail["assignments"][number]["state"], { label: string; tone: "green" | "indigo" | "zinc" }> = {
  CURRENT: { label: "Current", tone: "green" },
  UPCOMING: { label: "Upcoming", tone: "indigo" },
  ENDED: { label: "Ended", tone: "zinc" },
};

export function TerritoryDetailClient({ initial, canEdit, today }: { initial: TerritoryDetail; canEdit: boolean; today: string }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [header, setHeader] = useState({ name: d.name, description: d.description ?? "" });
  const [assign, setAssign] = useState<{ userId: string; isPrimary: boolean; startDate: string; endDate: string } | null>(null);
  const [ending, setEnding] = useState<{ id: string; user: string; endDate: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [move, setMove] = useState(false);
  const { reps } = usePerformanceOptions(canEdit);
  const base = `/api/v1/sales-marketing/performance/territories/${d.id}`;

  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", "x-toast": "off" }, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res));
      return false;
    }
    const { data } = await res.json();
    setD(data);
    setHeader({ name: data.name, description: data.description ?? "" });
    return true;
  };

  const findCustomers = async (q: string) => {
    const res = await fetch(`/api/v1/sales-marketing/performance/territories/customer-search?q=${encodeURIComponent(q)}`, { headers: { "x-toast": "off" } });
    setHits(res.ok ? (await res.json()).data : []);
  };

  const pickedElsewhere = hits.filter((h) => picked.has(h.id) && h.territory && h.territory.id !== d.id);

  return (
    <div className="space-y-4">
      {error && !assign && !ending && !adding && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className={`${CARD} flex flex-wrap items-start justify-between gap-3`}>
        {editing ? (
          <form
            className="grid flex-1 gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(base, "PATCH", header)) setEditing(false);
            }}
          >
            <FormField label="Name" htmlFor="h-name" required>
              <input id="h-name" required maxLength={200} value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} className={textInputClass()} />
            </FormField>
            <FormField label="Description" htmlFor="h-desc">
              <input id="h-desc" maxLength={1000} value={header.description} onChange={(e) => setHeader({ ...header, description: e.target.value })} className={textInputClass()} />
            </FormField>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="xs" isLoading={busy}>
                Save
              </Button>
              <Button type="button" size="xs" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{d.name}</span>
              <span className="text-zinc-500">{d.code}</span>
              {d.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
            </div>
            {d.description && <p className="text-zinc-600 dark:text-zinc-300">{d.description}</p>}
            <p className="text-xs text-zinc-500">
              Created by {d.createdBy} on {formatDate(d.createdAt)}
            </p>
            {d.canSeePerformance && (
              <Link href="/sales-marketing/performance" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                See territory performance
              </Link>
            )}
          </div>
        )}
        {canEdit && !editing && (
          <div className="flex gap-2">
            <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="xs" variant={d.active ? "danger" : "secondary"} isLoading={busy} onClick={() => call(`${base}/actions/${d.active ? "deactivate" : "reactivate"}`, "POST")}>
              {d.active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>

      <section className={CARD} aria-labelledby="reps-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="reps-h" className="text-sm font-semibold">
            Sales reps
          </h2>
          {canEdit && d.active && (
            <Button size="xs" onClick={() => (setError(null), setAssign({ userId: "", isPrimary: !d.assignments.some((a) => a.isPrimary && a.state !== "ENDED"), startDate: today, endDate: "" }))}>
              Assign a rep
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">The primary rep in force on an order&apos;s date is suggested as its sales rep when the customer has no quotation owner or CRM owner.</p>
        {d.assignments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No reps assigned yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-1.5 font-medium">Rep</th>
                <th className="py-1.5 font-medium">Role</th>
                <th className="py-1.5 font-medium">From</th>
                <th className="py-1.5 font-medium">To</th>
                <th className="py-1.5 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.assignments.map((a) => (
                <tr key={a.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="py-1.5">
                    {a.user}
                    {!a.userActive && <span className="ml-1 text-xs text-zinc-500">(inactive user)</span>}
                  </td>
                  <td className="py-1.5">{a.isPrimary ? "Primary" : "Supporting"}</td>
                  <td className="py-1.5">{formatDate(a.startDate)}</td>
                  <td className="py-1.5">{a.endDate ? formatDate(a.endDate) : "Open"}</td>
                  <td className="py-1.5">
                    <Badge tone={STATE[a.state].tone}>{STATE[a.state].label}</Badge>
                  </td>
                  <td className="py-1.5 text-right">
                    {canEdit && a.state === "UPCOMING" && (
                      <Button size="xs" variant="secondary" isLoading={busy} onClick={() => call(`${base}/assignments/${a.id}`, "DELETE")}>
                        Remove
                      </Button>
                    )}
                    {canEdit && a.state === "CURRENT" && (
                      <Button size="xs" variant="secondary" onClick={() => (setError(null), setEnding({ id: a.id, user: a.user, endDate: today }))}>
                        End
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={CARD} aria-labelledby="cust-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="cust-h" className="text-sm font-semibold">
            Customers ({d.customers.length})
          </h2>
          {canEdit && d.active && (
            <Button
              size="xs"
              onClick={() => {
                setError(null);
                setPicked(new Set());
                setMove(false);
                setAdding(true);
                void findCustomers("");
              }}
            >
              Add customers
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">A customer belongs to one territory. New orders take the customer&apos;s territory; orders already booked keep theirs.</p>
        {d.customers.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No customers in this territory yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {d.customers.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>
                  {c.name} <span className="text-xs text-zinc-500">{[c.code, c.city, c.country].filter(Boolean).join(" · ")}</span>
                </span>
                {canEdit && (
                  <Button size="xs" variant="secondary" isLoading={busy} onClick={() => call(`${base}/customers/${c.id}`, "DELETE")} aria-label={`Remove ${c.name}`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD} aria-labelledby="hist-h">
        <h2 id="hist-h" className="mb-2 text-sm font-semibold">
          History
        </h2>
        <EventList events={d.events} />
      </section>

      {assign && (
        <Modal open onClose={() => setAssign(null)} title="Assign a rep">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`${base}/assignments`, "POST", { ...assign, endDate: assign.endDate || null })) setAssign(null);
            }}
          >
            <FormField label="Rep" htmlFor="as-user" required>
              <SearchableSelect id="as-user" required value={assign.userId} onChange={(userId) => setAssign({ ...assign, userId })} options={reps} placeholder="Search people…" />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={assign.isPrimary} onChange={(e) => setAssign({ ...assign, isPrimary: e.target.checked })} />
              Primary rep (one at a time)
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="From" htmlFor="as-from" required>
                <input id="as-from" type="date" required value={assign.startDate} onChange={(e) => setAssign({ ...assign, startDate: e.target.value })} className={textInputClass()} />
              </FormField>
              <FormField label="To (optional)" htmlFor="as-to">
                <input id="as-to" type="date" min={assign.startDate} value={assign.endDate} onChange={(e) => setAssign({ ...assign, endDate: e.target.value })} className={textInputClass()} />
              </FormField>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAssign(null)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                Assign
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {ending && (
        <Modal open onClose={() => setEnding(null)} title={`End ${ending.user}'s assignment`}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`${base}/assignments/${ending.id}`, "PATCH", { endDate: ending.endDate })) setEnding(null);
            }}
          >
            <FormField label="Last day" htmlFor="end-date" required>
              <input id="end-date" type="date" required value={ending.endDate} onChange={(e) => setEnding({ ...ending, endDate: e.target.value })} className={textInputClass()} />
            </FormField>
            <p className="text-xs text-zinc-500">The assignment is kept in the history; it just stops after this day.</p>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEnding(null)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy}>
                End assignment
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {adding && (
        <Modal open onClose={() => setAdding(false)} title={`Add customers to ${d.name}`} maxWidthClass="max-w-2xl">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`${base}/customers`, "POST", { customerIds: [...picked], move })) setAdding(false);
            }}
          >
            <input
              aria-label="Search customers"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                void findCustomers(e.target.value);
              }}
              placeholder="Search name, code or city…"
              className={textInputClass()}
            />
            <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
              {hits.map((h) => {
                const here = h.territory?.id === d.id;
                return (
                  <li key={h.id}>
                    <label className={`flex items-center gap-2 py-1.5 ${here ? "text-zinc-400" : ""}`}>
                      <input
                        type="checkbox"
                        disabled={here}
                        checked={here || picked.has(h.id)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(h.id);
                          else next.delete(h.id);
                          setPicked(next);
                        }}
                      />
                      <span className="flex-1">
                        {h.name} <span className="text-xs text-zinc-500">{[h.code, h.city, h.country].filter(Boolean).join(" · ")}</span>
                      </span>
                      {h.territory && <Badge tone={here ? "green" : "amber"}>{here ? "Already here" : `In ${h.territory.name}`}</Badge>}
                    </label>
                  </li>
                );
              })}
              {hits.length === 0 && <li className="py-2 text-zinc-500">No customers found.</li>}
            </ul>
            {pickedElsewhere.length > 0 && (
              <label className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} />
                Move them here — {pickedElsewhere.length} selected customer{pickedElsewhere.length === 1 ? " is" : "s are"} in another territory. Their existing orders stay credited where they were.
              </label>
            )}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Close
              </Button>
              <Button type="submit" isLoading={busy} disabled={picked.size === 0}>
                Add {picked.size || ""} customer{picked.size === 1 ? "" : "s"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

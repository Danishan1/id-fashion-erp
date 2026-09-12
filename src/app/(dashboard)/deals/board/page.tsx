"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { STAGE_LABELS } from "../statusLabels";

type Stage = keyof typeof STAGE_LABELS;

const BOARD_STAGES: Stage[] = ["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

interface BoardDeal {
  id: string;
  dealNumber: string;
  title: string;
  stage: Stage;
  value: string;
  weightedValue: number;
  probabilityPercent: string;
  expectedCloseDate: string | null;
  lead: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  assignedTo: { id: string; fullName: string } | null;
}

export default function DealsBoardPage() {
  const [deals, setDeals] = useState<BoardDeal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  // pageSize is capped at 100 by this app's shared list-query parser — the
  // same limit every other "load everything for a client-side view" fetch in
  // this codebase already lives with (e.g. Customers/Products pickers).
  const load = () =>
    fetch("/api/v1/deals?pageSize=100&sortBy=createdAt&sortOrder=desc")
      .then((res) => res.json())
      .then((body) => setDeals(body.data ?? []))
      .finally(() => setIsLoading(false));

  useEffect(() => {
    load();
  }, []);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    deals.forEach((d) => d.assignedTo && map.set(d.assignedTo.id, d.assignedTo.fullName));
    return [...map.entries()];
  }, [deals]);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (ownerFilter && d.assignedTo?.id !== ownerFilter) return false;
      if (!search) return true;
      const haystack = `${d.title} ${d.lead?.name ?? ""} ${d.customer?.name ?? ""}`.toLowerCase();
      return haystack.includes(search.toLowerCase());
    });
  }, [deals, search, ownerFilter]);

  const byStage = useMemo(() => {
    const grouped = new Map<Stage, BoardDeal[]>(BOARD_STAGES.map((s) => [s, []]));
    filtered.forEach((d) => grouped.get(d.stage)?.push(d));
    return grouped;
  }, [filtered]);

  const moveDeal = async (dealId: string, stage: Stage) => {
    setDragError(null);
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage === stage) return;

    // Optimistic move — reverted below if the server rejects it. The actual
    // legality of the move is enforced server-side by the exact same
    // ALLOWED_TRANSITIONS guard the detail page's "Move to X" buttons use —
    // this board is a new surface over that logic, not a second copy of it.
    const previousStage = deal.stage;
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage } : d)));

    const body: Record<string, unknown> = { stage };
    if (stage === "LOST") body.lostReason = "Moved on the pipeline board";

    const res = await fetch(`/api/v1/deals/${dealId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      setDragError(errBody?.error?.message ?? "Could not move this deal.");
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage: previousStage } : d)));
      return;
    }
    load();
  };

  const stageStats = (stage: Stage) => {
    const list = byStage.get(stage) ?? [];
    const total = list.reduce((sum, d) => sum + Number(d.value), 0);
    const weighted = list.reduce((sum, d) => sum + d.weightedValue, 0);
    return { count: list.length, total, weighted };
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Deals", href: "/deals" }, { label: "Board" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Pipeline Board</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Drag a card to a new stage — the same transition rules as the detail page apply.</p>
        </div>
        <Link href="/deals" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          List View →
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search title, lead, or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="w-56">
          <SearchableSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            options={owners.map(([id, name]) => ({ id, label: name }))}
            placeholder="Search owner…"
            emptyOptionLabel="All owners"
          />
        </div>
      </div>

      {dragError && <p className="text-sm text-red-600 dark:text-red-400">{dragError}</p>}

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-3 lg:grid-cols-5">
          {BOARD_STAGES.map((stage) => {
            const stats = stageStats(stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId) moveDeal(draggedId, stage);
                }}
                className="min-w-[240px] rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{STAGE_LABELS[stage]}</h2>
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{stats.count}</span>
                </div>
                <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                  ₹{stats.total.toLocaleString()} · Weighted ₹{Math.round(stats.weighted).toLocaleString()}
                </p>
                <div className="space-y-2">
                  {(byStage.get(stage) ?? []).map((d) => (
                    <a
                      key={d.id}
                      href={`/deals/${d.id}`}
                      draggable
                      onDragStart={() => setDraggedId(d.id)}
                      onDragEnd={() => setDraggedId(null)}
                      className="block cursor-grab rounded-md border border-zinc-200 bg-white p-2 text-xs shadow-sm hover:border-indigo-300 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <p className="font-medium text-zinc-900 dark:text-zinc-50">{d.title}</p>
                      <p className="mt-0.5 text-zinc-500">{d.customer?.name ?? d.lead?.name ?? "—"}</p>
                      <p className="mt-1 flex items-center justify-between text-zinc-500">
                        <span>₹{Number(d.value).toLocaleString()}</span>
                        <span>{Number(d.probabilityPercent)}%</span>
                      </p>
                      <p className="mt-0.5 flex items-center justify-between text-zinc-400">
                        <span>{d.assignedTo?.fullName ?? "Unassigned"}</span>
                        {d.expectedCloseDate && <span>{new Date(d.expectedCloseDate).toLocaleDateString()}</span>}
                      </p>
                    </a>
                  ))}
                  {(byStage.get(stage) ?? []).length === 0 && <p className="text-xs text-zinc-400">No deals here.</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

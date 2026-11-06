"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { selectClass } from "../performance/performance-ui";
import { CARD, StatusBadge, useApi, useCampaignLookups } from "./campaign-ui";

interface Cal {
  month: string;
  start: string;
  end: string;
  campaigns: { id: string; code: string; name: string; status: string; owner: string; type: string; plannedStartDate: string; plannedEndDate: string; actualStartDate: string | null; actualEndDate: string | null }[];
  activities: { id: string; campaignId: string | null; subject: string; type: string; status: string; dueDate: string; overdue: boolean; milestone: boolean }[];
  activitiesHidden: boolean;
}

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Month view of campaigns (planned and actual spans) with their activity and milestone due dates (Phase 08). */
export function CampaignCalendarClient({ initialMonth, today }: { initialMonth: string; today: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [ownerUserId, setOwner] = useState("");
  const [typeId, setTypeId] = useState("");
  const lookups = useCampaignLookups();
  const { data, error, reload } = useApi<Cal>(`/api/v1/sales-marketing/campaigns/calendar?month=${month}&ownerUserId=${ownerUserId}&typeId=${typeId}`);
  const days = data ? Number(data.end.slice(8, 10)) : 30;
  const dayOf = (iso: string) => Number(iso.slice(8, 10));
  const clamp = (from: string, to: string) => {
    if (!data || to < data.start || from > data.end) return null;
    const a = from < data.start ? 1 : dayOf(from);
    const b = to > data.end ? days : dayOf(to);
    return { a, b };
  };
  const grid = { gridTemplateColumns: `minmax(10rem, 14rem) repeat(${days}, minmax(1.4rem, 1fr))` };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setMonth(shift(month, -1))} aria-label="Previous month">
          ‹
        </Button>
        <span className="min-w-[9rem] text-center font-medium">{label(month)}</span>
        <Button size="sm" variant="secondary" onClick={() => setMonth(shift(month, 1))} aria-label="Next month">
          ›
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>
          This month
        </Button>
        <select aria-label="Owner" value={ownerUserId} onChange={(e) => setOwner(e.target.value)} className={selectClass}>
          <option value="">Any owner</option>
          {lookups.owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={selectClass}>
          <option value="">Any type</option>
          {lookups.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState />
      ) : data.campaigns.length === 0 ? (
        <div className={CARD}>
          <p className="text-sm text-zinc-500">No campaigns planned or running in {label(month)}.</p>
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <div className="grid min-w-[52rem] text-xs" style={grid} role="grid" aria-label={`Campaigns in ${label(month)}`}>
            <div className="sticky left-0 bg-white py-1 font-medium text-zinc-500 dark:bg-zinc-900">Campaign</div>
            {Array.from({ length: days }, (_, i) => {
              const iso = `${month}-${String(i + 1).padStart(2, "0")}`;
              return (
                <div key={i} className={`py-1 text-center ${iso === today ? "font-bold text-indigo-600 dark:text-indigo-400" : "text-zinc-500"}`}>
                  {i + 1}
                </div>
              );
            })}
            {data.campaigns.map((c) => {
              const planned = clamp(c.plannedStartDate, c.plannedEndDate);
              const actual = c.actualStartDate ? clamp(c.actualStartDate, c.actualEndDate ?? (today > data.end ? data.end : today)) : null;
              const acts = data.activities.filter((a) => a.campaignId === c.id);
              return (
                <div key={c.id} className="contents" role="row">
                  <div className="sticky left-0 border-t border-zinc-100 bg-white py-1.5 pr-2 dark:border-zinc-800 dark:bg-zinc-900">
                    <Link href={`/sales-marketing/campaigns/${c.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {c.code}
                    </Link>
                    <div className="truncate text-zinc-500" title={c.name}>
                      {c.name}
                    </div>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="relative border-t border-zinc-100 dark:border-zinc-800" style={{ gridColumn: `2 / span ${days}` }}>
                    {planned && (
                      <div
                        className="absolute top-2 h-3 rounded border border-indigo-300 bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950"
                        style={{ left: `${((planned.a - 1) / days) * 100}%`, width: `${((planned.b - planned.a + 1) / days) * 100}%` }}
                        title={`Planned ${c.plannedStartDate} → ${c.plannedEndDate}`}
                      />
                    )}
                    {actual && (
                      <div
                        className="absolute top-6 h-3 rounded bg-green-500/80"
                        style={{ left: `${((actual.a - 1) / days) * 100}%`, width: `${((actual.b - actual.a + 1) / days) * 100}%` }}
                        title={`Actual ${c.actualStartDate} → ${c.actualEndDate ?? "running"}`}
                      />
                    )}
                    {acts.map((a) => {
                      const d = dayOf(a.dueDate);
                      const late = a.overdue;
                      return (
                        <Link
                          key={a.id}
                          href={`/crm/activities/${a.id}`}
                          className={`absolute top-10 -translate-x-1/2 leading-none ${a.status === "COMPLETED" ? "text-green-600" : late ? "text-red-600" : "text-zinc-700 dark:text-zinc-300"}`}
                          style={{ left: `${((d - 0.5) / days) * 100}%` }}
                          title={`${a.milestone ? "Milestone" : a.type.toLowerCase()}: ${a.subject} (${a.dueDate}, ${a.status.toLowerCase()})`}
                          aria-label={`${a.milestone ? "Milestone" : "Activity"} ${a.subject}`}
                        >
                          {a.milestone ? "◆" : "•"}
                        </Link>
                      );
                    })}
                    <div className="h-14" />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            <span className="mr-1 inline-block h-2 w-4 rounded border border-indigo-300 bg-indigo-100 align-middle" /> planned ·{" "}
            <span className="mr-1 inline-block h-2 w-4 rounded bg-green-500/80 align-middle" /> actual · ◆ milestone · • other activity (red = overdue, green = done)
            {data.activitiesHidden && " · activities need CRM access"}
          </p>
        </div>
      )}
    </div>
  );
}

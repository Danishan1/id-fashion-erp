"use client";

import { useEffect, useState } from "react";
import { humanizeStatus } from "@/lib/humanize-status";

interface Entry {
  id: string;
  at: string;
  kind: "ACTIVITY" | "STAGE" | "ASSIGNMENT" | "FOLLOWUP" | "FILE";
  type: string;
  title: string;
  detail: string | null;
  user: string | null;
}

const FILTERS: Array<{ key: Entry["kind"] | "ALL"; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "ACTIVITY", label: "Calls, emails & notes" },
  { key: "STAGE", label: "Stage changes" },
  { key: "FOLLOWUP", label: "Follow-ups" },
  { key: "ASSIGNMENT", label: "Assignments" },
  { key: "FILE", label: "Documents" },
];

const DOT: Record<Entry["kind"], string> = {
  ACTIVITY: "bg-indigo-500",
  STAGE: "bg-violet-500",
  FOLLOWUP: "bg-amber-500",
  ASSIGNMENT: "bg-sky-500",
  FILE: "bg-zinc-400",
};

/** `refreshSignal` bumps whenever the parent logs something new. */
export function LeadTimelineTab({ leadId, refreshSignal }: { leadId: string; refreshSignal: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState<Entry["kind"] | "ALL">("ALL");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/leads/${leadId}/timeline`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setEntries(body.data ?? []))
      .catch(() => setError("Could not load the timeline."));
  }, [leadId, refreshSignal]);

  const shown = (entries ?? []).filter((e) => filter === "ALL" || e.kind === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === f.key
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {entries === null && !error ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing here yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-zinc-200 pl-5 dark:border-zinc-800">
          {shown.map((e) => (
            <li key={e.id} className="relative">
              <span className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950 ${DOT[e.kind]}`} />
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{e.title}</span>
                <span className="text-xs text-zinc-500">
                  {new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  {e.user ? ` · ${e.user}` : ""}
                </span>
              </div>
              <div className="text-[11px] uppercase text-zinc-400">{humanizeStatus(e.type)}</div>
              {e.detail && <p className="mt-0.5 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{e.detail}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

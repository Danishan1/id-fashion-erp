"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

interface FollowupRow {
  id: string;
  relatedModule: "LEAD" | "DEAL" | "CUSTOMER";
  relatedRecordId: string;
  relatedLabel: string;
  followupDate: string;
  type: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "PENDING" | "COMPLETED";
  notes: string | null;
  assignedTo: { id: string; fullName: string } | null;
}

interface Buckets {
  overdue: FollowupRow[];
  dueToday: FollowupRow[];
  upcoming: FollowupRow[];
  completed: FollowupRow[];
}

const PRIORITY_CLASS: Record<FollowupRow["priority"], string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

function relatedHref(row: FollowupRow) {
  if (row.relatedModule === "LEAD") return `/leads/${row.relatedRecordId}`;
  if (row.relatedModule === "DEAL") return `/deals/${row.relatedRecordId}`;
  return `/masters/customers/${row.relatedRecordId}/360`;
}

export default function FollowUpsPage() {
  const [buckets, setBuckets] = useState<Buckets | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  const load = () =>
    fetch("/api/v1/crm-followups/management")
      .then((res) => res.json())
      .then((body) => setBuckets(body.data));

  useEffect(() => {
    load();
  }, []);

  const changeStatus = async (id: string, status: "COMPLETED" | "CANCELLED") => {
    await fetch(`/api/v1/crm-followups/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const checkNow = async () => {
    setIsChecking(true);
    setCheckResult(null);
    const res = await fetch("/api/v1/crm-followups/generate-notifications", { method: "POST" });
    const body = await res.json();
    setIsChecking(false);
    if (res.ok) setCheckResult(`Checked ${body.data.checked} due/overdue follow-up(s) — ${body.data.notified} new notification(s) sent.`);
  };

  const renderRow = (row: FollowupRow) => (
    <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <a href={relatedHref(row)} className="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            {row.relatedLabel}
          </a>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_CLASS[row.priority]}`}>{row.priority}</span>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          {row.type} · {new Date(row.followupDate).toLocaleString()} · {row.assignedTo?.fullName ?? "Unassigned"}
        </p>
        {row.notes && <p className="mt-0.5 text-xs text-zinc-500">{row.notes}</p>}
      </div>
      {row.status === "PENDING" && (
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => changeStatus(row.id, "COMPLETED")} className="text-xs font-medium text-green-600 hover:underline">
            Complete
          </button>
          <button type="button" onClick={() => changeStatus(row.id, "CANCELLED")} className="text-xs font-medium text-red-600 hover:underline">
            Cancel
          </button>
        </div>
      )}
    </li>
  );

  const groups: Array<[string, FollowupRow[] | undefined, string]> = buckets
    ? [
        ["Overdue", buckets.overdue, "text-red-600 dark:text-red-400"],
        ["Due Today", buckets.dueToday, "text-amber-600 dark:text-amber-400"],
        ["Upcoming", buckets.upcoming, "text-zinc-700 dark:text-zinc-300"],
        ["Completed", buckets.completed, "text-green-600 dark:text-green-400"],
      ]
    : [];

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Follow-ups" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Follow-up Management</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Every open follow-up across Leads, Deals, and Customers, in one place.</p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={isChecking}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isChecking ? "Checking…" : "Check for Due Follow-ups"}
        </button>
      </div>

      {checkResult && <p className="text-sm text-zinc-600 dark:text-zinc-300">{checkResult}</p>}

      {!buckets ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {groups.map(([label, rows, colorClass]) => (
            <div key={label} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="text-xs font-medium uppercase text-zinc-500">{label}</div>
              <div className={`mt-1 text-xl font-semibold ${colorClass}`}>{rows?.length ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {buckets && (
        <div className="space-y-6">
          {groups.map(([label, rows]) => (
            <div key={label}>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{label}</h2>
              {!rows || rows.length === 0 ? (
                <p className="text-sm text-zinc-500">Nothing here.</p>
              ) : (
                <ul className="space-y-2">{rows.map(renderRow)}</ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

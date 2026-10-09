"use client";

import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { AppointmentForm } from "../appointments/AppointmentForm";
import { useAppointmentLookups } from "../appointments/useAppointmentLookups";
import { ActivityComposer } from "./ActivityComposer";
import { ActivityDetailModal } from "./ActivityDetail";
import { ActivityRows } from "./ActivityList";
import { ACTIVITIES_API, type ActivityDto, type ActivityParentRef } from "./activity-types";
import { useActivityLookups } from "./useActivityLookups";

type Tab = "open" | "closed" | "all";
const QUICK: { type: string; mode?: "schedule" | "log"; label: string }[] = [
  { type: "TASK", label: "Task" },
  { type: "CALL", mode: "log", label: "Log call" },
  { type: "MEETING", label: "Meeting" },
  { type: "APPOINTMENT", label: "Appointment" },
  { type: "EMAIL", mode: "log", label: "Log message" },
];

/**
 * The activities section of a CRM record (contact, company, opportunity,
 * lead): quick "add" buttons that pre-fill the record, open / completed /
 * all tabs (server-side, paged), tick-to-complete and the detail dialog.
 * Activities created on related records (e.g. a deal's tasks on its company)
 * appear here too. Notes stay in the record's Notes section (`onAddNote`).
 */
export function ActivityPanel({
  parent,
  canCreate,
  canEdit,
  currentUserId,
  onAddNote,
  onChanged,
  pageSize = 10,
}: {
  parent: ActivityParentRef;
  canCreate: boolean;
  canEdit: boolean;
  currentUserId: string;
  onAddNote?: () => void;
  onChanged?: () => void;
  pageSize?: number;
}) {
  const { meta, users } = useActivityLookups();
  const appointmentLookups = useAppointmentLookups();
  const [booking, setBooking] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [limit, setLimit] = useState(pageSize);
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ key: string; rows: ActivityDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ type: string; mode?: "schedule" | "log" } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const dataKey = `${parent.entityType}:${parent.entityId}:${tab}:${limit}`;
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ entityType: parent.entityType, entityId: parent.entityId, pageSize: String(limit), sortBy: tab === "closed" ? "completedAt" : "dueAt", sortOrder: tab === "closed" ? "desc" : "asc" });
    if (tab !== "all") qs.set("state", tab);
    crmRequest<ActivityDto[]>(`${ACTIVITIES_API}?${qs}`).then((res) => {
      if (cancelled) return;
      if (!res.ok) return setError(res.error.message);
      setError(null);
      setData({ key: `${parent.entityType}:${parent.entityId}:${tab}:${limit}`, rows: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [parent.entityType, parent.entityId, tab, limit, tick]);

  const changed = () => {
    setTick((t) => t + 1);
    onChanged?.();
  };
  // Rows of the current tab / size (a refresh keeps showing the old rows until the new ones arrive).
  const loading = !data || data.key !== dataKey;

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex flex-wrap gap-1.5" aria-label="Add activity">
          {QUICK.filter((q) => q.type !== "APPOINTMENT" || parent.entityType !== "LEAD").map((q) => (
            <button key={q.label} type="button" disabled={!meta || (q.type === "APPOINTMENT" && !appointmentLookups.meta)} onClick={() => (q.type === "APPOINTMENT" ? setBooking(true) : setComposer(q))} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              + {q.label}
            </button>
          ))}
          {onAddNote && (
            <button type="button" onClick={onAddNote} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              + Note
            </button>
          )}
        </div>
      )}
      <div role="tablist" aria-label="Activity filter" className="flex gap-3 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {(["open", "closed", "all"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setLimit(pageSize);
            }}
            className={`-mb-px border-b-2 px-1 pb-1.5 ${tab === t ? "border-indigo-600 font-medium text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}
          >
            {t === "open" ? "Open" : t === "closed" ? "Completed" : "All"}
          </button>
        ))}
      </div>
      {error ? (
        <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
      ) : loading ? (
        <CrmLoadingState />
      ) : data.rows.length === 0 ? (
        <CrmEmptyState title={tab === "open" ? "Nothing to do" : "No activities yet"} description={tab === "open" ? "Add a task, call or meeting to plan the next step." : "Logged calls, meetings and completed tasks appear here."} />
      ) : (
        <>
          <ActivityRows rows={data.rows} canEdit={canEdit} showRecord={false} onOpen={(a) => setOpened(a.id)} onChanged={changed} />
          {data.rows.length >= limit && (
            <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              Show more
            </button>
          )}
        </>
      )}
      {composer && meta && (
        <ActivityComposer
          meta={meta}
          users={users}
          currentUserId={currentUserId}
          parent={parent}
          initialType={composer.type}
          initialMode={composer.mode}
          onClose={() => setComposer(null)}
          onSaved={(a) => {
            setComposer(null);
            if (a.status === "COMPLETED" && tab === "open") setTab("all");
            changed();
          }}
        />
      )}
      {opened && <ActivityDetailModal activityId={opened} meta={meta} users={users} canEdit={canEdit} currentUserId={currentUserId} onClose={() => setOpened(null)} onChanged={changed} />}
      {booking && appointmentLookups.meta && parent.entityType !== "LEAD" && (
        <AppointmentForm
          meta={appointmentLookups.meta}
          users={appointmentLookups.users}
          currentUserId={currentUserId}
          prefill={{ [parent.entityType.toLowerCase()]: { id: parent.entityId, label: parent.label } }}
          onClose={() => setBooking(false)}
          onSaved={() => {
            setBooking(false);
            changed();
          }}
        />
      )}
    </div>
  );
}

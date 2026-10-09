"use client";

import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { ACTIVITY_PRIORITIES, ACTIVITY_TYPES, DUE_STATES, isActivityType, type ActivityPriority, type DueState } from "@/modules/crm/activities/activity-registry";
import type { ActivityDto } from "./activity-types";

export function ActivityTypeIcon({ type }: { type: string }) {
  return (
    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs dark:bg-zinc-800">
      {isActivityType(type) ? ACTIVITY_TYPES[type].icon : "•"}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const p = ACTIVITY_PRIORITIES[priority as ActivityPriority];
  if (!p || priority === "NORMAL") return null;
  return <CrmBadge label={p.label} tone={p.tone as CrmBadgeTone} />;
}

export function DueStateBadge({ state }: { state: DueState }) {
  const s = DUE_STATES[state];
  return <CrmBadge label={s.label} tone={s.tone as CrmBadgeTone} />;
}

/** "10 Oct 2026, 11:00" / "10 Oct 2026" (business time — already converted by the API). */
export function formatDue(due: ActivityDto["due"], end?: string | null) {
  if (!due) return "No due date";
  const d = new Date(`${due.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return due.time ? `${d}, ${due.time}${end ? `–${end}` : ""}` : d;
}

export function DueText({ activity }: { activity: Pick<ActivityDto, "due" | "end" | "dueState" | "status"> }) {
  const overdue = activity.dueState === "OVERDUE";
  return <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : undefined}>{formatDue(activity.due, activity.end)}</span>;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { ActivityTypeIcon, DueStateBadge, DueText, PriorityBadge } from "./ActivityBadges";
import { ACTIVITIES_API, type ActivityDto } from "./activity-types";

/**
 * Compact activity rows (record panels, My Tasks): a tick to complete open
 * items, type, subject, related record, assignee, due and priority. Clicking
 * the subject opens the detail.
 */
export function ActivityRows({
  rows,
  canEdit,
  showRecord = true,
  onOpen,
  onChanged,
}: {
  rows: ActivityDto[];
  canEdit: boolean;
  showRecord?: boolean;
  onOpen: (a: ActivityDto) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const toggle = async (a: ActivityDto) => {
    setBusyId(a.id);
    const res = await crmRequest(`${ACTIVITIES_API}/${a.id}/${a.permissions.complete ? "complete" : "reopen"}`, { method: "POST", body: { version: a.version }, successMessage: a.permissions.complete ? "Marked complete." : "Reopened." });
    setBusyId(null);
    if (res.ok) onChanged();
  };
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {rows.map((a) => {
        const done = a.status === "COMPLETED";
        const togglable = canEdit && (a.permissions.complete || (done && a.permissions.reopen));
        return (
          <li key={a.id} className="flex items-start gap-3 py-2" data-testid={`activity-row-${a.id}`}>
            <input
              type="checkbox"
              className="mt-1.5"
              checked={done}
              disabled={!togglable || busyId === a.id || a.status === "CANCELLED"}
              onChange={() => toggle(a)}
              aria-label={done ? `Reopen ${a.subject}` : `Complete ${a.subject}`}
            />
            <ActivityTypeIcon type={a.type} />
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => onOpen(a)} className={`text-left text-sm font-medium hover:underline ${done ? "text-zinc-500 line-through" : a.status === "CANCELLED" ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-50"}`}>
                {a.subject}
              </button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {a.typeLabel}
                {showRecord && a.primary && (
                  <>
                    {" · "}
                    {a.primary.href ? (
                      <Link href={a.primary.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {a.primary.label}
                      </Link>
                    ) : (
                      a.primary.label
                    )}
                  </>
                )}
                {a.assignedTo && ` · ${a.assignedTo.fullName}`}
                {a.outcome && ` · ${a.outcome}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
              <DueText activity={a} />
              <span className="flex gap-1">
                {(a.dueState === "OVERDUE" || a.dueState === "DUE_TODAY") && <DueStateBadge state={a.dueState} />}
                <PriorityBadge priority={a.priority} />
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

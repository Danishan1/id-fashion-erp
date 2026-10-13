"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityTypeIcon, DueStateBadge, DueText, PriorityBadge } from "@/components/crm/activities/ActivityBadges";
import { ActivityComposer } from "@/components/crm/activities/ActivityComposer";
import { ActivityDetailModal } from "@/components/crm/activities/ActivityDetail";
import { ACTIVITIES_API, type ActivityDto } from "@/components/crm/activities/activity-types";
import { useActivityLookups } from "@/components/crm/activities/useActivityLookups";
import { CrmBulkBar } from "@/components/crm/CrmBulkBar";
import { crmRequest } from "@/components/crm/crm-api";
import { bulkMessage, type BulkResult } from "@/components/crm/CrmRecordDialogs";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmTable } from "@/components/crm/CrmTable";
import { textInputClass } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { ACTIVITY_PRIORITIES, ACTIVITY_PRIORITY_KEYS, ACTIVITY_STATUSES, ACTIVITY_STATUS_KEYS, ACTIVITY_TYPE_KEYS, ACTIVITY_TYPES } from "@/modules/crm/activities/activity-registry";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";

const VIEWS = [
  { key: "my-open", label: "My open tasks", params: { mine: "assigned", state: "open" } },
  { key: "today", label: "Due today", params: { due: "today" } },
  { key: "overdue", label: "Overdue", params: { due: "overdue" } },
  { key: "upcoming", label: "Upcoming", params: { due: "upcoming" } },
  { key: "completed", label: "Completed", params: { due: "completed", sortBy: "completedAt", sortOrder: "desc" } },
  { key: "logged", label: "Calls & meetings", params: { types: "CALL,MEETING" } },
  { key: "all", label: "All", params: {} },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const FILTERS: CrmFilterDefinition[] = [
  { type: "select", key: "types", label: "Type", options: ACTIVITY_TYPE_KEYS.map((t) => ({ value: t, label: ACTIVITY_TYPES[t].label })) },
  { type: "select", key: "statuses", label: "Status", options: ACTIVITY_STATUS_KEYS.map((s) => ({ value: s, label: ACTIVITY_STATUSES[s].label })) },
  { type: "select", key: "priorities", label: "Priority", options: ACTIVITY_PRIORITY_KEYS.map((p) => ({ value: p, label: ACTIVITY_PRIORITIES[p].label })) },
  {
    type: "select",
    key: "relatedType",
    label: "Related to",
    options: [
      { value: "OPPORTUNITY", label: "Opportunities" },
      { value: "CONTACT", label: "Contacts" },
      { value: "COMPANY", label: "Companies" },
      { value: "LEAD", label: "Leads" },
    ],
  },
  { type: "dateRange", label: "Due", fromKey: "dueFrom", toKey: "dueTo" },
];

/**
 * All CRM activities the user may see, with quick views (my open tasks, due
 * today, overdue, upcoming, completed), filters, search, server-side paging
 * and bulk actions (each record checked on its own).
 */
export function ActivitiesListClient({ permissions, currentUserId, initialView = "my-open", initialAssignee = "" }: { permissions: CrmPagePermissions; currentUserId: string; initialView?: ViewKey; initialAssignee?: string }) {
  const { meta, users } = useActivityLookups();
  const [view, setView] = useState<ViewKey>(initialView);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState(initialAssignee);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [busy, setBusy] = useState(false);

  const v = VIEWS.find((x) => x.key === view)!;
  const params = new URLSearchParams(v.params as Record<string, string>);
  if (assigneeFilter === "unassigned") params.set("unassigned", "true");
  else if (assigneeFilter) params.set("assignedToUserIds", assigneeFilter);
  const fetchUrl = `${ACTIVITIES_API}?${params.toString()}`;
  const refresh = () => setRefreshKey((k) => k + 1);

  const bulk = async (body: Record<string, unknown>, verb: string) => {
    setBusy(true);
    const res = await crmRequest<BulkResult>(`${ACTIVITIES_API}/bulk`, { method: "POST", body: { ...body, ids: selected }, toast: "errors" });
    setBusy(false);
    if (!res.ok) return;
    toast.success(bulkMessage(res.data, verb, "activity"));
    if (res.data.skipped.length) toast.warning(`Skipped: ${[...new Set(res.data.skipped.map((s) => s.reason))].join("; ")}`);
    setSelected([]);
    refresh();
  };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {VIEWS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={view === x.key}
            onClick={() => {
              setView(x.key);
              setSelected([]);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${view === x.key ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300" : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <CrmTable<ActivityDto>
        tableKey={view}
        fetchUrl={fetchUrl}
        refreshKey={refreshKey}
        filters={FILTERS}
        searchPlaceholder="Search subject, notes, outcome…"
        onRowClick={(row) => setOpened(row.id)}
        newAction={permissions.create ? { label: "New activity", onClick: () => setComposing(true) } : undefined}
        toolbar={
          <select aria-label="Assigned to" className={`${textInputClass()} w-auto`} value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="">Anyone</option>
            <option value={currentUserId}>Me</option>
            <option value="unassigned">Unassigned</option>
            {users
              .filter((u) => u.id !== currentUserId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
          </select>
        }
        selection={permissions.edit ? { selectedIds: selected, onChange: setSelected, label: (r) => r.subject } : undefined}
        aboveTable={
          permissions.edit && (
            <CrmBulkBar count={selected.length} onClear={() => setSelected([])}>
              <button type="button" disabled={busy} className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-sm dark:bg-zinc-900" onClick={() => bulk({ action: "complete" }, "Completed")}>
                Complete
              </button>
              <span className="flex items-center gap-1">
                <input type="date" aria-label="New due date" className={`${textInputClass()} w-auto py-1`} value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
                <button type="button" disabled={busy || !rescheduleDate} className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-sm disabled:opacity-50 dark:bg-zinc-900" onClick={() => bulk({ action: "reschedule", dueDate: rescheduleDate }, "Rescheduled")}>
                  Reschedule
                </button>
              </span>
              <span className="flex items-center gap-1">
                <select aria-label="Assign to" className={`${textInputClass()} w-auto py-1`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Assign to…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={busy || !assignee} className="rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-sm disabled:opacity-50 dark:bg-zinc-900" onClick={() => bulk({ action: "assign", assignedToUserId: assignee }, "Assigned")}>
                  Assign
                </button>
              </span>
              <select aria-label="Set priority" className={`${textInputClass()} w-auto py-1`} value="" onChange={(e) => e.target.value && bulk({ action: "priority", priority: e.target.value }, "Updated")}>
                <option value="">Priority…</option>
                {ACTIVITY_PRIORITY_KEYS.map((p) => (
                  <option key={p} value={p}>
                    {ACTIVITY_PRIORITIES[p].label}
                  </option>
                ))}
              </select>
              <button type="button" disabled={busy} className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-sm text-red-700 dark:bg-zinc-900 dark:text-red-400" onClick={() => bulk({ action: "cancel" }, "Cancelled")}>
                Cancel
              </button>
            </CrmBulkBar>
          )
        }
        columns={[
          {
            key: "subject",
            header: "Activity",
            sortable: true,
            render: (a) => (
              <span className="flex items-center gap-2">
                <ActivityTypeIcon type={a.type} />
                <span className="min-w-0">
                  <span className={`block font-medium ${a.status === "COMPLETED" || a.status === "CANCELLED" ? "text-zinc-500 line-through" : ""}`}>{a.subject}</span>
                  <span className="block text-xs text-zinc-500">
                    {a.typeLabel}
                    {a.outcome ? ` · ${a.outcome}` : ""}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: "related",
            header: "Related to",
            render: (a) =>
              a.primary?.href ? (
                <Link href={a.primary.href} onClick={(e) => e.stopPropagation()} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {a.primary.label}
                </Link>
              ) : (
                (a.primary?.label ?? "—")
              ),
          },
          { key: "assignedTo", header: "Assigned to", render: (a) => a.assignedTo?.fullName ?? "Unassigned" },
          { key: "priority", header: "Priority", render: (a) => (a.priority === "NORMAL" ? "Normal" : <PriorityBadge priority={a.priority} />) },
          { key: "dueAt", header: "Due", sortable: true, render: (a) => <DueText activity={a} /> },
          { key: "status", header: "Status", render: (a) => <DueStateBadge state={a.dueState} /> },
        ]}
      />
      {composing && meta && (
        <ActivityComposer
          meta={meta}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            refresh();
          }}
        />
      )}
      {opened && <ActivityDetailModal activityId={opened} meta={meta} users={users} canEdit={permissions.edit} onClose={() => setOpened(null)} onChanged={refresh} />}
    </div>
  );
}

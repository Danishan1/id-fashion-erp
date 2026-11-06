"use client";

import { useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmTable } from "@/components/crm/CrmTable";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ACTIVE_STATUSES, BULK_JOBS_API, BULK_JOBS_PAGE, TONE_TO_BADGE, type BulkJobDto } from "./bulk-ui-types";

const STATUS_OPTIONS = [
  { value: "QUEUED,VALIDATING,RUNNING,CANCEL_REQUESTED", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "COMPLETED_WITH_ERRORS", label: "Completed with errors" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function BulkProgress({ job }: { job: Pick<BulkJobDto, "progress" | "processedCount" | "totalCount" | "failedCount" | "status"> }) {
  const active = ACTIVE_STATUSES.includes(job.status);
  return (
    <div className="min-w-[8rem]">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress} aria-label="Progress">
        <div className={`h-full ${job.failedCount ? "bg-amber-500" : "bg-indigo-600"} ${active ? "transition-all" : ""}`} style={{ width: `${job.progress}%` }} />
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">
        {job.processedCount.toLocaleString()} / {job.totalCount.toLocaleString()}
      </div>
    </div>
  );
}

export interface BulkRecordTypeOption {
  value: string;
  label: string;
}

const CRM_TYPES: BulkRecordTypeOption[] = [
  { value: "LEAD", label: "Leads" },
  { value: "CONTACT", label: "Contacts" },
  { value: "COMPANY", label: "Companies" },
  { value: "OPPORTUNITY", label: "Opportunities" },
];

/**
 * Phase 14 — bulk jobs: the user's own, plus every job of record types they
 * administer. Refreshes while jobs run. Each module's jobs page passes its own
 * record types (CRM by default; Sales & Marketing passes its five) and the
 * path of its job detail page.
 */
export function BulkJobsListClient({ recordTypes = CRM_TYPES, basePath = BULK_JOBS_PAGE, scheduleId }: { recordTypes?: BulkRecordTypeOption[]; basePath?: string; scheduleId?: string } = {}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const scope = `entityTypes=${recordTypes.map((t) => t.value).join(",")}${scheduleId ? `&scheduleId=${scheduleId}` : ""}`;

  // Every 5 s: a 1-row check for running jobs; the table reloads only while something runs.
  useEffect(() => {
    let wasActive = false;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const r = await fetch(`${BULK_JOBS_API}?statuses=${ACTIVE_STATUSES.join(",")}&pageSize=1&${scope}`).catch(() => null);
      const body = r?.ok ? await r.json().catch(() => null) : null;
      const active = (body?.meta?.totalCount ?? 0) > 0;
      if (active || wasActive) setRefreshKey((k) => k + 1);
      wasActive = active;
    }, 5000);
    return () => clearInterval(t);
  }, [scope]);

  return (
    <CrmTable<BulkJobDto>
      fetchUrl={`${BULK_JOBS_API}?${scope}`}
      syncWithUrl={!scheduleId}
      refreshKey={refreshKey}
      searchPlaceholder="Search job summary…"
      filters={[
        { type: "select", key: "statuses", label: "Status", options: STATUS_OPTIONS },
        { type: "select", key: "entityType", label: "Record type", options: recordTypes },
        { type: "select", key: "mine", label: "Started by", options: [{ value: "true", label: "Me" }], anyLabel: "Anyone I can see" },
      ]}
      rowHref={(j) => `${basePath}/${j.id}`}
      columns={[
        {
          key: "action",
          header: "Action",
          render: (j) => (
            <div>
              <div className="font-medium">
                {j.actionLabel} · {j.entityLabel}
                {j.dryRun && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">Dry run</span>}
                {j.scheduleId && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-300">Scheduled</span>}
              </div>
              {j.summary && <div className="max-w-md truncate text-xs text-zinc-500">{j.summary}</div>}
            </div>
          ),
        },
        { key: "status", header: "Status", render: (j) => <CrmBadge label={j.statusLabel} tone={TONE_TO_BADGE[j.statusTone]} /> },
        { key: "progress", header: "Progress", render: (j) => <BulkProgress job={j} /> },
        {
          key: "results",
          header: "Results",
          render: (j) => (
            <span className="text-xs">
              <span className="text-green-700 dark:text-green-400">{j.succeededCount} ok</span> · <span>{j.skippedCount} skipped</span> · <span className={j.failedCount ? "text-red-600 dark:text-red-400" : ""}>{j.failedCount} failed</span>
            </span>
          ),
        },
        { key: "requestedBy", header: "Started by", render: (j) => (j.isMine ? "You" : (j.requestedBy.name ?? "—")) },
        { key: "createdAt", header: "Started", render: (j) => <ClientDateTime value={j.createdAt} /> },
      ]}
    />
  );
}

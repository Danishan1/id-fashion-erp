"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BulkJobsListClient, type BulkRecordTypeOption } from "@/components/bulk/BulkJobsListClient";
import { BULK_SCHEDULES_API, TONE_TO_BADGE, type BulkScheduleDto } from "@/components/bulk/bulk-ui-types";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { SM_BULK_JOBS_PAGE } from "./SmBulkActions";

export const SM_RECORD_TYPES: BulkRecordTypeOption[] = [
  { value: "ENQUIRY", label: "Enquiries" },
  { value: "QUOTATION", label: "Quotations" },
  { value: "CAMPAIGN", label: "Campaigns" },
  { value: "PROMOTION", label: "Promotions" },
  { value: "ATTRIBUTION_MODEL", label: "Attribution models" },
];

const OUTCOME_LABEL: Record<string, string> = {
  STARTED: "Started",
  SKIPPED_OVERLAP: "Skipped — previous run still going",
  FAILED_TO_START: "Couldn't start",
  NOTHING_TO_DO: "Nothing matched",
  COMPLETED: "Completed",
  COMPLETED_WITH_ERRORS: "Completed with errors",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Phase 14 (S&M) — Bulk jobs page: jobs (own + administered record types) and saved schedules. */
export function SmBulkJobsClient({ initialTab = "jobs" }: { initialTab?: "jobs" | "schedules" }) {
  const [tab, setTab] = useState<"jobs" | "schedules">(initialTab);
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Bulk jobs view">
        {(
          [
            ["jobs", "Jobs"],
            ["schedules", "Schedules"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 text-sm font-medium ${tab === k ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "jobs" ? <BulkJobsListClient recordTypes={SM_RECORD_TYPES} basePath={SM_BULK_JOBS_PAGE} /> : <SmBulkSchedulesClient />}
    </div>
  );
}

export function SmBulkSchedulesClient() {
  const [rows, setRows] = useState<BulkScheduleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BulkScheduleDto | null>(null);
  const [runsOf, setRunsOf] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await crmRequest<BulkScheduleDto[]>(`${BULK_SCHEDULES_API}?entityTypes=${SM_RECORD_TYPES.map((t) => t.value).join(",")}`, { toast: "off" });
    if (r.ok) {
      setRows(r.data);
      setError(null);
    } else setError(r.error.message);
  }, []);
  useEffect(() => {
    let live = true;
    void crmRequest<BulkScheduleDto[]>(`${BULK_SCHEDULES_API}?entityTypes=${SM_RECORD_TYPES.map((t) => t.value).join(",")}`, { toast: "off" }).then((r) => {
      if (!live) return;
      if (r.ok) setRows(r.data);
      else setError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, []);

  const act = async (s: BulkScheduleDto, action: "pause" | "resume" | "delete") => {
    setBusy(s.id);
    const r = await crmRequest(`${BULK_SCHEDULES_API}/${s.id}`, { method: "POST", body: { action, version: s.version }, successMessage: action === "pause" ? "Schedule paused." : action === "resume" ? "Schedule resumed." : "Schedule deleted." });
    setBusy(null);
    setDeleting(null);
    if (r.ok) await load();
  };

  if (error && !rows) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <LoadingState />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Exports and attribution recalculations can repeat daily, weekly or monthly (India time). Create one from a list: <em>Bulk actions → Review → Save as a schedule</em>. Each run is a normal bulk job started as the schedule&apos;s owner; a run is skipped while the previous one is still going, and a schedule pauses itself after 3 failed runs in a row.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">No schedules yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[56rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Next run</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-zinc-500">
                      {s.actionLabel} · {s.entityLabel}
                      {s.summary ? ` · ${s.summary}` : ""}
                    </div>
                    {s.listHref && (
                      <Link href={`${s.listHref}${s.filterQuery ? `?${s.filterQuery}` : ""}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                        Records: the list with these filters
                      </Link>
                    )}
                    {!s.available && <div className="text-xs text-red-600 dark:text-red-400">This action can no longer be scheduled.</div>}
                  </td>
                  <td className="px-3 py-2">
                    {s.when}
                    <div className="mt-1">
                      <CrmBadge label={s.status === "ACTIVE" ? "Active" : "Paused"} tone={s.status === "ACTIVE" ? "green" : "amber"} />
                    </div>
                  </td>
                  <td className="px-3 py-2">{s.nextRunAt ? <ClientDateTime value={s.nextRunAt} /> : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.lastRunAt ? <ClientDateTime value={s.lastRunAt} /> : "Not run yet"}
                    {s.lastOutcome && <div>{OUTCOME_LABEL[s.lastOutcome] ?? s.lastOutcome}</div>}
                    {s.lastJobStatus && s.lastJobId && (
                      <Link href={`${SM_BULK_JOBS_PAGE}/${s.lastJobId}`} className="inline-block">
                        <CrmBadge label={s.lastJobStatus.label} tone={TONE_TO_BADGE[s.lastJobStatus.tone]} />
                      </Link>
                    )}
                    {s.lastMessage && <div className="max-w-xs text-zinc-500">{s.lastMessage}</div>}
                    {s.consecutiveFailures > 0 && <div className="text-red-600 dark:text-red-400">{s.consecutiveFailures} failed in a row</div>}
                  </td>
                  <td className="px-3 py-2">{s.owner.name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="xs" variant="secondary" onClick={() => setRunsOf(runsOf === s.id ? null : s.id)}>
                        {runsOf === s.id ? "Hide runs" : "Runs"}
                      </Button>
                      {s.status === "ACTIVE" ? (
                        <Button size="xs" variant="secondary" disabled={busy === s.id} onClick={() => act(s, "pause")}>
                          Pause
                        </Button>
                      ) : (
                        <Button size="xs" variant="secondary" disabled={busy === s.id || !s.available} onClick={() => act(s, "resume")}>
                          Resume
                        </Button>
                      )}
                      <Button size="xs" variant="danger" disabled={busy === s.id} onClick={() => setDeleting(s)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runsOf && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Runs of “{rows.find((r) => r.id === runsOf)?.name}”</h3>
          <BulkJobsListClient key={runsOf} recordTypes={SM_RECORD_TYPES} basePath={SM_BULK_JOBS_PAGE} scheduleId={runsOf} />
        </section>
      )}
      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete this schedule?"
        message="No more runs will start. Jobs it already ran (and their files) stay on the Jobs tab."
        confirmLabel="Delete schedule"
        isDangerous
        isBusy={Boolean(busy)}
        onConfirm={() => deleting && act(deleting, "delete")}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

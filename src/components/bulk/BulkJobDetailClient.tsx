"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { crmRequest } from "@/components/crm/crm-api";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BulkProgress } from "./BulkJobsListClient";
import { ACTIVE_STATUSES, BULK_JOBS_API, BULK_JOBS_PAGE, TONE_TO_BADGE, type BulkJobDetailDto, type BulkJobDto, type BulkJobItemDto } from "./bulk-ui-types";

const ITEM_TONE: Record<string, "neutral" | "indigo" | "green" | "amber" | "red"> = { PENDING: "neutral", PROCESSING: "indigo", SUCCEEDED: "green", SKIPPED: "amber", FAILED: "red", CANCELLED: "neutral" };

function bytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Phase 14 — one bulk job: live progress (polled while running), outcome per record, cancel, retry, error report, download. */
export function BulkJobDetailClient({ id }: { id: string }) {
  const [job, setJob] = useState<BulkJobDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "retry" | null>(null);
  const [busy, setBusy] = useState(false);
  const [itemsKey, setItemsKey] = useState(0);
  const lastProcessed = useRef(-1);
  const router = useRouter();

  const apply = useCallback((r: Awaited<ReturnType<typeof crmRequest<BulkJobDetailDto>>>) => {
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setError(null);
    setJob(r.data);
    // Refresh the per-record table only when something changed.
    if (r.data.processedCount !== lastProcessed.current) {
      lastProcessed.current = r.data.processedCount;
      setItemsKey((k) => k + 1);
    }
  }, []);
  const load = useCallback(() => crmRequest<BulkJobDetailDto>(`${BULK_JOBS_API}/${id}`, { toast: "off" }).then(apply), [id, apply]);

  useEffect(() => {
    let live = true;
    void crmRequest<BulkJobDetailDto>(`${BULK_JOBS_API}/${id}`, { toast: "off" }).then((r) => live && apply(r));
    return () => {
      live = false;
    };
  }, [id, apply]);

  const active = job ? ACTIVE_STATUSES.includes(job.status) : false;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => clearInterval(t);
  }, [active, load]);

  if (error && !job) return <CrmErrorState message={error} onRetry={load} />;
  if (!job) return <CrmLoadingState />;

  const doCancel = async () => {
    setBusy(true);
    const r = await crmRequest<BulkJobDetailDto>(`${BULK_JOBS_API}/${id}/cancel`, { method: "POST", successMessage: "Cancellation requested." });
    setBusy(false);
    setConfirm(null);
    if (r.ok) setJob(r.data);
  };
  const doRetry = async () => {
    setBusy(true);
    const r = await crmRequest<BulkJobDto>(`${BULK_JOBS_API}/${id}/retry`, { method: "POST", body: {} });
    setBusy(false);
    setConfirm(null);
    if (r.ok) router.push(`${BULK_JOBS_PAGE}/${r.data.id}`);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {job.actionLabel} · {job.entityLabel}
            </h2>
            {job.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400">{job.summary}</p>}
            {job.action?.description && <p className="mt-1 text-xs text-zinc-500">{job.action.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrmBadge label={job.statusLabel} tone={TONE_TO_BADGE[job.statusTone]} />
            {job.canCancel && (
              <Button size="xs" variant="danger" onClick={() => setConfirm("cancel")} disabled={busy}>
                Cancel job
              </Button>
            )}
            {job.canRetry && job.retries.length === 0 && (
              <Button size="xs" variant="secondary" onClick={() => setConfirm("retry")} disabled={busy}>
                Retry failed ({job.failedCount})
              </Button>
            )}
            {(job.failedCount > 0 || job.skippedCount > 0 || (job.itemCounts.CANCELLED ?? 0) > 0) && (
              <a href={`${BULK_JOBS_API}/${id}/errors`} className={buttonClasses("secondary", "xs")}>
                Download error report
              </a>
            )}
          </div>
        </div>

        <BulkProgress job={job} />

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="Records" value={job.totalCount} />
          <Stat label="Succeeded" value={job.succeededCount} tone="text-green-700 dark:text-green-400" />
          <Stat label="Skipped" value={job.skippedCount} tone="text-amber-700 dark:text-amber-300" />
          <Stat label="Failed" value={job.failedCount} tone={job.failedCount ? "text-red-600 dark:text-red-400" : undefined} />
          <Stat label="Not processed" value={job.itemCounts.CANCELLED ?? 0} />
        </dl>

        {job.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {job.error.message} {job.error.code ? <span className="text-xs opacity-75">({job.error.code})</span> : null}
          </p>
        )}
        {job.status === "CANCEL_REQUESTED" && <p className="text-sm text-amber-700 dark:text-amber-300">Stopping after the record in progress. Records already done are not undone.</p>}
        {job.status === "QUEUED" && <p className="text-sm text-zinc-500">Waiting for the background worker…</p>}

        {job.download && (
          <div className="flex flex-wrap items-center gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/50">
            <span>
              {job.download.fileName} · {job.download.rowCount.toLocaleString()} rows · {bytes(job.download.sizeBytes)}
            </span>
            {job.download.available ? (
              <a href={`${BULK_JOBS_API}/${id}/download`} className={buttonClasses("primary", "xs")}>
                Download
              </a>
            ) : (
              <span className="text-xs text-zinc-500">{job.download.expired ? "Expired — run the export again." : "Only the person who ran the export can download it."}</span>
            )}
            {!job.download.expired && (
              <span className="text-xs text-zinc-500">
                Available until <ClientDateTime value={job.download.expiresAt} />
              </span>
            )}
          </div>
        )}

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-zinc-500 sm:grid-cols-2">
          <div>
            Started by: {job.isMine ? "you" : (job.requestedBy.name ?? "—")} · <ClientDateTime value={job.createdAt} />
          </div>
          <div>Selection: {job.selectionMode === "FILTER" ? "all records matching a filter (fixed at start)" : "selected records"}</div>
          {job.finishedAt && (
            <div>
              Finished: <ClientDateTime value={job.finishedAt} />
            </div>
          )}
          {job.retryOfJobId && (
            <div>
              Retry of{" "}
              <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`${BULK_JOBS_PAGE}/${job.retryOfJobId}`}>
                an earlier job
              </Link>
            </div>
          )}
          {job.retries.map((r) => (
            <div key={r.id}>
              Retried:{" "}
              <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`${BULK_JOBS_PAGE}/${r.id}`}>
                {r.statusLabel}
              </Link>
            </div>
          ))}
          {job.listHref && job.selection?.filterQuery !== undefined && (
            <div>
              <Link className="text-indigo-600 hover:underline dark:text-indigo-400" href={`${job.listHref}${job.selection.filterQuery ? `?${job.selection.filterQuery}` : ""}`}>
                Open the list with this filter
              </Link>
            </div>
          )}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Records</h3>
        <CrmTable<BulkJobItemDto>
          fetchUrl={`${BULK_JOBS_API}/${id}/items`}
          refreshKey={itemsKey}
          syncWithUrl={false}
          searchPlaceholder="(search not available)"
          filters={[
            {
              type: "select",
              key: "statuses",
              label: "Outcome",
              options: [
                { value: "FAILED", label: "Failed" },
                { value: "SKIPPED", label: "Skipped" },
                { value: "SUCCEEDED", label: "Succeeded" },
                { value: "CANCELLED", label: "Not processed" },
                { value: "PENDING,PROCESSING", label: "Pending" },
              ],
            },
          ]}
          columns={[
            { key: "sequence", header: "#", render: (r) => r.sequence },
            {
              key: "label",
              header: "Record",
              render: (r) =>
                r.href ? (
                  <Link href={r.href} className="text-indigo-600 hover:underline dark:text-indigo-400">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                ),
            },
            { key: "status", header: "Outcome", render: (r) => <CrmBadge label={r.statusLabel} tone={ITEM_TONE[r.status] ?? "neutral"} /> },
            { key: "message", header: "Details", render: (r) => <span className="text-xs">{r.message ?? "—"}{r.errorCode && r.status === "FAILED" ? <span className="ml-1 text-zinc-400">({r.errorCode})</span> : null}</span> },
            { key: "attempts", header: "Attempts", render: (r) => r.attempts },
          ]}
        />
      </section>

      <ConfirmModal
        open={confirm === "cancel"}
        title="Cancel this job?"
        message="Records not yet processed will be skipped. Records already changed stay changed — cancelling does not undo them."
        confirmLabel="Cancel job"
        isDangerous
        isBusy={busy}
        onConfirm={doCancel}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === "retry"}
        title={`Retry ${job.failedCount} failed record(s)?`}
        message="A new job runs the same action on the records that failed. Each record is checked again, so fixed records will now succeed."
        confirmLabel="Retry"
        isBusy={busy}
        onConfirm={doRetry}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`text-lg font-semibold ${tone ?? ""}`}>{value.toLocaleString()}</dd>
    </div>
  );
}

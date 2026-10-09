"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { ImportStatusBadge } from "./ImportBadges";
import { ImportCounts, ImportProgress } from "./ImportCounts";
import { ImportRowsTable, type RowFilter } from "./ImportRowsTable";
import { CancelButton, ImportResultSummary } from "./ImportWizard";
import { FINISHED_STATUSES, POLICY_INFO } from "./import-types";
import { useImportJob } from "./useImportJob";

export function ImportDetailClient({ jobId }: { jobId: string }) {
  const { job, error, reload } = useImportJob(jobId);
  const [filter, setFilter] = useState<RowFilter | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!job) return <CrmLoadingState />;
  const finished = FINISHED_STATUSES.includes(job.status);
  const activeFilter: RowFilter = filter ?? (finished ? (job.flaggedRows ? "FLAGGED" : job.failedRows + job.skippedRows ? "problems" : "all") : "all");
  const reviewing = finished && activeFilter === "FLAGGED";

  const review = async (action: "CREATE" | "UPDATE" | "SKIP") => {
    setBusy(action);
    setMessage(null);
    const res = await crmRequest<{ results: { rowNumber: number; outcome: string; reason: string | null }[] }>(`/api/v1/crm/imports/${job.id}/review`, {
      method: "POST",
      toast: "errors",
      body: { action, rowIds: selected },
    });
    setBusy(null);
    if (!res.ok) return;
    const unchanged = res.data.results.filter((r) => r.outcome === "FLAGGED");
    setMessage(`${res.data.results.length - unchanged.length} row(s) decided.${unchanged.length ? ` ${unchanged.length} still need a choice (${unchanged[0].reason})` : ""}`);
    setSelected([]);
    setRefreshKey((k) => k + 1);
    reload();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{job.fileName}</h2>
              <ImportStatusBadge status={job.status} />
            </div>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              {job.totalRows.toLocaleString("en-IN")} rows · {job.fileType} · uploaded <ClientDateTime value={job.createdAt} /> by {job.createdBy.fullName} · source {job.source?.name ?? "Import"} · duplicates:{" "}
              {POLICY_INFO[job.duplicatePolicy].label.toLowerCase()}
            </p>
          </div>
          {(job.status === "PROCESSING" || !finished) && <CancelButton jobId={job.id} onDone={reload} disabled={Boolean(job.cancelRequestedAt)} />}
        </div>
        {job.status === "PROCESSING" || job.status === "VALIDATING" ? <ImportProgress job={job} /> : null}
        {finished ? <ImportResultSummary job={job} /> : <ImportCounts job={job} mode={job.status === "PROCESSING" ? "outcome" : "validation"} />}
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Rows</h2>
        {reviewing && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            Flagged rows weren&apos;t imported. Select rows, then choose: <strong>Create new lead</strong>, <strong>Update the matching lead</strong> (fills only empty fields; needs exactly one match), or{" "}
            <strong>Skip</strong>.
          </div>
        )}
        {message && <p className="text-sm text-zinc-700 dark:text-zinc-200">{message}</p>}
        <ImportRowsTable
          jobId={job.id}
          mode={finished || job.status === "PROCESSING" ? "result" : "preview"}
          filter={activeFilter}
          onFilterChange={(f) => {
            setFilter(f);
            setSelected([]);
          }}
          refreshKey={refreshKey}
          selection={reviewing ? { selectedIds: selected, onChange: setSelected } : undefined}
          toolbar={
            reviewing && selected.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-sm text-zinc-600 dark:text-zinc-300">{selected.length} selected</span>
                <Button onClick={() => review("CREATE")} isLoading={busy === "CREATE"} disabled={Boolean(busy)}>
                  Create new lead
                </Button>
                <Button variant="secondary" onClick={() => review("UPDATE")} isLoading={busy === "UPDATE"} disabled={Boolean(busy)}>
                  Update matching lead
                </Button>
                <Button variant="secondary" onClick={() => review("SKIP")} isLoading={busy === "SKIP"} disabled={Boolean(busy)}>
                  Skip
                </Button>
              </div>
            ) : undefined
          }
        />
      </section>
    </div>
  );
}

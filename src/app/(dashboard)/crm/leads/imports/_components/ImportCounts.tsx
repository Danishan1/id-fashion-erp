import type { ImportJobDto } from "./import-types";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" | "indigo" }) {
  const color =
    tone === "green" ? "text-green-700 dark:text-green-400" : tone === "amber" ? "text-amber-700 dark:text-amber-400" : tone === "red" ? "text-red-700 dark:text-red-400" : tone === "indigo" ? "text-indigo-700 dark:text-indigo-300" : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString("en-IN")}</dd>
    </div>
  );
}

/** Validation counts (before import) or outcome counts (after). */
export function ImportCounts({ job, mode }: { job: ImportJobDto; mode: "validation" | "outcome" }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Total rows" value={job.totalRows} />
      {mode === "validation" ? (
        <>
          <Stat label="Valid" value={job.validRows} tone="green" />
          <Stat label="Warnings" value={job.warningRows} tone="amber" />
          <Stat label="Errors" value={job.errorRows} tone="red" />
          <Stat label="Possible duplicates" value={job.duplicateRows} tone="amber" />
        </>
      ) : (
        <>
          <Stat label="Imported" value={job.importedRows} tone="green" />
          <Stat label="Updated" value={job.updatedRows} tone="indigo" />
          <Stat label="Skipped" value={job.skippedRows} />
          <Stat label="Flagged" value={job.flaggedRows} tone="amber" />
          <Stat label="Failed" value={job.failedRows} tone="red" />
        </>
      )}
    </dl>
  );
}

export function ImportProgress({ job }: { job: ImportJobDto }) {
  const validating = job.status === "VALIDATING";
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-zinc-900 dark:text-zinc-50">{validating ? "Checking rows…" : job.cancelRequestedAt ? "Stopping after the current batch…" : "Importing…"}</span>
        {!validating && (
          <span className="tabular-nums text-zinc-600 dark:text-zinc-300">
            {job.percent}% · {job.processedRows.toLocaleString("en-IN")} / {job.totalRows.toLocaleString("en-IN")}
          </span>
        )}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full bg-indigo-600 transition-all ${validating ? "w-1/3 animate-pulse" : ""}`} style={validating ? undefined : { width: `${job.percent}%` }} />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">This runs in the background — you can leave this page and come back from Import History.</p>
    </div>
  );
}

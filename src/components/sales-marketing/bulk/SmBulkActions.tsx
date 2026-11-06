"use client";

import Link from "next/link";
import { BulkActionsButton } from "@/components/bulk/BulkActionsButton";

export const SM_BULK_JOBS_PAGE = "/sales-marketing/bulk-jobs";
export const SM_BULK_SCHEDULES_PAGE = "/sales-marketing/bulk-jobs?tab=schedules";

/** Builds the list API's query string for "all records matching the current filters" (blank values dropped). */
export function bulkFilterQuery(params: Record<string, string | undefined | null | false>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, String(v));
  return sp.toString();
}

/**
 * Phase 14 (S&M) — the bulk-actions entry point on Sales & Marketing lists:
 * the shared BulkActionsButton (actions, dry run, schedules come from the
 * server registry) pointed at Sales & Marketing → Bulk jobs.
 */
export function SmBulkActions({ entityType, selectedIds, filterQuery, onDone }: { entityType: string; selectedIds: string[]; filterQuery: string; onDone?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {selectedIds.length > 0 && (
        <span className="text-xs text-zinc-500">
          {selectedIds.length} selected ·{" "}
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={onDone}>
            clear
          </button>
        </span>
      )}
      <BulkActionsButton entityType={entityType} selectedIds={selectedIds} filterQuery={filterQuery} onSubmitted={onDone} jobsPath={SM_BULK_JOBS_PAGE} schedulesPath={SM_BULK_SCHEDULES_PAGE} />
      <Link href={SM_BULK_JOBS_PAGE} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
        Bulk jobs
      </Link>
    </div>
  );
}

/** Checkbox cell helpers for the hand-built S&M tables (promotions, attribution models). */
export function toggleId(ids: string[], id: string, on: boolean) {
  return on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
}

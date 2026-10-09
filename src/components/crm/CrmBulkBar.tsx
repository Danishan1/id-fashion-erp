import type { ReactNode } from "react";

/** Shown above a table while rows are selected. */
export function CrmBulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-500/30 dark:bg-indigo-500/10">
      <span className="text-sm font-medium text-indigo-800 dark:text-indigo-200">{count} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <button type="button" onClick={onClear} className="ml-auto text-sm text-indigo-700 hover:underline dark:text-indigo-300">
        Clear selection
      </button>
    </div>
  );
}

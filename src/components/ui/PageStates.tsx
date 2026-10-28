import type { ReactNode } from "react";

/**
 * The three standard non-content states, matching UI_RULES.md §5–§7: plain
 * "Loading…" text (no spinner/skeleton), a dashed box for an empty panel that
 * says *why* it is empty, and a red message with a retry action. Inside a
 * DataTable the table's own states are used instead.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
      {label}
    </p>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Try again
        </button>
      )}
    </div>
  );
}

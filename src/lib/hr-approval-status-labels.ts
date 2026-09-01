/**
 * Shared {PENDING, APPROVED, REJECTED} status map for Leave Requests and
 * Attendance Corrections — two unrelated route folders with the identical
 * 3-value approval-workflow enum. Both previously rendered the completely
 * bare raw enum value with zero label or color treatment at all (the worst
 * instance of this bug class found in the whole app) — placed under `src/lib/`
 * rather than owned by either folder, since neither is the canonical source
 * for the other.
 */
export const STATUS_LABELS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
};

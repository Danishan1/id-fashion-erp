export const STATUS_LABELS = {
  // OPEN means zero lines have been issued or escalated yet — every line is
  // still genuinely pending action, so "Pending" reads clearer to a
  // merchandiser/warehouse user than the more generic "Open".
  OPEN: "Pending",
  PARTIALLY_FULFILLED: "Partially Fulfilled",
  FULFILLED: "Fulfilled",
  CLOSED: "Closed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  OPEN: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PARTIALLY_FULFILLED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  FULFILLED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

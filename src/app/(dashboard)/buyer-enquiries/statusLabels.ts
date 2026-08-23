export const STATUS_LABELS = {
  OPEN: "Open",
  PARTIALLY_CONVERTED: "Partially Converted",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  OPEN: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PARTIALLY_CONVERTED: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

export const LINE_STATUS_LABELS = {
  PENDING_REVIEW: "Pending Review",
  APPROVED_FOR_SAMPLING: "Approved for Sampling",
  ON_HOLD: "On Hold",
  REJECTED: "Rejected",
  CONVERTED: "Converted",
} as const;

export const LINE_STATUS_BADGE_CLASS: Record<keyof typeof LINE_STATUS_LABELS, string> = {
  PENDING_REVIEW: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  APPROVED_FOR_SAMPLING: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  CONVERTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
};

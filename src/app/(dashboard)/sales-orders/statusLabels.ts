export const STATUS_LABELS = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  IN_PRODUCTION: "In Production",
  PARTIALLY_DISPATCHED: "Partially Dispatched",
  DISPATCHED: "Dispatched",
  INVOICED: "Invoiced",
  CLOSED: "Closed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  CONFIRMED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  IN_PRODUCTION: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  PARTIALLY_DISPATCHED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  DISPATCHED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  INVOICED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

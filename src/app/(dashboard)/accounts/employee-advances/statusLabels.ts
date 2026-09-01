export const STATUS_LABELS = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_SETTLED: "Partially Settled",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  ISSUED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  PARTIALLY_SETTLED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  SETTLED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

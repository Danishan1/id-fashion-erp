export const STATUS_LABELS = {
  COMPLETED: "Completed",
  PARTIALLY_REVERSED: "Partially Reversed",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  PARTIALLY_REVERSED: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  CANCELLED: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-700 dark:text-zinc-400",
};

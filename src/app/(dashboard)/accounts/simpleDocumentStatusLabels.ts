/**
 * Shared {DRAFT, POSTED, CANCELLED} status map for Accounts' simple 3-state
 * documents (Payments, Journals) — both previously hard-coded the identical
 * 3-branch color ternary inline (4 times project-wide, counting Sales/
 * Purchase Invoice's own separate 6-state version in invoiceStatusLabels.ts)
 * and rendered the raw enum value with no human label at all. One shared
 * file here, following the established per-module statusLabels.ts shape
 * (STATUS_LABELS/STATUS_BADGE_CLASS) used everywhere else in this app.
 */
export const STATUS_LABELS = {
  DRAFT: "Draft",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-700 dark:text-zinc-400",
};

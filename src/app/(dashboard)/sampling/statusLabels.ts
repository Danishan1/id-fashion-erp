export const STATUS_LABELS = {
  DRAFT: "Draft",
  REQUESTED: "Requested",
  TECH_PACK_READY: "Tech Pack Ready",
  IN_DEVELOPMENT: "In Development",
  INTERNAL_QC: "Internal QC",
  SUBMITTED_TO_CUSTOMER: "Submitted to Customer",
  CUSTOMER_FEEDBACK_RECEIVED: "Feedback Received",
  REVISION_REQUESTED: "Revision Requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REQUESTED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  TECH_PACK_READY: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  IN_DEVELOPMENT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  INTERNAL_QC: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  SUBMITTED_TO_CUSTOMER: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  CUSTOMER_FEEDBACK_RECEIVED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  REVISION_REQUESTED: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

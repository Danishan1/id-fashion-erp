export const STATUS_LABELS = {
  PLANNED: "Planned",
  MATERIAL_ALLOCATED: "Material Allocated",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
  CLOSED: "Closed",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  PLANNED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  MATERIAL_ALLOCATED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  IN_PROGRESS: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
};

export const LOT_STATUS_LABELS = {
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  SPLIT: "Split",
  MERGED: "Merged",
  CANCELLED: "Cancelled",
} as const;

export const JOB_ORDER_STATUS_LABELS = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  PARTIALLY_COMPLETED: "Partially Completed",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const JOB_WORK_ORDER_STATUS_LABELS = {
  ISSUED: "Issued",
  PARTIALLY_RECEIVED: "Partially Received",
  FULLY_RECEIVED: "Fully Received",
  CLOSED: "Closed",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const JOB_WORK_ORDER_STATUS_BADGE_CLASS: Record<keyof typeof JOB_WORK_ORDER_STATUS_LABELS, string> = {
  ISSUED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  PARTIALLY_RECEIVED: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  FULLY_RECEIVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

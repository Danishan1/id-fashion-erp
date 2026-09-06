export const STATUS_LABELS = {
  IDEA: "Idea",
  REFERENCE_ANALYSIS: "Analysis",
  DESIGN_DEVELOPMENT: "Design Development",
  DESIGN_SELECTED: "Design Selected",
  TECHNICAL_DEVELOPMENT: "Technical Development",
  COSTING: "Costing",
  SAMPLING: "Sampling",
  BUYER_REVIEW: "Buyer Review",
  APPROVED: "Approved",
  PRODUCTION: "Production",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  IDEA: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REFERENCE_ANALYSIS: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  DESIGN_DEVELOPMENT: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  DESIGN_SELECTED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  TECHNICAL_DEVELOPMENT: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  COSTING: "bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  SAMPLING: "bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  BUYER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  PRODUCTION: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  COMPLETED: "bg-green-200 text-green-800 dark:bg-green-500/20 dark:text-green-200",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  ON_HOLD: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  CANCELLED: "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 line-through",
};

export const SOURCE_TYPE_LABELS = {
  REFERENCE: "From Reference",
  FABRIC: "From Fabric",
} as const;

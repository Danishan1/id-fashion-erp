/**
 * Shared 6-state status map for Sales Invoice and Purchase Invoice (both
 * share the identical DRAFT/POSTED/PARTIALLY_PAID/PAID/CLOSED/CANCELLED
 * enum). Both list pages and the Sales Invoice detail panel previously
 * hard-coded the same 3-branch (POSTED/CANCELLED/else) color ternary and
 * rendered the raw enum value with no label — the "else" branch silently
 * conflated DRAFT, PARTIALLY_PAID, PAID, and CLOSED into one raw-text amber
 * badge (the detail panel's own STATUS_STYLES only had 3 real entries too,
 * so PARTIALLY_PAID/PAID/CLOSED got no color at all there). Colors follow
 * this app's established converged badge convention (DESIGN_SYSTEM.md §1),
 * mirroring the semantic progression already used by Sales Order's own
 * statusLabels.ts (draft=zinc, early/posted=blue, needs-attention=amber,
 * success terminal=green, cancelled=zinc+line-through).
 */
export const STATUS_LABELS = {
  DRAFT: "Draft",
  POSTED: "Posted",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
} as const;

export const STATUS_BADGE_CLASS: Record<keyof typeof STATUS_LABELS, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  POSTED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  PARTIALLY_PAID: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  PAID: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CLOSED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-700 dark:text-zinc-400",
};

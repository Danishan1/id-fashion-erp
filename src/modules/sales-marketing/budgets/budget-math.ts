/**
 * Campaign budget arithmetic (Sales & Marketing Phase 12) — pure, no database.
 * Inputs are the finance records already linked to the campaign; nothing is
 * copied out of Finance, so a figure can always be traced back to its document.
 *
 *   Approved   = the campaign's approved planned budget (Phase 08 revision); null = none approved
 *   Allocated  = Σ allocation-line amounts (active and closed)
 *   Actual     = Σ linked Expenses in APPROVED / PARTIALLY_PAID / PAID (amount, before GST)
 *              + Σ Purchase Invoices in POSTED / PARTIALLY_PAID / PAID / CLOSED (subtotal × exchange rate, before GST)
 *                (an invoice without its own campaign counts for its purchase order's campaign and budget line)
 *   Committed  = Σ over linked Purchase Orders in APPROVED / SENT_TO_SUPPLIER / PARTIALLY_RECEIVED /
 *                FULLY_RECEIVED / ON_HOLD of max(0, PO base total − posted invoices against it)
 *                (so an invoice moves money from Committed to Actual — never counted twice)
 *   Pipeline   = not yet counted: Expenses PENDING_APPROVAL + Purchase Orders in DRAFT + Purchase Invoices in DRAFT
 *   Remaining  = Approved − Actual − Committed
 *   Used %     = (Actual + Committed) ÷ Approved × 100
 * Per allocation line the same formulas apply with the line's amount as the limit;
 * spend linked to the campaign without a line shows under "Not allocated".
 */

export const SPENT_EXPENSE = ["APPROVED", "PARTIALLY_PAID", "PAID"] as const;
export const PIPELINE_EXPENSE = ["PENDING_APPROVAL"] as const;
export const POSTED_INVOICE = ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"] as const;
export const COMMITTED_PO = ["APPROVED", "SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "ON_HOLD"] as const;
export const NOT_ALLOCATED = "-";

const r2 = (v: number) => Math.round(v * 100) / 100;
const has = (list: readonly string[], v: string) => list.includes(v);

export interface ExpenseIn {
  amount: number;
  status: string;
  allocationId: string | null;
}
export interface PurchaseOrderIn {
  id: string;
  status: string;
  baseTotal: number;
  allocationId: string | null;
}
export interface InvoiceIn {
  /** Base amount before GST (subtotal × exchange rate). */
  baseSubtotal: number;
  status: string;
  purchaseOrderId: string | null;
  /** Allocation after inheritance from the purchase order. */
  allocationId: string | null;
  /** Counted as this campaign's spend (own campaign, or inherited). */
  counts: boolean;
}

export interface BudgetFigures {
  limit: number | null;
  actual: number;
  committed: number;
  pipeline: number;
  remaining: number | null;
  usedPercent: number | null;
}

export interface BudgetComputation extends BudgetFigures {
  allocated: number;
  unallocatedLimit: number | null;
  byAllocation: Record<string, BudgetFigures>;
}

function figures(limit: number | null, actual: number, committed: number, pipeline: number): BudgetFigures {
  return {
    limit: limit === null ? null : r2(limit),
    actual: r2(actual),
    committed: r2(committed),
    pipeline: r2(pipeline),
    remaining: limit === null ? null : r2(limit - actual - committed),
    usedPercent: limit === null || limit <= 0 ? null : Math.round(((actual + committed) / limit) * 1000) / 10,
  };
}

/**
 * `invoicedByPo` = posted invoices against each linked PO (base subtotal), whatever
 * campaign the invoice itself names — they're what releases the commitment.
 */
export function computeBudget(input: {
  approved: number | null;
  allocations: { id: string; amount: number }[];
  expenses: ExpenseIn[];
  purchaseOrders: PurchaseOrderIn[];
  invoices: InvoiceIn[];
  invoicedByPo: Record<string, number>;
}): BudgetComputation {
  const keys = [...input.allocations.map((a) => a.id), NOT_ALLOCATED];
  const acc = Object.fromEntries(keys.map((k) => [k, { actual: 0, committed: 0, pipeline: 0 }])) as Record<string, { actual: number; committed: number; pipeline: number }>;
  const bucket = (id: string | null) => acc[id && acc[id] ? id : NOT_ALLOCATED];

  for (const e of input.expenses) {
    if (has(SPENT_EXPENSE, e.status)) bucket(e.allocationId).actual += e.amount;
    else if (has(PIPELINE_EXPENSE, e.status)) bucket(e.allocationId).pipeline += e.amount;
  }
  for (const i of input.invoices) {
    if (!i.counts) continue;
    if (has(POSTED_INVOICE, i.status)) bucket(i.allocationId).actual += i.baseSubtotal;
    else if (i.status === "DRAFT") bucket(i.allocationId).pipeline += i.baseSubtotal;
  }
  for (const po of input.purchaseOrders) {
    if (has(COMMITTED_PO, po.status)) bucket(po.allocationId).committed += Math.max(0, po.baseTotal - (input.invoicedByPo[po.id] ?? 0));
    else if (po.status === "DRAFT") bucket(po.allocationId).pipeline += po.baseTotal;
  }

  const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
  const total = Object.values(acc).reduce((s, v) => ({ actual: s.actual + v.actual, committed: s.committed + v.committed, pipeline: s.pipeline + v.pipeline }), { actual: 0, committed: 0, pipeline: 0 });
  const unallocatedLimit = input.approved === null ? null : Math.max(0, input.approved - allocated);
  const byAllocation: Record<string, BudgetFigures> = {};
  for (const a of input.allocations) byAllocation[a.id] = figures(a.amount, acc[a.id].actual, acc[a.id].committed, acc[a.id].pipeline);
  const na = acc[NOT_ALLOCATED];
  byAllocation[NOT_ALLOCATED] = figures(unallocatedLimit, na.actual, na.committed, na.pipeline);
  return { ...figures(input.approved, total.actual, total.committed, total.pipeline), allocated: r2(allocated), unallocatedLimit: unallocatedLimit === null ? null : r2(unallocatedLimit), byAllocation };
}

// ── Alerts ───────────────────────────────────────────────────────

export type BudgetAlertKind = "WARN_THRESHOLD" | "OVER_BUDGET" | "OVER_ALLOCATED" | "ENDED_WITH_OPEN_COMMITMENTS";
export interface AlertCondition {
  scopeKey: string;
  kind: BudgetAlertKind;
  message: string;
  basis: Record<string, unknown>;
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * The alert conditions true right now. Evaluating twice with the same figures
 * gives the same (scopeKey, kind) set, so stored alerts are raised once and
 * cleared when the condition goes away — never repeated for an unchanged state.
 * Over budget replaces the warning (never both for one scope).
 */
export function budgetAlertConditions(input: {
  computation: BudgetComputation;
  allocations: { id: string; name: string }[];
  warnPercent: number;
  ended: boolean;
}): AlertCondition[] {
  const out: AlertCondition[] = [];
  const c = input.computation;
  const check = (scopeKey: string, label: string, f: BudgetFigures) => {
    if (f.limit === null || f.limit <= 0) return;
    const used = f.actual + f.committed;
    const basis = { limit: f.limit, actual: f.actual, committed: f.committed, usedPercent: f.usedPercent };
    if (used > f.limit + 0.004) out.push({ scopeKey, kind: "OVER_BUDGET", message: `${label} is over budget: ${inr(used)} spent or committed against ${inr(f.limit)}.`, basis });
    else if ((f.usedPercent ?? 0) >= input.warnPercent) out.push({ scopeKey, kind: "WARN_THRESHOLD", message: `${label} has used ${f.usedPercent}% of ${inr(f.limit)} (warning at ${input.warnPercent}%).`, basis: { ...basis, warnPercent: input.warnPercent } });
  };
  check(NOT_ALLOCATED, "The campaign", c);
  for (const a of input.allocations) if (c.byAllocation[a.id]) check(a.id, `Budget line "${a.name}"`, c.byAllocation[a.id]);
  if (c.limit !== null && c.allocated > c.limit + 0.004) {
    out.push({ scopeKey: NOT_ALLOCATED, kind: "OVER_ALLOCATED", message: `Budget lines add up to ${inr(c.allocated)}, more than the approved ${inr(c.limit)}. Reduce or move a line.`, basis: { allocated: c.allocated, limit: c.limit } });
  }
  if (input.ended && c.committed > 0) {
    out.push({ scopeKey: NOT_ALLOCATED, kind: "ENDED_WITH_OPEN_COMMITMENTS", message: `The campaign has ended but ${inr(c.committed)} of purchase orders are still not invoiced.`, basis: { committed: c.committed } });
  }
  return out;
}

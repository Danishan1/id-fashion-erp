/**
 * Rounds a currency amount to 2 decimal places, closing the recurring
 * IEEE-754-noise bug class this project has hit repeatedly: summing many
 * `Decimal`-derived JS numbers (via `Number(someDecimal)`) drifts, producing
 * values like `49.600000000000364` or, worse, a genuine `0` rendered as raw
 * scientific notation (`1.0658141036401503e-14`). Apply this at the point
 * every currency total/running-balance/per-row amount is computed — not
 * just the final aggregate row, which earlier point-fixes (Customer Ledger,
 * Balance Sheet's own summary row) mistakenly treated as sufficient (Phase
 * 10 QA pass: the same noise recurred in Trial Balance/General Ledger/
 * Balance Sheet per-line items, Day Book, Sales/Purchase registers, and
 * Customer/Supplier Outstanding — all traced to this one root cause).
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  // Normalize -0 to 0 — Math.round can produce -0 for a tiny negative input
  // (e.g. -1.46e-11), and while it prints/serializes identically to 0 in
  // practice, Object.is(-0, 0) is false, which is exactly the kind of
  // surprising inequality this helper exists to prevent.
  return rounded === 0 ? 0 : rounded;
}

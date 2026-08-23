/**
 * Consistent 2-decimal-place formatting for money fields across the UI.
 * `Number(x).toLocaleString()` alone renders a fluctuating number of
 * decimals (5302.5 -> "5,302.5", 1080 -> "1,080"), which looks inconsistent
 * on the same screen. Always pin currency amounts to exactly 2 decimals.
 */
export function formatCurrency(amount: number | string): string {
  return Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

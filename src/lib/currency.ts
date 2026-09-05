/**
 * Consistent 2-decimal-place formatting for money fields across the UI.
 * `Number(x).toLocaleString()` alone renders a fluctuating number of
 * decimals (5302.5 -> "5,302.5", 1080 -> "1,080"), which looks inconsistent
 * on the same screen. Always pin currency amounts to exactly 2 decimals.
 *
 * The locale is pinned to "en-IN" explicitly, not left as `undefined` —
 * `undefined` resolves to the *running process's own* default locale, which
 * a Node server and a browser frequently disagree on (this app's server
 * process can resolve differently from a viewer's own Windows locale). For
 * any amount >= 100,000 that produces a different digit grouping (Indian
 * lakh/crore grouping vs. Western thousands grouping) that disagreement is
 * a real React hydration-mismatch error for a Server Component (or a Client
 * Component rendering server-passed data immediately) that renders this
 * value. "en-IN" matches the locale `ReportTable.tsx` already hardcodes for
 * the same reason — one convention, not two.
 */
export function formatCurrency(amount: number | string): string {
  return Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Plain (non-currency) number formatting — counts, quantities, etc. Same
 * pinned-locale reasoning as `formatCurrency` above: a bare
 * `Number(x).toLocaleString()` with no locale argument resolves against the
 * running process's own default, which a Server Component render (or a
 * Client Component rendering server-passed data immediately) can disagree
 * on between SSR and hydration.
 */
export function formatNumber(value: number | string, options?: Intl.NumberFormatOptions): string {
  return Number(value).toLocaleString("en-IN", options);
}

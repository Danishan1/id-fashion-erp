/**
 * Deterministic date/time formatting — always resolves to the exact same
 * string regardless of which locale/timezone the running process (Node
 * server vs. browser) defaults to. Bare `.toLocaleDateString()`/
 * `.toLocaleString()` resolve against the *runtime's own* default locale and
 * timezone; when a Server Component (or a Client Component rendering data
 * present on first render, not behind a mount-gated empty state) renders one
 * directly, the SSR pass and the client hydration pass can legitimately
 * disagree — the server process defaults to en-US, this app's actual
 * viewers are on en-GB/en-IN-formatting Windows machines — producing a real
 * React hydration-mismatch error. Pinning both the locale and the timezone
 * removes the disagreement at the source instead of merely suppressing the
 * warning about it.
 *
 * Locale is pinned to "en-IN" — matching the one place in this codebase
 * that already made a deliberate, hardcoded locale choice for exactly this
 * reason (`ReportTable.tsx`'s currency/number formatting) — rather than
 * introducing a second, differing convention. The timezone is pinned to
 * Asia/Kolkata (IST) since this is an India-based business — this also
 * matches the UTC-day-boundary discipline already established for report
 * date-range filtering elsewhere in this codebase.
 */
const LOCALE = "en-IN";
const TIME_ZONE = "Asia/Kolkata";

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, { timeZone: TIME_ZONE });
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(LOCALE, { timeZone: TIME_ZONE });
}

export function formatTime(value: string | Date): string {
  return new Date(value).toLocaleTimeString(LOCALE, { timeZone: TIME_ZONE });
}

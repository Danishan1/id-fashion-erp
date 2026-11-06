/**
 * Formats a Date as a plain "YYYY-MM-DD" string using its LOCAL calendar
 * components — never `.toISOString()`, which converts through UTC first and
 * silently lands a day early for part of the local day on any timezone ahead
 * of UTC (e.g. IST, UTC+5:30). This exact bug class (ERP-BUG-0001, Phase 10
 * QA pass) has been found and fixed repeatedly across this project — this is
 * the shared, canonical version of the fix, replacing what had drifted into
 * 3 separate hand-copied local implementations (SamplingFilters.tsx,
 * crm/page.tsx and the since-removed Marketing channel report) plus ~26 separate
 * `new Date().toISOString().slice(0, 10)` "today" defaults that had the bug
 * outright rather than a local fix.
 */
export function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date as "YYYY-MM-DD", from local calendar components — see `toIsoDate()`. */
export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

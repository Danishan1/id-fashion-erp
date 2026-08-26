/**
 * Shared date-range filter parser for every report's `dateFrom`/`dateTo`
 * query params — previously copy-pasted independently across ~15 report
 * files (`parseDateRange()` in each of `accounts.reports.ts`,
 * `sales-orders.reports.ts`, `production.reports.ts`, etc.), each applying
 * `dateTo` as an inclusive `lte: new Date(dateTo)` bound.
 *
 * That's correct for a genuine `@db.Date` column (e.g. `SalesInvoice.invoiceDate`)
 * — both the stored value and `new Date("2026-08-24")` land on the identical
 * UTC midnight, so `lte` includes exactly that day. It's wrong for a plain
 * `DateTime` column (e.g. `JobOrder.createdAt`, `QcInspection.inspectedAt`,
 * `InventoryTransaction.performedAt`) — `new Date("2026-08-24")` is the very
 * START of that day in UTC, so `lte` excludes almost the entire selected end
 * date (ERP-BUG-R01, Phase 10 QA pass, confirmed live: filtering "today" on
 * Rework Report and QC Inspection Register silently dropped same-day rows).
 *
 * `dateToExclusive` (dateTo + 1 day) sidesteps the column-type distinction
 * entirely: `lt: dateToExclusive` includes the whole selected end date for
 * BOTH column types, since a `@db.Date` value can never reach the next day's
 * midnight either. Every report should filter with `lt: dateToExclusive`,
 * never `lte: dateTo`.
 */
export function parseReportDateRange(filters: Record<string, string>): { dateFrom?: Date; dateToExclusive?: Date } {
  const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : undefined;
  let dateToExclusive: Date | undefined;
  if (filters.dateTo) {
    const dateTo = new Date(filters.dateTo);
    dateToExclusive = new Date(dateTo.getTime() + 24 * 60 * 60 * 1000);
  }
  return { dateFrom, dateToExclusive };
}

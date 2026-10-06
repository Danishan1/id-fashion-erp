/**
 * Business-day boundaries for CRM date filters. Dates in filters are calendar
 * days as the (India-based) team sees them, so "2026-10-01" means 00:00–23:59
 * Asia/Kolkata — the same zone the UI formats in (lib/date-format.ts).
 */
const BUSINESS_UTC_OFFSET = "+05:30";

export function businessDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000${BUSINESS_UTC_OFFSET}`);
}

export function businessDayEnd(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999${BUSINESS_UTC_OFFSET}`);
}

export function businessDayRange(range: { from?: string; to?: string } | undefined): { gte?: Date; lte?: Date } | undefined {
  if (!range || (!range.from && !range.to)) return undefined;
  return { ...(range.from ? { gte: businessDayStart(range.from) } : {}), ...(range.to ? { lte: businessDayEnd(range.to) } : {}) };
}

/** Today's calendar date (YYYY-MM-DD) in the business time zone. */
export function businessToday(now: Date = new Date()): string {
  return new Date(now.getTime() + (5 * 60 + 30) * 60_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD plus `days` calendar days. */
export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A calendar-date column (`@db.Date`, stored at UTC midnight) between two YYYY-MM-DD dates, inclusive. */
export function calendarDateRange(range: { from?: string; to?: string } | undefined): { gte?: Date; lte?: Date } | undefined {
  if (!range || (!range.from && !range.to)) return undefined;
  return { ...(range.from ? { gte: new Date(`${range.from}T00:00:00.000Z`) } : {}), ...(range.to ? { lte: new Date(`${range.to}T00:00:00.000Z`) } : {}) };
}

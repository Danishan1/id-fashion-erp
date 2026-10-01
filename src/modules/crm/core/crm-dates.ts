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

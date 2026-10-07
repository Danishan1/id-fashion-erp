import { addCalendarDays, businessDateParts, businessDateTime, businessDayEnd, businessDayStart, businessToday } from "../core/crm-dates";
import { ALL_DAY_REMINDER_HOUR, isOpenStatus, OPEN_STATUSES, type DueFilter, type DueState } from "./activity-registry";

/**
 * Client-safe due-date logic for activities, always in the business time
 * zone (crm-dates.ts — the same zone every CRM date filter uses). Overdue is
 * derived from due_at / all_day / status and never stored:
 *   timed item   → overdue once its due time has passed
 *   all-day item → overdue once its due day has ended
 */

export interface DueFields {
  status: string;
  dueAt: Date | string | null;
  allDay: boolean;
}

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

export function dueState(a: DueFields, now: Date = new Date()): DueState {
  if (a.status === "COMPLETED") return "COMPLETED";
  if (a.status === "CANCELLED") return "CANCELLED";
  if (a.status === "NO_SHOW") return "NO_SHOW";
  if (!a.dueAt) return "NO_DUE_DATE";
  const due = toDate(a.dueAt);
  const today = businessToday(now);
  const dueDay = businessDateParts(due).date;
  if (a.allDay ? dueDay < today : due.getTime() < now.getTime()) return "OVERDUE";
  if (dueDay === today) return "DUE_TODAY";
  if (dueDay === addCalendarDays(today, 1)) return "DUE_TOMORROW";
  return "UPCOMING";
}

export const isOverdue = (a: DueFields, now: Date = new Date()) => isOpenStatus(a.status) && dueState(a, now) === "OVERDUE";

/** Due instant from a business date + optional time (no time = all-day, stored at the day's start). */
export function dueFromParts(date: string, time?: string | null): { dueAt: Date; allDay: boolean } {
  return time ? { dueAt: businessDateTime(date, time), allDay: false } : { dueAt: businessDayStart(date), allDay: true };
}

/** When the reminder fires: N minutes before the due time (all-day items: before 09:00 on the due day). */
export function reminderTime(dueAt: Date, allDay: boolean, offsetMinutes: number): Date {
  const base = allDay ? businessDateTime(businessDateParts(dueAt).date, `${String(ALL_DAY_REMINDER_HOUR).padStart(2, "0")}:00`) : dueAt;
  return new Date(base.getTime() - offsetMinutes * 60_000);
}

/** Display form, e.g. { date: "2026-10-10", time: "11:00" } (time null for all-day). */
export function dueParts(dueAt: Date | string | null, allDay: boolean) {
  if (!dueAt) return null;
  const p = businessDateParts(toDate(dueAt));
  return { date: p.date, time: allDay ? null : p.time };
}

/**
 * Prisma-shaped `where` fragment for a quick due filter (server side). Open
 * means an open status (pending / in progress, or an open appointment).
 */
export function dueFilterWhere(filter: DueFilter, now: Date = new Date()): Record<string, unknown> {
  const open = { status: { in: [...OPEN_STATUSES] } };
  const today = businessToday(now);
  const tomorrow = addCalendarDays(today, 1);
  const todayStart = businessDayStart(today);
  const todayEnd = businessDayEnd(today);
  switch (filter) {
    case "overdue":
      return { AND: [open, { OR: [{ allDay: false, dueAt: { lt: now } }, { allDay: true, dueAt: { lt: todayStart } }] }] };
    case "today":
      return { AND: [open, { OR: [{ allDay: true, dueAt: { gte: todayStart, lte: todayEnd } }, { allDay: false, dueAt: { gte: now, lte: todayEnd } }] }] };
    case "tomorrow":
      return { AND: [open, { dueAt: { gte: businessDayStart(tomorrow), lte: businessDayEnd(tomorrow) } }] };
    case "upcoming":
      return { AND: [open, { dueAt: { gt: todayEnd } }] };
    case "no_due_date":
      return { AND: [open, { dueAt: null }] };
    case "completed":
      return { status: "COMPLETED" };
  }
}

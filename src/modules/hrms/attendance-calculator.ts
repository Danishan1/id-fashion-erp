/**
 * Attendance calculation engine — pure, deterministic, client-safe.
 *
 * Ported from the old system's utils/attendanceCalculator.js plus the
 * day-status rule from its salary.js (see docs/hrms/ATTENDANCE_MODULE_PLAN.md).
 * Every day boundary is Asia/Kolkata (IST, fixed +05:30, no DST).
 */

export const IST_OFFSET_MS = 330 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Used when an employee has no shift assigned (old team summary used 8 h). */
export const DEFAULT_SHIFT_HOURS = 8;
/** Old system: a session longer than this is flagged (not capped). */
export const DEFAULT_MAX_SESSION_HOURS = 18;
/** Old system: 0.251 h tolerance on every status band. */
export const DEFAULT_STATUS_TOLERANCE_MINUTES = 15;
/** Old system: geofence radius default and minimum, in metres. */
export const DEFAULT_RADIUS_METERS = 100;
export const MIN_RADIUS_METERS = 10;
export const EARTH_RADIUS_METERS = 6_371_000;

export const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

// ─── IST dates ───────────────────────────────────────────────

/** "YYYY-MM-DD" of the instant in IST. */
export function istDateKey(d: Date | number): string {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "HH:mm" of the instant in IST. */
export function istTimeString(d: Date | number): string {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** UTC instants of IST midnight .. next IST midnight for a date key. */
export function istDayRange(dateKey: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** A `@db.Date` value for a date key (UTC midnight, how Prisma stores DATE). */
export function dateKeyToDbDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/** Date key of a `@db.Date` value read back from Prisma. */
export function dbDateToKey(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

/** The instant for "HH:mm" IST on a date key. */
export function istTimeOnDate(dateKey: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - IST_OFFSET_MS + (h * 60 + m) * 60 * 1000);
}

export function isValidDateKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(Date.parse(`${key}T00:00:00.000Z`)) && new Date(`${key}T00:00:00.000Z`).toISOString().slice(0, 10) === key;
}

export function isValidHhmm(v: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

export function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(dateKey: string): Weekday {
  return WEEKDAYS[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()];
}

/** Every date key from..to inclusive. */
export function dateKeysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthDateKeys(year: number, month: number): string[] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => addDays(first, i));
}

// ─── Sessions & hours ────────────────────────────────────────

export interface Interval {
  start: number;
  end: number;
}

/** Old mergeIntervals(): union of intervals, so overlap is never counted twice. */
export function mergeIntervals(intervals: Interval[]): { merged: Interval[]; totalMs: number } {
  const valid = intervals.filter((i) => i && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start).sort((a, b) => a.start - b.start);
  if (valid.length === 0) return { merged: [], totalMs: 0 };
  const merged: Interval[] = [];
  let current = { ...valid[0] };
  for (let i = 1; i < valid.length; i++) {
    const next = valid[i];
    if (next.start <= current.end) current.end = Math.max(current.end, next.end);
    else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return { merged, totalMs: merged.reduce((sum, i) => sum + (i.end - i.start), 0) };
}

export interface SessionTimes {
  id?: string;
  checkInAt: Date | string;
  checkOutAt: Date | string | null;
}

export interface DayHours {
  /** Union of closed sessions. */
  finalizedHours: number;
  /** Union including an open session up to `now`. */
  liveHours: number;
  hasOpenSession: boolean;
  /** Closed sessions longer than the max (flagged, still counted — as old). */
  excessiveSessionIds: string[];
  firstIn: Date | null;
  lastOut: Date | null;
}

export function computeDayHours(sessions: SessionTimes[], now: Date = new Date(), maxSessionHours = DEFAULT_MAX_SESSION_HOURS): DayHours {
  const closed: Interval[] = [];
  const live: Interval[] = [];
  const excessive: string[] = [];
  let hasOpen = false;
  let firstIn: number | null = null;
  let lastOut: number | null = null;
  for (const s of sessions) {
    const start = new Date(s.checkInAt).getTime();
    if (firstIn === null || start < firstIn) firstIn = start;
    if (s.checkOutAt) {
      const end = new Date(s.checkOutAt).getTime();
      if (end <= start) continue; // invalid, excluded
      if (lastOut === null || end > lastOut) lastOut = end;
      if (end - start > maxSessionHours * HOUR_MS && s.id) excessive.push(s.id);
      closed.push({ start, end });
      live.push({ start, end });
    } else {
      hasOpen = true;
      if (now.getTime() > start) live.push({ start, end: now.getTime() });
    }
  }
  return {
    finalizedHours: round2(mergeIntervals(closed).totalMs / HOUR_MS),
    liveHours: round2(mergeIntervals(live).totalMs / HOUR_MS),
    hasOpenSession: hasOpen,
    excessiveSessionIds: excessive,
    firstIn: firstIn === null ? null : new Date(firstIn),
    lastOut: lastOut === null ? null : new Date(lastOut),
  };
}

/** Old overlap rule: (startA < endB) AND (endA > startB). An open session runs to +infinity. */
export function intervalsOverlap(a: { start: number; end: number | null }, b: { start: number; end: number | null }): boolean {
  const aEnd = a.end ?? Number.POSITIVE_INFINITY;
  const bEnd = b.end ?? Number.POSITIVE_INFINITY;
  return a.start < bEnd && aEnd > b.start;
}

/** The first existing session that overlaps the proposed one (excluding `excludeId`). */
export function findConflictingSession<T extends SessionTimes & { id: string }>(proposed: { checkInAt: Date; checkOutAt: Date | null }, existing: T[], excludeId?: string): T | null {
  const p = { start: proposed.checkInAt.getTime(), end: proposed.checkOutAt ? proposed.checkOutAt.getTime() : null };
  for (const s of existing) {
    if (s.id === excludeId) continue;
    const e = { start: new Date(s.checkInAt).getTime(), end: s.checkOutAt ? new Date(s.checkOutAt).getTime() : null };
    if (intervalsOverlap(p, e)) return s;
  }
  return null;
}

/** Validation shared by regularization and admin correction. Returns an error message or null. */
export function validateSessionTimes(checkInAt: Date, checkOutAt: Date | null, maxSessionHours = DEFAULT_MAX_SESSION_HOURS): string | null {
  if (Number.isNaN(checkInAt.getTime())) return "Check-in time is not valid.";
  if (!checkOutAt) return null;
  if (Number.isNaN(checkOutAt.getTime())) return "Check-out time is not valid.";
  if (checkOutAt.getTime() <= checkInAt.getTime()) return "Check-out time must be after check-in time.";
  if (checkOutAt.getTime() - checkInAt.getTime() > maxSessionHours * HOUR_MS) return `A session cannot be longer than ${maxSessionHours} hours.`;
  return null;
}

// ─── Shift, status, overtime, late ───────────────────────────

/** Shift length in hours from "HH:mm" start/end; overnight shifts wrap +24 h. Null when no shift. */
export function shiftHoursFromTimes(startTime: string | null | undefined, endTime: string | null | undefined): number | null {
  if (!startTime || !endTime || !isValidHhmm(startTime) || !isValidHhmm(endTime)) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return round2(minutes / 60);
}

export type DayStatusBand = "FULL" | "SEMI" | "HALF" | "LOW";

export const DAY_STATUS_LABELS: Record<DayStatusBand, string> = {
  FULL: "Full Present",
  SEMI: "Semi-full Present",
  HALF: "Half Present",
  LOW: "Low Hours",
};

/**
 * Old salary.js rule: worked hours against expected (shift) hours, each band
 * lowered by the tolerance. Returns the present/absent fraction for the day.
 */
export function computeDayStatus(workedHours: number, expectedHours: number, toleranceMinutes = DEFAULT_STATUS_TOLERANCE_MINUTES): { band: DayStatusBand; present: number; absent: number } {
  const tol = toleranceMinutes / 60;
  if (workedHours >= expectedHours - tol) return { band: "FULL", present: 1, absent: 0 };
  if (workedHours >= expectedHours * 0.75 - tol) return { band: "SEMI", present: 0.75, absent: 0.25 };
  if (workedHours >= expectedHours * 0.5 - tol) return { band: "HALF", present: 0.5, absent: 0.5 };
  return { band: "LOW", present: 0, absent: 1 };
}

/** OT = worked − shift. No shift → no overtime (fix F6). */
export function computeOvertimeHours(workedHours: number, shiftHours: number | null): number {
  if (shiftHours === null || shiftHours <= 0) return 0;
  return round2(Math.max(0, workedHours - shiftHours));
}

/** Late against the shift start + grace, in IST (fix F16: no server-local time). */
export function computeIsLateIst(punchIn: Date | null, shiftStartTime: string | null | undefined, graceMinutes = 0): boolean | null {
  if (!punchIn || !shiftStartTime || !isValidHhmm(shiftStartTime)) return null;
  const cutoff = istTimeOnDate(istDateKey(punchIn), shiftStartTime).getTime() + graceMinutes * 60 * 1000;
  return punchIn.getTime() > cutoff;
}

// ─── Geofence ────────────────────────────────────────────────

/** Old isValidCoordinate(): in range and not the (0,0) fallback. */
export function isValidCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Old radius rule: max(10, radius), default 100. */
export function effectiveRadius(radiusMeters: number | null | undefined): number {
  return radiusMeters && radiusMeters > 0 ? Math.max(MIN_RADIUS_METERS, radiusMeters) : DEFAULT_RADIUS_METERS;
}

export interface GeoLocation {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/**
 * Checks a point against every location. Returns the nearest location the
 * point is inside (nearest wins), or — when outside all — the nearest one
 * with its distance, for the audit trail.
 */
export function evaluateGeofence<T extends GeoLocation>(lat: number, lng: number, locations: T[]): { inside: boolean; location: T | null; distanceMeters: number | null } {
  let nearestInside: { location: T; distance: number } | null = null;
  let nearest: { location: T; distance: number } | null = null;
  for (const loc of locations) {
    if (!isValidCoordinate(loc.latitude, loc.longitude)) continue;
    const distance = haversineMeters(lat, lng, loc.latitude, loc.longitude);
    if (!nearest || distance < nearest.distance) nearest = { location: loc, distance };
    if (distance <= effectiveRadius(loc.radiusMeters) && (!nearestInside || distance < nearestInside.distance)) nearestInside = { location: loc, distance };
  }
  const pick = nearestInside ?? nearest;
  return { inside: !!nearestInside, location: pick?.location ?? null, distanceMeters: pick ? Math.round(pick.distance) : null };
}

// ─── Leave ───────────────────────────────────────────────────

export const LEAVE_DURATION_FRACTIONS = {
  FULL: 1,
  F_HALF: 0.5,
  S_HALF: 0.5,
  QR1: 0.25,
  QR2: 0.25,
  QR3: 0.25,
  QR4: 0.25,
} as const;
export type LeaveDuration = keyof typeof LEAVE_DURATION_FRACTIONS;

export const LEAVE_DURATION_LABELS: Record<LeaveDuration, string> = {
  FULL: "Full Day",
  F_HALF: "First Half",
  S_HALF: "Second Half",
  QR1: "Quarter 1",
  QR2: "Quarter 2",
  QR3: "Quarter 3",
  QR4: "Quarter 4",
};

/** Fix F1: the real fraction, not always 1. */
export function leaveFraction(duration: LeaveDuration): number {
  return LEAVE_DURATION_FRACTIONS[duration];
}

/**
 * Old approval rule: PAID when remaining + carryForward covers the fraction;
 * deduct from remaining first, then carryForward. Otherwise NOT_PAID.
 */
export function planLeaveDeduction(fraction: number, remaining: number, carryForward: number): { paymentType: "PAID" | "NOT_PAID"; fromRemaining: number; fromCarry: number } {
  if (remaining + carryForward + 1e-9 < fraction) return { paymentType: "NOT_PAID", fromRemaining: 0, fromCarry: 0 };
  const fromRemaining = round2(Math.min(remaining, fraction));
  return { paymentType: "PAID", fromRemaining, fromCarry: round2(fraction - fromRemaining) };
}

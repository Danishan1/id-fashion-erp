/**
 * Client-safe time-zone helpers (Phase 10 — appointments). Instants are
 * stored as UTC timestamps; a time zone (IANA name, e.g. "Asia/Kolkata",
 * "Europe/London") is the context a wall-clock time was entered in and is
 * displayed in. All conversion uses the runtime's Intl time-zone database
 * (the same ICU data the browser and Node use) — no hand-written DST rules.
 *
 * The ERP's business zone stays Asia/Kolkata (crm-dates.ts, date-format.ts).
 */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/** A short list offered first in pickers; any valid IANA zone is accepted. */
export const COMMON_TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Dhaka",
  "Asia/Kathmandu",
  "Asia/Colombo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Africa/Johannesburg",
  "UTC",
] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Every zone the runtime knows (falls back to the common list). */
export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : [...list, "UTC"];
  } catch {
    /* older runtime */
  }
  return [...COMMON_TIME_ZONES];
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface ZonedParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

/** Wall-clock date and time of an instant in a time zone. */
export function zonedParts(at: Date | string | number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${year}-${pad(month)}-${pad(day)}`, time: `${pad(hour)}:${pad(minute)}`, year, month, day, hour, minute, weekday: WEEKDAYS[get("weekday")] ?? 0 };
}

/** UTC offset of a zone at an instant, in minutes (IST = +330, London summer = +60). */
export function zoneOffsetMinutes(at: Date | number, timeZone: string): number {
  const d = new Date(at);
  const p = formatter(timeZone).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

export class NonexistentLocalTimeError extends Error {
  constructor(date: string, time: string, timeZone: string) {
    super(`${date} ${time} does not exist in ${timeZone} (the clocks change that day). Choose another time.`);
    this.name = "NonexistentLocalTimeError";
  }
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` `time`.
 * A time skipped by a daylight-saving change throws NonexistentLocalTimeError;
 * a repeated time (clocks going back) resolves to its first occurrence.
 */
export function zonedToInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // A zone changes offset at most once around any wall time: the offsets 12 h
  // either side cover both readings. Keep the ones that round-trip.
  const offsets = new Set([zoneOffsetMinutes(wall - 43_200_000, timeZone), zoneOffsetMinutes(wall, timeZone), zoneOffsetMinutes(wall + 43_200_000, timeZone)]);
  const valid = [...offsets]
    .map((o) => wall - o * 60_000)
    .filter((t) => {
      const p = zonedParts(t, timeZone);
      return p.date === date && p.time === time;
    });
  if (!valid.length) throw new NonexistentLocalTimeError(date, time, timeZone);
  return new Date(Math.min(...valid));
}

/** YYYY-MM-DD plus n days (calendar arithmetic, zone-independent). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday, for a YYYY-MM-DD. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn = 1): string {
  return addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7));
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function daysInMonth(date: string): number {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The instant a calendar day starts in a zone (midnight; DST-safe — a zone with no midnight that day uses its first valid minute). */
export function zonedDayStart(date: string, timeZone: string): Date {
  try {
    return zonedToInstant(date, "00:00", timeZone);
  } catch {
    return zonedToInstant(date, "01:00", timeZone);
  }
}

/** "11:00 AM" style label in a zone. */
export function formatZonedTime(at: Date | string, timeZone: string): string {
  return new Date(at).toLocaleTimeString("en-IN", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
}

/** "Wed, 15 Oct 2026" style label in a zone. */
export function formatZonedDate(at: Date | string, timeZone: string): string {
  return new Date(at).toLocaleDateString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Short zone label — "IST", "BST", "EDT", "GST" where a locale knows one, else "GMT+5:30" style. */
export function zoneAbbreviation(at: Date | string, timeZone: string): string {
  const names = ["en-IN", "en-GB", "en-US"].map((locale) => new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(new Date(at)).find((x) => x.type === "timeZoneName")?.value ?? "");
  return names.find((n) => n && !/^GMT[+-]/.test(n)) ?? names[0] ?? timeZone;
}

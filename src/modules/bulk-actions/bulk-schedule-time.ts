/**
 * Phase 14 (S&M) — when a saved bulk schedule runs next. Pure (no DB) so it can
 * be unit-tested. Schedules are kept in India time (Asia/Kolkata = UTC+05:30,
 * no daylight saving), so the offset is fixed; any other timezone is refused
 * at save time rather than computed wrongly.
 */

export type ScheduleFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface ScheduleRule {
  frequency: ScheduleFrequency;
  /** "HH:MM", 24-hour, local time. */
  timeOfDay: string;
  /** 1 = Monday … 7 = Sunday (WEEKLY). */
  dayOfWeek?: number | null;
  /** 1–28 (MONTHLY) — capped at 28 so every month has the day. */
  dayOfMonth?: number | null;
}

export const SCHEDULE_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MIN = 330;
const MIN = 60_000;
const DAY = 86_400_000;

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

function parseTime(t: string): { h: number; m: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!match) throw new Error(`Invalid time "${t}".`);
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** The first run strictly after `after` (a UTC instant). */
export function nextScheduleRunAt(rule: ScheduleRule, after: Date): Date {
  const { h, m } = parseTime(rule.timeOfDay);
  // "Local" instants are represented as UTC dates shifted by the offset.
  const localAfter = new Date(after.getTime() + IST_OFFSET_MIN * MIN);
  const startOfLocalDay = Date.UTC(localAfter.getUTCFullYear(), localAfter.getUTCMonth(), localAfter.getUTCDate());
  for (let d = 0; d <= 62; d++) {
    const day = new Date(startOfLocalDay + d * DAY);
    const isoDow = ((day.getUTCDay() + 6) % 7) + 1;
    if (rule.frequency === "WEEKLY" && isoDow !== rule.dayOfWeek) continue;
    if (rule.frequency === "MONTHLY" && day.getUTCDate() !== rule.dayOfMonth) continue;
    const runUtc = day.getTime() + (h * 60 + m) * MIN - IST_OFFSET_MIN * MIN;
    if (runUtc > after.getTime()) return new Date(runUtc);
  }
  throw new Error("No run found within two months — check the schedule rule.");
}

/** "Daily at 07:30 IST", "Every Monday at 09:00 IST", "Monthly on day 1 at 06:00 IST". */
export function describeSchedule(rule: ScheduleRule): string {
  const at = `at ${rule.timeOfDay} IST`;
  if (rule.frequency === "DAILY") return `Daily ${at}`;
  if (rule.frequency === "WEEKLY") return `Every ${DAY_NAMES[(rule.dayOfWeek ?? 1) - 1]} ${at}`;
  return `Monthly on day ${rule.dayOfMonth} ${at}`;
}

import type { SalesTargetPeriodTypeKey } from "./performance-registry";

/**
 * Target periods and attainment maths (Phase 05). Pure and client-safe:
 * works on "YYYY-MM-DD" strings and month numbers only, so no time zone can
 * move a boundary. Quarters and years follow the company's fiscal year start
 * month (Company.fiscalYearStartMonth, 1 = January). PHASE_05 §5–§6.
 */

export interface Period {
  type: SalesTargetPeriodTypeKey;
  start: string;
  end: string;
  label: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LENGTH: Record<SalesTargetPeriodTypeKey, number> = { MONTH: 1, QUARTER: 3, YEAR: 12 };

const pad = (n: number) => String(n).padStart(2, "0");
const mod = (a: number, n: number) => ((a % n) + n) % n;

function parse(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Not a date: ${iso}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Month index (year*12 + month-1) → first / last day. */
const firstDay = (idx: number) => `${Math.floor(idx / 12)}-${pad(mod(idx, 12) + 1)}-01`;
const lastDay = (idx: number) => {
  const y = Math.floor(idx / 12);
  const m = mod(idx, 12) + 1;
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
};

function checkFiscal(fiscalStartMonth: number) {
  if (!Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12) throw new Error(`Bad fiscal start month ${fiscalStartMonth}`);
}

function startIndex(type: SalesTargetPeriodTypeKey, monthIdx: number, fiscalStartMonth: number): number {
  if (type === "MONTH") return monthIdx;
  return monthIdx - mod(monthIdx - (fiscalStartMonth - 1), LENGTH[type]);
}

function fiscalYearLabel(fyStartIdx: number, fiscalStartMonth: number): string {
  const y = Math.floor(fyStartIdx / 12);
  return fiscalStartMonth === 1 ? String(y) : `FY ${y}-${pad((y + 1) % 100)}`;
}

export function periodLabel(type: SalesTargetPeriodTypeKey, start: string, fiscalStartMonth: number): string {
  const { y, m } = parse(start);
  const idx = y * 12 + (m - 1);
  if (type === "MONTH") return `${MONTH_NAMES[m - 1]} ${y}`;
  const fyStart = startIndex("YEAR", idx, fiscalStartMonth);
  if (type === "YEAR") return fiscalYearLabel(fyStart, fiscalStartMonth);
  const q = Math.floor((idx - fyStart) / 3) + 1;
  return `Q${q} ${fiscalYearLabel(fyStart, fiscalStartMonth)}`;
}

/** The whole period of `type` that contains `date`. */
export function periodContaining(type: SalesTargetPeriodTypeKey, date: string, fiscalStartMonth: number): Period {
  checkFiscal(fiscalStartMonth);
  const { y, m } = parse(date);
  const s = startIndex(type, y * 12 + (m - 1), fiscalStartMonth);
  const start = firstDay(s);
  return { type, start, end: lastDay(s + LENGTH[type] - 1), label: periodLabel(type, start, fiscalStartMonth) };
}

/** True when `start` is the first day of a `type` period. */
export function isPeriodStart(type: SalesTargetPeriodTypeKey, start: string, fiscalStartMonth: number): boolean {
  try {
    return periodContaining(type, start, fiscalStartMonth).start === start;
  } catch {
    return false;
  }
}

/** The period `offset` periods after (negative = before) the one containing `date`. */
export function shiftPeriod(type: SalesTargetPeriodTypeKey, date: string, offset: number, fiscalStartMonth: number): Period {
  const { y, m } = parse(periodContaining(type, date, fiscalStartMonth).start);
  return periodContaining(type, firstDay(y * 12 + (m - 1) + offset * LENGTH[type]), fiscalStartMonth);
}

/** Periods around today for pickers: `back` before, the current one, `ahead` after (newest first). */
export function periodOptions(type: SalesTargetPeriodTypeKey, today: string, fiscalStartMonth: number, back = 12, ahead = 3): Period[] {
  const out: Period[] = [];
  for (let i = ahead; i >= -back; i--) out.push(shiftPeriod(type, today, i, fiscalStartMonth));
  return out;
}

const dayNumber = (iso: string) => {
  const { y, m, d } = parse(iso);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

export interface PeriodProgress {
  state: "UPCOMING" | "CURRENT" | "ENDED";
  totalDays: number;
  /** Days from the start up to and including today (0 if upcoming, total if ended). */
  elapsedDays: number;
  remainingDays: number;
}

export function periodProgress(start: string, end: string, today: string): PeriodProgress {
  const totalDays = dayNumber(end) - dayNumber(start) + 1;
  if (today < start) return { state: "UPCOMING", totalDays, elapsedDays: 0, remainingDays: totalDays };
  if (today > end) return { state: "ENDED", totalDays, elapsedDays: totalDays, remainingDays: 0 };
  const elapsedDays = dayNumber(today) - dayNumber(start) + 1;
  return { state: "CURRENT", totalDays, elapsedDays, remainingDays: totalDays - elapsedDays };
}

export interface Attainment {
  target: number | null;
  actual: number;
  /** target − actual; negative = over target. Null without a target. */
  gap: number | null;
  /** actual ÷ target × 100, 1 dp. Null when there is no approved target or it is 0. */
  percent: number | null;
  /** Target × elapsed share, for the current period only. */
  expectedToDate: number | null;
  /** AHEAD / BEHIND (current period), MET / MISSED (ended), null otherwise. */
  pace: "AHEAD" | "BEHIND" | "MET" | "MISSED" | null;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function attainment(target: number | null, actual: number, progress: PeriodProgress): Attainment {
  if (target === null) return { target: null, actual, gap: null, percent: null, expectedToDate: null, pace: null };
  const percent = target > 0 ? Math.round((actual / target) * 1000) / 10 : null;
  let expectedToDate: number | null = null;
  let pace: Attainment["pace"] = null;
  if (progress.state === "CURRENT" && target > 0) {
    expectedToDate = r2((target * progress.elapsedDays) / progress.totalDays);
    pace = actual >= expectedToDate ? "AHEAD" : "BEHIND";
  } else if (progress.state === "ENDED" && target > 0) {
    pace = actual >= target ? "MET" : "MISSED";
  }
  return { target, actual, gap: r2(target - actual), percent, expectedToDate, pace };
}

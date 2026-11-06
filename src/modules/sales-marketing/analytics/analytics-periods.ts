/**
 * Phase 17 — relative periods for saved reports, dashboards and scheduled
 * deliveries ("last month" stays last month at every run). Pure and
 * client-safe; dates are India dates (Asia/Kolkata), inclusive.
 */

export const PERIOD_PRESETS = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  last_quarter: "Last quarter",
  year_to_date: "Calendar year to date",
  this_fiscal_year: "This financial year",
  last_fiscal_year: "Last financial year",
  last_12_months: "Last 12 full months",
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Today's date in India. */
export function indiaToday(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Resolves a preset against "today" (India date) and the company's fiscal-year start month. */
export function resolvePreset(preset: PeriodPreset, today: string, fiscalStartMonth = 4): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const back = (days: number) => new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
  switch (preset) {
    case "last_7_days":
      return { from: back(6), to: today };
    case "last_30_days":
      return { from: back(29), to: today };
    case "this_month":
      return { from: iso(y, m, 1), to: today };
    case "last_month": {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)) };
    }
    case "this_quarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: iso(y, qm, 1), to: today };
    }
    case "last_quarter": {
      let qm = Math.floor((m - 1) / 3) * 3 + 1 - 3;
      let qy = y;
      if (qm < 1) {
        qm += 12;
        qy -= 1;
      }
      return { from: iso(qy, qm, 1), to: iso(qy, qm + 2, lastDay(qy, qm + 2)) };
    }
    case "year_to_date":
      return { from: iso(y, 1, 1), to: today };
    case "this_fiscal_year": {
      const fy = m >= fiscalStartMonth ? y : y - 1;
      return { from: iso(fy, fiscalStartMonth, 1), to: today };
    }
    case "last_fiscal_year": {
      const fy = (m >= fiscalStartMonth ? y : y - 1) - 1;
      const endY = fiscalStartMonth === 1 ? fy : fy + 1;
      const endM = fiscalStartMonth === 1 ? 12 : fiscalStartMonth - 1;
      return { from: iso(fy, fiscalStartMonth, 1), to: iso(endY, endM, lastDay(endY, endM)) };
    }
    case "last_12_months": {
      const ey = m === 1 ? y - 1 : y;
      const em = m === 1 ? 12 : m - 1;
      const sm = ((em - 12 + 12) % 12) + 1;
      const sy = sm > em ? ey - 1 : ey;
      return { from: iso(sy, sm, 1), to: iso(ey, em, lastDay(ey, em)) };
    }
  }
}

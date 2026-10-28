import { todayIst } from "../../attendance/_shared/attendance-ui";

/** Previous month (salary is normally worked on after the month ends), as YYYY-MM. */
export function previousMonthKey(): string {
  const t = todayIst();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const ADJUSTMENT_MODE_LABELS: Record<string, string> = {
  FIXED_HOURS: "Fixed hours",
  OFFICE_TIME: "Office time",
  FULL_DAY: "Full day",
};

"use client";

/** Colours for the month grids (old AttendanceRecords.jsx: Present green, Absent red, Half yellow, Leave blue, Outside purple). */
export const DAY_CODE_STYLES: Record<string, { label: string; cell: string }> = {
  P: { label: "Present", cell: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" },
  SP: { label: "Present 0.75", cell: "bg-lime-100 text-lime-800 dark:bg-lime-900/50 dark:text-lime-200" },
  HP: { label: "Half Present", cell: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" },
  LH: { label: "Low Hours", cell: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200" },
  A: { label: "Absent", cell: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200" },
  L: { label: "Leave", cell: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200" },
  H: { label: "Holiday", cell: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
  W: { label: "Weekly Off", cell: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  S: { label: "Sandwich (absent)", cell: "bg-rose-200 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200" },
  "-": { label: "Not counted", cell: "bg-white text-zinc-300 dark:bg-zinc-900 dark:text-zinc-600" },
};

export function DayCodeLegend() {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {Object.entries(DAY_CODE_STYLES)
        .filter(([k]) => k !== "-")
        .map(([code, s]) => (
          <span key={code} className={`rounded px-1.5 py-0.5 ${s.cell}`}>
            {code} = {s.label}
          </span>
        ))}
      <span className="rounded px-1.5 py-0.5 ring-2 ring-violet-500">Outside punch</span>
    </div>
  );
}

export interface MonthDay {
  dateKey: string;
  weekday: string;
  code: string;
  workedHours: number;
  firstIn: string | null;
  lastOut: string | null;
  isLate: boolean | null;
  isOutside: boolean;
  holidayName: string | null;
  leaveLabel: string | null;
  leaveFraction: number;
  bandLabel: string | null;
  present: number;
  absent: number;
  isSandwich: boolean;
}

export interface MonthSummary {
  workingDays: number;
  weekendDays: number;
  holidayDays: number;
  sandwichDays: number;
  presentDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  extraPayableDays: number;
  lateDays: number;
  outsideDays: number;
  totalHours: number;
  approvedOvertimeHours: number;
  pendingOvertimeHours: number;
}

export function monthInputValue(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

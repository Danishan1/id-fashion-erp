import { prisma } from "@/core/db/client";
import {
  DAY_STATUS_LABELS,
  DEFAULT_SHIFT_HOURS,
  addDays,
  computeDayHours,
  computeDayStatus,
  computeIsLateIst,
  dateKeyToDbDate,
  dateKeysBetween,
  istDateKey,
  monthDateKeys,
  round2,
  shiftHoursFromTimes,
  weekdayOf,
  type DayStatusBand,
  type Weekday,
} from "./attendance-calculator";
import { effectiveWeekends, getAttendanceSettings, type EffectiveAttendanceSettings } from "./attendance-settings.service";

/**
 * One engine for every month view (personal calendar, team grid, dashboard
 * counts, salary sheet) so they can never disagree. Ported from the old
 * getAllUserAttendanceForOneMonth / salary.js day logic:
 *  - workday status from hours vs shift hours (Full / 0.75 / Half / Low)
 *  - holidays and weekly offs are paid; working on them is extra payable
 *  - a weekly off / holiday between two leave-or-absent days is a
 *    "sandwich" day (counted absent instead of paid)
 *  - leave days combine with worked hours (fraction of the day)
 *  - only granted, taken leave counts (fix F10)
 */

export type DayCode = "P" | "SP" | "HP" | "LH" | "A" | "L" | "H" | "W" | "S" | "-";

export const DAY_CODE_LABELS: Record<DayCode, string> = {
  P: "Present",
  SP: "Present 0.75",
  HP: "Half Present",
  LH: "Low Hours",
  A: "Absent",
  L: "Leave",
  H: "Holiday",
  W: "Weekly Off",
  S: "Sandwich (absent)",
  "-": "Not counted",
};

export interface AttendanceDay {
  dateKey: string;
  weekday: Weekday;
  isFuture: boolean;
  isPreJoining: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isWeekend: boolean;
  isSandwich: boolean;
  sessionCount: number;
  firstIn: string | null;
  lastOut: string | null;
  hasOpenSession: boolean;
  workedHours: number;
  expectedHours: number;
  band: DayStatusBand | null;
  bandLabel: string | null;
  isLate: boolean | null;
  isOutside: boolean;
  leaveFraction: number;
  paidLeaveFraction: number;
  unpaidLeaveFraction: number;
  leaveLabel: string | null;
  /** Fractions for this day (sum to 1 on a counted workday). */
  present: number;
  absent: number;
  /** Paid weekly-off / holiday credit (0 or 1). */
  paidOff: number;
  /** Extra payable for working on a weekly off / holiday. */
  extraPayable: number;
  code: DayCode;
  /** Real worked hours (workedHours differs only when a salary adjustment applies). */
  actualWorkedHours: number;
  /** Active salary-only adjustment, set only when `applySalaryAdjustments` is on. */
  salaryAdjustment: { id: string; mode: "FIXED_HOURS" | "OFFICE_TIME" | "FULL_DAY"; hours: number | null; reason: string } | null;
}

export interface ComputeMonthOptions {
  /**
   * Salary Management (2026-10-28): apply the salary-only overlay from
   * hrms_salary_attendance_adjustments. Off for every attendance screen, so
   * those always show the real punches.
   */
  applySalaryAdjustments?: boolean;
}

export interface AttendanceMonthSummary {
  calendarDays: number;
  countedDays: number;
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
  zeroHourWorkdays: number;
  approvedOvertimeHours: number;
  pendingOvertimeHours: number;
}

export interface EmployeeMonth {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    shift: { name: string; startTime: string; endTime: string } | null;
    joinDate: Date | null;
    fixedMonthlySalary: number | null;
    travelAllowance: number | null;
    dearnessAllowance: number | null;
    overtimeRatePerHour: number | null;
  };
  days: AttendanceDay[];
  summary: AttendanceMonthSummary;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export async function computeEmployeesMonth(
  companyId: string,
  employeeIds: string[],
  year: number,
  month: number,
  now: Date = new Date(),
  options: ComputeMonthOptions = {}
): Promise<EmployeeMonth[]> {
  if (employeeIds.length === 0) return [];
  const settings = await getAttendanceSettings(companyId);
  const monthKeys = monthDateKeys(year, month);
  // Look a week either side so sandwich days at the month edge see their neighbours.
  const fromKey = addDays(monthKeys[0], -7);
  const toKey = addDays(monthKeys[monthKeys.length - 1], 7);
  const range = { gte: dateKeyToDbDate(fromKey), lte: dateKeyToDbDate(toKey) };

  const [employees, holidays, records, leaveDays, legacyLeaves, overtime, adjustments] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId, id: { in: employeeIds } },
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        joinDate: true,
        fixedMonthlySalary: true,
        travelAllowance: true,
        dearnessAllowance: true,
        shift: { select: { name: true, startTime: true, endTime: true, graceMinutes: true } },
        attendanceProfile: { select: { useCompanyWeekends: true, weekends: true, overtimeRatePerHour: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.holidayMaster.findMany({ where: { companyId, isActive: true, date: range }, select: { date: true, name: true } }),
    prisma.attendanceRecord.findMany({
      where: { companyId, employeeId: { in: employeeIds }, attendanceDate: range },
      select: { employeeId: true, attendanceDate: true, sessions: { select: { id: true, checkInAt: true, checkOutAt: true, status: true, isLoginFromOffice: true, isLogoutFromOffice: true } } },
    }),
    prisma.leaveDay.findMany({
      where: { companyId, employeeId: { in: employeeIds }, leaveDate: range, taken: true, leaveRequest: { status: "APPROVED" } },
      select: { employeeId: true, leaveDate: true, fraction: true, paymentType: true, durationType: true, leaveRequest: { select: { leaveType: { select: { name: true } } } } },
    }),
    // Leave approved before the per-day model existed: whole days, treated as paid.
    prisma.leaveRequest.findMany({
      where: { companyId, employeeId: { in: employeeIds }, status: "APPROVED", days: { none: {} }, startDate: { lte: range.lte }, endDate: { gte: range.gte } },
      select: { employeeId: true, startDate: true, endDate: true, leaveType: { select: { name: true } } },
    }),
    prisma.overtimeRecord.findMany({
      where: { companyId, employeeId: { in: employeeIds }, attendanceDate: { gte: dateKeyToDbDate(monthKeys[0]), lte: dateKeyToDbDate(monthKeys[monthKeys.length - 1]) } },
      select: { employeeId: true, hours: true, status: true },
    }),
    options.applySalaryAdjustments
      ? prisma.salaryAttendanceAdjustment.findMany({
          where: { companyId, employeeId: { in: employeeIds }, attendanceDate: range, removedAt: null },
          select: { id: true, employeeId: true, attendanceDate: true, mode: true, hours: true, reason: true },
        })
      : Promise.resolve([]),
  ]);
  const adjustmentByKey = new Map<string, (typeof adjustments)[number]>();
  for (const a of adjustments) adjustmentByKey.set(`${a.employeeId}:${a.attendanceDate.toISOString().slice(0, 10)}`, a);

  const holidayByKey = new Map<string, string>();
  for (const h of holidays) holidayByKey.set(h.date.toISOString().slice(0, 10), h.name);
  const todayKey = istDateKey(now);

  return employees.map((e) => {
    const weekends = new Set(effectiveWeekends(settings, e.attendanceProfile));
    const shiftHours = shiftHoursFromTimes(e.shift?.startTime, e.shift?.endTime);
    const expectedHours = shiftHours ?? DEFAULT_SHIFT_HOURS;
    const joinKey = e.joinDate ? e.joinDate.toISOString().slice(0, 10) : null;

    const sessionsByKey = new Map<string, (typeof records)[number]["sessions"]>();
    for (const r of records) if (r.employeeId === e.id) sessionsByKey.set(r.attendanceDate.toISOString().slice(0, 10), r.sessions);

    const leaveByKey = new Map<string, { fraction: number; paid: number; unpaid: number; names: Set<string> }>();
    const addLeave = (key: string, fraction: number, paid: boolean | null, name: string) => {
      const cur = leaveByKey.get(key) ?? { fraction: 0, paid: 0, unpaid: 0, names: new Set<string>() };
      cur.fraction += fraction;
      if (paid === false) cur.unpaid += fraction;
      else cur.paid += fraction;
      cur.names.add(name);
      leaveByKey.set(key, cur);
    };
    for (const l of leaveDays) {
      if (l.employeeId !== e.id) continue;
      addLeave(l.leaveDate.toISOString().slice(0, 10), Number(l.fraction), l.paymentType === "NOT_PAID" ? false : true, l.leaveRequest.leaveType.name);
    }
    for (const l of legacyLeaves) {
      if (l.employeeId !== e.id) continue;
      for (const key of dateKeysBetween(l.startDate.toISOString().slice(0, 10), l.endDate.toISOString().slice(0, 10))) addLeave(key, 1, true, l.leaveType.name);
    }

    const allKeys = dateKeysBetween(fromKey, toKey);
    const days: AttendanceDay[] = allKeys.map((key) => {
      const weekday = weekdayOf(key);
      const sessions = sessionsByKey.get(key) ?? [];
      const hours = computeDayHours(sessions, now, settings.maxSessionHours);
      const actualWorked = key === todayKey ? hours.liveHours : hours.finalizedHours;
      const adj = adjustmentByKey.get(`${e.id}:${key}`) ?? null;
      // FIXED_HOURS / OFFICE_TIME replace the hours; FULL_DAY keeps them and forces a full day below.
      const worked = adj && adj.hours !== null && adj.mode !== "FULL_DAY" ? Number(adj.hours) : actualWorked;
      const isFuture = key > todayKey;
      const isPreJoining = !!joinKey && key < joinKey;
      const holidayName = holidayByKey.get(key) ?? null;
      const isHoliday = !!holidayName;
      const isWeekend = weekends.has(weekday);
      const leave = leaveByKey.get(key);
      const leaveFraction = Math.min(1, leave?.fraction ?? 0);
      const paidLeave = Math.min(leaveFraction, leave?.paid ?? 0);
      const unpaidLeave = round2(leaveFraction - paidLeave);
      const isOutside = sessions.some((s) => s.status === "PRESENT_FROM_OUTSIDE" || !s.isLoginFromOffice || !s.isLogoutFromOffice);
      const status =
        adj?.mode === "FULL_DAY"
          ? { band: "FULL" as const, present: 1, absent: 0 }
          : worked > 0
            ? computeDayStatus(worked, expectedHours, settings.statusToleranceMinutes)
            : null;
      const isLate = hours.firstIn ? computeIsLateIst(hours.firstIn, e.shift?.startTime, e.shift?.graceMinutes ?? 0) : null;

      let present = 0;
      let absent = 0;
      let paidOff = 0;
      let extraPayable = 0;
      let code: DayCode = "-";

      if (isFuture || isPreJoining) {
        code = "-";
      } else if (isHoliday || isWeekend) {
        paidOff = 1;
        extraPayable = status ? status.present : 0;
        code = isHoliday ? "H" : "W";
      } else {
        // A workday: leave covers part, hours cover the rest, the remainder is absent.
        const remainingAfterLeave = Math.max(0, 1 - leaveFraction);
        present = status ? Math.min(status.present, remainingAfterLeave) : 0;
        absent = round4(Math.max(0, 1 - leaveFraction - present));
        if (leaveFraction >= 1) code = "L";
        else if (status?.band === "FULL" || (leaveFraction > 0 && present > 0 && absent === 0)) code = leaveFraction > 0 ? "L" : "P";
        else if (status?.band === "SEMI") code = "SP";
        else if (status?.band === "HALF") code = "HP";
        else if (status?.band === "LOW") code = "LH";
        else if (leaveFraction > 0) code = "L";
        else code = "A";
      }

      return {
        dateKey: key,
        weekday,
        isFuture,
        isPreJoining,
        isHoliday,
        holidayName,
        isWeekend,
        isSandwich: false,
        sessionCount: sessions.length,
        firstIn: hours.firstIn?.toISOString() ?? null,
        lastOut: hours.lastOut?.toISOString() ?? null,
        hasOpenSession: hours.hasOpenSession,
        workedHours: round2(worked),
        expectedHours,
        band: status?.band ?? null,
        bandLabel: status ? DAY_STATUS_LABELS[status.band] : null,
        isLate,
        isOutside,
        leaveFraction,
        paidLeaveFraction: round2(paidLeave),
        unpaidLeaveFraction: unpaidLeave,
        leaveLabel: leave ? [...leave.names].join(", ") : null,
        present: round4(present),
        absent,
        paidOff,
        extraPayable,
        code,
        actualWorkedHours: round2(actualWorked),
        salaryAdjustment: adj ? { id: adj.id, mode: adj.mode, hours: adj.hours === null ? null : Number(adj.hours), reason: adj.reason } : null,
      };
    });

    // Sandwich rule: a run of weekly offs / holidays with a fully-absent or
    // full-leave workday on both sides is counted absent, not paid.
    const isOffDay = (d: AttendanceDay) => !d.isFuture && !d.isPreJoining && (d.isHoliday || d.isWeekend);
    const isLeaveOrAbsent = (d: AttendanceDay) => !d.isFuture && !d.isPreJoining && !isOffDay(d) && (d.absent >= 1 || d.leaveFraction >= 1);
    for (let i = 0; i < days.length; i++) {
      if (!isOffDay(days[i])) continue;
      let j = i;
      while (j + 1 < days.length && isOffDay(days[j + 1])) j++;
      const before = days[i - 1];
      const after = days[j + 1];
      if (before && after && isLeaveOrAbsent(before) && isLeaveOrAbsent(after)) {
        for (let k = i; k <= j; k++) {
          if (days[k].extraPayable > 0) continue; // worked that day — not a sandwich
          days[k].isSandwich = true;
          days[k].paidOff = 0;
          days[k].absent = 1;
          days[k].code = "S";
        }
      }
      i = j;
    }

    const inMonth = days.filter((d) => d.dateKey >= monthKeys[0] && d.dateKey <= monthKeys[monthKeys.length - 1]);
    const counted = inMonth.filter((d) => !d.isFuture && !d.isPreJoining);
    const workdays = counted.filter((d) => !d.isHoliday && !d.isWeekend);
    const sum = (f: (d: AttendanceDay) => number) => round2(counted.reduce((s, d) => s + f(d), 0));
    const ot = overtime.filter((o) => o.employeeId === e.id);

    const summary: AttendanceMonthSummary = {
      calendarDays: inMonth.length,
      countedDays: counted.length,
      workingDays: workdays.length,
      weekendDays: counted.filter((d) => d.isWeekend && !d.isHoliday && !d.isSandwich).length,
      holidayDays: counted.filter((d) => d.isHoliday && !d.isSandwich).length,
      sandwichDays: counted.filter((d) => d.isSandwich).length,
      presentDays: sum((d) => d.present),
      paidLeaveDays: round2(workdays.reduce((s, d) => s + d.paidLeaveFraction, 0)),
      unpaidLeaveDays: round2(workdays.reduce((s, d) => s + d.unpaidLeaveFraction, 0)),
      absentDays: sum((d) => d.absent),
      extraPayableDays: sum((d) => d.extraPayable),
      lateDays: workdays.filter((d) => d.isLate === true).length,
      outsideDays: counted.filter((d) => d.isOutside).length,
      totalHours: sum((d) => d.workedHours),
      zeroHourWorkdays: workdays.filter((d) => d.workedHours === 0 && d.leaveFraction === 0).length,
      approvedOvertimeHours: round2(ot.filter((o) => o.status === "APPROVED").reduce((s, o) => s + Number(o.hours), 0)),
      pendingOvertimeHours: round2(ot.filter((o) => o.status === "PENDING").reduce((s, o) => s + Number(o.hours), 0)),
    };

    return {
      employee: {
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        shift: e.shift ? { name: e.shift.name, startTime: e.shift.startTime, endTime: e.shift.endTime } : null,
        joinDate: e.joinDate,
        fixedMonthlySalary: e.fixedMonthlySalary ? Number(e.fixedMonthlySalary) : null,
        travelAllowance: e.travelAllowance ? Number(e.travelAllowance) : null,
        dearnessAllowance: e.dearnessAllowance ? Number(e.dearnessAllowance) : null,
        overtimeRatePerHour: e.attendanceProfile?.overtimeRatePerHour ? Number(e.attendanceProfile.overtimeRatePerHour) : null,
      },
      days: inMonth,
      summary,
    };
  });
}

export function parseMonth(value: string | null | undefined, now: Date = new Date()): { year: number; month: number } {
  const m = value && /^(\d{4})-(\d{2})$/.exec(value);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) };
  const key = istDateKey(now);
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

export type { EffectiveAttendanceSettings };

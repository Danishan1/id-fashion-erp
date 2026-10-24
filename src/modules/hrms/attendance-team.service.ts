import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buildXlsxBuffer, type XlsxColumn } from "@/lib/xlsx";
import { istDateKey, monthDateKeys, round2 } from "./attendance-calculator";
import { computeEmployeesMonth, type EmployeeMonth } from "./attendance-month.service";
import type { HrmsActor } from "./attendance-settings.service";
import { cascadeAvailability, ensureBalance } from "./leave-balance.service";
import { countPendingRegularizations } from "./attendance-correction.service";
import { getHrmsEmployeeScope } from "./hrms-scope";

async function scopedEmployeeIds(actor: HrmsActor, search?: string) {
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance");
  const where: Prisma.EmployeeWhereInput = {
    companyId: actor.companyId,
    isActive: true,
    deletedAt: null,
    ...(scope === null ? {} : { id: { in: scope } }),
    ...(search ? { OR: [{ fullName: { contains: search, mode: "insensitive" } }, { employeeCode: { contains: search, mode: "insensitive" } }] } : {}),
  };
  const rows = await prisma.employee.findMany({ where, select: { id: true }, orderBy: { fullName: "asc" }, take: 2000 });
  return rows.map((r) => r.id);
}

export type TeamDayStatus = "PRESENT" | "OUTSIDE" | "HALF_DAY" | "ON_LEAVE" | "ABSENT" | "NOT_PUNCHED" | "WEEKLY_OFF" | "HOLIDAY" | "NOT_JOINED";

/** Today's (or any day's) team cards + table — old getAttendanceDashboardRecord, with the cards it never filled in. */
export async function getTeamDay(actor: HrmsActor, dateKey: string, now: Date = new Date()) {
  const ids = await scopedEmployeeIds(actor);
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const months = await computeEmployeesMonth(actor.companyId, ids, year, month, now);
  const isToday = dateKey === istDateKey(now);
  const rows = months.map((m) => {
    const d = m.days.find((x) => x.dateKey === dateKey)!;
    let status: TeamDayStatus;
    if (d.isPreJoining) status = "NOT_JOINED";
    else if (d.isHoliday && d.sessionCount === 0) status = "HOLIDAY";
    else if (d.isWeekend && d.sessionCount === 0) status = "WEEKLY_OFF";
    else if (d.leaveFraction >= 1) status = "ON_LEAVE";
    else if (d.sessionCount === 0) status = isToday || d.isFuture ? "NOT_PUNCHED" : d.leaveFraction > 0 ? "ON_LEAVE" : "ABSENT";
    else if (d.isOutside) status = "OUTSIDE";
    else if (!isToday && (d.band === "HALF" || d.band === "LOW" || d.band === "SEMI")) status = "HALF_DAY";
    else status = "PRESENT";
    return { employee: m.employee, day: d, status };
  });
  const count = (s: TeamDayStatus) => rows.filter((r) => r.status === s).length;
  return {
    dateKey,
    isToday,
    cards: {
      total: rows.filter((r) => r.status !== "NOT_JOINED").length,
      present: count("PRESENT"),
      outside: count("OUTSIDE"),
      halfDay: count("HALF_DAY"),
      onLeave: count("ON_LEAVE"),
      absent: count("ABSENT"),
      notPunched: count("NOT_PUNCHED"),
      off: count("WEEKLY_OFF") + count("HOLIDAY"),
      late: rows.filter((r) => r.day.isLate === true).length,
    },
    rows,
  };
}

/** Month grid for the team (old getAllUserAttendanceForOneMonth). */
export async function getTeamMonth(actor: HrmsActor, year: number, month: number, search?: string) {
  const ids = await scopedEmployeeIds(actor, search);
  const months = await computeEmployeesMonth(actor.companyId, ids, year, month);
  return {
    year,
    month,
    dateKeys: monthDateKeys(year, month),
    employees: months.map((m) => ({
      employee: m.employee,
      days: m.days.map((d) => ({ dateKey: d.dateKey, code: d.code, workedHours: d.workedHours, isOutside: d.isOutside, isLate: d.isLate, firstIn: d.firstIn, lastOut: d.lastOut, holidayName: d.holidayName, leaveLabel: d.leaveLabel })),
      summary: m.summary,
    })),
  };
}

export async function exportTeamMonthXlsx(actor: HrmsActor, year: number, month: number, search?: string) {
  const data = await getTeamMonth(actor, year, month, search);
  const columns: XlsxColumn[] = [
    { header: "Code", key: "code", width: 12 },
    { header: "Employee", key: "name", width: 24 },
    ...data.dateKeys.map((k) => ({ header: String(Number(k.slice(8))), key: `d${k}`, width: 5 })),
    { header: "Present", key: "present", type: "number" as const, width: 9 },
    { header: "Paid leave", key: "paidLeave", type: "number" as const, width: 10 },
    { header: "Unpaid leave", key: "unpaidLeave", type: "number" as const, width: 11 },
    { header: "Absent", key: "absent", type: "number" as const, width: 9 },
    { header: "Weekly off", key: "weekend", type: "number" as const, width: 10 },
    { header: "Holiday", key: "holiday", type: "number" as const, width: 9 },
    { header: "Sandwich", key: "sandwich", type: "number" as const, width: 9 },
    { header: "Late", key: "late", type: "number" as const, width: 7 },
    { header: "Hours", key: "hours", type: "number" as const, width: 9 },
    { header: "OT hours (approved)", key: "ot", type: "number" as const, width: 12 },
  ];
  const rows = data.employees.map((e) => ({
    code: e.employee.employeeCode,
    name: e.employee.fullName,
    ...Object.fromEntries(e.days.map((d) => [`d${d.dateKey}`, d.code === "-" ? "" : d.code + (d.isOutside ? "*" : "")])),
    present: e.summary.presentDays,
    paidLeave: e.summary.paidLeaveDays,
    unpaidLeave: e.summary.unpaidLeaveDays,
    absent: e.summary.absentDays,
    weekend: e.summary.weekendDays,
    holiday: e.summary.holidayDays,
    sandwich: e.summary.sandwichDays,
    late: e.summary.lateDays,
    hours: e.summary.totalHours,
    ot: e.summary.approvedOvertimeHours,
  }));
  return buildXlsxBuffer(`Attendance ${year}-${String(month).padStart(2, "0")}`, columns, rows);
}

// ─── Salary sheet (attendance → pay) ─────────────────────────

export interface SalaryRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  grossMonthly: number | null;
  perDay: number | null;
  calendarDays: number;
  presentDays: number;
  paidLeaveDays: number;
  autoPaidLeaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  weekendDays: number;
  holidayDays: number;
  sandwichDays: number;
  extraPayableDays: number;
  payableDays: number;
  deductionDays: number;
  deductionAmount: number | null;
  earnedAmount: number | null;
  approvedOvertimeHours: number;
  overtimeRate: number | null;
  overtimePay: number;
  netPay: number | null;
}

/**
 * Old salary.js, read-only: per-day pay = gross ÷ calendar days; payable =
 * present + paid leave + weekly offs + holidays + extra payable (worked on an
 * off day) + auto paid leave (zero-hour workdays covered by leftover quota);
 * deduction = (absent + unpaid leave) × per day; overtime = approved OT hours
 * of this month only (fix F11) × rate.
 */
function buildSalaryRow(m: EmployeeMonth, availableLeave: number): SalaryRow {
  const s = m.summary;
  const e = m.employee;
  const gross = e.fixedMonthlySalary === null ? null : round2(e.fixedMonthlySalary + (e.travelAllowance ?? 0) + (e.dearnessAllowance ?? 0));
  const perDay = gross === null ? null : gross / s.calendarDays;
  const autoPaid = round2(Math.min(s.zeroHourWorkdays, Math.max(0, availableLeave), s.absentDays));
  const absent = round2(s.absentDays - autoPaid);
  const payableDays = round2(s.presentDays + s.paidLeaveDays + s.weekendDays + s.holidayDays + s.extraPayableDays + autoPaid);
  const deductionDays = round2(absent + s.unpaidLeaveDays);
  const overtimePay = round2(s.approvedOvertimeHours * (e.overtimeRatePerHour ?? 0));
  const earned = perDay === null ? null : round2(payableDays * perDay);
  return {
    employeeId: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    grossMonthly: gross,
    perDay: perDay === null ? null : round2(perDay),
    calendarDays: s.calendarDays,
    presentDays: s.presentDays,
    paidLeaveDays: s.paidLeaveDays,
    autoPaidLeaveDays: autoPaid,
    unpaidLeaveDays: s.unpaidLeaveDays,
    absentDays: absent,
    weekendDays: s.weekendDays,
    holidayDays: s.holidayDays,
    sandwichDays: s.sandwichDays,
    extraPayableDays: s.extraPayableDays,
    payableDays,
    deductionDays,
    deductionAmount: perDay === null ? null : round2(deductionDays * perDay),
    earnedAmount: earned,
    approvedOvertimeHours: s.approvedOvertimeHours,
    overtimeRate: e.overtimeRatePerHour,
    overtimePay,
    netPay: earned === null ? null : round2(earned + overtimePay),
  };
}

async function availableLeaveByEmployee(companyId: string, employeeIds: string[], year: number, month: number) {
  const leaveTypes = await prisma.leaveType.findMany({ where: { companyId, isActive: true }, select: { id: true } });
  const map = new Map<string, number>();
  for (const id of employeeIds) {
    let total = 0;
    for (const t of leaveTypes) {
      const b = await prisma.$transaction((tx) => ensureBalance(tx, companyId, id, t.id, year, month));
      total += Number(b.remaining) + Number(b.carryForward);
    }
    map.set(id, round2(total));
  }
  return map;
}

export async function getSalarySheet(actor: HrmsActor, year: number, month: number) {
  const closed = await prisma.attendanceMonthClose.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } }, include: { company: { select: { id: true } } } });
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance");
  if (closed) {
    const snapshot = closed.snapshotJson as unknown as { rows: SalaryRow[] };
    const rows = scope === null ? snapshot.rows : snapshot.rows.filter((r) => scope.includes(r.employeeId));
    const closedBy = await prisma.user.findUnique({ where: { id: closed.closedByUserId }, select: { fullName: true } });
    return { year, month, isClosed: true, closedAt: closed.closedAt, closedBy: closedBy?.fullName ?? null, pendingRegularizations: 0, monthEnded: true, rows };
  }
  const ids = await scopedEmployeeIds(actor);
  const months = await computeEmployeesMonth(actor.companyId, ids, year, month);
  const available = await availableLeaveByEmployee(actor.companyId, ids, year, month);
  const keys = monthDateKeys(year, month);
  return {
    year,
    month,
    isClosed: false,
    closedAt: null,
    closedBy: null,
    pendingRegularizations: await countPendingRegularizations(actor.companyId, scope),
    monthEnded: keys[keys.length - 1] < istDateKey(new Date()),
    rows: months.map((m) => buildSalaryRow(m, available.get(m.employee.id) ?? 0)),
  };
}

/**
 * Finalise a month (old payroll generation's attendance side): blocked while
 * any regularization is pending or the month hasn't ended; uses leftover
 * leave quota for zero-hour workdays (Auto Leave History) and freezes the
 * sheet. Company-wide only (needs view_all), done once per month.
 */
export async function finaliseSalaryMonth(actor: HrmsActor, year: number, month: number) {
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance");
  if (scope !== null) throw new BusinessRuleError("PERMISSION_DENIED", "Finalising a month needs company-wide attendance access.");
  const keys = monthDateKeys(year, month);
  if (keys[keys.length - 1] >= istDateKey(new Date())) throw new BusinessRuleError("VALIDATION_ERROR", "A month can be finalised only after it has ended.");
  const existing = await prisma.attendanceMonthClose.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } } });
  if (existing) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This month is already finalised.");
  const pending = await countPendingRegularizations(actor.companyId, null);
  if (pending > 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `${pending} regularization request(s) are still pending — approve or reject them first.`);

  const sheet = await getSalarySheet(actor, year, month);
  const closeRow = await prisma.$transaction(async (tx) => {
    for (const row of sheet.rows) {
      let need = row.autoPaidLeaveDays;
      if (need <= 0) continue;
      const balances = await tx.leaveBalance.findMany({
        where: { employeeId: row.employeeId, year, month, leaveType: { isActive: true } },
        include: { leaveType: { select: { name: true } } },
        orderBy: { leaveType: { name: "asc" } },
      });
      for (const b of balances) {
        if (need <= 0) break;
        const available = Number(b.remaining) + Number(b.carryForward);
        if (available <= 0) continue;
        const take = round2(Math.min(need, available));
        const fromRemaining = round2(Math.min(Number(b.remaining), take));
        const fromCarry = round2(take - fromRemaining);
        await tx.leaveBalance.update({ where: { id: b.id }, data: { remaining: { decrement: fromRemaining }, carryForward: { decrement: fromCarry }, used: { increment: take } } });
        await cascadeAvailability(tx, row.employeeId, b.leaveTypeId, year, month, -take);
        await tx.autoLeaveHistory.create({
          data: { companyId: actor.companyId, employeeId: row.employeeId, leaveTypeId: b.leaveTypeId, year, month, used: take, preRemaining: available, createdByUserId: actor.userId },
        });
        need = round2(need - take);
      }
    }
    return tx.attendanceMonthClose.create({
      data: { companyId: actor.companyId, year, month, closedByUserId: actor.userId, snapshotJson: { rows: sheet.rows } as unknown as Prisma.InputJsonValue },
    });
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_month_closes",
    recordId: closeRow.id,
    action: "POST",
    newValues: { year, month, employees: sheet.rows.length, autoPaidLeaveDays: round2(sheet.rows.reduce((s, r) => s + r.autoPaidLeaveDays, 0)) },
  });
  return getSalarySheet(actor, year, month);
}

export async function exportSalarySheetXlsx(actor: HrmsActor, year: number, month: number) {
  const sheet = await getSalarySheet(actor, year, month);
  const n = "number" as const;
  const columns: XlsxColumn[] = [
    { header: "Code", key: "employeeCode", width: 12 },
    { header: "Employee", key: "fullName", width: 24 },
    { header: "Monthly gross", key: "grossMonthly", type: n },
    { header: "Per day", key: "perDay", type: n },
    { header: "Present", key: "presentDays", type: n },
    { header: "Paid leave", key: "paidLeaveDays", type: n },
    { header: "Auto paid leave", key: "autoPaidLeaveDays", type: n },
    { header: "Weekly off", key: "weekendDays", type: n },
    { header: "Holidays", key: "holidayDays", type: n },
    { header: "Extra payable", key: "extraPayableDays", type: n },
    { header: "Payable days", key: "payableDays", type: n },
    { header: "Absent", key: "absentDays", type: n },
    { header: "Unpaid leave", key: "unpaidLeaveDays", type: n },
    { header: "Sandwich", key: "sandwichDays", type: n },
    { header: "Deduction", key: "deductionAmount", type: n },
    { header: "Earned", key: "earnedAmount", type: n },
    { header: "OT hours", key: "approvedOvertimeHours", type: n },
    { header: "OT pay", key: "overtimePay", type: n },
    { header: "Net pay", key: "netPay", type: n },
  ];
  return buildXlsxBuffer(`Salary ${year}-${String(month).padStart(2, "0")}`, columns, sheet.rows as unknown as Record<string, unknown>[]);
}

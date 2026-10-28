import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { dateKeyToDbDate, round2 } from "./attendance-calculator";
import { computeEmployeesMonth, type AttendanceDay, type EmployeeMonth } from "./attendance-month.service";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope } from "./hrms-scope";
import { switchLeaveDayPayment } from "./leave-balance.service";
import type { BulkAdjustInput, LeavePaymentSwitchInput } from "./salary-attendance.schema";

/**
 * Salary Management slice 2 (2026-10-28, docs/hrms/SALARY_MANAGEMENT_PLAN.md):
 * Manage Attendance. Admin reviews an employee's month and can count chosen
 * workdays as fixed hours / office (shift) hours / a full day — stored as a
 * salary-only overlay, never touching the real punches — and switch a leave
 * day between Paid and Unpaid (this one does move the leave balance).
 * Every change is recorded.
 */

const MODULE = "hrms_salary_attendance" as const;

export interface SalaryAttendanceActor {
  companyId: string;
  userId: string;
}

/** Month cards + counts, shared by the list and the detail view. */
export function summarizeSalaryMonth(m: EmployeeMonth) {
  const notJoined = (d: AttendanceDay) => d.isPreJoining;
  const workdays = m.days.filter((d) => !notJoined(d) && !d.isHoliday && !d.isWeekend);
  const counted = m.days.filter((d) => !d.isFuture && !d.isPreJoining);
  const expectedHoursPerDay = m.days[0]?.expectedHours ?? 8;
  const s = m.summary;
  const workedDays = workdays.filter((d) => !d.isFuture && (d.present > 0 || d.workedHours > 0)).length;
  const actualHours = round2(counted.reduce((sum, d) => sum + d.actualWorkedHours, 0));
  const adjustedHours = s.totalHours;
  const expectedHours = round2(workdays.length * expectedHoursPerDay);
  const creditedDays = s.presentDays + s.paidLeaveDays + s.weekendDays + s.holidayDays;
  return {
    workingDays: workdays.length,
    workedDays,
    actualHours,
    adjustedHours,
    expectedHours,
    paidWeekends: s.weekendDays,
    companyHolidays: s.holidayDays,
    presentDays: s.presentDays,
    paidLeaveDays: s.paidLeaveDays,
    unpaidLeaveDays: s.unpaidLeaveDays,
    absentDays: s.absentDays,
    extraPayableDays: s.extraPayableDays,
    sandwichDays: s.sandwichDays,
    adjustedDays: m.days.filter((d) => d.salaryAdjustment).length,
    attendancePercent: s.countedDays > 0 ? round2(Math.min(100, (creditedDays / s.countedDays) * 100)) : 0,
    hoursPercent: expectedHours > 0 ? round2(Math.min(100, (adjustedHours / expectedHours) * 100)) : 0,
  };
}

async function employeesInScope(actor: SalaryAttendanceActor) {
  const scope = await getHrmsEmployeeScope(actor.userId, MODULE);
  return prisma.employee.findMany({
    where: { companyId: actor.companyId, deletedAt: null, isActive: true, ...(scope === null ? {} : { id: { in: scope } }) },
    select: { id: true },
  });
}

export async function listSalaryAttendance(actor: SalaryAttendanceActor, year: number, month: number) {
  const employees = await employeesInScope(actor);
  const months = await computeEmployeesMonth(actor.companyId, employees.map((e) => e.id), year, month, new Date(), { applySalaryAdjustments: true });
  return months.map((m) => ({ employee: { id: m.employee.id, employeeCode: m.employee.employeeCode, fullName: m.employee.fullName }, ...summarizeSalaryMonth(m) }));
}

async function loadMonth(actor: SalaryAttendanceActor, employeeId: string, year: number, month: number) {
  await assertHrmsEmployeeInScope(actor.userId, MODULE, employeeId, { label: "Employee", id: employeeId });
  const [m] = await computeEmployeesMonth(actor.companyId, [employeeId], year, month, new Date(), { applySalaryAdjustments: true });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: employeeId });
  return m;
}

function monthRange(year: number, month: number) {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { gte: dateKeyToDbDate(first), lte: dateKeyToDbDate(last) };
}

export async function getEmployeeSalaryAttendance(actor: SalaryAttendanceActor, employeeId: string, year: number, month: number) {
  const m = await loadMonth(actor, employeeId, year, month);
  const range = monthRange(year, month);
  const [leaveDays, adjustmentLog] = await Promise.all([
    prisma.leaveDay.findMany({
      where: { companyId: actor.companyId, employeeId, leaveDate: range, taken: true, leaveRequest: { status: "APPROVED" } },
      select: {
        id: true,
        leaveDate: true,
        fraction: true,
        durationType: true,
        paymentType: true,
        leaveRequest: { select: { leaveType: { select: { name: true } } } },
        paymentChanges: { orderBy: { createdAt: "desc" }, select: { fromType: true, toType: true, reason: true, createdAt: true, changedByUserId: true } },
      },
      orderBy: { leaveDate: "asc" },
    }),
    prisma.salaryAttendanceAdjustment.findMany({
      where: { companyId: actor.companyId, employeeId, attendanceDate: range },
      orderBy: { createdAt: "desc" },
      select: { id: true, attendanceDate: true, mode: true, hours: true, actualHours: true, reason: true, createdAt: true, createdByUserId: true, removedAt: true, removedByUserId: true, removeReason: true },
    }),
  ]);

  const userIds = [...new Set([...adjustmentLog.flatMap((a) => [a.createdByUserId, a.removedByUserId]), ...leaveDays.flatMap((l) => l.paymentChanges.map((c) => c.changedByUserId))].filter(Boolean) as string[])];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
  const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.fullName ?? "—" : null);

  return {
    employee: m.employee,
    year,
    month,
    summary: summarizeSalaryMonth(m),
    days: m.days,
    leaveDays: leaveDays.map((l) => ({
      id: l.id,
      dateKey: l.leaveDate.toISOString().slice(0, 10),
      leaveType: l.leaveRequest.leaveType.name,
      fraction: Number(l.fraction),
      durationType: l.durationType,
      paymentType: l.paymentType ?? "PAID",
      changes: l.paymentChanges.map((c) => ({ fromType: c.fromType, toType: c.toType, reason: c.reason, at: c.createdAt, by: name(c.changedByUserId) })),
    })),
    adjustmentLog: adjustmentLog.map((a) => ({
      id: a.id,
      dateKey: a.attendanceDate.toISOString().slice(0, 10),
      mode: a.mode,
      hours: a.hours === null ? null : Number(a.hours),
      actualHours: Number(a.actualHours),
      reason: a.reason,
      at: a.createdAt,
      by: name(a.createdByUserId),
      removedAt: a.removedAt,
      removedBy: name(a.removedByUserId),
      removeReason: a.removeReason,
    })),
  };
}

/** Nobody adjusts or re-pays their own attendance. */
async function assertNotOwnRecord(actor: SalaryAttendanceActor, employeeId: string) {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  if (user?.employeeId === employeeId) throw new BusinessRuleError("PERMISSION_DENIED", "You can't change your own attendance for salary.");
}

export async function adjustSalaryDays(actor: SalaryAttendanceActor, employeeId: string, input: BulkAdjustInput) {
  await assertNotOwnRecord(actor, employeeId);
  const year = Number(input.dates[0].slice(0, 4));
  const month = Number(input.dates[0].slice(5, 7));
  const m = await loadMonth(actor, employeeId, year, month);
  const byKey = new Map(m.days.map((d) => [d.dateKey, d]));
  const dates = [...new Set(input.dates)].sort();

  const rows = dates.map((key) => {
    const day = byKey.get(key);
    if (!day) throw new BusinessRuleError("VALIDATION_ERROR", `${key} is not in this month.`);
    if (day.isFuture) throw new BusinessRuleError("VALIDATION_ERROR", `${key} is in the future.`);
    if (day.isPreJoining) throw new BusinessRuleError("VALIDATION_ERROR", `${key} is before the joining date.`);
    if (day.isHoliday || day.isWeekend) throw new BusinessRuleError("VALIDATION_ERROR", `${key} is a ${day.isHoliday ? "holiday" : "weekly off"} — only working days can be adjusted.`);
    if (day.leaveFraction >= 1) throw new BusinessRuleError("VALIDATION_ERROR", `${key} is a full leave day — change the leave instead.`);
    const hours = input.mode === "FIXED_HOURS" ? input.hours! : input.mode === "OFFICE_TIME" ? day.expectedHours : null;
    return { key, hours, actualHours: day.actualWorkedHours };
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.salaryAttendanceAdjustment.updateMany({
      where: { companyId: actor.companyId, employeeId, attendanceDate: { in: rows.map((r) => dateKeyToDbDate(r.key)) }, removedAt: null },
      data: { removedAt: now, removedByUserId: actor.userId, removeReason: "Replaced by a new adjustment" },
    });
    await tx.salaryAttendanceAdjustment.createMany({
      data: rows.map((r) => ({
        companyId: actor.companyId,
        employeeId,
        attendanceDate: dateKeyToDbDate(r.key),
        mode: input.mode,
        hours: r.hours,
        actualHours: r.actualHours,
        reason: input.reason,
        createdByUserId: actor.userId,
      })),
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_salary_attendance_adjustments",
    recordId: employeeId,
    action: "CREATE",
    newValues: { dates: rows.map((r) => r.key), mode: input.mode, hours: input.mode === "FIXED_HOURS" ? input.hours : null, reason: input.reason },
  });
  return getEmployeeSalaryAttendance(actor, employeeId, year, month);
}

export async function removeSalaryAdjustment(actor: SalaryAttendanceActor, adjustmentId: string, reason?: string) {
  const adj = await prisma.salaryAttendanceAdjustment.findFirst({ where: { id: adjustmentId, companyId: actor.companyId } });
  if (!adj) throw new BusinessRuleError("NOT_FOUND", "Adjustment not found.", { id: adjustmentId });
  await assertHrmsEmployeeInScope(actor.userId, MODULE, adj.employeeId, { label: "Adjustment", id: adjustmentId });
  await assertNotOwnRecord(actor, adj.employeeId);
  const res = await prisma.salaryAttendanceAdjustment.updateMany({
    where: { id: adj.id, removedAt: null },
    data: { removedAt: new Date(), removedByUserId: actor.userId, removeReason: reason || null },
  });
  if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This adjustment was already removed.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_attendance_adjustments", recordId: adj.id, action: "DELETE", oldValues: { date: adj.attendanceDate.toISOString().slice(0, 10), mode: adj.mode, hours: adj.hours === null ? null : Number(adj.hours) }, newValues: { reason: reason || null } });
  const key = adj.attendanceDate.toISOString().slice(0, 10);
  return getEmployeeSalaryAttendance(actor, adj.employeeId, Number(key.slice(0, 4)), Number(key.slice(5, 7)));
}

export async function switchLeavePayment(actor: SalaryAttendanceActor, leaveDayId: string, input: LeavePaymentSwitchInput) {
  const day = await prisma.leaveDay.findFirst({
    where: { id: leaveDayId, companyId: actor.companyId, taken: true, leaveRequest: { status: "APPROVED" } },
    select: { id: true, employeeId: true, leaveDate: true, fraction: true, paymentType: true, paidFromRemaining: true, paidFromCarry: true, leaveBalanceId: true, leaveRequest: { select: { leaveTypeId: true } } },
  });
  if (!day) throw new BusinessRuleError("NOT_FOUND", "Leave day not found.", { id: leaveDayId });
  await assertHrmsEmployeeInScope(actor.userId, MODULE, day.employeeId, { label: "Leave day", id: leaveDayId });
  await assertNotOwnRecord(actor, day.employeeId);

  const from = day.paymentType ?? "PAID";
  const moved = await prisma.$transaction(async (tx) => {
    const result = await switchLeaveDayPayment(tx, actor.companyId, day, day.leaveRequest.leaveTypeId, input.to);
    await tx.leavePaymentChange.create({
      data: {
        companyId: actor.companyId,
        leaveDayId: day.id,
        employeeId: day.employeeId,
        fromType: from,
        toType: input.to,
        fromRemaining: result.fromRemaining,
        fromCarry: result.fromCarry,
        reason: input.reason,
        changedByUserId: actor.userId,
      },
    });
    return result;
  });

  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_leave_days", recordId: day.id, action: "UPDATE", oldValues: { paymentType: from }, newValues: { paymentType: input.to, reason: input.reason, ...moved } });
  const key = day.leaveDate.toISOString().slice(0, 10);
  return getEmployeeSalaryAttendance(actor, day.employeeId, Number(key.slice(0, 4)), Number(key.slice(5, 7)));
}

import type { AttendanceOvertimeStatus, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNotification } from "@/core/notifications/NotificationService";
import { computeDayHours, computeOvertimeHours, dateKeyToDbDate, monthDateKeys, shiftHoursFromTimes } from "./attendance-calculator";
import { getAttendanceSettings, type HrmsActor } from "./attendance-settings.service";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";

/**
 * Old OvertimeWorker: OT = worked (interval union of closed sessions) −
 * shift hours, only for employees with an OT rate. Fixes: no shift → no OT
 * (F6), and a decided (approved/rejected) record is never touched again (F5).
 */
export async function recalculateOvertimeForDay(companyId: string, employeeId: string, dateKey: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    select: { id: true, shift: { select: { startTime: true, endTime: true } }, attendanceProfile: { select: { overtimeRatePerHour: true } } },
  });
  if (!employee) return null;
  const rate = employee.attendanceProfile?.overtimeRatePerHour ? Number(employee.attendanceProfile.overtimeRatePerHour) : 0;
  const shiftHours = shiftHoursFromTimes(employee.shift?.startTime, employee.shift?.endTime);
  const attendanceDate = dateKeyToDbDate(dateKey);
  const existing = await prisma.overtimeRecord.findUnique({ where: { employeeId_attendanceDate: { employeeId, attendanceDate } } });
  if (existing && existing.status !== "PENDING") return existing;
  if (!rate || shiftHours === null) {
    if (existing) await prisma.overtimeRecord.delete({ where: { id: existing.id } });
    return null;
  }

  const settings = await getAttendanceSettings(companyId);
  const record = await prisma.attendanceRecord.findUnique({
    where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    select: { sessions: { select: { id: true, checkInAt: true, checkOutAt: true } } },
  });
  const worked = computeDayHours(record?.sessions ?? [], new Date(), settings.maxSessionHours).finalizedHours;
  const hours = computeOvertimeHours(worked, shiftHours);

  if (hours <= 0) {
    if (existing) await prisma.overtimeRecord.delete({ where: { id: existing.id } });
    return null;
  }
  if (existing) {
    return prisma.overtimeRecord.update({ where: { id: existing.id }, data: { hours, workedHours: worked, shiftHours } });
  }
  return prisma.overtimeRecord.create({
    data: { companyId, employeeId, attendanceDate, hours, workedHours: worked, shiftHours, reason: "Auto-calculated overtime", status: "PENDING" },
  });
}

const OVERTIME_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true, attendanceProfile: { select: { overtimeRatePerHour: true } } } },
  decidedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.OvertimeRecordInclude;

export interface OvertimeListFilters {
  month?: string; // YYYY-MM
  status?: AttendanceOvertimeStatus;
  employeeId?: string;
  mine?: boolean;
}

function monthWhere(month?: string) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return {};
  const [y, m] = month.split("-").map(Number);
  const keys = monthDateKeys(y, m);
  return { attendanceDate: { gte: dateKeyToDbDate(keys[0]), lte: dateKeyToDbDate(keys[keys.length - 1]) } };
}

export async function listOvertime(actor: HrmsActor, filters: OvertimeListFilters) {
  let employeeFilter: Prisma.OvertimeRecordWhereInput = {};
  if (filters.mine) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
    employeeFilter = { employeeId: user?.employeeId ?? "00000000-0000-0000-0000-000000000000" };
  } else {
    const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance_overtime");
    employeeFilter = hrmsEmployeeWhere(scope);
    if (filters.employeeId) employeeFilter = { AND: [employeeFilter, { employeeId: filters.employeeId }] };
  }
  const rows = await prisma.overtimeRecord.findMany({
    where: { companyId: actor.companyId, ...employeeFilter, ...monthWhere(filters.month), ...(filters.status ? { status: filters.status } : {}) },
    include: OVERTIME_INCLUDE,
    orderBy: [{ attendanceDate: "desc" }, { createdAt: "desc" }],
    take: 1000,
  });
  return rows.map((r) => {
    const rate = r.employee.attendanceProfile?.overtimeRatePerHour ? Number(r.employee.attendanceProfile.overtimeRatePerHour) : 0;
    return { ...r, hours: Number(r.hours), workedHours: Number(r.workedHours), shiftHours: Number(r.shiftHours), ratePerHour: rate, amount: Math.round(Number(r.hours) * rate * 100) / 100 };
  });
}

export async function decideOvertime(actor: HrmsActor, id: string, decision: "APPROVED" | "REJECTED", reason?: string | null) {
  const record = await prisma.overtimeRecord.findFirst({ where: { id, companyId: actor.companyId }, include: { employee: { select: { fullName: true, user: { select: { id: true } } } } } });
  if (!record) throw new BusinessRuleError("NOT_FOUND", "Overtime record not found.", { id });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_overtime", record.employeeId, { label: "Overtime record", id });
  if (record.status === decision) return record; // idempotent repeat
  if (record.status !== "PENDING") throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This overtime is already ${record.status.toLowerCase()}.`);
  // The employee's own linked user can never approve their own overtime.
  if (decision === "APPROVED") {
    await PermissionService.assert(actor.userId, "hrms_attendance_overtime", "approve", { createdBy: record.employee.user?.id ?? undefined });
  } else {
    await PermissionService.assert(actor.userId, "hrms_attendance_overtime", "reject");
    if (!reason?.trim()) throw new BusinessRuleError("VALIDATION_ERROR", "A reason is required to reject overtime.");
  }
  const updated = await prisma.overtimeRecord.updateMany({
    where: { id, status: "PENDING" },
    data: { status: decision, decidedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: decision === "REJECTED" ? reason!.trim() : null },
  });
  if (updated.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This overtime was already decided.");
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_overtime_records",
    recordId: id,
    action: decision === "APPROVED" ? "APPROVE" : "REJECT",
    oldValues: { status: record.status },
    newValues: { status: decision, reason: reason ?? null },
  });
  if (record.employee.user?.id) {
    await createNotification({
      companyId: actor.companyId,
      userId: record.employee.user.id,
      title: `Overtime ${decision === "APPROVED" ? "approved" : "rejected"}`,
      body: `${Number(record.hours)} h overtime on ${record.attendanceDate.toISOString().slice(0, 10)} was ${decision === "APPROVED" ? "approved" : `rejected: ${reason}`}.`,
    }).catch(() => undefined);
  }
  return prisma.overtimeRecord.findUniqueOrThrow({ where: { id }, include: OVERTIME_INCLUDE });
}

/** Recalculates every day of a month for one employee (used after OT rate / shift changes). */
export async function recalculateOvertimeForMonth(companyId: string, employeeId: string, year: number, month: number) {
  for (const key of monthDateKeys(year, month)) await recalculateOvertimeForDay(companyId, employeeId, key);
}

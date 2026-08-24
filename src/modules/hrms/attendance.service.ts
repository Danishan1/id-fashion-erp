import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { AttendanceRepository } from "./attendance.repository";
import type { RecordAttendanceInput } from "./attendance.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Deliberately NOT stored — computed against the employee's own assigned
 * Shift.startTime, a real improvement over the source's single hardcoded
 * 10:15 cutoff for every employee company-wide (see the migration report).
 * Returns null (not "on time") when the employee has no shift assigned —
 * there's genuinely nothing to compare against, so "late" would be a guess.
 */
export function computeIsLate(punchIn: Date | null, shiftStartTime: string | null | undefined): boolean | null {
  if (!punchIn || !shiftStartTime) return null;
  const [hours, minutes] = shiftStartTime.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const cutoff = new Date(punchIn);
  cutoff.setHours(hours, minutes, 0, 0);
  return punchIn.getTime() > cutoff.getTime();
}

function decorateAttendance<T extends { punchIn: Date | string | null; employee: { shift: { startTime: string } | null } }>(record: T) {
  const punchIn = record.punchIn ? new Date(record.punchIn) : null;
  return { ...record, isLate: computeIsLate(punchIn, record.employee.shift?.startTime) };
}

export async function listAttendance(companyId: string, query: ListQuery, attendanceDate?: string) {
  const where: Prisma.AttendanceRecordWhereInput = {
    companyId,
    ...(attendanceDate ? { attendanceDate: new Date(attendanceDate) } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AttendanceRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    AttendanceRepository.count(where),
  ]);

  return { data: data.map(decorateAttendance), totalCount };
}

export async function recordAttendance(actor: ActorContext, input: RecordAttendanceInput) {
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId: actor.companyId }, select: { id: true } });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: input.employeeId });

  const record = await AttendanceRepository.upsert(
    input.employeeId,
    new Date(input.attendanceDate),
    {
      punchIn: input.punchIn ? new Date(input.punchIn) : null,
      punchOut: input.punchOut ? new Date(input.punchOut) : null,
      remarks: input.remarks || null,
      recordedByUserId: actor.userId,
    },
    actor.companyId
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_records",
    recordId: record.id,
    action: "CREATE",
    newValues: { employeeId: input.employeeId, attendanceDate: input.attendanceDate, punchIn: input.punchIn, punchOut: input.punchOut },
  });

  return decorateAttendance(record);
}

/** Mirrors the source's own daily attendance report: present/late/missing
 * counts for one date, company-wide. */
export async function getAttendanceSummaryForDate(companyId: string, attendanceDate: string) {
  const records = await AttendanceRepository.findByDate(companyId, new Date(attendanceDate));
  const decorated = records.map(decorateAttendance);

  const present = decorated.filter((r) => r.punchIn).length;
  const late = decorated.filter((r) => r.isLate === true).length;
  const missing = decorated.filter((r) => !r.punchIn).length;

  return { present, late, missing, records: decorated };
}

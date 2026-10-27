import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { AttendanceRepository } from "./attendance.repository";
import { computeIsLateIst, istTimeString } from "./attendance-calculator";
import { addManualSession } from "./attendance-session.service";
import { getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";
import type { RecordAttendanceInput } from "./attendance.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Deliberately NOT stored — computed against the employee's own assigned
 * Shift.startTime + graceMinutes. Returns null (not "on time") when the
 * employee has no shift assigned. Uses the IST clock (attendance module
 * port, fix F16) — never the server's own time zone.
 */
export function computeIsLate(punchIn: Date | null, shiftStartTime: string | null | undefined, graceMinutes = 0): boolean | null {
  return computeIsLateIst(punchIn, shiftStartTime, graceMinutes);
}

function decorateAttendance<T extends { punchIn: Date | string | null; employee: { shift: { startTime: string; graceMinutes: number } | null } }>(record: T) {
  const punchIn = record.punchIn ? new Date(record.punchIn) : null;
  return { ...record, isLate: computeIsLate(punchIn, record.employee.shift?.startTime, record.employee.shift?.graceMinutes) };
}

export async function listAttendance(actor: ActorContext, query: ListQuery, attendanceDate?: string) {
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance_team");
  const where: Prisma.AttendanceRecordWhereInput = {
    companyId: actor.companyId,
    ...hrmsEmployeeWhere(scope),
    ...(attendanceDate ? { attendanceDate: new Date(attendanceDate) } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AttendanceRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    AttendanceRepository.count(where),
  ]);

  return { data: data.map(decorateAttendance), totalCount };
}

/**
 * Older "Record Attendance" entry point (date + punch-in/out). Every punch is
 * now an AttendanceSession, so this adds a MANUAL session for that day — with
 * the same order / 18 h / overlap checks as an admin correction.
 */
export async function recordAttendance(actor: ActorContext, input: RecordAttendanceInput) {
  const toHhmm = (v: string | undefined) => {
    if (!v) return null;
    if (/^\d{2}:\d{2}$/.test(v)) return v;
    const d = /([+-]\d{2}:?\d{2}|Z)$/.test(v) ? new Date(v) : new Date(`${v}+05:30`);
    return Number.isNaN(d.getTime()) ? null : istTimeString(d);
  };
  const checkIn = toHhmm(input.punchIn || undefined);
  const session = await addManualSession(actor, {
    employeeId: input.employeeId,
    attendanceDate: input.attendanceDate,
    checkIn: checkIn ?? "",
    checkOut: toHhmm(input.punchOut || undefined),
    remarks: input.remarks || null,
  });
  const record = await prisma.attendanceRecord.findUniqueOrThrow({
    where: { id: session.attendanceRecordId },
    include: { employee: { select: { id: true, employeeCode: true, fullName: true, shift: { select: { id: true, name: true, startTime: true, graceMinutes: true } } } }, recordedBy: { select: { id: true, fullName: true } } },
  });
  return decorateAttendance(record);
}

/** Present / late / missing counts for one date (older summary endpoint). */
export async function getAttendanceSummaryForDate(actor: ActorContext, attendanceDate: string) {
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance_team");
  const records = await AttendanceRepository.findByDate(actor.companyId, new Date(attendanceDate));
  const decorated = records.filter((r) => scope === null || scope.includes(r.employeeId)).map(decorateAttendance);

  const present = decorated.filter((r) => r.punchIn).length;
  const late = decorated.filter((r) => r.isLate === true).length;
  const missing = decorated.filter((r) => !r.punchIn).length;

  return { present, late, missing, records: decorated };
}

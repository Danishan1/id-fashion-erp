import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  addDays,
  dateKeyToDbDate,
  findConflictingSession,
  istDateKey,
  istDayRange,
  istTimeOnDate,
  isValidDateKey,
  isValidHhmm,
  monthDateKeys,
  validateSessionTimes,
} from "./attendance-calculator";
import { getAttendanceSettings, type HrmsActor } from "./attendance-settings.service";
import { getOrCreateDayRecord, syncDayRecord } from "./attendance-session.core";
import { onAttendanceDayChanged } from "./attendance-events";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";
import { assertSalaryMonthOpen } from "./salary-month-lock";

type Tx = Prisma.TransactionClient;

/** Other sessions of the employee near a time window, for the overlap check. */
export async function nearbySessions(db: Tx | typeof prisma, employeeId: string, around: Date) {
  const key = istDateKey(around);
  return db.attendanceSession.findMany({
    where: { employeeId, checkInAt: { gte: istDayRange(addDays(key, -2)).start, lt: istDayRange(addDays(key, 2)).end } },
    select: { id: true, checkInAt: true, checkOutAt: true },
  });
}

/** Overlap + order + 18 h checks shared by corrections and regularizations (fix F8). */
export async function assertSessionTimesAllowed(db: Tx | typeof prisma, companyId: string, employeeId: string, checkInAt: Date, checkOutAt: Date | null, excludeSessionId?: string) {
  const settings = await getAttendanceSettings(companyId);
  const problem = validateSessionTimes(checkInAt, checkOutAt, settings.maxSessionHours);
  if (problem) throw new BusinessRuleError("VALIDATION_ERROR", problem);
  if (checkInAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "Check-in time can't be in the future.");
  if (checkOutAt && checkOutAt.getTime() > Date.now() + 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "Check-out time can't be in the future.");
  const conflict = findConflictingSession({ checkInAt, checkOutAt }, await nearbySessions(db, employeeId, checkInAt), excludeSessionId);
  if (conflict) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `These times overlap another session (${conflict.checkInAt.toISOString()} – ${conflict.checkOutAt ? conflict.checkOutAt.toISOString() : "still open"}).`
    );
  }
}

export interface ManualSessionInput {
  employeeId: string;
  attendanceDate: string;
  checkIn: string; // HH:mm IST
  checkOut?: string | null;
  remarks?: string | null;
}

/** Admin "Record Attendance": adds a MANUAL session (replaces the old day-level upsert). */
export async function addManualSession(actor: HrmsActor, input: ManualSessionInput) {
  if (!isValidDateKey(input.attendanceDate)) throw new BusinessRuleError("VALIDATION_ERROR", "Date is not valid.");
  if (!isValidHhmm(input.checkIn)) throw new BusinessRuleError("VALIDATION_ERROR", "Check-in time is required (HH:mm).");
  if (input.checkOut && !isValidHhmm(input.checkOut)) throw new BusinessRuleError("VALIDATION_ERROR", "Check-out time is not valid (HH:mm).");
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId: actor.companyId, deletedAt: null }, select: { id: true } });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: input.employeeId });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_team", input.employeeId, { label: "Employee", id: input.employeeId });
  await assertSalaryMonthOpen(actor.companyId, [input.attendanceDate]);

  const checkInAt = istTimeOnDate(input.attendanceDate, input.checkIn);
  let checkOutAt = input.checkOut ? istTimeOnDate(input.attendanceDate, input.checkOut) : null;
  // A check-out earlier than check-in on the same date is a night shift ending next day.
  if (checkOutAt && checkOutAt <= checkInAt) checkOutAt = istTimeOnDate(addDays(input.attendanceDate, 1), input.checkOut!);

  const session = await prisma.$transaction(async (tx) => {
    await assertSessionTimesAllowed(tx, actor.companyId, input.employeeId, checkInAt, checkOutAt);
    const record = await getOrCreateDayRecord(tx, actor.companyId, input.employeeId, input.attendanceDate, actor.userId);
    const created = await tx.attendanceSession.create({
      data: {
        companyId: actor.companyId,
        attendanceRecordId: record.id,
        employeeId: input.employeeId,
        checkInAt,
        checkOutAt,
        source: "MANUAL",
        status: "PRESENT",
        remarks: input.remarks || null,
        createdByUserId: actor.userId,
      },
    });
    if (input.remarks) await tx.attendanceRecord.update({ where: { id: record.id }, data: { remarks: input.remarks } });
    await syncDayRecord(tx, record.id);
    return created;
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_sessions",
    recordId: session.id,
    action: "CREATE",
    newValues: { employeeId: input.employeeId, attendanceDate: input.attendanceDate, checkIn: input.checkIn, checkOut: input.checkOut ?? null, source: "MANUAL" },
  });
  await onAttendanceDayChanged(actor.companyId, input.employeeId, input.attendanceDate);
  return session;
}

export interface SessionCorrection {
  sessionId: string;
  checkInAt: string; // ISO
  checkOutAt?: string | null;
}

/** Old ChangeAttendanceTime — now with order/18 h/overlap checks (fix F8). */
export async function correctSession(actor: HrmsActor, input: SessionCorrection) {
  const session = await prisma.attendanceSession.findFirst({ where: { id: input.sessionId, companyId: actor.companyId }, include: { attendanceRecord: { select: { attendanceDate: true } } } });
  if (!session) throw new BusinessRuleError("NOT_FOUND", "Attendance session not found.", { id: input.sessionId });
  await assertHrmsEmployeeInScope(actor.userId, ["hrms_attendance_team", "hrms_attendance_photos"], session.employeeId, { label: "Attendance session", id: input.sessionId });
  await assertSalaryMonthOpen(actor.companyId, [session.attendanceRecord.attendanceDate]);
  const checkInAt = new Date(input.checkInAt);
  const checkOutAt = input.checkOutAt ? new Date(input.checkOutAt) : null;
  if (Number.isNaN(checkInAt.getTime())) throw new BusinessRuleError("VALIDATION_ERROR", "Check-in time is not valid.");
  const openRejection = await prisma.outdoorRejection.findFirst({ where: { sessionId: session.id, status: { in: ["PENDING", "IN_PROCESS"] } }, select: { id: true } });
  if (openRejection) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This punch has an open outdoor rejection — settle that first.");

  await prisma.$transaction(async (tx) => {
    await assertSessionTimesAllowed(tx, actor.companyId, session.employeeId, checkInAt, checkOutAt, session.id);
    await tx.attendanceSession.update({ where: { id: session.id }, data: { checkInAt, checkOutAt, updatedByUserId: actor.userId } });
    await syncDayRecord(tx, session.attendanceRecordId);
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_sessions",
    recordId: session.id,
    action: "UPDATE",
    oldValues: { checkInAt: session.checkInAt.toISOString(), checkOutAt: session.checkOutAt?.toISOString() ?? null },
    newValues: { checkInAt: checkInAt.toISOString(), checkOutAt: checkOutAt?.toISOString() ?? null, correction: true },
  });
  await onAttendanceDayChanged(actor.companyId, session.employeeId, session.attendanceRecord.attendanceDate.toISOString().slice(0, 10));
  return prisma.attendanceSession.findUniqueOrThrow({ where: { id: session.id } });
}

/** Old BulkChangeAttendanceTime — each correction checked and saved on its own. */
export async function bulkCorrectSessions(actor: HrmsActor, corrections: SessionCorrection[]) {
  const results: { sessionId: string; ok: boolean; error?: string }[] = [];
  for (const c of corrections) {
    try {
      await correctSession(actor, c);
      results.push({ sessionId: c.sessionId, ok: true });
    } catch (error) {
      results.push({ sessionId: c.sessionId, ok: false, error: error instanceof Error ? error.message : "Failed" });
    }
  }
  return { updated: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

const SESSION_AUDIT_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  inLocation: { select: { id: true, name: true } },
  outLocation: { select: { id: true, name: true } },
  attendanceRecord: { select: { attendanceDate: true } },
  outdoorRejections: { orderBy: { rejectedAt: "desc" as const }, take: 1, select: { id: true, status: true, isRevoked: true } },
} satisfies Prisma.AttendanceSessionInclude;

/** Punch photo audit: sessions with selfies, place and distance from the office. */
export async function listSessions(actor: HrmsActor, filters: { employeeId?: string; month?: string; date?: string; outsideOnly?: boolean }) {
  const scope = await getHrmsEmployeeScope(actor.userId, ["hrms_attendance_team", "hrms_attendance_photos", "hrms_attendance_regularization"]);
  let range: { gte: Date; lt: Date } | undefined;
  if (filters.date && isValidDateKey(filters.date)) {
    range = { gte: dateKeyToDbDate(filters.date), lt: dateKeyToDbDate(addDays(filters.date, 1)) };
  } else if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const [y, m] = filters.month.split("-").map(Number);
    const keys = monthDateKeys(y, m);
    range = { gte: dateKeyToDbDate(keys[0]), lt: dateKeyToDbDate(addDays(keys[keys.length - 1], 1)) };
  }
  const where: Prisma.AttendanceSessionWhereInput = {
    companyId: actor.companyId,
    ...hrmsEmployeeWhere(scope),
    ...(filters.employeeId ? { AND: [{ employeeId: filters.employeeId }] } : {}),
    ...(range ? { attendanceRecord: { attendanceDate: range } } : {}),
    ...(filters.outsideOnly ? { OR: [{ isLoginFromOffice: false }, { isLogoutFromOffice: false }, { status: "PRESENT_FROM_OUTSIDE" }] } : {}),
  };
  const rows = await prisma.attendanceSession.findMany({ where, include: SESSION_AUDIT_INCLUDE, orderBy: { checkInAt: "desc" }, take: 1000 });
  return rows.map((s) => ({
    id: s.id,
    employee: s.employee,
    attendanceDate: s.attendanceRecord.attendanceDate,
    checkInAt: s.checkInAt,
    checkOutAt: s.checkOutAt,
    status: s.status,
    source: s.source,
    isLoginFromOffice: s.isLoginFromOffice,
    isLogoutFromOffice: s.isLogoutFromOffice,
    inLocation: s.inLocation,
    outLocation: s.outLocation,
    inDistanceMeters: s.inDistanceMeters,
    outDistanceMeters: s.outDistanceMeters,
    inLatitude: s.inLatitude,
    inLongitude: s.inLongitude,
    outLatitude: s.outLatitude,
    outLongitude: s.outLongitude,
    inAddress: s.inAddress,
    outAddress: s.outAddress,
    hasInSelfie: !!s.inSelfieKey,
    hasOutSelfie: !!s.outSelfieKey,
    faceVerifiedIn: !!s.inFacePhotoId,
    faceVerifiedOut: !!s.outFacePhotoId,
    remarks: s.remarks,
    latestRejection: s.outdoorRejections[0] ?? null,
  }));
}

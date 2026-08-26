import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNotification } from "@/core/notifications/NotificationService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceCorrectionRepository } from "./attendance-correction.repository";
import type { CreateAttendanceCorrectionInput, RejectAttendanceCorrectionInput } from "./attendance-correction.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/** Same "resolve the login account linked to an Employee, or nothing" helper
 * as leave.service.ts — kept local rather than shared, since it's a 3-line
 * query and the two modules have no other coupling. */
function findLinkedUserId(companyId: string, employeeId: string) {
  return prisma.user.findFirst({ where: { companyId, employeeId }, select: { id: true } });
}

export async function listAttendanceCorrections(companyId: string, query: ListQuery, status?: string) {
  const where: Prisma.AttendanceCorrectionRequestWhereInput = {
    companyId,
    ...(status ? { status: status as never } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AttendanceCorrectionRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    AttendanceCorrectionRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function createAttendanceCorrectionRequest(actor: ActorContext, input: CreateAttendanceCorrectionInput) {
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, companyId: actor.companyId },
    select: { id: true, fullName: true, reportsToId: true },
  });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: input.employeeId });

  const attendanceDate = new Date(input.attendanceDate);
  const existingRecord = await AttendanceRepository.findByEmployeeAndDate(input.employeeId, attendanceDate);

  const request = await AttendanceCorrectionRepository.create({
    companyId: actor.companyId,
    employeeId: input.employeeId,
    attendanceRecordId: existingRecord?.id ?? null,
    attendanceDate,
    requestedPunchIn: input.requestedPunchIn ? new Date(input.requestedPunchIn) : null,
    requestedPunchOut: input.requestedPunchOut ? new Date(input.requestedPunchOut) : null,
    reason: input.reason,
    status: "PENDING",
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: {
      employeeId: input.employeeId,
      attendanceDate: input.attendanceDate,
      requestedPunchIn: input.requestedPunchIn,
      requestedPunchOut: input.requestedPunchOut,
    },
  });

  // Same "notify the reporting manager, if the hierarchy and a login account
  // both exist" pattern as createLeaveRequest — silently skipped otherwise.
  if (employee.reportsToId) {
    const manager = await findLinkedUserId(actor.companyId, employee.reportsToId);
    if (manager) {
      await createNotification({
        companyId: actor.companyId,
        userId: manager.id,
        title: "New attendance correction request",
        body: `${employee.fullName} requested a punch-time correction for ${input.attendanceDate}.`,
        relatedModule: "ATTENDANCE_CORRECTION",
        relatedRecordId: request.id,
      });
    }
  }

  return request;
}

/**
 * Applies the requested punch time(s) onto the real AttendanceRecord for
 * that date — creating it if none existed yet (e.g. a forgotten punch-in
 * with no record at all), otherwise merging: a field the request didn't
 * touch keeps its existing value rather than being nulled out.
 */
export async function approveAttendanceCorrectionRequest(actor: ActorContext, id: string) {
  const existing = await AttendanceCorrectionRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Attendance correction request not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This correction request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  // Re-asserted here (the route's own assert has no resourceContext) so the
  // self-approval guard can actually apply — mirrors the exact fix already
  // made to approveLeaveRequest() for the identical reason.
  await PermissionService.assert(actor.userId, "hrms_attendance", "approve", { createdBy: existing.createdByUserId });

  const currentRecord = await AttendanceRepository.findByEmployeeAndDate(existing.employeeId, existing.attendanceDate);
  const record = await AttendanceRepository.upsert(
    existing.employeeId,
    existing.attendanceDate,
    {
      punchIn: existing.requestedPunchIn ?? currentRecord?.punchIn ?? null,
      punchOut: existing.requestedPunchOut ?? currentRecord?.punchOut ?? null,
      remarks: currentRecord?.remarks ?? null,
      recordedByUserId: actor.userId,
    },
    actor.companyId
  );

  const updated = await AttendanceCorrectionRepository.update(id, {
    status: "APPROVED",
    approvedByUserId: actor.userId,
    decidedAt: new Date(),
    rejectionReason: null,
    attendanceRecordId: record.id,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "PENDING" },
    newValues: { status: "APPROVED", attendanceRecordId: record.id },
  });

  const requester = await findLinkedUserId(actor.companyId, updated.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: "Attendance correction approved",
      body: `Your attendance correction for ${existing.attendanceDate.toISOString().slice(0, 10)} has been approved.`,
      relatedModule: "ATTENDANCE_CORRECTION",
      relatedRecordId: id,
    });
  }

  return updated;
}

export async function rejectAttendanceCorrectionRequest(actor: ActorContext, id: string, input: RejectAttendanceCorrectionInput) {
  const existing = await AttendanceCorrectionRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Attendance correction request not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This correction request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  const updated = await AttendanceCorrectionRepository.update(id, {
    status: "REJECTED",
    approvedByUserId: actor.userId,
    decidedAt: new Date(),
    rejectionReason: input.reason,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "PENDING" },
    newValues: { status: "REJECTED", rejectionReason: input.reason },
  });

  const requester = await findLinkedUserId(actor.companyId, updated.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: "Attendance correction rejected",
      body: `Your attendance correction for ${existing.attendanceDate.toISOString().slice(0, 10)} was rejected: ${input.reason}`,
      relatedModule: "ATTENDANCE_CORRECTION",
      relatedRecordId: id,
    });
  }

  return updated;
}

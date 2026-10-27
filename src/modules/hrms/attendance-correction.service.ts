import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNotification } from "@/core/notifications/NotificationService";
import { getAttachmentForDownload, listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import {
  addDays,
  dateKeyToDbDate,
  dateKeysBetween,
  istDateKey,
  istTimeOnDate,
  isValidDateKey,
  istTimeString,
  leaveFraction,
  weekdayOf,
} from "./attendance-calculator";
import { effectiveWeekends, getAttendanceSettings } from "./attendance-settings.service";
import { getOrCreateDayRecord, syncDayRecord } from "./attendance-session.core";
import { assertSessionTimesAllowed } from "./attendance-session.service";
import { onAttendanceDayChanged } from "./attendance-events";
import { deductLeaveDay, refundLeaveDay } from "./leave-balance.service";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";
import { AttendanceCorrectionRepository } from "./attendance-correction.repository";
import type { CreateAttendanceCorrectionInput, RejectAttendanceCorrectionInput } from "./attendance-correction.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

type Tx = Prisma.TransactionClient;

const TYPE_LABELS: Record<string, string> = {
  MISSED_PUNCH: "Missed punch",
  MISSED_LOGOUT: "Missed logout",
  CHANGE_LOGIN: "Change login time",
  CHANGE_LOGOUT: "Change logout time",
  LEAVE_NOT_TAKEN: "Leave not taken",
  EMERGENCY_LEAVE: "Emergency leave",
};

function findLinkedUserId(companyId: string, employeeId: string) {
  return prisma.user.findFirst({ where: { companyId, employeeId }, select: { id: true } });
}

export async function listAttendanceCorrections(actor: ActorContext, query: ListQuery, status?: string, options: { mine?: boolean; type?: string } = {}) {
  let employeeWhere: Prisma.AttendanceCorrectionRequestWhereInput;
  if (options.mine) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
    employeeWhere = { employeeId: user?.employeeId ?? "00000000-0000-0000-0000-000000000000" };
  } else {
    employeeWhere = hrmsEmployeeWhere(await getHrmsEmployeeScope(actor.userId, "hrms_attendance_regularization"));
  }
  const where: Prisma.AttendanceCorrectionRequestWhereInput = {
    companyId: actor.companyId,
    ...employeeWhere,
    ...(status ? { status: status as never } : {}),
    ...(options.type ? { type: options.type as never } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AttendanceCorrectionRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    AttendanceCorrectionRepository.count(where),
  ]);

  return { data, totalCount };
}

async function resolveEmployee(actor: ActorContext, employeeId?: string | null) {
  let id = employeeId || null;
  if (!id) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
    id = user?.employeeId ?? null;
    if (!id) throw new BusinessRuleError("VALIDATION_ERROR", "Your login is not linked to an employee — choose the employee.");
  }
  const employee = await prisma.employee.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    select: { id: true, fullName: true, reportsToId: true, attendanceProfile: { select: { useCompanyWeekends: true, weekends: true } } },
  });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_regularization", employee.id, { label: "Employee", id: employee.id });
  return employee;
}

/** An instant for "HH:mm" on a day; if it falls before `after`, it is the next day (night shift). */
function timeOnDay(dateKey: string, hhmm: string, after?: Date): Date {
  const t = istTimeOnDate(dateKey, hhmm);
  if (after && t.getTime() <= after.getTime()) return istTimeOnDate(addDays(dateKey, 1), hhmm);
  return t;
}

async function loadSessionForEmployee(sessionId: string, employeeId: string, companyId: string) {
  const s = await prisma.attendanceSession.findFirst({ where: { id: sessionId, employeeId, companyId }, include: { attendanceRecord: { select: { attendanceDate: true } } } });
  if (!s) throw new BusinessRuleError("NOT_FOUND", "That punch session was not found for this employee.", { id: sessionId });
  return s;
}

/** Working days (not weekly off / holiday) in a range for an employee. */
async function workingDaysBetween(companyId: string, employee: { attendanceProfile: { useCompanyWeekends: boolean; weekends: string[] } | null }, from: string, to: string) {
  const settings = await getAttendanceSettings(companyId);
  const weekends = new Set(effectiveWeekends(settings, employee.attendanceProfile));
  const holidays = await prisma.holidayMaster.findMany({ where: { companyId, isActive: true, date: { gte: dateKeyToDbDate(from), lte: dateKeyToDbDate(to) } }, select: { date: true } });
  const holidayKeys = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
  return dateKeysBetween(from, to).filter((k) => !weekends.has(weekdayOf(k)) && !holidayKeys.has(k));
}

function requireRange(input: CreateAttendanceCorrectionInput) {
  const from = input.dateFrom || "";
  const to = input.dateTo || input.dateFrom || "";
  if (!isValidDateKey(from) || !isValidDateKey(to)) throw new BusinessRuleError("VALIDATION_ERROR", "From and To dates are required.");
  if (to < from) throw new BusinessRuleError("VALIDATION_ERROR", "To date must be on or after From date.");
  if (dateKeysBetween(from, to).length > 62) throw new BusinessRuleError("VALIDATION_ERROR", "A range can be at most 62 days.");
  return { from, to };
}

/**
 * Raise a regularization (old createRegularization). Each type is validated
 * up front, the same way it will be re-checked on approval.
 */
export async function createAttendanceCorrectionRequest(actor: ActorContext, input: CreateAttendanceCorrectionInput) {
  const employee = await resolveEmployee(actor, input.employeeId);
  const type = input.type;

  const data: Prisma.AttendanceCorrectionRequestUncheckedCreateInput = {
    companyId: actor.companyId,
    employeeId: employee.id,
    type,
    attendanceDate: dateKeyToDbDate(istDateKey(new Date())),
    reason: input.reason,
    remark: input.remark || null,
    status: "PENDING",
    createdByUserId: actor.userId,
  };

  if (type === "MISSED_PUNCH") {
    // Older clients sent ISO times; accept those too.
    const date = input.attendanceDate || "";
    if (!isValidDateKey(date)) throw new BusinessRuleError("VALIDATION_ERROR", "Date is required.");
    if (date > istDateKey(new Date())) throw new BusinessRuleError("VALIDATION_ERROR", "You can't regularize a future date.");
    const inHhmm = input.checkIn || (input.requestedPunchIn ? istTimeString(new Date(input.requestedPunchIn)) : "");
    const outHhmm = input.checkOut || (input.requestedPunchOut ? istTimeString(new Date(input.requestedPunchOut)) : "");
    if (!inHhmm || !outHhmm) throw new BusinessRuleError("VALIDATION_ERROR", "Both login and logout times are required for a missed punch.");
    const checkInAt = istTimeOnDate(date, inHhmm);
    const checkOutAt = istTimeOnDate(date, outHhmm);
    if (checkOutAt <= checkInAt) throw new BusinessRuleError("VALIDATION_ERROR", "Logout time must be after login time.");
    await assertSessionTimesAllowed(prisma, actor.companyId, employee.id, checkInAt, checkOutAt);
    const record = await prisma.attendanceRecord.findUnique({ where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: dateKeyToDbDate(date) } }, select: { id: true } });
    Object.assign(data, { attendanceDate: dateKeyToDbDate(date), attendanceRecordId: record?.id ?? null, requestedPunchIn: checkInAt, requestedPunchOut: checkOutAt });
  } else if (type === "CHANGE_LOGIN" || type === "CHANGE_LOGOUT" || type === "MISSED_LOGOUT") {
    if (!input.sessionId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the punch session to change.");
    const session = await loadSessionForEmployee(input.sessionId, employee.id, actor.companyId);
    const dayKey = session.attendanceRecord.attendanceDate.toISOString().slice(0, 10);
    let checkInAt = session.checkInAt;
    let checkOutAt = session.checkOutAt;
    if (type === "CHANGE_LOGIN") {
      if (!input.checkIn) throw new BusinessRuleError("VALIDATION_ERROR", "The new login time is required.");
      if (!session.checkOutAt) throw new BusinessRuleError("VALIDATION_ERROR", "This session has no logout yet — raise a Missed Logout instead.");
      checkInAt = istTimeOnDate(dayKey, input.checkIn);
      if (checkInAt >= session.checkOutAt) throw new BusinessRuleError("VALIDATION_ERROR", "The new login time must be before the logout time.");
      Object.assign(data, { requestedPunchIn: checkInAt });
    } else {
      if (!input.checkOut) throw new BusinessRuleError("VALIDATION_ERROR", "The logout time is required.");
      if (type === "MISSED_LOGOUT" && session.checkOutAt) throw new BusinessRuleError("VALIDATION_ERROR", "This session already has a logout — raise Change Logout instead.");
      if (type === "CHANGE_LOGOUT" && !session.checkOutAt) throw new BusinessRuleError("VALIDATION_ERROR", "This session has no logout yet — raise a Missed Logout instead.");
      checkOutAt = timeOnDay(dayKey, input.checkOut, session.checkInAt);
      Object.assign(data, { requestedPunchOut: checkOutAt });
    }
    await assertSessionTimesAllowed(prisma, actor.companyId, employee.id, checkInAt, checkOutAt, session.id);
    Object.assign(data, { sessionId: session.id, attendanceRecordId: session.attendanceRecordId, attendanceDate: session.attendanceRecord.attendanceDate });
  } else if (type === "LEAVE_NOT_TAKEN") {
    const { from, to } = requireRange(input);
    const days = await prisma.leaveDay.findMany({
      where: { employeeId: employee.id, taken: true, leaveDate: { gte: dateKeyToDbDate(from), lte: dateKeyToDbDate(to) }, leaveRequest: { status: "APPROVED" } },
      select: { id: true },
    });
    if (days.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "There is no approved leave in those dates to cancel.");
    Object.assign(data, { dateFrom: dateKeyToDbDate(from), dateTo: dateKeyToDbDate(to), attendanceDate: dateKeyToDbDate(from) });
  } else if (type === "EMERGENCY_LEAVE") {
    const { from, to } = requireRange(input);
    if (to > istDateKey(new Date())) throw new BusinessRuleError("VALIDATION_ERROR", "Emergency leave is for days already passed — apply normal leave for future dates.");
    if (!input.leaveTypeId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the leave type.");
    const leaveType = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: actor.companyId, isActive: true }, select: { id: true } });
    if (!leaveType) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id: input.leaveTypeId });
    const working = await workingDaysBetween(actor.companyId, employee, from, to);
    if (working.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Those dates are all weekly offs or holidays.");
    const clash = await prisma.leaveDay.findFirst({
      where: { employeeId: employee.id, taken: true, leaveDate: { in: working.map(dateKeyToDbDate) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
      select: { leaveDate: true },
    });
    if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `Leave already exists for ${clash.leaveDate.toISOString().slice(0, 10)}.`);
    Object.assign(data, { dateFrom: dateKeyToDbDate(from), dateTo: dateKeyToDbDate(to), leaveTypeId: leaveType.id, attendanceDate: dateKeyToDbDate(from) });
  }

  const request = await AttendanceCorrectionRepository.create(data);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: { type, employeeId: employee.id, sessionId: data.sessionId ?? null, requestedPunchIn: data.requestedPunchIn ?? null, requestedPunchOut: data.requestedPunchOut ?? null, dateFrom: input.dateFrom || null, dateTo: input.dateTo || null },
  });

  if (employee.reportsToId) {
    const manager = await findLinkedUserId(actor.companyId, employee.reportsToId);
    if (manager) {
      await createNotification({
        companyId: actor.companyId,
        userId: manager.id,
        title: `New regularization: ${TYPE_LABELS[type]}`,
        body: `${employee.fullName} raised a ${TYPE_LABELS[type].toLowerCase()} request.`,
        relatedModule: "ATTENDANCE_CORRECTION",
        relatedRecordId: request.id,
      }).catch(() => undefined);
    }
  }
  return request;
}

/** Applies an approved request inside the approval transaction. Returns the day keys whose overtime must be recalculated. */
async function applyRegularization(tx: Tx, actor: ActorContext, req: NonNullable<Awaited<ReturnType<typeof AttendanceCorrectionRepository.findAnyById>>>): Promise<string[]> {
  switch (req.type) {
    case "MISSED_PUNCH": {
      if (!req.requestedPunchIn || !req.requestedPunchOut) throw new BusinessRuleError("VALIDATION_ERROR", "This request has no times to apply.");
      const dayKey = req.attendanceDate.toISOString().slice(0, 10);
      if (req.sessionId) {
        const s = await tx.attendanceSession.findFirst({ where: { id: req.sessionId, employeeId: req.employeeId } });
        if (!s) throw new BusinessRuleError("NOT_FOUND", "The punch session no longer exists.");
        await assertSessionTimesAllowed(tx, actor.companyId, req.employeeId, req.requestedPunchIn, req.requestedPunchOut, s.id);
        await tx.attendanceSession.update({ where: { id: s.id }, data: { checkInAt: req.requestedPunchIn, checkOutAt: req.requestedPunchOut, updatedByUserId: actor.userId } });
        await syncDayRecord(tx, s.attendanceRecordId);
      } else {
        await assertSessionTimesAllowed(tx, actor.companyId, req.employeeId, req.requestedPunchIn, req.requestedPunchOut);
        const record = await getOrCreateDayRecord(tx, actor.companyId, req.employeeId, dayKey, actor.userId);
        await tx.attendanceSession.create({
          data: {
            companyId: actor.companyId,
            attendanceRecordId: record.id,
            employeeId: req.employeeId,
            checkInAt: req.requestedPunchIn,
            checkOutAt: req.requestedPunchOut,
            source: "REGULARIZATION",
            status: "PRESENT",
            inAddress: "Regularized",
            remarks: `Regularization: ${req.reason}`,
            createdByUserId: actor.userId,
          },
        });
        await syncDayRecord(tx, record.id);
        await tx.attendanceCorrectionRequest.update({ where: { id: req.id }, data: { attendanceRecordId: record.id } });
      }
      return [dayKey];
    }
    case "CHANGE_LOGIN":
    case "CHANGE_LOGOUT":
    case "MISSED_LOGOUT": {
      if (!req.sessionId) throw new BusinessRuleError("VALIDATION_ERROR", "This request has no session.");
      const s = await tx.attendanceSession.findFirst({ where: { id: req.sessionId, employeeId: req.employeeId }, include: { attendanceRecord: { select: { attendanceDate: true } } } });
      if (!s) throw new BusinessRuleError("NOT_FOUND", "The punch session no longer exists.");
      const openRejection = await tx.outdoorRejection.findFirst({ where: { sessionId: s.id, status: { in: ["PENDING", "IN_PROCESS"] } }, select: { id: true } });
      if (openRejection) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This punch has an open outdoor rejection — settle that first.");
      const checkInAt = req.type === "CHANGE_LOGIN" ? req.requestedPunchIn! : s.checkInAt;
      const checkOutAt = req.type === "CHANGE_LOGIN" ? s.checkOutAt : req.requestedPunchOut!;
      if (req.type === "CHANGE_LOGIN" && (!checkOutAt || checkInAt >= checkOutAt)) throw new BusinessRuleError("VALIDATION_ERROR", "The new login time must be before the logout time.");
      await assertSessionTimesAllowed(tx, actor.companyId, req.employeeId, checkInAt, checkOutAt, s.id);
      await tx.attendanceSession.update({ where: { id: s.id }, data: { checkInAt, checkOutAt, updatedByUserId: actor.userId } });
      await syncDayRecord(tx, s.attendanceRecordId);
      return [s.attendanceRecord.attendanceDate.toISOString().slice(0, 10)];
    }
    case "LEAVE_NOT_TAKEN": {
      const days = await tx.leaveDay.findMany({
        where: { employeeId: req.employeeId, taken: true, leaveDate: { gte: req.dateFrom!, lte: req.dateTo! }, leaveRequest: { status: "APPROVED" } },
      });
      if (days.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "There is no approved leave left in those dates.");
      for (const d of days) await refundLeaveDay(tx, d);
      return [];
    }
    case "EMERGENCY_LEAVE": {
      const employee = await tx.employee.findUniqueOrThrow({ where: { id: req.employeeId }, select: { attendanceProfile: { select: { useCompanyWeekends: true, weekends: true } } } });
      const working = await workingDaysBetween(actor.companyId, employee, req.dateFrom!.toISOString().slice(0, 10), req.dateTo!.toISOString().slice(0, 10));
      const clash = await tx.leaveDay.findFirst({ where: { employeeId: req.employeeId, taken: true, leaveDate: { in: working.map(dateKeyToDbDate) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } } });
      if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `Leave already exists for ${clash.leaveDate.toISOString().slice(0, 10)}.`);
      const leaveRequest = await tx.leaveRequest.create({
        data: {
          companyId: actor.companyId,
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId!,
          startDate: dateKeyToDbDate(working[0]),
          endDate: dateKeyToDbDate(working[working.length - 1]),
          reason: `Emergency leave: ${req.reason}`,
          status: "APPROVED",
          approvedByUserId: actor.userId,
          decidedAt: new Date(),
          createdByUserId: req.createdByUserId,
        },
      });
      for (const key of working) {
        const day = await tx.leaveDay.create({
          data: { companyId: actor.companyId, leaveRequestId: leaveRequest.id, employeeId: req.employeeId, leaveDate: dateKeyToDbDate(key), durationType: "FULL", fraction: leaveFraction("FULL") },
        });
        await deductLeaveDay(tx, actor.companyId, day, req.leaveTypeId!);
      }
      return [];
    }
  }
  return [];
}

/**
 * Approve (old updateRegularizationStatus): the change is applied in the same
 * transaction. A repeat of the same decision is a no-op; deciding an already
 * decided request is a 409.
 */
export async function approveAttendanceCorrectionRequest(actor: ActorContext, id: string) {
  const existing = await AttendanceCorrectionRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Attendance correction request not found.", { id });
  if (existing.status === "APPROVED") return AttendanceCorrectionRepository.findById(id);
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This request is already "${existing.status}".`, { currentStatus: existing.status });
  }
  await PermissionService.assert(actor.userId, "hrms_attendance_regularization", "approve", { createdBy: existing.createdByUserId });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_regularization", existing.employeeId, { label: "Attendance correction request", id });
  const ownUser = await findLinkedUserId(actor.companyId, existing.employeeId);
  if (ownUser?.id === actor.userId) await PermissionService.assert(actor.userId, "hrms_attendance_regularization", "approve", { createdBy: actor.userId });

  let changedDays: string[] = [];
  await prisma.$transaction(async (tx) => {
    const res = await tx.attendanceCorrectionRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", approvedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: null },
    });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request was already decided.");
    changedDays = await applyRegularization(tx, actor, existing);
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "PENDING" },
    newValues: { status: "APPROVED", type: existing.type },
  });
  for (const key of changedDays) await onAttendanceDayChanged(actor.companyId, existing.employeeId, key);

  if (ownUser) {
    await createNotification({
      companyId: actor.companyId,
      userId: ownUser.id,
      title: `${TYPE_LABELS[existing.type]} approved`,
      body: `Your ${TYPE_LABELS[existing.type].toLowerCase()} request was approved.`,
      relatedModule: "ATTENDANCE_CORRECTION",
      relatedRecordId: id,
    }).catch(() => undefined);
  }
  return AttendanceCorrectionRepository.findById(id);
}

export async function rejectAttendanceCorrectionRequest(actor: ActorContext, id: string, input: RejectAttendanceCorrectionInput) {
  const existing = await AttendanceCorrectionRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Attendance correction request not found.", { id });
  if (existing.status === "REJECTED") return AttendanceCorrectionRepository.findById(id);
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This request is already "${existing.status}".`, { currentStatus: existing.status });
  }
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_regularization", existing.employeeId, { label: "Attendance correction request", id });

  const res = await prisma.attendanceCorrectionRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", approvedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: input.reason },
  });
  if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request was already decided.");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_attendance_correction_requests",
    recordId: id,
    action: "REJECT",
    oldValues: { status: "PENDING" },
    newValues: { status: "REJECTED", rejectionReason: input.reason },
  });

  const requester = await findLinkedUserId(actor.companyId, existing.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: `${TYPE_LABELS[existing.type]} rejected`,
      body: `Your ${TYPE_LABELS[existing.type].toLowerCase()} request was rejected: ${input.reason}`,
      relatedModule: "ATTENDANCE_CORRECTION",
      relatedRecordId: id,
    }).catch(() => undefined);
  }
  return AttendanceCorrectionRepository.findById(id);
}

/** Pending regularizations block finalising a salary month (old salary.js). */
export async function countPendingRegularizations(companyId: string, employeeIds: string[] | null) {
  return prisma.attendanceCorrectionRequest.count({ where: { companyId, status: "PENDING", ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) } });
}

// ─── Proof documents (shared AttachmentService, scope-checked here) ──────

async function assertCorrectionVisible(actor: ActorContext, id: string) {
  const req = await AttendanceCorrectionRepository.findAnyById(actor.companyId, id);
  if (!req) throw new BusinessRuleError("NOT_FOUND", "Attendance correction request not found.", { id });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance_regularization", req.employeeId, { label: "Attendance correction request", id });
  return req;
}

export async function listCorrectionDocuments(actor: ActorContext, id: string) {
  await assertCorrectionVisible(actor, id);
  return listAttachments(actor.companyId, "ATTENDANCE_CORRECTION", id);
}

export async function addCorrectionDocument(actor: ActorContext, id: string, file: File) {
  const req = await assertCorrectionVisible(actor, id);
  if (file.size > 10 * 1024 * 1024) throw new BusinessRuleError("VALIDATION_ERROR", "A document must be 10 MB or smaller.");
  return uploadAttachment(actor, "ATTENDANCE_CORRECTION", id, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name || "document", mimeType: file.type || "application/octet-stream" }, req.status);
}

export async function readCorrectionDocument(actor: ActorContext, id: string, attachmentId: string) {
  await assertCorrectionVisible(actor, id);
  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, attachmentId);
  if (attachment.relatedModule !== "ATTENDANCE_CORRECTION" || attachment.relatedRecordId !== id) throw new BusinessRuleError("NOT_FOUND", "Document not found.", { id: attachmentId });
  return { attachment, buffer };
}

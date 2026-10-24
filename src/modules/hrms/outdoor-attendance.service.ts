import type { OutdoorRejectionStatus, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { readStoredFile } from "@/core/file-storage/FileStorage";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addDays, dateKeyToDbDate, monthDateKeys } from "./attendance-calculator";
import type { HrmsActor } from "./attendance-settings.service";
import { saveProofFile, syncDayRecord } from "./attendance-session.core";
import { assertSessionTimesAllowed } from "./attendance-session.service";
import { onAttendanceDayChanged } from "./attendance-events";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";

/**
 * Old outdoor flow (code, not the doc):
 *  - approve      → the outside punch is accepted (stored as REMOTE = "approved outside")
 *  - reject       → times are trimmed to admin-entered values; originals kept
 *  - employee     → accept the trim, or clarify (reason + proof) → IN_PROCESS
 *  - admin decide → APPROVED restores the original times; REJECTED keeps the trim
 *  - cancel       → restores the original times
 */

const ACTIVE: OutdoorRejectionStatus[] = ["PENDING", "IN_PROCESS"];

function monthRange(month?: string) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return undefined;
  const [y, m] = month.split("-").map(Number);
  const keys = monthDateKeys(y, m);
  return { gte: dateKeyToDbDate(keys[0]), lt: dateKeyToDbDate(addDays(keys[keys.length - 1], 1)) };
}

async function linkedEmployeeId(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  return user?.employeeId ?? null;
}

async function employeeUserId(employeeId: string) {
  const user = await prisma.user.findFirst({ where: { employeeId }, select: { id: true } });
  return user?.id ?? null;
}

async function notify(companyId: string, employeeId: string, title: string, body: string) {
  const userId = await employeeUserId(employeeId);
  if (userId) await createNotification({ companyId, userId, title, body }).catch(() => undefined);
}

function dayKeyOf(session: { attendanceRecord: { attendanceDate: Date } }) {
  return session.attendanceRecord.attendanceDate.toISOString().slice(0, 10);
}

/** Outside punches still waiting for an admin decision. */
export async function listUnverifiedSessions(actor: HrmsActor, filters: { month?: string; employeeId?: string }) {
  const scope = await getHrmsEmployeeScope(actor.userId, "hrms_attendance");
  const range = monthRange(filters.month);
  return prisma.attendanceSession.findMany({
    where: {
      companyId: actor.companyId,
      ...hrmsEmployeeWhere(scope),
      ...(filters.employeeId ? { AND: [{ employeeId: filters.employeeId }] } : {}),
      status: "PRESENT_FROM_OUTSIDE",
      outdoorRejections: { none: { status: { in: ACTIVE } } },
      ...(range ? { attendanceRecord: { attendanceDate: range } } : {}),
    },
    include: {
      employee: { select: { id: true, employeeCode: true, fullName: true } },
      inLocation: { select: { name: true } },
      outLocation: { select: { name: true } },
      attendanceRecord: { select: { attendanceDate: true } },
    },
    orderBy: { checkInAt: "desc" },
    take: 500,
  });
}

/** Old bulk approve: the outside punches are accepted as they are. */
export async function approveOutdoorSessions(actor: HrmsActor, sessionIds: string[]) {
  let approved = 0;
  for (const id of sessionIds) {
    const session = await prisma.attendanceSession.findFirst({ where: { id, companyId: actor.companyId }, select: { id: true, employeeId: true, status: true } });
    if (!session || session.status !== "PRESENT_FROM_OUTSIDE") continue;
    await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", session.employeeId, { label: "Attendance session", id });
    if ((await linkedEmployeeId(actor.userId)) === session.employeeId) {
      throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "You can't approve your own outside punch.");
    }
    const res = await prisma.attendanceSession.updateMany({ where: { id, status: "PRESENT_FROM_OUTSIDE" }, data: { status: "REMOTE", updatedByUserId: actor.userId } });
    if (res.count === 0) continue;
    approved++;
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_attendance_sessions", recordId: id, action: "APPROVE", oldValues: { status: "PRESENT_FROM_OUTSIDE" }, newValues: { status: "REMOTE", outdoorApproved: true } });
  }
  return { approved };
}

export interface RejectOutdoorInput {
  reason: string;
  trimmedCheckInAt: string;
  trimmedCheckOutAt?: string | null;
}

/** Reject = trim the times to what the admin allows; originals are kept for a later restore. */
export async function rejectOutdoorSession(actor: HrmsActor, sessionId: string, input: RejectOutdoorInput) {
  const session = await prisma.attendanceSession.findFirst({ where: { id: sessionId, companyId: actor.companyId }, include: { attendanceRecord: { select: { attendanceDate: true } } } });
  if (!session) throw new BusinessRuleError("NOT_FOUND", "Attendance session not found.", { id: sessionId });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", session.employeeId, { label: "Attendance session", id: sessionId });
  if (session.status !== "PRESENT_FROM_OUTSIDE" && session.status !== "REMOTE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an outside punch can be rejected.");
  if (!session.checkOutAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The employee hasn't punched out yet — reject after the session is closed.");
  if ((await linkedEmployeeId(actor.userId)) === session.employeeId) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "You can't reject your own punch.");
  if (!input.reason.trim()) throw new BusinessRuleError("VALIDATION_ERROR", "A reason is required.");
  const active = await prisma.outdoorRejection.findFirst({ where: { sessionId, status: { in: ACTIVE } }, select: { id: true } });
  if (active) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This punch already has an open rejection.");

  const trimmedIn = new Date(input.trimmedCheckInAt);
  const trimmedOut = input.trimmedCheckOutAt ? new Date(input.trimmedCheckOutAt) : null;
  if (Number.isNaN(trimmedIn.getTime()) || (trimmedOut && Number.isNaN(trimmedOut.getTime()))) throw new BusinessRuleError("VALIDATION_ERROR", "Allowed times are not valid.");
  if (!trimmedOut) throw new BusinessRuleError("VALIDATION_ERROR", "Allowed check-out time is required.");

  const rejection = await prisma.$transaction(async (tx) => {
    await assertSessionTimesAllowed(tx, actor.companyId, session.employeeId, trimmedIn, trimmedOut, session.id);
    const created = await tx.outdoorRejection.create({
      data: {
        companyId: actor.companyId,
        employeeId: session.employeeId,
        sessionId,
        originalCheckIn: session.checkInAt,
        originalCheckOut: session.checkOutAt,
        trimmedCheckIn: trimmedIn,
        trimmedCheckOut: trimmedOut,
        rejectedReason: input.reason.trim(),
        rejectedByUserId: actor.userId,
      },
    });
    await tx.attendanceSession.update({ where: { id: sessionId }, data: { checkInAt: trimmedIn, checkOutAt: trimmedOut, status: "PRESENT_FROM_OUTSIDE", updatedByUserId: actor.userId } });
    await syncDayRecord(tx, session.attendanceRecordId);
    return created;
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_outdoor_rejections",
    recordId: rejection.id,
    action: "REJECT",
    oldValues: { checkInAt: session.checkInAt.toISOString(), checkOutAt: session.checkOutAt.toISOString() },
    newValues: { checkInAt: trimmedIn.toISOString(), checkOutAt: trimmedOut.toISOString(), reason: input.reason },
  });
  await onAttendanceDayChanged(actor.companyId, session.employeeId, dayKeyOf(session));
  await notify(actor.companyId, session.employeeId, "Outside punch rejected", `Your punch on ${dayKeyOf(session)} was trimmed: ${input.reason}. Accept it or send a clarification from My Attendance.`);
  return rejection;
}

const REJECTION_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  rejectedBy: { select: { id: true, fullName: true } },
  session: { select: { id: true, inLatitude: true, inLongitude: true, inDistanceMeters: true, outDistanceMeters: true, attendanceRecord: { select: { attendanceDate: true } } } },
} satisfies Prisma.OutdoorRejectionInclude;

export async function listOutdoorRejections(actor: HrmsActor, filters: { mine?: boolean; status?: OutdoorRejectionStatus; month?: string }) {
  let employeeWhere: Prisma.OutdoorRejectionWhereInput;
  if (filters.mine) {
    employeeWhere = { employeeId: (await linkedEmployeeId(actor.userId)) ?? "00000000-0000-0000-0000-000000000000" };
  } else {
    employeeWhere = hrmsEmployeeWhere(await getHrmsEmployeeScope(actor.userId, "hrms_attendance"));
  }
  const range = monthRange(filters.month);
  const rows = await prisma.outdoorRejection.findMany({
    where: { companyId: actor.companyId, ...employeeWhere, ...(filters.status ? { status: filters.status } : {}), ...(range ? { originalCheckIn: range } : {}) },
    include: REJECTION_INCLUDE,
    orderBy: { rejectedAt: "desc" },
    take: 500,
  });
  return rows.map(({ clarificationProofKey, ...r }) => ({ ...r, hasProof: !!clarificationProofKey }));
}

async function loadRejection(actor: HrmsActor, id: string) {
  const r = await prisma.outdoorRejection.findFirst({ where: { id, companyId: actor.companyId }, include: { session: { include: { attendanceRecord: { select: { attendanceDate: true } } } } } });
  if (!r) throw new BusinessRuleError("NOT_FOUND", "Outdoor rejection not found.", { id });
  return r;
}

/** Employee accepts the trimmed times. */
export async function acceptOutdoorRejection(actor: HrmsActor, id: string) {
  const r = await loadRejection(actor, id);
  if ((await linkedEmployeeId(actor.userId)) !== r.employeeId) throw new BusinessRuleError("NOT_FOUND", "Outdoor rejection not found.", { id });
  if (r.status === "APPROVED") return r;
  if (r.status !== "PENDING") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This rejection can no longer be accepted.");
  await prisma.outdoorRejection.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED", decidedAt: new Date() } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_outdoor_rejections", recordId: id, action: "UPDATE", oldValues: { status: r.status }, newValues: { status: "APPROVED", acceptedByEmployee: true } });
  return loadRejection(actor, id);
}

/** Employee explains the outside punch with a reason and optional proof. */
export async function clarifyOutdoorRejection(actor: HrmsActor, id: string, reason: string, proof: File | null) {
  const r = await loadRejection(actor, id);
  if ((await linkedEmployeeId(actor.userId)) !== r.employeeId) throw new BusinessRuleError("NOT_FOUND", "Outdoor rejection not found.", { id });
  if (r.status !== "PENDING") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A clarification can only be sent while the rejection is pending.");
  if (!reason.trim()) throw new BusinessRuleError("VALIDATION_ERROR", "Please explain why you punched from outside.");
  const stored = proof ? await saveProofFile(proof) : null;
  const res = await prisma.outdoorRejection.updateMany({
    where: { id, status: "PENDING" },
    data: {
      status: "IN_PROCESS",
      clarificationReason: reason.trim(),
      clarificationProofKey: stored?.storageKey ?? null,
      clarificationProofMime: stored?.mimeType ?? null,
      clarificationProofName: stored?.fileName ?? null,
      clarifiedAt: new Date(),
    },
  });
  if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This rejection was already handled.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_outdoor_rejections", recordId: id, action: "UPDATE", oldValues: { status: "PENDING" }, newValues: { status: "IN_PROCESS", clarification: reason.trim(), proof: !!stored } });
  const approverIds = await prisma.user.findFirst({ where: { id: r.rejectedByUserId }, select: { id: true } });
  if (approverIds) await createNotification({ companyId: actor.companyId, userId: approverIds.id, title: "Outside punch clarification", body: `A clarification was sent for the punch on ${dayKeyOf(r.session)}.` }).catch(() => undefined);
  return loadRejection(actor, id);
}

async function restoreOriginalTimes(tx: Prisma.TransactionClient, actor: HrmsActor, r: Awaited<ReturnType<typeof loadRejection>>) {
  await assertSessionTimesAllowed(tx, actor.companyId, r.employeeId, r.originalCheckIn, r.originalCheckOut, r.sessionId);
  await tx.attendanceSession.update({ where: { id: r.sessionId }, data: { checkInAt: r.originalCheckIn, checkOutAt: r.originalCheckOut, status: "REMOTE", updatedByUserId: actor.userId } });
  await syncDayRecord(tx, r.session.attendanceRecordId);
}

/** Admin decision on a clarification: APPROVED restores the original times. */
export async function decideOutdoorClarification(actor: HrmsActor, id: string, decision: "APPROVED" | "REJECTED") {
  const r = await loadRejection(actor, id);
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", r.employeeId, { label: "Outdoor rejection", id });
  if (r.status === decision) return r;
  if (r.status !== "IN_PROCESS") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a clarification that is in process can be decided.");
  const ownUserId = await employeeUserId(r.employeeId);
  if (decision === "APPROVED") await PermissionService.assert(actor.userId, "hrms_attendance", "approve", { createdBy: ownUserId ?? undefined });
  else await PermissionService.assert(actor.userId, "hrms_attendance", "reject");

  await prisma.$transaction(async (tx) => {
    const res = await tx.outdoorRejection.updateMany({ where: { id, status: "IN_PROCESS" }, data: { status: decision, decidedByUserId: actor.userId, decidedAt: new Date() } });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This clarification was already decided.");
    if (decision === "APPROVED") await restoreOriginalTimes(tx, actor, r);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_outdoor_rejections", recordId: id, action: decision === "APPROVED" ? "APPROVE" : "REJECT", oldValues: { status: "IN_PROCESS" }, newValues: { status: decision, restoredOriginalTimes: decision === "APPROVED" } });
  if (decision === "APPROVED") await onAttendanceDayChanged(actor.companyId, r.employeeId, dayKeyOf(r.session));
  await notify(actor.companyId, r.employeeId, `Clarification ${decision === "APPROVED" ? "approved" : "rejected"}`, decision === "APPROVED" ? `Your original punch times on ${dayKeyOf(r.session)} were restored.` : `Your clarification for ${dayKeyOf(r.session)} was rejected; the trimmed times stay.`);
  return loadRejection(actor, id);
}

/** Admin cancels the rejection: original times restored. */
export async function cancelOutdoorRejection(actor: HrmsActor, id: string) {
  const r = await loadRejection(actor, id);
  await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", r.employeeId, { label: "Outdoor rejection", id });
  if (!ACTIVE.includes(r.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an open rejection can be cancelled.");
  await prisma.$transaction(async (tx) => {
    const res = await tx.outdoorRejection.updateMany({
      where: { id, status: { in: ACTIVE } },
      data: { status: "APPROVED", isRevoked: true, revokedByUserId: actor.userId, revokedAt: new Date(), decidedByUserId: actor.userId, decidedAt: new Date() },
    });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This rejection was already handled.");
    await restoreOriginalTimes(tx, actor, r);
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_outdoor_rejections", recordId: id, action: "CANCEL", oldValues: { status: r.status }, newValues: { status: "APPROVED", revoked: true, restoredOriginalTimes: true } });
  await onAttendanceDayChanged(actor.companyId, r.employeeId, dayKeyOf(r.session));
  await notify(actor.companyId, r.employeeId, "Outside punch rejection cancelled", `Your original punch times on ${dayKeyOf(r.session)} were restored.`);
  return loadRejection(actor, id);
}

/** Proof file: the employee or anyone who can see their attendance. */
export async function readOutdoorProof(actor: HrmsActor, id: string) {
  const r = await loadRejection(actor, id);
  if ((await linkedEmployeeId(actor.userId)) !== r.employeeId) {
    await assertHrmsEmployeeInScope(actor.userId, "hrms_attendance", r.employeeId, { label: "Proof", id });
  }
  if (!r.clarificationProofKey) throw new BusinessRuleError("NOT_FOUND", "No proof uploaded.", { id });
  return { buffer: await readStoredFile(r.clarificationProofKey), mimeType: r.clarificationProofMime ?? "application/octet-stream", fileName: r.clarificationProofName ?? "proof" };
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { LeaveRequestRepository, LeaveTypeRepository } from "./leave.repository";
import type { CreateLeaveRequestInput, CreateLeaveTypeInput, RejectLeaveRequestInput, UpdateLeaveTypeInput } from "./leave.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Inclusive day count (Aug 1 -> Aug 3 is 3 days, matching how leave is
 * always counted in practice, not an exclusive date-math span). */
function inclusiveDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
}

export async function listLeaveTypes(companyId: string) {
  return LeaveTypeRepository.findMany(companyId);
}

export async function createLeaveType(actor: ActorContext, input: CreateLeaveTypeInput) {
  const leaveType = await LeaveTypeRepository.create({ companyId: actor.companyId, name: input.name, annualDays: input.annualDays, isActive: input.isActive });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_leave_types", recordId: leaveType.id, action: "CREATE", newValues: input });
  return leaveType;
}

export async function updateLeaveType(actor: ActorContext, id: string, input: UpdateLeaveTypeInput) {
  const existing = await LeaveTypeRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id });
  const updated = await LeaveTypeRepository.update(id, { name: input.name, annualDays: input.annualDays, isActive: input.isActive });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_leave_types", recordId: id, action: "UPDATE", newValues: input });
  return updated;
}

/**
 * Running balance the source never tracked at all (it only stores a flat
 * `days` quota with no consumption ledger) — the one deliberate improvement
 * flagged in the migration report. Computed live from APPROVED requests
 * overlapping the given calendar year, never a stored "remaining" counter
 * that could drift.
 */
export async function getLeaveBalance(companyId: string, employeeId: string, leaveTypeId: string, year: number) {
  const leaveType = await prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId } });
  if (!leaveType) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id: leaveTypeId });

  const approved = await LeaveRequestRepository.findApprovedInYear(employeeId, leaveTypeId, year);
  const yearStart = new Date(`${year}-01-01`);
  const yearEnd = new Date(`${year}-12-31`);
  const usedDays = approved.reduce((sum, r) => {
    const clippedStart = r.startDate < yearStart ? yearStart : r.startDate;
    const clippedEnd = r.endDate > yearEnd ? yearEnd : r.endDate;
    return sum + inclusiveDayCount(clippedStart, clippedEnd);
  }, 0);

  const annualDays = Number(leaveType.annualDays);
  return { annualDays, usedDays, remainingDays: Math.max(0, annualDays - usedDays) };
}

export async function listLeaveRequests(companyId: string, query: ListQuery, status?: string) {
  const where: Prisma.LeaveRequestWhereInput = {
    companyId,
    ...(status ? { status: status as never } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    LeaveRequestRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    LeaveRequestRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function createLeaveRequest(actor: ActorContext, input: CreateLeaveRequestInput) {
  const employee = await prisma.employee.findFirst({ where: { id: input.employeeId, companyId: actor.companyId }, select: { id: true } });
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: input.employeeId });
  const leaveType = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: actor.companyId }, select: { id: true } });
  if (!leaveType) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id: input.leaveTypeId });

  const request = await LeaveRequestRepository.create({
    companyId: actor.companyId,
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    startDate: new Date(input.startDate),
    endDate: new Date(input.endDate),
    reason: input.reason || null,
    status: "PENDING",
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: { employeeId: input.employeeId, leaveTypeId: input.leaveTypeId, startDate: input.startDate, endDate: input.endDate },
  });

  return request;
}

/**
 * Blocks approving past the employee's own remaining balance — the exact
 * "obvious real-world gap" the migration report flags the source as having
 * (it lets any leave request through with no balance check at all).
 * annualDays === 0 is treated as "unlimited / not tracked" so a genuinely
 * unconfigured leave type never blocks approval.
 */
export async function approveLeaveRequest(actor: ActorContext, id: string) {
  const existing = await LeaveRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave request not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This leave request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  const year = existing.startDate.getFullYear();
  const balance = await getLeaveBalance(actor.companyId, existing.employeeId, existing.leaveTypeId, year);
  const requestedDays = inclusiveDayCount(existing.startDate, existing.endDate);

  if (balance.annualDays > 0 && requestedDays > balance.remainingDays) {
    throw new BusinessRuleError(
      "LEAVE_BALANCE_EXCEEDED",
      `Cannot approve — this request is for ${requestedDays} day(s), but only ${balance.remainingDays} day(s) remain of this leave type for ${year}.`,
      { requestedDays, remainingDays: balance.remainingDays, year }
    );
  }

  const updated = await LeaveRequestRepository.update(id, { status: "APPROVED", approvedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "PENDING" },
    newValues: { status: "APPROVED" },
  });

  return updated;
}

export async function rejectLeaveRequest(actor: ActorContext, id: string, input: RejectLeaveRequestInput) {
  const existing = await LeaveRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave request not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This leave request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  const updated = await LeaveRequestRepository.update(id, { status: "REJECTED", approvedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: input.reason });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "PENDING" },
    newValues: { status: "REJECTED", rejectionReason: input.reason },
  });

  return updated;
}

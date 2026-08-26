import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNotification } from "@/core/notifications/NotificationService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { HrConfigRepository } from "@/modules/hr-config/hr-config.repository";
import { LeaveBalanceCarryForwardRepository, LeaveRequestRepository, LeaveTypeRepository } from "./leave.repository";
import type { CreateLeaveRequestInput, CreateLeaveTypeInput, RejectLeaveRequestInput, UpdateLeaveTypeInput } from "./leave.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD, matching how @db.Date columns round-trip through Prisma —
 * comparing sliced ISO strings avoids the local-timezone Date-construction
 * pitfalls already documented elsewhere in this project (see
 * dashboard.reports.ts's startOfDay comment). */
function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * HRMS gap-analysis Priority 2 item: HolidayMaster existed since Phase 3 but
 * had no caller outside its own CRUD — a company holiday fell inside a leave
 * range and silently cost the employee a real leave day. Fetches every
 * active holiday in [start, end] once as a lookup set (leave ranges are
 * always short, so a day-by-day scan against it is cheap and simple — no
 * need for interval-overlap SQL).
 */
async function countHolidayDaysInRange(companyId: string, start: Date, end: Date): Promise<Set<string>> {
  const holidays = await HrConfigRepository.holidayMaster.findMany({
    where: { companyId, isActive: true, date: { gte: start, lte: end } },
    select: { date: true },
  });
  return new Set(holidays.map((h) => toDateKey(h.date)));
}

/** Inclusive day count (Aug 1 -> Aug 3 is 3 days, matching how leave is
 * always counted in practice) minus any company holiday inside the range —
 * this is what a leave request actually costs the employee's balance. */
function countLeaveDays(start: Date, end: Date, holidayKeys: Set<string>): number {
  let days = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
    if (!holidayKeys.has(toDateKey(new Date(t)))) days++;
  }
  return days;
}

/** The `Notification` table is keyed on a User, not an Employee — resolves
 * the login account (if any) linked to a given Employee via the existing
 * `User.employeeId` FK. Employees with no login account (most shop-floor
 * staff) simply get no notification, not an error. */
function findLinkedUserId(companyId: string, employeeId: string) {
  return prisma.user.findFirst({ where: { companyId, employeeId }, select: { id: true } });
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
  const holidayKeys = await countHolidayDaysInRange(companyId, yearStart, yearEnd);
  const usedDays = approved.reduce((sum, r) => {
    const clippedStart = r.startDate < yearStart ? yearStart : r.startDate;
    const clippedEnd = r.endDate > yearEnd ? yearEnd : r.endDate;
    return sum + countLeaveDays(clippedStart, clippedEnd, holidayKeys);
  }, 0);

  // Carried-in days from the prior year's unused balance (HRMS gap-analysis
  // Priority 2 item) — added on top of the leave type's own annualDays, not
  // a separate bucket, so an existing caller reading remainingDays gets the
  // correct total without knowing carry-forward exists at all.
  const carriedInDays = await LeaveBalanceCarryForwardRepository.sumForYear(companyId, employeeId, leaveTypeId, year);
  const annualDays = Number(leaveType.annualDays) + carriedInDays;
  return { annualDays, usedDays, remainingDays: Math.max(0, annualDays - usedDays), carriedInDays };
}

/**
 * Manually-triggered batch computation (no job runner exists in this
 * project — see LeaveBalanceCarryForward's own schema comment), computing
 * each active employee's unused balance for `fromYear` per active leave
 * type and carrying it into `fromYear + 1`. Idempotent per employee+
 * leaveType — re-running for the same fromYear skips pairs already carried
 * forward rather than double-crediting them.
 */
export async function runLeaveCarryForward(actor: ActorContext, fromYear: number) {
  const toYear = fromYear + 1;

  const [employees, leaveTypes, existing] = await Promise.all([
    prisma.employee.findMany({ where: { companyId: actor.companyId, isActive: true, deletedAt: null }, select: { id: true } }),
    LeaveTypeRepository.findMany(actor.companyId),
    LeaveBalanceCarryForwardRepository.findExistingForYear(actor.companyId, toYear),
  ]);

  const alreadyCarried = new Set(existing.map((e) => `${e.employeeId}:${e.leaveTypeId}`));
  // annualDays === 0 means "unlimited/untracked" (see getLeaveBalance's own
  // comment) — nothing meaningful to carry forward for those.
  const eligibleLeaveTypes = leaveTypes.filter((lt) => lt.isActive && Number(lt.annualDays) > 0);

  let carryForwardsCreated = 0;
  let totalDaysCarried = 0;

  for (const employee of employees) {
    for (const leaveType of eligibleLeaveTypes) {
      if (alreadyCarried.has(`${employee.id}:${leaveType.id}`)) continue;

      const balance = await getLeaveBalance(actor.companyId, employee.id, leaveType.id, fromYear);
      if (balance.remainingDays <= 0) continue;

      await LeaveBalanceCarryForwardRepository.create({
        companyId: actor.companyId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        fromYear,
        toYear,
        carriedDays: balance.remainingDays,
        createdByUserId: actor.userId,
      });
      carryForwardsCreated++;
      totalDaysCarried += balance.remainingDays;
    }
  }

  return { fromYear, toYear, employeesProcessed: employees.length, carryForwardsCreated, totalDaysCarried };
}

export async function listLeaveCarryForwards(companyId: string, toYear?: number) {
  return LeaveBalanceCarryForwardRepository.findMany(companyId, toYear);
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
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, companyId: actor.companyId },
    select: { id: true, fullName: true, reportsToId: true },
  });
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

  // Notify the employee's reporting manager (if the hierarchy is set and the
  // manager has a login account) that a new request is waiting on them.
  // Silently skipped otherwise — most shop-floor employees have neither.
  if (employee.reportsToId) {
    const manager = await findLinkedUserId(actor.companyId, employee.reportsToId);
    if (manager) {
      const holidayKeys = await countHolidayDaysInRange(actor.companyId, request.startDate, request.endDate);
      const requestedDays = countLeaveDays(request.startDate, request.endDate, holidayKeys);
      await createNotification({
        companyId: actor.companyId,
        userId: manager.id,
        title: "New leave request pending approval",
        body: `${employee.fullName} requested ${requestedDays} day(s) of leave (${input.startDate} to ${input.endDate}).`,
        relatedModule: "LEAVE_REQUEST",
        relatedRecordId: request.id,
      });
    }
  }

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

  // Re-asserted here (the route's own assert has no resourceContext) so the
  // self-approval guard — keyed on this specific request's creator — can
  // actually apply, matching Campaign's approveCampaign() and every other
  // approve checkpoint in this app. Previously omitted, which let a
  // MANAGEMENT-role user approve their own leave request.
  await PermissionService.assert(actor.userId, "hrms_leave", "approve", { createdBy: existing.createdByUserId });

  const year = existing.startDate.getFullYear();
  const balance = await getLeaveBalance(actor.companyId, existing.employeeId, existing.leaveTypeId, year);
  const requestHolidayKeys = await countHolidayDaysInRange(actor.companyId, existing.startDate, existing.endDate);
  const requestedDays = countLeaveDays(existing.startDate, existing.endDate, requestHolidayKeys);

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

  const requester = await findLinkedUserId(actor.companyId, updated.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: "Leave request approved",
      body: `Your leave request for ${requestedDays} day(s) (${existing.startDate.toISOString().slice(0, 10)} to ${existing.endDate.toISOString().slice(0, 10)}) has been approved.`,
      relatedModule: "LEAVE_REQUEST",
      relatedRecordId: id,
    });
  }

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

  const requester = await findLinkedUserId(actor.companyId, updated.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: "Leave request rejected",
      body: `Your leave request for ${existing.startDate.toISOString().slice(0, 10)} to ${existing.endDate.toISOString().slice(0, 10)} was rejected: ${input.reason}`,
      relatedModule: "LEAVE_REQUEST",
      relatedRecordId: id,
    });
  }

  return updated;
}

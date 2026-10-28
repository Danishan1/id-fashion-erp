import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createNotification } from "@/core/notifications/NotificationService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { HrConfigRepository } from "@/modules/hr-config/hr-config.repository";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";
import { LeaveBalanceCarryForwardRepository, LeaveRequestRepository, LeaveTypeRepository } from "./leave.repository";
import { addDays, dateKeyToDbDate, dateKeysBetween, isValidDateKey, leaveFraction, weekdayOf, type LeaveDuration } from "./attendance-calculator";
import { effectiveWeekends, getAttendanceSettings } from "./attendance-settings.service";
import { deductLeaveDay } from "./leave-balance.service";
import { assertSalaryMonthOpen, monthKeysBetween } from "./salary-month-lock";
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
  const leaveType = await LeaveTypeRepository.create({ companyId: actor.companyId, name: input.name, annualDays: input.annualDays, allocationType: input.allocationType, quotaPerPeriod: input.quotaPerPeriod, isActive: input.isActive });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_leave_types", recordId: leaveType.id, action: "CREATE", newValues: input });
  return leaveType;
}

export async function updateLeaveType(actor: ActorContext, id: string, input: UpdateLeaveTypeInput) {
  const existing = await LeaveTypeRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id });
  const updated = await LeaveTypeRepository.update(id, { name: input.name, annualDays: input.annualDays, allocationType: input.allocationType, quotaPerPeriod: input.quotaPerPeriod, isActive: input.isActive });
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

export async function listLeaveRequests(actor: ActorContext, query: ListQuery, status?: string, options: { mine?: boolean } = {}) {
  let employeeWhere: Prisma.LeaveRequestWhereInput;
  if (options.mine) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
    employeeWhere = { employeeId: user?.employeeId ?? "00000000-0000-0000-0000-000000000000" };
  } else {
    employeeWhere = hrmsEmployeeWhere(await getHrmsEmployeeScope(actor.userId, "hrms_leave"));
  }
  const where: Prisma.LeaveRequestWhereInput = {
    companyId: actor.companyId,
    ...employeeWhere,
    ...(status ? { status: status as never } : {}),
    ...(query.search ? { employee: { fullName: { contains: query.search, mode: "insensitive" as const } } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    LeaveRequestRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    LeaveRequestRepository.count(where),
  ]);

  return { data, totalCount };
}

/** The employee to apply leave for: the one given (HR / manager), else the caller's own. */
async function resolveLeaveEmployee(actor: ActorContext, employeeId?: string | null) {
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
  await assertHrmsEmployeeInScope(actor.userId, "hrms_leave", employee.id, { label: "Employee", id: employee.id });
  return employee;
}

/**
 * Apply for leave day by day (old createLeave): each day Full / Half /
 * Quarter. With `includeSandwich`, weekly offs that sit between two applied
 * days are added as full sandwich leave days (old "sandwich Sunday", fix F14:
 * actually added on the server). Weekly offs / holidays can't be applied for
 * directly, and a day already on leave (pending or approved) is refused.
 */
export async function createLeaveRequest(actor: ActorContext, input: CreateLeaveRequestInput) {
  const employee = await resolveLeaveEmployee(actor, input.employeeId);
  const leaveType = await prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: actor.companyId, isActive: true }, select: { id: true, name: true } });
  if (!leaveType) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id: input.leaveTypeId });

  const settings = await getAttendanceSettings(actor.companyId);
  const weekends = new Set(effectiveWeekends(settings, employee.attendanceProfile));
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const keys = days.map((d) => d.date);
  if (new Set(keys).size !== keys.length) throw new BusinessRuleError("VALIDATION_ERROR", "The same date is listed twice.");
  for (const k of keys) if (!isValidDateKey(k)) throw new BusinessRuleError("VALIDATION_ERROR", `"${k}" is not a valid date.`);

  const holidays = await prisma.holidayMaster.findMany({
    where: { companyId: actor.companyId, isActive: true, date: { gte: dateKeyToDbDate(keys[0]), lte: dateKeyToDbDate(keys[keys.length - 1]) } },
    select: { date: true, name: true },
  });
  const holidayByKey = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h.name]));
  for (const k of keys) {
    if (holidayByKey.has(k)) throw new BusinessRuleError("VALIDATION_ERROR", `${k} is a holiday (${holidayByKey.get(k)}) — no leave is needed.`);
    if (weekends.has(weekdayOf(k))) throw new BusinessRuleError("VALIDATION_ERROR", `${k} is your weekly off — no leave is needed.`);
  }

  const rows: { date: string; duration: LeaveDuration; isSandwich: boolean }[] = days.map((d) => ({ date: d.date, duration: d.duration, isSandwich: false }));
  if (input.includeSandwich) {
    for (let i = 0; i + 1 < days.length; i++) {
      const between = dateKeysBetween(addDays(days[i].date, 1), addDays(days[i + 1].date, -1));
      if (between.length > 0 && between.every((k) => weekends.has(weekdayOf(k)) || holidayByKey.has(k))) {
        for (const k of between) if (weekends.has(weekdayOf(k))) rows.push({ date: k, duration: "FULL", isSandwich: true });
      }
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  const clash = await prisma.leaveDay.findFirst({
    where: { employeeId: employee.id, taken: true, leaveDate: { in: rows.map((r) => dateKeyToDbDate(r.date)) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
    select: { leaveDate: true },
  });
  if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `Leave is already applied for ${clash.leaveDate.toISOString().slice(0, 10)}.`);

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        companyId: actor.companyId,
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: dateKeyToDbDate(rows[0].date),
        endDate: dateKeyToDbDate(rows[rows.length - 1].date),
        reason: input.reason || null,
        status: "PENDING",
        createdByUserId: actor.userId,
      },
    });
    await tx.leaveDay.createMany({
      data: rows.map((r) => ({
        companyId: actor.companyId,
        leaveRequestId: created.id,
        employeeId: employee.id,
        leaveDate: dateKeyToDbDate(r.date),
        durationType: r.duration,
        fraction: leaveFraction(r.duration),
        isSandwich: r.isSandwich,
      })),
    });
    return created;
  });

  const totalDays = rows.reduce((s, r) => s + leaveFraction(r.duration), 0);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_requests",
    recordId: request.id,
    action: "CREATE",
    newValues: { employeeId: employee.id, leaveTypeId: leaveType.id, days: rows, totalDays },
  });

  if (employee.reportsToId) {
    const manager = await findLinkedUserId(actor.companyId, employee.reportsToId);
    if (manager) {
      await createNotification({
        companyId: actor.companyId,
        userId: manager.id,
        title: "New leave request pending approval",
        body: `${employee.fullName} applied for ${totalDays} day(s) of ${leaveType.name} (${rows[0].date} to ${rows[rows.length - 1].date}).`,
        relatedModule: "LEAVE_REQUEST",
        relatedRecordId: request.id,
      });
    }
  }

  return LeaveRequestRepository.findById(request.id);
}

/**
 * Approve: every day is deducted from its own month's balance — remaining
 * first, then carry-forward — and marked PAID, or NOT_PAID when the balance
 * doesn't cover it (old updateLeaveStatus, fixes F1/F2). All in one
 * transaction. Requests from before the per-day model are approved as before.
 */
export async function approveLeaveRequest(actor: ActorContext, id: string) {
  const existing = await LeaveRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave request not found.", { id });
  if (existing.status === "APPROVED") return LeaveRequestRepository.findById(id);
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This leave request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  // Re-asserted with the request's creator so the self-approval guard applies.
  await PermissionService.assert(actor.userId, "hrms_leave", "approve", { createdBy: existing.createdByUserId });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_leave", existing.employeeId, { label: "Leave request", id });
  await assertSalaryMonthOpen(actor.companyId, monthKeysBetween(existing.startDate, existing.endDate));

  let paid = 0;
  let unpaid = 0;
  await prisma.$transaction(async (tx) => {
    const res = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", approvedByUserId: actor.userId, decidedAt: new Date(), rejectionReason: null },
    });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This leave request was already decided.");
    const days = await tx.leaveDay.findMany({ where: { leaveRequestId: id, taken: true }, orderBy: { leaveDate: "asc" } });
    for (const day of days) {
      const plan = await deductLeaveDay(tx, actor.companyId, day, existing.leaveTypeId);
      if (plan.paymentType === "PAID") paid += Number(day.fraction);
      else unpaid += Number(day.fraction);
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_requests",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "PENDING" },
    newValues: { status: "APPROVED", paidDays: paid, unpaidDays: unpaid },
  });

  const requester = await findLinkedUserId(actor.companyId, existing.employeeId);
  if (requester) {
    await createNotification({
      companyId: actor.companyId,
      userId: requester.id,
      title: "Leave request approved",
      body: `Your leave (${existing.startDate.toISOString().slice(0, 10)} to ${existing.endDate.toISOString().slice(0, 10)}) was approved${unpaid > 0 ? ` — ${paid} day(s) paid, ${unpaid} day(s) unpaid (not enough balance)` : ""}.`,
      relatedModule: "LEAVE_REQUEST",
      relatedRecordId: id,
    });
  }

  return LeaveRequestRepository.findById(id);
}


export async function rejectLeaveRequest(actor: ActorContext, id: string, input: RejectLeaveRequestInput) {
  const existing = await LeaveRequestRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Leave request not found.", { id });
  if (existing.status !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This leave request is already "${existing.status}".`, { currentStatus: existing.status });
  }

  await assertHrmsEmployeeInScope(actor.userId, "hrms_leave", existing.employeeId, { label: "Leave request", id });

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

/** For the apply form: each date's weekday, weekly off / holiday, and any leave already on it. */
export async function getLeaveDayInfo(actor: ActorContext, employeeId: string | null | undefined, from: string, to: string) {
  const employee = await resolveLeaveEmployee(actor, employeeId);
  if (!isValidDateKey(from) || !isValidDateKey(to) || to < from) throw new BusinessRuleError("VALIDATION_ERROR", "Choose a valid date range.");
  const keys = dateKeysBetween(from, to);
  if (keys.length > 62) throw new BusinessRuleError("VALIDATION_ERROR", "A range can be at most 62 days.");
  const settings = await getAttendanceSettings(actor.companyId);
  const weekends = new Set(effectiveWeekends(settings, employee.attendanceProfile));
  const [holidays, existing] = await Promise.all([
    prisma.holidayMaster.findMany({ where: { companyId: actor.companyId, isActive: true, date: { gte: dateKeyToDbDate(from), lte: dateKeyToDbDate(to) } }, select: { date: true, name: true } }),
    prisma.leaveDay.findMany({
      where: { employeeId: employee.id, taken: true, leaveDate: { gte: dateKeyToDbDate(from), lte: dateKeyToDbDate(to) }, leaveRequest: { status: { in: ["PENDING", "APPROVED"] } } },
      select: { leaveDate: true, leaveRequest: { select: { status: true } } },
    }),
  ]);
  const holidayByKey = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h.name]));
  const leaveByKey = new Map(existing.map((d) => [d.leaveDate.toISOString().slice(0, 10), d.leaveRequest.status]));
  return {
    employee: { id: employee.id, fullName: employee.fullName },
    days: keys.map((k) => ({ date: k, weekday: weekdayOf(k), isWeekend: weekends.has(weekdayOf(k)), holidayName: holidayByKey.get(k) ?? null, existingLeave: leaveByKey.get(k) ?? null })),
  };
}

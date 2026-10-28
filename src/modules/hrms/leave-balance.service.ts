import type { LeaveAllocationType, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { istDateKey, planLeaveDeduction, round2 } from "./attendance-calculator";
import type { HrmsActor } from "./attendance-settings.service";
import { assertHrmsEmployeeInScope, getHrmsEmployeeScope, hrmsEmployeeWhere } from "./hrms-scope";

/**
 * Monthly leave balances (old LeaveBalance model, bugs fixed):
 *  - one row per employee × leave type × month
 *  - `allocated` = the leave type's quota, credited only at the start of its
 *    allocation period (monthly / quarterly / half-yearly / yearly) — fix F3
 *  - new month: carryForward = previous remaining + previous carryForward;
 *    remaining = allocated (no double counting — fix F3)
 *  - a leave day deducts from remaining first, then carryForward; PAID only
 *    when they cover the fraction, else NOT_PAID
 *  - any change to a month's availability cascades into later months'
 *    carryForward, so the chain always adds up.
 */

type Tx = Prisma.TransactionClient;

/** Months back we will rebuild a missing chain (keeps a forgotten employee bounded). */
const MAX_CHAIN_MONTHS = 36;

export function ym(year: number, month: number) {
  return year * 12 + (month - 1);
}
function fromYm(v: number) {
  return { year: Math.floor(v / 12), month: (v % 12) + 1 };
}

/** Is `month` the first month of an allocation period? */
export function isCreditMonth(allocationType: LeaveAllocationType, month: number): boolean {
  switch (allocationType) {
    case "MONTHLY":
      return true;
    case "QUARTERLY":
      return month % 3 === 1;
    case "HALF_YEARLY":
      return month === 1 || month === 7;
    case "YEARLY":
      return month === 1;
  }
}

export function creditFor(leaveType: { allocationType: LeaveAllocationType; quotaPerPeriod: Prisma.Decimal | number }, month: number) {
  return isCreditMonth(leaveType.allocationType, month) ? round2(Number(leaveType.quotaPerPeriod)) : 0;
}

/** The balance row for a month, building any missing months in between (and before, up to a limit). */
export async function ensureBalance(tx: Tx, companyId: string, employeeId: string, leaveTypeId: string, year: number, month: number) {
  const existing = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year_month: { employeeId, leaveTypeId, year, month } } });
  if (existing) return existing;
  const leaveType = await tx.leaveType.findFirst({ where: { id: leaveTypeId, companyId } });
  if (!leaveType) throw new BusinessRuleError("NOT_FOUND", "Leave type not found.", { id: leaveTypeId });

  const target = ym(year, month);
  const prev = await tx.leaveBalance.findFirst({
    where: { employeeId, leaveTypeId, OR: [{ year: { lt: year } }, { year, month: { lt: month } }] },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  let start = prev ? ym(prev.year, prev.month) + 1 : target;
  if (target - start > MAX_CHAIN_MONTHS) start = target - MAX_CHAIN_MONTHS;
  let carry = prev ? round2(Number(prev.remaining) + Number(prev.carryForward)) : 0;

  let row = null;
  for (let v = start; v <= target; v++) {
    const { year: y, month: m } = fromYm(v);
    const allocated = creditFor(leaveType, m);
    row = await tx.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year_month: { employeeId, leaveTypeId, year: y, month: m } },
      create: { companyId, employeeId, leaveTypeId, year: y, month: m, allocated, remaining: allocated, used: 0, carryForward: carry },
      update: {},
    });
    carry = round2(Number(row.remaining) + Number(row.carryForward));
  }
  return row!;
}

/**
 * After a month's (remaining + carryForward) changed by `delta`, push the same
 * change into every later month's carryForward. If a later month already
 * used its carry, the shortfall comes out of that month's remaining.
 */
export async function cascadeAvailability(tx: Tx, employeeId: string, leaveTypeId: string, year: number, month: number, delta: number) {
  if (Math.abs(delta) < 1e-9) return;
  const later = await tx.leaveBalance.findMany({
    where: { employeeId, leaveTypeId, OR: [{ year: { gt: year } }, { year, month: { gt: month } }] },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  let d = delta;
  for (const row of later) {
    let carry = round2(Number(row.carryForward) + d);
    let remaining = Number(row.remaining);
    if (carry < 0) {
      remaining = round2(Math.max(0, remaining + carry));
      carry = 0;
    }
    const newAvailable = remaining + carry;
    const oldAvailable = Number(row.remaining) + Number(row.carryForward);
    await tx.leaveBalance.update({ where: { id: row.id }, data: { carryForward: carry, remaining } });
    d = round2(newAvailable - oldAvailable);
    if (Math.abs(d) < 1e-9) break;
  }
}

/** Deduct one leave day: remaining first, then carryForward; NOT_PAID when not covered. */
export async function deductLeaveDay(tx: Tx, companyId: string, day: { id: string; employeeId: string; leaveDate: Date; fraction: Prisma.Decimal | number }, leaveTypeId: string) {
  const key = day.leaveDate.toISOString().slice(0, 10);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const balance = await ensureBalance(tx, companyId, day.employeeId, leaveTypeId, year, month);
  const fraction = Number(day.fraction);
  const plan = planLeaveDeduction(fraction, Number(balance.remaining), Number(balance.carryForward));
  if (plan.paymentType === "PAID") {
    const res = await tx.leaveBalance.updateMany({
      where: { id: balance.id, remaining: { gte: plan.fromRemaining }, carryForward: { gte: plan.fromCarry } },
      data: { remaining: { decrement: plan.fromRemaining }, carryForward: { decrement: plan.fromCarry }, used: { increment: fraction } },
    });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The leave balance changed while approving — please try again.");
    await cascadeAvailability(tx, day.employeeId, leaveTypeId, year, month, -(plan.fromRemaining + plan.fromCarry));
  } else {
    await tx.leaveBalance.update({ where: { id: balance.id }, data: { used: { increment: fraction } } });
  }
  await tx.leaveDay.update({
    where: { id: day.id },
    data: { paymentType: plan.paymentType, paidFromRemaining: plan.fromRemaining, paidFromCarry: plan.fromCarry, leaveBalanceId: balance.id },
  });
  return plan;
}

/** Leave Not Taken: give back exactly what the day took, to the month it came from. */
export async function refundLeaveDay(tx: Tx, day: { id: string; employeeId: string; fraction: Prisma.Decimal | number; paidFromRemaining: Prisma.Decimal | number; paidFromCarry: Prisma.Decimal | number; leaveBalanceId: string | null }) {
  const fraction = Number(day.fraction);
  const fromRemaining = Number(day.paidFromRemaining);
  const fromCarry = Number(day.paidFromCarry);
  if (day.leaveBalanceId) {
    const balance = await tx.leaveBalance.findUnique({ where: { id: day.leaveBalanceId } });
    if (balance) {
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { remaining: { increment: fromRemaining }, carryForward: { increment: fromCarry }, used: Number(balance.used) >= fraction ? { decrement: fraction } : 0 },
      });
      await cascadeAvailability(tx, day.employeeId, balance.leaveTypeId, balance.year, balance.month, fromRemaining + fromCarry);
    }
  }
  await tx.leaveDay.update({ where: { id: day.id }, data: { taken: false } });
  return { refunded: round2(fromRemaining + fromCarry), fraction };
}

/**
 * Salary Management (2026-10-28): switch a taken leave day between Paid and
 * Not Paid. Paid → Not Paid gives the balance back to the month it came from;
 * Not Paid → Paid takes it from that month's remaining first, then
 * carry-forward, and refuses when the balance doesn't cover the day. `used`
 * is untouched (the leave is still taken either way).
 */
export async function switchLeaveDayPayment(
  tx: Tx,
  companyId: string,
  day: { id: string; employeeId: string; leaveDate: Date; fraction: Prisma.Decimal | number; paymentType: "PAID" | "NOT_PAID" | null; paidFromRemaining: Prisma.Decimal | number; paidFromCarry: Prisma.Decimal | number; leaveBalanceId: string | null },
  leaveTypeId: string,
  to: "PAID" | "NOT_PAID"
): Promise<{ fromRemaining: number; fromCarry: number }> {
  const from = day.paymentType ?? "PAID";
  if (from === to) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This leave day is already ${to === "PAID" ? "paid" : "unpaid"}.`);

  if (to === "NOT_PAID") {
    const fromRemaining = Number(day.paidFromRemaining);
    const fromCarry = Number(day.paidFromCarry);
    if (day.leaveBalanceId && fromRemaining + fromCarry > 0) {
      const balance = await tx.leaveBalance.findUnique({ where: { id: day.leaveBalanceId } });
      if (balance) {
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { remaining: { increment: fromRemaining }, carryForward: { increment: fromCarry } } });
        await cascadeAvailability(tx, day.employeeId, balance.leaveTypeId, balance.year, balance.month, fromRemaining + fromCarry);
      }
    }
    await tx.leaveDay.update({ where: { id: day.id }, data: { paymentType: "NOT_PAID", paidFromRemaining: 0, paidFromCarry: 0 } });
    return { fromRemaining, fromCarry };
  }

  const key = day.leaveDate.toISOString().slice(0, 10);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const balance = await ensureBalance(tx, companyId, day.employeeId, leaveTypeId, year, month);
  const fraction = Number(day.fraction);
  const plan = planLeaveDeduction(fraction, Number(balance.remaining), Number(balance.carryForward));
  if (plan.paymentType !== "PAID") {
    const available = round2(Number(balance.remaining) + Number(balance.carryForward));
    throw new BusinessRuleError("VALIDATION_ERROR", `Not enough leave balance to make this day paid — ${available} day(s) available, ${fraction} needed.`, { available, needed: fraction });
  }
  const res = await tx.leaveBalance.updateMany({
    where: { id: balance.id, remaining: { gte: plan.fromRemaining }, carryForward: { gte: plan.fromCarry } },
    data: { remaining: { decrement: plan.fromRemaining }, carryForward: { decrement: plan.fromCarry } },
  });
  if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The leave balance changed — please try again.");
  await cascadeAvailability(tx, day.employeeId, leaveTypeId, year, month, -(plan.fromRemaining + plan.fromCarry));
  await tx.leaveDay.update({ where: { id: day.id }, data: { paymentType: "PAID", paidFromRemaining: plan.fromRemaining, paidFromCarry: plan.fromCarry, leaveBalanceId: balance.id } });
  return { fromRemaining: plan.fromRemaining, fromCarry: plan.fromCarry };
}

/** Make sure every active employee has this month's balance for every active leave type (the monthly credit). */
export async function creditMonthForCompany(companyId: string, year: number, month: number) {
  const [employees, leaveTypes] = await Promise.all([
    prisma.employee.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true } }),
    prisma.leaveType.findMany({ where: { companyId, isActive: true }, select: { id: true } }),
  ]);
  let created = 0;
  for (const e of employees) {
    for (const t of leaveTypes) {
      const had = await prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year_month: { employeeId: e.id, leaveTypeId: t.id, year, month } }, select: { id: true } });
      if (had) continue;
      await prisma.$transaction((tx) => ensureBalance(tx, companyId, e.id, t.id, year, month));
      created++;
    }
  }
  return { employees: employees.length, leaveTypes: leaveTypes.length, created };
}

/** Worker job: credit the current IST month for every active company (idempotent). */
export async function creditCurrentMonthForAllCompanies(now: Date = new Date()) {
  const key = istDateKey(now);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const companies = await prisma.company.findMany({ where: { isActive: true }, select: { id: true } });
  let created = 0;
  for (const c of companies) created += (await creditMonthForCompany(c.id, year, month)).created;
  return { year, month, companies: companies.length, created };
}

export async function runMonthlyCredit(actor: HrmsActor, year: number, month: number) {
  const result = await creditMonthForCompany(actor.companyId, year, month);
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_leave_balances", recordId: actor.companyId, action: "CREATE", newValues: { monthlyCredit: `${year}-${month}`, ...result } });
  return result;
}

/** Balances for a month, scoped to the caller's HRMS team (or one employee). */
export async function listLeaveBalances(actor: HrmsActor, filters: { year: number; month: number; employeeId?: string; mine?: boolean }) {
  let employeeIds: string[] | null;
  if (filters.mine) {
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
    employeeIds = user?.employeeId ? [user.employeeId] : [];
  } else {
    employeeIds = await getHrmsEmployeeScope(actor.userId, ["hrms_leave_balances", "hrms_leave"]);
    if (filters.employeeId) employeeIds = (employeeIds ?? [filters.employeeId]).filter((id) => id === filters.employeeId);
  }
  // Lazily credit the month for the employees shown, so balances are never missing.
  const [employees, leaveTypes] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId: actor.companyId, isActive: true, deletedAt: null, ...(employeeIds === null ? {} : { id: { in: employeeIds } }) },
      select: { id: true },
      take: 2000,
    }),
    prisma.leaveType.findMany({ where: { companyId: actor.companyId, isActive: true }, select: { id: true } }),
  ]);
  for (const e of employees) {
    for (const t of leaveTypes) {
      const had = await prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year_month: { employeeId: e.id, leaveTypeId: t.id, year: filters.year, month: filters.month } }, select: { id: true } });
      if (!had) await prisma.$transaction((tx) => ensureBalance(tx, actor.companyId, e.id, t.id, filters.year, filters.month));
    }
  }
  const rows = await prisma.leaveBalance.findMany({
    where: { companyId: actor.companyId, year: filters.year, month: filters.month, ...hrmsEmployeeWhere(employeeIds), leaveType: { isActive: true } },
    include: { employee: { select: { id: true, employeeCode: true, fullName: true } }, leaveType: { select: { id: true, name: true, allocationType: true, quotaPerPeriod: true } } },
    orderBy: [{ employee: { fullName: "asc" } }, { leaveType: { name: "asc" } }],
  });
  return rows.map((r) => ({
    ...r,
    allocated: Number(r.allocated),
    used: Number(r.used),
    remaining: Number(r.remaining),
    carryForward: Number(r.carryForward),
    available: round2(Number(r.remaining) + Number(r.carryForward)),
    leaveType: { ...r.leaveType, quotaPerPeriod: Number(r.leaveType.quotaPerPeriod) },
  }));
}

/** Admin override of one month's quota (old leaveManagement). */
export async function adjustLeaveBalance(actor: HrmsActor, id: string, input: { allocated: number; remaining: number; carryForward: number }) {
  const row = await prisma.leaveBalance.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw new BusinessRuleError("NOT_FOUND", "Leave balance not found.", { id });
  await assertHrmsEmployeeInScope(actor.userId, "hrms_leave_balances", row.employeeId, { label: "Leave balance", id });
  for (const [k, v] of Object.entries(input)) if (!Number.isFinite(v) || v < 0) throw new BusinessRuleError("VALIDATION_ERROR", `${k} must be 0 or more.`);
  const oldAvailable = Number(row.remaining) + Number(row.carryForward);
  const delta = round2(input.remaining + input.carryForward - oldAvailable);
  await prisma.$transaction(async (tx) => {
    await tx.leaveBalance.update({ where: { id }, data: { allocated: input.allocated, remaining: input.remaining, carryForward: input.carryForward, isAdjusted: true } });
    await cascadeAvailability(tx, row.employeeId, row.leaveTypeId, row.year, row.month, delta);
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "hrms_leave_balances",
    recordId: id,
    action: "UPDATE",
    oldValues: { allocated: Number(row.allocated), remaining: Number(row.remaining), carryForward: Number(row.carryForward) },
    newValues: { ...input },
  });
  return prisma.leaveBalance.findUniqueOrThrow({ where: { id } });
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  leaveDay: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  leaveBalance: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() },
  leaveType: { findFirst: vi.fn() },
  leavePaymentChange: { create: vi.fn() },
  salaryAttendanceAdjustment: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));
const month = vi.hoisted(() => ({ computeEmployeesMonth: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./attendance-month.service", () => month);
vi.mock("./hrms-scope", () => ({ assertHrmsEmployeeInScope: vi.fn(), getHrmsEmployeeScope: vi.fn().mockResolvedValue(null) }));

const { adjustSalaryDays, switchLeavePayment, summarizeSalaryMonth } = await import("./salary-attendance.service");
const { switchLeaveDayPayment } = await import("./leave-balance.service");
const { bulkAdjustSchema } = await import("./salary-attendance.schema");

const actor = { companyId: "c1", userId: "u1" };
const EMP = "e1";

function day(dateKey: string, patch: Record<string, unknown> = {}) {
  return {
    dateKey,
    weekday: "MONDAY",
    isFuture: false,
    isPreJoining: false,
    isHoliday: false,
    holidayName: null,
    isWeekend: false,
    isSandwich: false,
    workedHours: 8.5,
    actualWorkedHours: 8.5,
    expectedHours: 9,
    leaveFraction: 0,
    present: 0.75,
    absent: 0.25,
    code: "SP",
    salaryAdjustment: null,
    ...patch,
  };
}

function monthOf(days: ReturnType<typeof day>[]) {
  return {
    employee: { id: EMP, employeeCode: "E1", fullName: "Ravi", shift: null },
    days,
    summary: { countedDays: days.length, presentDays: 1, paidLeaveDays: 0, unpaidLeaveDays: 0, weekendDays: 1, holidayDays: 0, absentDays: 0, extraPayableDays: 0, sandwichDays: 0, totalHours: 17 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.user.findUnique.mockResolvedValue({ employeeId: "someone-else" });
  db.user.findMany.mockResolvedValue([]);
  db.leaveDay.findMany.mockResolvedValue([]);
  db.salaryAttendanceAdjustment.findMany.mockResolvedValue([]);
});

describe("summarizeSalaryMonth", () => {
  it("cards: worked/working days, actual vs counted hours, expected = working days x shift hours", () => {
    const m = monthOf([day("2026-10-01"), day("2026-10-02", { workedHours: 9, actualWorkedHours: 8.5 }), day("2026-10-04", { isWeekend: true, workedHours: 0, actualWorkedHours: 0, present: 0 })]);
    const s = summarizeSalaryMonth(m as never);
    expect(s).toMatchObject({ workingDays: 2, workedDays: 2, actualHours: 17, adjustedHours: 17, expectedHours: 18, paidWeekends: 1 });
  });
});

describe("bulkAdjustSchema", () => {
  it("needs hours for fixed hours, a reason, and one month", () => {
    const ok = (p: object) => bulkAdjustSchema.safeParse({ dates: ["2026-10-01"], mode: "OFFICE_TIME", reason: "late bus", ...p }).success;
    expect(ok({})).toBe(true);
    expect(ok({ mode: "FIXED_HOURS" })).toBe(false);
    expect(ok({ mode: "FIXED_HOURS", hours: 9 })).toBe(true);
    expect(ok({ reason: "x" })).toBe(false);
    expect(ok({ dates: ["2026-10-01", "2026-11-01"] })).toBe(false);
  });
});

describe("adjustSalaryDays", () => {
  const input = (p: object = {}) => bulkAdjustSchema.parse({ dates: ["2026-10-01", "2026-10-02"], mode: "OFFICE_TIME", reason: "approved", ...p });

  it("replaces active adjustments and stores shift hours for office time, with the real hours", async () => {
    month.computeEmployeesMonth.mockResolvedValue([monthOf([day("2026-10-01"), day("2026-10-02", { actualWorkedHours: 7 })])]);
    await adjustSalaryDays(actor, EMP, input());
    expect(month.computeEmployeesMonth.mock.calls[0][5]).toEqual({ applySalaryAdjustments: true });
    expect(db.salaryAttendanceAdjustment.updateMany.mock.calls[0][0].data).toMatchObject({ removedByUserId: "u1", removeReason: "Replaced by a new adjustment" });
    const rows = db.salaryAttendanceAdjustment.createMany.mock.calls[0][0].data;
    expect(rows.map((r: { hours: number; actualHours: number; mode: string }) => [r.mode, r.hours, r.actualHours])).toEqual([
      ["OFFICE_TIME", 9, 8.5],
      ["OFFICE_TIME", 9, 7],
    ]);
  });

  it("full day stores no hours; fixed hours stores the given hours", async () => {
    month.computeEmployeesMonth.mockResolvedValue([monthOf([day("2026-10-01"), day("2026-10-02")])]);
    await adjustSalaryDays(actor, EMP, input({ mode: "FULL_DAY" }));
    expect(db.salaryAttendanceAdjustment.createMany.mock.calls[0][0].data[0].hours).toBeNull();
    await adjustSalaryDays(actor, EMP, input({ mode: "FIXED_HOURS", hours: 9 }));
    expect(db.salaryAttendanceAdjustment.createMany.mock.calls[1][0].data[0].hours).toBe(9);
  });

  it("refuses weekly offs, holidays, future and full-leave days", async () => {
    for (const patch of [{ isWeekend: true }, { isHoliday: true }, { isFuture: true }, { leaveFraction: 1 }]) {
      month.computeEmployeesMonth.mockResolvedValue([monthOf([day("2026-10-01", patch), day("2026-10-02")])]);
      await expect(adjustSalaryDays(actor, EMP, input())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(db.salaryAttendanceAdjustment.createMany).not.toHaveBeenCalled();
  });

  it("nobody adjusts their own attendance", async () => {
    db.user.findUnique.mockResolvedValue({ employeeId: EMP });
    await expect(adjustSalaryDays(actor, EMP, input())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

describe("switchLeaveDayPayment", () => {
  const leaveDay = (p: object = {}) => ({ id: "ld1", employeeId: EMP, leaveDate: new Date("2026-10-05"), fraction: 1, paymentType: "PAID" as const, paidFromRemaining: 0.5, paidFromCarry: 0.5, leaveBalanceId: "b1", ...p });

  it("Paid -> Unpaid gives the balance back and cascades it", async () => {
    db.leaveBalance.findUnique.mockResolvedValue({ id: "b1", leaveTypeId: "lt", year: 2026, month: 10 });
    db.leaveBalance.findMany.mockResolvedValue([]);
    const r = await switchLeaveDayPayment(db as never, "c1", leaveDay(), "lt", "NOT_PAID");
    expect(r).toEqual({ fromRemaining: 0.5, fromCarry: 0.5 });
    expect(db.leaveBalance.update.mock.calls[0][0].data).toEqual({ remaining: { increment: 0.5 }, carryForward: { increment: 0.5 } });
    expect(db.leaveDay.update.mock.calls[0][0].data).toEqual({ paymentType: "NOT_PAID", paidFromRemaining: 0, paidFromCarry: 0 });
  });

  it("Unpaid -> Paid takes remaining first, then carry-forward", async () => {
    db.leaveBalance.findUnique.mockResolvedValue({ id: "b1", remaining: 0.5, carryForward: 2 });
    db.leaveBalance.updateMany.mockResolvedValue({ count: 1 });
    db.leaveBalance.findMany.mockResolvedValue([]);
    const r = await switchLeaveDayPayment(db as never, "c1", leaveDay({ paymentType: "NOT_PAID", paidFromRemaining: 0, paidFromCarry: 0 }), "lt", "PAID");
    expect(r).toEqual({ fromRemaining: 0.5, fromCarry: 0.5 });
    expect(db.leaveDay.update.mock.calls[0][0].data).toMatchObject({ paymentType: "PAID", paidFromRemaining: 0.5, paidFromCarry: 0.5, leaveBalanceId: "b1" });
  });

  it("Unpaid -> Paid is refused when the balance doesn't cover the day", async () => {
    db.leaveBalance.findUnique.mockResolvedValue({ id: "b1", remaining: 0, carryForward: 0.5 });
    await expect(switchLeaveDayPayment(db as never, "c1", leaveDay({ paymentType: "NOT_PAID" }), "lt", "PAID")).rejects.toThrow(/Not enough leave balance/);
    expect(db.leaveDay.update).not.toHaveBeenCalled();
  });

  it("refuses a no-op switch", async () => {
    await expect(switchLeaveDayPayment(db as never, "c1", leaveDay(), "lt", "PAID")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("switchLeavePayment", () => {
  it("records the change with the balance it moved", async () => {
    db.leaveDay.findFirst.mockResolvedValue({ id: "ld1", employeeId: EMP, leaveDate: new Date("2026-10-05"), fraction: 1, paymentType: "PAID", paidFromRemaining: 1, paidFromCarry: 0, leaveBalanceId: "b1", leaveRequest: { leaveTypeId: "lt" } });
    db.leaveBalance.findUnique.mockResolvedValue({ id: "b1", leaveTypeId: "lt", year: 2026, month: 10 });
    db.leaveBalance.findMany.mockResolvedValue([]);
    month.computeEmployeesMonth.mockResolvedValue([monthOf([day("2026-10-05")])]);
    await switchLeavePayment(actor, "ld1", { to: "NOT_PAID", reason: "no balance agreed" });
    expect(db.leavePaymentChange.create.mock.calls[0][0].data).toMatchObject({ fromType: "PAID", toType: "NOT_PAID", fromRemaining: 1, fromCarry: 0, reason: "no balance agreed", changedByUserId: "u1" });
  });
});

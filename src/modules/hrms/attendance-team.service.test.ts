import { beforeEach, describe, expect, it, vi } from "vitest";

const hrmsScope = vi.hoisted(() => ({ getHrmsEmployeeScope: vi.fn(), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./hrms-scope", () => ({
  ...hrmsScope,
  hrmsEmployeeWhere: (scope: string[] | null) => (scope === null ? {} : { employeeId: { in: scope } }),
}));

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./attendance-correction.service", () => ({
  countPendingRegularizations: vi.fn().mockResolvedValue(0),
}));
vi.mock("./attendance-month.service", () => ({
  computeEmployeesMonth: vi.fn(),
}));
vi.mock("./leave-balance.service", () => ({
  ensureBalance: vi.fn(),
  cascadeAvailability: vi.fn(),
}));

vi.mock("@/core/db/client", () => {
  const p = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p)),
    employee: { findMany: vi.fn() },
    leaveType: { findMany: vi.fn() },
    leaveBalance: { findMany: vi.fn(), update: vi.fn() },
    autoLeaveHistory: { create: vi.fn() },
    attendanceMonthClose: { findUnique: vi.fn(), create: vi.fn() },
    salaryRun: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn() },
  };
  return { prisma: p };
});

const { prisma } = await import("@/core/db/client");
const { computeEmployeesMonth } = await import("./attendance-month.service");
const { ensureBalance } = await import("./leave-balance.service");
const { countPendingRegularizations } = await import("./attendance-correction.service");
const { getSalarySheet, finaliseSalaryMonth } = await import("./attendance-team.service");

const adminActor = { companyId: "co-1", userId: "admin-1", branchId: "br-1" };

beforeEach(() => {
  hrmsScope.getHrmsEmployeeScope.mockReset().mockResolvedValue(null);
  vi.mocked(countPendingRegularizations).mockReset().mockResolvedValue(0);

  vi.mocked(prisma.$transaction).mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma));
  vi.mocked(prisma.employee.findMany).mockReset().mockResolvedValue([{ id: "emp-1" }] as never);
  vi.mocked(prisma.leaveType.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.attendanceMonthClose.findUnique).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.attendanceMonthClose.create).mockReset().mockResolvedValue({ id: "close-1" } as never);
  vi.mocked(ensureBalance).mockReset();
});

describe("attendance-team.service (salary sheet arithmetic)", () => {
  it("computes hand-checked salary numbers on a 30-day month", async () => {
    // 30-day month (e.g. September 2026)
    // Gross: 30000 + 3000 + 2000 = 35000
    // Per day: 35000 / 30 = 1166.6666...
    // 20 present, 2 paid leave, 4 weekend, 1 holiday, 0 extra payable, 3 absent, 0 unpaid
    // 4 approved OT hours at 200/hr = 800
    vi.mocked(computeEmployeesMonth).mockResolvedValue([
      {
        employee: {
          id: "emp-1",
          employeeCode: "EMP001",
          fullName: "Asha Rao",
          shift: { name: "General", startTime: "09:00", endTime: "17:00" },
          joinDate: new Date("2026-01-01T00:00:00Z"),
          fixedMonthlySalary: 30000,
          travelAllowance: 3000,
          dearnessAllowance: 2000,
          overtimeRatePerHour: 200,
        },
        days: [],
        summary: {
          calendarDays: 30,
          countedDays: 30,
          workingDays: 25,
          weekendDays: 4,
          holidayDays: 1,
          sandwichDays: 0,
          presentDays: 20,
          paidLeaveDays: 2,
          unpaidLeaveDays: 0,
          absentDays: 3,
          extraPayableDays: 0,
          lateDays: 0,
          outsideDays: 0,
          totalHours: 160,
          zeroHourWorkdays: 3,
          approvedOvertimeHours: 4,
          pendingOvertimeHours: 0,
        },
      },
    ] as never);

    const sheet = await getSalarySheet(adminActor, 2026, 9);
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0];

    expect(row.grossMonthly).toBe(35000);
    expect(row.perDay).toBe(1166.67);
    expect(row.payableDays).toBe(27); // 20 + 2 + 4 + 1
    expect(row.deductionDays).toBe(3); // 3 absent
    expect(row.earnedAmount).toBe(31500); // 27 * 35000 / 30
    expect(row.deductionAmount).toBe(3500); // 3 * 35000 / 30
    expect(row.overtimePay).toBe(800); // 4 * 200
    expect(row.netPay).toBe(32300); // 31500 + 800
  });

  it("applies auto-paid leave for zero-hour workdays when employee has available quota", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([{ id: "lt-1" }] as never);
    // Employee has 2 days of available quota remaining
    vi.mocked(ensureBalance).mockResolvedValue({
      id: "lb-1",
      remaining: 1,
      carryForward: 1,
    } as never);

    vi.mocked(computeEmployeesMonth).mockResolvedValue([
      {
        employee: {
          id: "emp-1",
          employeeCode: "EMP001",
          fullName: "Asha Rao",
          shift: null,
          joinDate: new Date("2026-01-01T00:00:00Z"),
          fixedMonthlySalary: 30000,
          travelAllowance: 0,
          dearnessAllowance: 0,
          overtimeRatePerHour: null,
        },
        days: [],
        summary: {
          calendarDays: 30,
          countedDays: 30,
          workingDays: 25,
          weekendDays: 4,
          holidayDays: 1,
          sandwichDays: 0,
          presentDays: 20,
          paidLeaveDays: 2,
          unpaidLeaveDays: 0,
          absentDays: 3, // 3 absent days, all zero-hour workdays
          extraPayableDays: 0,
          lateDays: 0,
          outsideDays: 0,
          totalHours: 160,
          zeroHourWorkdays: 3,
          approvedOvertimeHours: 0,
          pendingOvertimeHours: 0,
        },
      },
    ] as never);

    const sheet = await getSalarySheet(adminActor, 2026, 9);
    const row = sheet.rows[0];

    // 2 days out of 3 absent days are auto-covered by the 2 available leave days
    expect(row.autoPaidLeaveDays).toBe(2);
    expect(row.absentDays).toBe(1); // 3 - 2 = 1
    expect(row.payableDays).toBe(29); // 20 + 2 + 4 + 1 + 2 auto-paid
    expect(row.earnedAmount).toBe(29000); // 29 * (30000 / 30) = 29000
    expect(row.deductionAmount).toBe(1000); // 1 * (30000 / 30) = 1000
  });

  it("finaliseSalaryMonth blocks if user does not have company-wide attendance scope", async () => {
    hrmsScope.getHrmsEmployeeScope.mockResolvedValue(["emp-1", "emp-2"]); // scoped manager, not all

    await expect(finaliseSalaryMonth(adminActor, 2026, 8)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: expect.stringContaining("Finalising a month needs company-wide attendance access"),
    });
  });

  it("finaliseSalaryMonth blocks if regularizations are still pending", async () => {
    vi.mocked(countPendingRegularizations).mockResolvedValue(2);

    await expect(finaliseSalaryMonth(adminActor, 2026, 8)).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("regularization request(s) are still pending"),
    });
  });
});

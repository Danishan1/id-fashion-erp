import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  salaryRun: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  salaryRunLine: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
  salaryRunLineEdit: { createMany: vi.fn(), count: vi.fn() },
  salaryRunEvent: { create: vi.fn() },
  attendanceMonthClose: { findUnique: vi.fn() },
  employeeSalarySetting: { findMany: vi.fn() },
  employee: { findMany: vi.fn() },
  leaveType: { findMany: vi.fn() },
  leaveBalance: { findMany: vi.fn(), update: vi.fn() },
  autoLeaveHistory: { upsert: vi.fn(), deleteMany: vi.fn() },
  salaryAdvanceRecovery: { createMany: vi.fn(), deleteMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
const perm = vi.hoisted(() => ({ assert: vi.fn(), can: vi.fn() }));
const month = vi.hoisted(() => ({ computeEmployeesMonth: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: perm }));
vi.mock("./attendance-month.service", () => month);
vi.mock("./attendance-correction.service", () => ({ countPendingRegularizations: vi.fn().mockResolvedValue(0) }));
vi.mock("./hrms-scope", () => ({ getHrmsEmployeeScope: vi.fn().mockResolvedValue(null), assertHrmsEmployeeInScope: vi.fn() }));
vi.mock("./leave-balance.service", () => ({ ensureBalance: vi.fn(), cascadeAvailability: vi.fn(), switchLeaveDayPayment: vi.fn() }));
const advances = vi.hoisted(() => ({ advanceInstallmentsFor: vi.fn() }));
vi.mock("./salary-advance.service", () => advances);
vi.mock("./salary-payout.service", () => ({ salaryRequestsForRun: vi.fn().mockResolvedValue([]), undoSendToAccountsInTx: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn().mockResolvedValue("JRN-1") }));

const svc = await import("./salary-run.service");
const { assertSalaryMonthOpen, monthKeysBetween } = await import("./salary-month-lock");

const actor = { companyId: "c1", userId: "u1" };
const setupRow = {
  employeeId: "e1",
  baseMonthlySalary: 30000,
  components: [],
  pfSetting: null,
  esicSetting: null,
  tdsAmount: 0,
  surchargeAmount: 0,
  educationCess: 0,
  lateFeeInterest: 0,
  panNumber: null,
  uanNumber: null,
  esicNumber: null,
  bankName: null,
  bankAccountNumber: null,
  bankIfsc: null,
  bankBranch: null,
  employee: { attendanceProfile: null },
};

function employeeMonth() {
  return {
    employee: { id: "e1", employeeCode: "E1", fullName: "Ravi" },
    days: [{ isFuture: false, isPreJoining: false, isHoliday: false, isWeekend: false, actualWorkedHours: 9, workedHours: 9, present: 1, expectedHours: 9, salaryAdjustment: null }],
    summary: { calendarDays: 30, countedDays: 30, presentDays: 20, paidLeaveDays: 1, unpaidLeaveDays: 0, absentDays: 4, weekendDays: 4, holidayDays: 1, extraPayableDays: 0, sandwichDays: 0, zeroHourWorkdays: 4, approvedOvertimeHours: 0, totalHours: 180 },
  };
}

function lineRow(patch: Record<string, unknown> = {}) {
  return {
    id: "l1",
    runId: "r1",
    employeeId: "e1",
    setupJson: { baseMonthlySalary: 30000, components: [], pf: null, esic: null, tdsAmount: 0, surchargeAmount: 0, educationCess: 0, lateFeeInterest: 0, overtimeRatePerHour: 0 },
    calendarDays: 30,
    systemPresentDays: 20,
    systemPaidLeaveDays: 3,
    systemExtraDays: 0,
    weekendDays: 4,
    holidayDays: 1,
    overtimeHours: 0,
    hasNoPunches: false,
    presentDays: null,
    paidLeaveDays: null,
    extraDays: null,
    arrearsAmount: 0,
    arrearsReason: null,
    run: { id: "r1", status: "DRAFT", year: 2026, month: 9 },
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: unknown) => (typeof fn === "function" ? (fn as (tx: typeof db) => unknown)(db) : fn));
  db.salaryRunLine.aggregate.mockResolvedValue({ _sum: { grossAmount: 0, totalDeductions: 0, netAmount: 0 } });
  db.salaryRunLine.updateMany.mockResolvedValue({ count: 1 });
  db.salaryRun.updateMany.mockResolvedValue({ count: 1 });
  db.salaryRun.findUnique.mockResolvedValue(null);
  db.attendanceMonthClose.findUnique.mockResolvedValue(null);
  db.employee.findMany.mockResolvedValue([]);
  db.employeeSalarySetting.findMany.mockResolvedValue([setupRow]);
  db.leaveType.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  db.salaryRunLineEdit.count.mockResolvedValue(0);
  month.computeEmployeesMonth.mockResolvedValue([employeeMonth()]);
  advances.advanceInstallmentsFor.mockResolvedValue(new Map());
});

describe("advance salary installments", () => {
  it("generate deducts the month's installment and keeps which advances it came from", async () => {
    advances.advanceInstallmentsFor.mockResolvedValue(new Map([["e1", { total: 3000, items: [{ advanceId: "a1", amount: 3000 }] }]]));
    db.salaryRun.create.mockResolvedValue({ id: "r1" });
    await svc.generateSalaryRun(actor, 2026, 9).catch(() => undefined);
    const data = db.salaryRunLine.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ installmentAmount: 3000, installmentJson: [{ advanceId: "a1", amount: 3000 }] });
    expect(data.netAmount).toBe(26000 - 3000);
  });

  it("finalise records the recoveries; reopen removes them", async () => {
    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "APPROVED", year: 2026, month: 9 });
    db.salaryRunLine.findMany.mockResolvedValue([{ id: "l1", employeeId: "e1", autoPaidLeaveDays: 0, installmentJson: [{ advanceId: "a1", amount: 3000 }], amountsJson: { installment: 3000 } }]);
    db.leaveBalance.findMany.mockResolvedValue([]);
    await svc.finaliseSalaryRun(actor, "r1").catch(() => undefined);
    expect(db.salaryAdvanceRecovery.createMany.mock.calls[0][0]).toEqual({ data: [{ advanceId: "a1", runLineId: "l1", amount: 3000 }], skipDuplicates: true });

    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "FINALISED", year: 2026, month: 9 });
    db.salaryRunLine.findMany.mockResolvedValue([{ id: "l1", employeeId: "e1", leaveSpendJson: [] }]);
    await svc.reopenSalaryRun(actor, "r1", "wrong").catch(() => undefined);
    expect(db.salaryAdvanceRecovery.deleteMany).toHaveBeenCalledWith({ where: { runLine: { runId: "r1" } } });
  });

  it("a month with no punches deducts no installment, so finalise records none", async () => {
    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "APPROVED", year: 2026, month: 9 });
    db.salaryRunLine.findMany.mockResolvedValue([{ id: "l1", employeeId: "e1", autoPaidLeaveDays: 0, installmentJson: [{ advanceId: "a1", amount: 3000 }], amountsJson: { installment: 0 } }]);
    db.leaveBalance.findMany.mockResolvedValue([]);
    await svc.finaliseSalaryRun(actor, "r1").catch(() => undefined);
    expect(db.salaryAdvanceRecovery.createMany).not.toHaveBeenCalled();
  });
});

describe("systemFigures", () => {
  it("uses leave balance for zero-hour workdays (auto paid leave) and takes them out of absent", () => {
    const f = svc.systemFigures(employeeMonth() as never, 2);
    expect(f).toMatchObject({ presentDays: 20, autoPaidLeaveDays: 2, paidLeaveDays: 3, absentDays: 2, hasNoPunches: false });
  });
});

describe("generateSalaryRun", () => {
  it("refuses a month that hasn't ended, an old-sheet month, or a run that isn't a draft", async () => {
    await expect(svc.generateSalaryRun(actor, 2999, 1)).rejects.toThrow(/after the month has ended/);
    db.attendanceMonthClose.findUnique.mockResolvedValueOnce({ id: "x" });
    await expect(svc.generateSalaryRun(actor, 2026, 9)).rejects.toThrow(/old Salary Sheet/);
    db.salaryRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "APPROVED", lines: [] });
    await expect(svc.generateSalaryRun(actor, 2026, 9)).rejects.toThrow(/can't be regenerated/);
  });

  it("creates a line with system figures and salary-adjusted attendance", async () => {
    db.salaryRun.create.mockResolvedValue({ id: "r1" });
    await svc.generateSalaryRun(actor, 2026, 9).catch(() => undefined); // the view re-read is not mocked in full
    expect(month.computeEmployeesMonth.mock.calls[0][5]).toEqual({ applySalaryAdjustments: true });
    const data = db.salaryRunLine.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ runId: "r1", employeeId: "e1", systemPresentDays: 20, presentDays: null, arrearsAmount: 0 });
    // paid days = 20 + 4 + 1 + 1 + 0 = 26 of 30 -> 26,000
    expect(data.netAmount).toBe(26000);
  });

  it("regenerating keeps the edited present days and arrears", async () => {
    db.salaryRun.findUnique.mockResolvedValueOnce({ id: "r1", status: "DRAFT", lines: [{ id: "l1", employeeId: "e1", presentDays: 22, paidLeaveDays: null, extraDays: null, arrearsAmount: 500, arrearsReason: "bonus" }] });
    db.salaryRun.update.mockResolvedValue({ id: "r1" });
    await svc.generateSalaryRun(actor, 2026, 9).catch(() => undefined);
    const data = db.salaryRunLine.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ presentDays: 22, arrearsAmount: 500, arrearsReason: "bonus", systemPresentDays: 20 });
    expect(data.netAmount).toBe(28000 + 500);
  });
});

describe("editSalaryLine", () => {
  it("only a draft can be edited", async () => {
    db.salaryRunLine.findFirst.mockResolvedValue(lineRow({ run: { status: "APPROVED", year: 2026, month: 9 } }));
    await expect(svc.editSalaryLine(actor, "l1", { presentDays: 21, reason: "fix" })).rejects.toThrow(/Only a draft/);
  });

  it("refuses days beyond the month and arrears without a reason", async () => {
    db.salaryRunLine.findFirst.mockResolvedValue(lineRow());
    await expect(svc.editSalaryLine(actor, "l1", { presentDays: 25, reason: "fix" })).rejects.toThrow(/can't be more than the 30 days/);
    await expect(svc.editSalaryLine(actor, "l1", { arrearsAmount: 100, reason: "fix" })).rejects.toThrow(/reason for the arrears/);
  });

  it("stores the edit, records old -> new, and a value equal to the system figure means not edited", async () => {
    db.salaryRunLine.findFirst.mockResolvedValue(lineRow({ presentDays: 22 }));
    await svc.editSalaryLine(actor, "l1", { presentDays: 20, extraDays: 1, reason: "checked register" }).catch(() => undefined);
    const upd = db.salaryRunLine.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "l1", run: { status: "DRAFT" } });
    expect(upd.data).toMatchObject({ presentDays: null, extraDays: 1 });
    expect(db.salaryRunLineEdit.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ field: "presentDays", oldValue: "22", newValue: "20", reason: "checked register", editedByUserId: "u1" }),
      expect.objectContaining({ field: "extraDays", oldValue: "0", newValue: "1" }),
    ]);
  });
});

describe("approve / finalise / reopen", () => {
  it("approve asserts the self-approval guard against the generator, and again when the approver edited lines", async () => {
    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "DRAFT", generatedByUserId: "u9", year: 2026, month: 9 });
    db.salaryRunLineEdit.count.mockResolvedValue(2);
    await svc.approveSalaryRun(actor, "r1").catch(() => undefined);
    expect(perm.assert).toHaveBeenNthCalledWith(1, "u1", "hrms_salary_generate", "approve", { createdBy: "u9" });
    expect(perm.assert).toHaveBeenNthCalledWith(2, "u1", "hrms_salary_generate", "approve", { createdBy: "u1" });
    expect(db.salaryRun.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "r1", status: "DRAFT" }, data: { status: "APPROVED", approvedByUserId: "u1" } });
  });

  it("finalise spends auto paid leave (remaining first) and remembers it; reopen gives it back", async () => {
    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "APPROVED", year: 2026, month: 9 });
    db.salaryRunLine.findMany.mockResolvedValue([{ id: "l1", employeeId: "e1", autoPaidLeaveDays: 1.5 }]);
    db.leaveBalance.findMany.mockResolvedValue([{ id: "b1", leaveTypeId: "lt", remaining: 1, carryForward: 2 }]);
    await svc.finaliseSalaryRun(actor, "r1").catch(() => undefined);
    expect(db.leaveBalance.update.mock.calls[0][0].data).toEqual({ remaining: { decrement: 1 }, carryForward: { decrement: 0.5 }, used: { increment: 1.5 } });
    expect(db.salaryRunLine.update.mock.calls[0][0].data.leaveSpendJson).toEqual([{ leaveTypeId: "lt", balanceId: "b1", fromRemaining: 1, fromCarry: 0.5 }]);

    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    db.salaryRun.updateMany.mockResolvedValue({ count: 1 });
    db.salaryRun.findFirst.mockResolvedValue({ id: "r1", status: "FINALISED", year: 2026, month: 9 });
    db.salaryRunLine.findMany.mockResolvedValue([{ id: "l1", employeeId: "e1", leaveSpendJson: [{ leaveTypeId: "lt", balanceId: "b1", fromRemaining: 1, fromCarry: 0.5 }] }]);
    await svc.reopenSalaryRun(actor, "r1", "wrong OT").catch(() => undefined);
    expect(db.leaveBalance.update.mock.calls[0][0].data).toEqual({ remaining: { increment: 1 }, carryForward: { increment: 0.5 }, used: { decrement: 1.5 } });
    expect(db.salaryRun.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "r1", status: "FINALISED" }, data: { status: "DRAFT", reopenReason: "wrong OT" } });
  });
});

describe("month lock", () => {
  it("blocks when the month's run is approved or finalised", async () => {
    db.salaryRun.findMany.mockResolvedValueOnce([{ year: 2026, month: 9, status: "FINALISED" }]);
    await expect(assertSalaryMonthOpen("c1", ["2026-09-12"])).rejects.toThrow(/September 2026 is finalised/);
    db.salaryRun.findMany.mockResolvedValueOnce([]);
    await expect(assertSalaryMonthOpen("c1", [new Date("2026-09-12")])).resolves.toBeUndefined();
  });

  it("lists every month a date range touches", () => {
    expect(monthKeysBetween(new Date("2026-09-28"), new Date("2026-11-02"))).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });
});

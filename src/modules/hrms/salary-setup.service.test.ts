import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn(), update: vi.fn() },
  employeeSalarySetting: { findUnique: vi.fn(), upsert: vi.fn() },
  employeeSalaryComponent: { deleteMany: vi.fn(), createMany: vi.fn() },
  employeeAttendanceProfile: { upsert: vi.fn() },
  salaryStatutorySetting: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

const { summarizeSalarySetup, saveEmployeeSalarySetup, createStatutorySetting, updateStatutorySetting } = await import("./salary-setup.service");
const { employeeSalarySetupSchema, statutorySettingSchema } = await import("./salary-setup.schema");

const actor = { companyId: "c1", userId: "u1" };
const EMP = "11111111-1111-4111-8111-111111111111";
const PF = "22222222-2222-4222-8222-222222222222";

function employeeRow(setting: unknown = null) {
  return {
    id: EMP,
    employeeCode: "EMP-1",
    fullName: "Ravi",
    joinDate: null,
    fixedMonthlySalary: 20000,
    travelAllowance: 1000,
    dearnessAllowance: null,
    department: null,
    designation: null,
    attendanceProfile: null,
    salarySetting: setting,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.employeeSalarySetting.upsert.mockResolvedValue({ id: "s1" });
});

describe("summarizeSalarySetup", () => {
  it("adds allowances to base and keeps deductions and taxes apart", () => {
    const r = summarizeSalarySetup(
      20000,
      [
        { kind: "ALLOWANCE", title: "HRA", amount: 4000.5 },
        { kind: "ALLOWANCE", title: "Conveyance", amount: 1600 },
        { kind: "DEDUCTION", title: "LIC", amount: 500 },
      ],
      { tds: 200, surcharge: 0, educationCess: 8, lateFeeInterest: 0 }
    );
    expect(r).toEqual({ base: 20000, allowances: 5600.5, gross: 25600.5, deductions: 500, taxes: 208 });
  });
});

describe("schemas", () => {
  it("rejects a bad PAN, IFSC, account number, duplicate lines and 3-decimal money", () => {
    const ok = (patch: object) => employeeSalarySetupSchema.safeParse({ baseMonthlySalary: 20000, ...patch }).success;
    expect(ok({})).toBe(true);
    expect(ok({ panNumber: "abcde1234f" })).toBe(true);
    expect(ok({ panNumber: "ABC123" })).toBe(false);
    expect(ok({ bankIfsc: "SBIN1001234" })).toBe(false);
    expect(ok({ bankAccountNumber: "12AB" })).toBe(false);
    expect(ok({ baseMonthlySalary: 100.123 })).toBe(false);
    expect(
      ok({ components: [{ kind: "ALLOWANCE", title: "HRA", amount: 1 }, { kind: "ALLOWANCE", title: "hra", amount: 2 }] })
    ).toBe(false);
  });

  it("rates must be 0-100 and isActive is not defaulted (an edit never re-activates)", () => {
    expect(statutorySettingSchema.safeParse({ title: "PF", employerRate: 12, employeeRate: 101 }).success).toBe(false);
    expect(statutorySettingSchema.parse({ title: "PF", employerRate: 12, employeeRate: 12 }).isActive).toBeUndefined();
  });
});

describe("statutory settings", () => {
  it("refuses a duplicate title", async () => {
    db.salaryStatutorySetting.findFirst.mockResolvedValue({ id: "x" });
    await expect(createStatutorySetting(actor, "PF", { title: "PF 12%", employerRate: 12, employeeRate: 12 })).rejects.toThrow(/already exists/);
  });

  it("update of another company's row is NOT_FOUND and keeps isActive when omitted", async () => {
    db.salaryStatutorySetting.findFirst.mockResolvedValueOnce(null);
    await expect(updateStatutorySetting(actor, "ESIC", "z", { title: "E", employerRate: 3.25, employeeRate: 0.75 })).rejects.toMatchObject({ code: "NOT_FOUND" });

    db.salaryStatutorySetting.findFirst
      .mockResolvedValueOnce({ id: "p", title: "PF", employerRate: 12, employeeRate: 12, maxLimit: null, isActive: false })
      .mockResolvedValueOnce(null);
    db.salaryStatutorySetting.update.mockResolvedValue({});
    await updateStatutorySetting(actor, "PF", "p", { title: "PF", employerRate: 12, employeeRate: 12 });
    expect(db.salaryStatutorySetting.update.mock.calls[0][0].data).not.toHaveProperty("isActive");
  });
});

describe("saveEmployeeSalarySetup", () => {
  it("saves the setup, replaces lines, mirrors base onto the employee and the OT rate onto the profile", async () => {
    db.employee.findFirst.mockResolvedValue(employeeRow());
    db.employeeSalarySetting.findUnique.mockResolvedValue(null);
    db.salaryStatutorySetting.findFirst.mockResolvedValue({ id: PF, isActive: true, title: "PF 12%" });

    const input = employeeSalarySetupSchema.parse({
      baseMonthlySalary: 22000,
      pfSettingId: PF,
      overtimeRatePerHour: 150,
      components: [{ kind: "ALLOWANCE", title: "HRA", amount: 4000 }],
    });
    await saveEmployeeSalarySetup(actor, EMP, input);

    expect(db.employeeSalarySetting.upsert.mock.calls[0][0].create).toMatchObject({ companyId: "c1", employeeId: EMP, baseMonthlySalary: 22000, pfSettingId: PF, esicSettingId: null, createdByUserId: "u1" });
    expect(db.employeeSalaryComponent.deleteMany).toHaveBeenCalledWith({ where: { settingId: "s1" } });
    expect(db.employeeSalaryComponent.createMany.mock.calls[0][0].data).toEqual([{ settingId: "s1", kind: "ALLOWANCE", title: "HRA", amount: 4000, sortOrder: 0 }]);
    expect(db.employee.update).toHaveBeenCalledWith({ where: { id: EMP }, data: { fixedMonthlySalary: 22000 } });
    expect(db.employeeAttendanceProfile.upsert.mock.calls[0][0].update).toEqual({ overtimeRatePerHour: 150 });
  });

  it("refuses an inactive PF setting the employee did not already have", async () => {
    db.employee.findFirst.mockResolvedValue(employeeRow());
    db.employeeSalarySetting.findUnique.mockResolvedValue(null);
    db.salaryStatutorySetting.findFirst.mockResolvedValue({ id: PF, isActive: false, title: "Old PF" });
    await expect(saveEmployeeSalarySetup(actor, EMP, employeeSalarySetupSchema.parse({ baseMonthlySalary: 1, pfSettingId: PF }))).rejects.toThrow(/inactive/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("keeps an inactive PF setting the employee already had", async () => {
    db.employee.findFirst.mockResolvedValue(employeeRow());
    db.employeeSalarySetting.findUnique.mockResolvedValue({ id: "s1", pfSettingId: PF, esicSettingId: null });
    db.salaryStatutorySetting.findFirst.mockResolvedValue({ id: PF, isActive: false, title: "Old PF" });
    await saveEmployeeSalarySetup(actor, EMP, employeeSalarySetupSchema.parse({ baseMonthlySalary: 1, pfSettingId: PF }));
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("an unknown employee is NOT_FOUND", async () => {
    db.employee.findFirst.mockResolvedValue(null);
    await expect(saveEmployeeSalarySetup(actor, EMP, employeeSalarySetupSchema.parse({ baseMonthlySalary: 1 }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

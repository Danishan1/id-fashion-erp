import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("@/modules/hr-config/hr-config.repository", () => ({
  HrConfigRepository: { designation: { findFirst: vi.fn() } },
}));
const txClient = vi.hoisted(() => ({ employeeWorkSkill: { createMany: vi.fn() } }));
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txClient)),
    user: { findFirst: vi.fn() },
  },
}));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/administration/user-admin.service", () => ({
  assertNewLoginAllowed: vi.fn(),
  createEmployeeLoginInTx: vi.fn(),
  suspendLoginForEmployee: vi.fn(),
}));
vi.mock("./employee.repository", () => ({
  EmployeeRepository: {
    findByCode: vi.fn(),
    findById: vi.fn(),
    createInTx: vi.fn(),
    findLinkedUserId: vi.fn(),
    update: vi.fn(),
    replaceWorkSkills: vi.fn(),
    countCompanyStages: vi.fn(),
  },
}));

const { HrConfigRepository } = await import("@/modules/hr-config/hr-config.repository");
const { EmployeeRepository } = await import("./employee.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { prisma } = await import("@/core/db/client");
const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const UserAdmin = await import("@/modules/administration/user-admin.service");
const { createEmployee, updateEmployee, setEmployeeActiveStatus, deactivateEmployee, createLoginForEmployee } = await import(
  "./employee.service"
);

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = { employeeCode: "EMP100", fullName: "New Hire", isActive: true };

beforeEach(() => {
  vi.mocked(HrConfigRepository.designation.findFirst).mockReset();
  vi.mocked(EmployeeRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(EmployeeRepository.findById).mockReset();
  vi.mocked(EmployeeRepository.createInTx).mockReset();
  vi.mocked(EmployeeRepository.findLinkedUserId).mockReset().mockResolvedValue(null);
  txClient.employeeWorkSkill.createMany.mockReset();
  vi.mocked(prisma.$transaction).mockClear();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(UserAdmin.assertNewLoginAllowed).mockReset().mockImplementation(async (_a, i) => i.email.trim().toLowerCase());
  vi.mocked(UserAdmin.createEmployeeLoginInTx).mockReset().mockResolvedValue({ id: "user-new", email: "ravi@co.com" } as never);
  vi.mocked(UserAdmin.suspendLoginForEmployee).mockReset().mockResolvedValue(null);
  vi.mocked(writeAuditLog).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(EmployeeRepository.update).mockReset();
  vi.mocked(EmployeeRepository.replaceWorkSkills).mockReset();
  vi.mocked(EmployeeRepository.countCompanyStages).mockReset();
});

describe("createEmployee — reportsToId validation", () => {
  it("rejects a reportsToId that doesn't belong to a real employee in this company", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null as never);

    await expect(createEmployee(actor, { ...baseInput, reportsToId: "mgr-1" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(EmployeeRepository.createInTx).not.toHaveBeenCalled();
  });

  it("creates successfully when reportsToId points at a real employee", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "mgr-1", fullName: "Manager" } as never);
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { ...baseInput, reportsToId: "mgr-1" } as never);

    expect(EmployeeRepository.createInTx).toHaveBeenCalledWith(txClient, expect.objectContaining({ reportsToId: "mgr-1" }));
  });

  it("skips the check entirely when no reportsToId is supplied", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, baseInput as never);

    expect(EmployeeRepository.findById).not.toHaveBeenCalled();
  });
});

describe("createEmployee/updateEmployee — isActive/selfEntryEnabled default-vs-omitted (ERP-BUG regression, 2026-09-02)", () => {
  // Both fields moved from z.boolean().default(x) to z.boolean().optional()
  // specifically because a .default() still fires under employeeUpdateSchema's
  // .partial(), so any PATCH omitting the field (as the Worker Settings pay-
  // config modal does) would silently reset it. Verified live against the
  // real dev DB before this fix: saving a Pay Config with no isActive/
  // selfEntryEnabled in the payload reset selfEntryEnabled from true to false.
  it("createEmployee defaults isActive=true and selfEntryEnabled=false when both are omitted", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { employeeCode: "EMP101", fullName: "No Flags Given" } as never);

    expect(EmployeeRepository.createInTx).toHaveBeenCalledWith(txClient, expect.objectContaining({ isActive: true, selfEntryEnabled: false }));
  });

  it("updateEmployee leaves isActive and selfEntryEnabled untouched when the PATCH body omits them entirely", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "EMP001" } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1" } as never);

    // Mirrors AdminWorkerSettingsPanel's savePay() payload — pay fields only.
    await updateEmployee(actor, "emp-1", { fixedMonthlySalary: 15000 } as never);

    const [, data] = vi.mocked(EmployeeRepository.update).mock.calls[0];
    expect(data).not.toHaveProperty("isActive");
    expect(data).not.toHaveProperty("selfEntryEnabled");
  });

  it("updateEmployee still applies an explicit isActive/selfEntryEnabled value when the caller does send one", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "EMP001" } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1" } as never);

    await updateEmployee(actor, "emp-1", { isActive: false, selfEntryEnabled: true } as never);

    expect(EmployeeRepository.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ isActive: false, selfEntryEnabled: true }));
  });
});

describe("updateEmployee — reportsToId validation", () => {
  it("rejects an employee reporting to themselves", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "EMP001" } as never);

    await expect(updateEmployee(actor, "emp-1", { reportsToId: "emp-1" } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(EmployeeRepository.update).not.toHaveBeenCalled();
  });

  it("allows reassigning to a different, real manager", async () => {
    vi.mocked(EmployeeRepository.findById)
      .mockResolvedValueOnce({ id: "emp-1", employeeCode: "EMP001" } as never) // getEmployeeById's own lookup (before)
      .mockResolvedValueOnce({ id: "mgr-2", fullName: "Other Manager" } as never); // assertReportsToIsValid's lookup
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1", reportsToId: "mgr-2" } as never);

    await updateEmployee(actor, "emp-1", { reportsToId: "mgr-2" } as never);

    expect(EmployeeRepository.update).toHaveBeenCalledWith("emp-1", expect.objectContaining({ reportsToId: "mgr-2" }));
  });
});

describe("Work Skills (2026-09-29)", () => {
  it("saves the selected stages on create, de-duplicated", async () => {
    vi.mocked(EmployeeRepository.countCompanyStages).mockResolvedValue(2);
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { ...baseInput, workSkillStageIds: ["st-cut", "st-stitch", "st-cut"] } as never);

    expect(EmployeeRepository.countCompanyStages).toHaveBeenCalledWith("co-1", ["st-cut", "st-stitch"]);
    expect(txClient.employeeWorkSkill.createMany).toHaveBeenCalledWith({
      data: [
        { employeeId: "emp-new", productionStageId: "st-cut" },
        { employeeId: "emp-new", productionStageId: "st-stitch" },
      ],
      skipDuplicates: true,
    });
  });

  it("rejects a stage that isn't one of this company's production stages", async () => {
    vi.mocked(EmployeeRepository.countCompanyStages).mockResolvedValue(1);

    await expect(createEmployee(actor, { ...baseInput, workSkillStageIds: ["st-cut", "st-foreign"] } as never)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(EmployeeRepository.createInTx).not.toHaveBeenCalled();
  });

  it("creates an employee with no skills without touching the skills table", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);
    await createEmployee(actor, baseInput as never);
    expect(txClient.employeeWorkSkill.createMany).not.toHaveBeenCalled();
  });

  it("an update that omits Work Skills leaves them as they are", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "EMP1", workSkills: [{ productionStageId: "st-cut" }] } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1" } as never);

    await updateEmployee(actor, "emp-1", { fullName: "Renamed" } as never);
    expect(EmployeeRepository.replaceWorkSkills).not.toHaveBeenCalled();
  });

  it("an update with an empty list clears every skill", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "EMP1", workSkills: [{ productionStageId: "st-cut" }] } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1" } as never);

    await updateEmployee(actor, "emp-1", { workSkillStageIds: [] } as never);
    expect(EmployeeRepository.replaceWorkSkills).toHaveBeenCalledWith("emp-1", []);
  });
});

describe("P2 -- ERP login from the Employee Master", () => {
  const login = { roleId: "role-worker", branchId: "br-1" };

  it("creates the employee and the login in one transaction, with the email lower-cased", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new", fullName: "Ravi", phone: null } as never);

    const result = await createEmployee(actor, { ...baseInput, email: "  Ravi@Co.com ", login } as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "administration_users", "create");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(UserAdmin.createEmployeeLoginInTx).toHaveBeenCalledWith(txClient, actor, {
      email: "ravi@co.com",
      fullName: "Ravi",
      phone: null,
      branchId: "br-1",
      roleId: "role-worker",
      employeeId: "emp-new",
    });
    expect(result.loginUserId).toBe("user-new");
  });

  it("never writes the password into the audit log", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new", fullName: "Ravi", phone: null } as never);
    await createEmployee(actor, { ...baseInput, email: "ravi@co.com", login } as never);
    const audits = JSON.stringify(vi.mocked(writeAuditLog).mock.calls);
    expect(audits).not.toContain("12345678");
    expect(audits).toContain('"temporaryPassword":true');
  });

  it("does not save the employee when the login can't be created (one transaction)", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new", fullName: "Ravi", phone: null } as never);
    vi.mocked(UserAdmin.createEmployeeLoginInTx).mockRejectedValue(new Error("unique violation"));

    await expect(createEmployee(actor, { ...baseInput, email: "ravi@co.com", login } as never)).rejects.toThrow("unique violation");
    // The rejection propagates out of $transaction, so Postgres rolls back the employee insert.
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuses before writing anything when the email is already a login", async () => {
    vi.mocked(UserAdmin.assertNewLoginAllowed).mockRejectedValue(Object.assign(new Error("dup"), { code: "DUPLICATE_EMAIL_EXISTS" }));
    await expect(createEmployee(actor, { ...baseInput, email: "taken@co.com", login } as never)).rejects.toMatchObject({
      code: "DUPLICATE_EMAIL_EXISTS",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires an email for a login", async () => {
    await expect(createEmployee(actor, { ...baseInput, login } as never)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires administration_users.create for a login", async () => {
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("no"), { code: "PERMISSION_DENIED" }));
    await expect(createEmployee(actor, { ...baseInput, email: "ravi@co.com", login } as never)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates no login when none is asked for", async () => {
    vi.mocked(EmployeeRepository.createInTx).mockResolvedValue({ id: "emp-new" } as never);
    await createEmployee(actor, { ...baseInput, email: "ravi@co.com" } as never);
    expect(PermissionService.assert).not.toHaveBeenCalled();
    expect(UserAdmin.createEmployeeLoginInTx).not.toHaveBeenCalled();
  });

  it("refuses a second login for an employee who already has one", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", email: "a@co.com", isActive: true } as never);
    vi.mocked(EmployeeRepository.findLinkedUserId).mockResolvedValue("user-9");
    await expect(createLoginForEmployee(actor, "emp-1", login)).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(UserAdmin.createEmployeeLoginInTx).not.toHaveBeenCalled();
  });

  it("creates a login for an existing employee", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", email: "A@Co.com", fullName: "A", phone: "9", isActive: true } as never);
    await createLoginForEmployee(actor, "emp-1", login);
    expect(UserAdmin.createEmployeeLoginInTx).toHaveBeenCalledWith(
      txClient,
      actor,
      expect.objectContaining({ email: "a@co.com", employeeId: "emp-1" })
    );
  });

  it("refuses a login for an inactive employee", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", email: "a@co.com", isActive: false } as never);
    await expect(createLoginForEmployee(actor, "emp-1", login)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("deactivating an employee suspends the linked login; reactivating does not reopen it", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", isActive: true } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1", isActive: false } as never);
    await setEmployeeActiveStatus(actor, "emp-1", false);
    expect(UserAdmin.suspendLoginForEmployee).toHaveBeenCalledWith(actor, "emp-1");

    vi.mocked(UserAdmin.suspendLoginForEmployee).mockClear();
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1", isActive: true } as never);
    await setEmployeeActiveStatus(actor, "emp-1", true);
    expect(UserAdmin.suspendLoginForEmployee).not.toHaveBeenCalled();
  });

  it("an edit that sets isActive=false suspends the login too", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", employeeCode: "E1", isActive: true } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1", isActive: false } as never);
    await updateEmployee(actor, "emp-1", { isActive: false } as never);
    expect(UserAdmin.suspendLoginForEmployee).toHaveBeenCalledWith(actor, "emp-1");
  });

  it("deleting an employee suspends the linked login", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", isActive: true } as never);
    vi.mocked(EmployeeRepository.update).mockResolvedValue({ id: "emp-1" } as never);
    await deactivateEmployee(actor, "emp-1");
    expect(UserAdmin.suspendLoginForEmployee).toHaveBeenCalledWith(actor, "emp-1");
  });
});

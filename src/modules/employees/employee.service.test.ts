import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("@/modules/hr-config/hr-config.repository", () => ({
  HrConfigRepository: { designation: { findFirst: vi.fn() } },
}));
vi.mock("./employee.repository", () => ({
  EmployeeRepository: {
    findByCode: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    replaceWorkSkills: vi.fn(),
    countCompanyStages: vi.fn(),
  },
}));

const { HrConfigRepository } = await import("@/modules/hr-config/hr-config.repository");
const { EmployeeRepository } = await import("./employee.repository");
const { createEmployee, updateEmployee } = await import("./employee.service");

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = { employeeCode: "EMP100", fullName: "New Hire", isActive: true };

beforeEach(() => {
  vi.mocked(HrConfigRepository.designation.findFirst).mockReset();
  vi.mocked(EmployeeRepository.findByCode).mockReset().mockResolvedValue(null);
  vi.mocked(EmployeeRepository.findById).mockReset();
  vi.mocked(EmployeeRepository.create).mockReset();
  vi.mocked(EmployeeRepository.update).mockReset();
  vi.mocked(EmployeeRepository.replaceWorkSkills).mockReset();
  vi.mocked(EmployeeRepository.countCompanyStages).mockReset();
});

describe("createEmployee — reportsToId validation", () => {
  it("rejects a reportsToId that doesn't belong to a real employee in this company", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null as never);

    await expect(createEmployee(actor, { ...baseInput, reportsToId: "mgr-1" } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(EmployeeRepository.create).not.toHaveBeenCalled();
  });

  it("creates successfully when reportsToId points at a real employee", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "mgr-1", fullName: "Manager" } as never);
    vi.mocked(EmployeeRepository.create).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { ...baseInput, reportsToId: "mgr-1" } as never);

    expect(EmployeeRepository.create).toHaveBeenCalledWith(expect.objectContaining({ reportsToId: "mgr-1" }));
  });

  it("skips the check entirely when no reportsToId is supplied", async () => {
    vi.mocked(EmployeeRepository.create).mockResolvedValue({ id: "emp-new" } as never);

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
    vi.mocked(EmployeeRepository.create).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { employeeCode: "EMP101", fullName: "No Flags Given" } as never);

    expect(EmployeeRepository.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, selfEntryEnabled: false }));
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
    vi.mocked(EmployeeRepository.create).mockResolvedValue({ id: "emp-new" } as never);

    await createEmployee(actor, { ...baseInput, workSkillStageIds: ["st-cut", "st-stitch", "st-cut"] } as never);

    expect(EmployeeRepository.countCompanyStages).toHaveBeenCalledWith("co-1", ["st-cut", "st-stitch"]);
    expect(EmployeeRepository.replaceWorkSkills).toHaveBeenCalledWith("emp-new", ["st-cut", "st-stitch"]);
  });

  it("rejects a stage that isn't one of this company's production stages", async () => {
    vi.mocked(EmployeeRepository.countCompanyStages).mockResolvedValue(1);

    await expect(createEmployee(actor, { ...baseInput, workSkillStageIds: ["st-cut", "st-foreign"] } as never)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(EmployeeRepository.create).not.toHaveBeenCalled();
  });

  it("creates an employee with no skills without touching the skills table", async () => {
    vi.mocked(EmployeeRepository.create).mockResolvedValue({ id: "emp-new" } as never);
    await createEmployee(actor, baseInput as never);
    expect(EmployeeRepository.replaceWorkSkills).not.toHaveBeenCalled();
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

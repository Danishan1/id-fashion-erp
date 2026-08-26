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

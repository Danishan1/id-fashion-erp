import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./cost-master.repository", () => ({
  CostMasterRepository: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { CostMasterRepository } = await import("./cost-master.repository");
const { listCostMasters, createCostMaster, updateCostMaster } = await import("./cost-master.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(CostMasterRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(CostMasterRepository.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(CostMasterRepository.create).mockReset();
  vi.mocked(CostMasterRepository.update).mockReset();
});

describe("Cost Master Service (Unit Tests)", () => {
  const sampleInput = {
    code: "CM-01",
    name: "Packaging Labor",
    type: "LABOR" as const,
    rate: 15.5,
    isActive: true,
  };

  it("lists cost masters for the given company ordered by name asc", async () => {
    const records = [{ id: "cm-1", code: "CM-01", name: "Packaging Labor", companyId: "co-1" }];
    vi.mocked(CostMasterRepository.findMany).mockResolvedValue(records as never);

    const result = await listCostMasters("co-1");
    expect(result).toEqual(records);
    expect(CostMasterRepository.findMany).toHaveBeenCalledWith({
      where: { companyId: "co-1" },
      orderBy: { name: "asc" },
    });
  });

  it("creates a new cost master and writes audit log", async () => {
    const createdRecord = { id: "cm-1", companyId: "co-1", ...sampleInput };
    vi.mocked(CostMasterRepository.create).mockResolvedValue(createdRecord as never);

    const result = await createCostMaster(actor, sampleInput);

    expect(result).toEqual(createdRecord);
    expect(CostMasterRepository.create).toHaveBeenCalledWith({
      data: {
        companyId: "co-1",
        code: "CM-01",
        name: "Packaging Labor",
        type: "LABOR",
        rate: 15.5,
        isActive: true,
      },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        userId: "user-1",
        tableName: "cost_masters",
        recordId: "cm-1",
        action: "CREATE",
      })
    );
  });

  it("rejects creating cost master with a duplicate code in the same company", async () => {
    vi.mocked(CostMasterRepository.findFirst).mockResolvedValue({ id: "cm-existing", code: "CM-01" } as never);

    await expect(createCostMaster(actor, sampleInput)).rejects.toMatchObject({
      code: "DUPLICATE_DOC_NUMBER",
      message: 'Cost master code "CM-01" is already in use.',
    });
    expect(CostMasterRepository.create).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("updates existing cost master and writes audit log", async () => {
    const existing = { id: "cm-1", companyId: "co-1", code: "CM-01", name: "Old Name", type: "LABOR", rate: 10, isActive: true };
    const updated = { ...existing, name: "Updated Name", rate: 20 };
    vi.mocked(CostMasterRepository.findFirst).mockResolvedValue(existing as never);
    vi.mocked(CostMasterRepository.update).mockResolvedValue(updated as never);

    const result = await updateCostMaster(actor, "cm-1", {
      ...sampleInput,
      name: "Updated Name",
      rate: 20,
    });

    expect(result).toEqual(updated);
    expect(CostMasterRepository.update).toHaveBeenCalledWith({
      where: { id: "cm-1" },
      data: { code: "CM-01", name: "Updated Name", type: "LABOR", rate: 20, isActive: true },
    });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        userId: "user-1",
        tableName: "cost_masters",
        recordId: "cm-1",
        action: "UPDATE",
      })
    );
  });

  it("throws NOT_FOUND when updating a cost master belonging to another company (tenant isolation)", async () => {
    vi.mocked(CostMasterRepository.findFirst).mockResolvedValue(null);

    await expect(updateCostMaster(actor, "cm-foreign", sampleInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Cost master not found.",
    });
    expect(CostMasterRepository.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

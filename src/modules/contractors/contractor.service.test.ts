import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("./contractor.repository", () => ({
  ContractorRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { ContractorRepository } = await import("./contractor.repository");
const { createContractor, updateContractor, getContractorById, setContractorActiveStatus } = await import(
  "./contractor.service"
);

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = {
  code: "CONTR-00001",
  name: "HP Cotton",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  isActive: true,
};

beforeEach(() => {
  vi.mocked(ContractorRepository.findByCode).mockReset();
  vi.mocked(ContractorRepository.create).mockReset();
  vi.mocked(ContractorRepository.update).mockReset();
  vi.mocked(ContractorRepository.findById).mockReset();
});

describe("createContractor", () => {
  it("rejects a duplicate code without ever touching the database's create call", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue({ id: "existing-id" } as never);

    await expect(createContractor(actor, baseInput)).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(ContractorRepository.create).not.toHaveBeenCalled();
  });

  it("creates the contractor when the code is free", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ContractorRepository.create).mockResolvedValue({ id: "new-id", ...baseInput, companyId: "co-1" } as never);

    const result = await createContractor(actor, baseInput);

    expect(result).toMatchObject({ id: "new-id" });
    expect(ContractorRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", code: "CONTR-00001" })
    );
  });
});

describe("updateContractor", () => {
  it("only touches keys actually present in the PATCH body", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput } as never);
    vi.mocked(ContractorRepository.update).mockResolvedValue({ id: "id-1", name: "HP Cotton Renamed" } as never);

    await updateContractor(actor, "id-1", { name: "HP Cotton Renamed" });

    expect(ContractorRepository.update).toHaveBeenCalledWith("id-1", { name: "HP Cotton Renamed" });
  });

  it("throws NOT_FOUND when the contractor doesn't exist for this company", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue(null);

    await expect(updateContractor(actor, "missing-id", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ContractorRepository.update).not.toHaveBeenCalled();
  });
});

describe("getContractorById", () => {
  it("throws NOT_FOUND when the repository returns nothing", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue(null);
    await expect(getContractorById("co-1", "missing-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setContractorActiveStatus", () => {
  it("only ever touches isActive, never any other field", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput } as never);
    vi.mocked(ContractorRepository.update).mockResolvedValue({ id: "id-1", isActive: false } as never);

    await setContractorActiveStatus(actor, "id-1", false);

    expect(ContractorRepository.update).toHaveBeenCalledWith("id-1", { isActive: false });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ advanceMasterCodeSequence: vi.fn() }));
vi.mock("@/core/db/client", () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) },
}));
vi.mock("./contractor.repository", () => ({
  CONTRACTOR_STAGES_INCLUDE: {},
  ContractorRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    findStagesByIds: vi.fn(),
    replaceStagesInTx: vi.fn(),
    create: vi.fn(),
    createInTx: vi.fn(),
    update: vi.fn(),
    updateInTx: vi.fn(),
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
const STAGE_CUT = "11111111-1111-4111-8111-111111111111";
const STAGE_SEW = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.mocked(ContractorRepository.findByCode).mockReset();
  vi.mocked(ContractorRepository.create).mockReset();
  vi.mocked(ContractorRepository.createInTx).mockReset();
  vi.mocked(ContractorRepository.update).mockReset();
  vi.mocked(ContractorRepository.updateInTx).mockReset();
  vi.mocked(ContractorRepository.findById).mockReset();
  vi.mocked(ContractorRepository.replaceStagesInTx).mockReset();
  vi.mocked(ContractorRepository.findStagesByIds).mockReset().mockResolvedValue([
    { id: STAGE_CUT, isActive: true, name: "Cutting" },
    { id: STAGE_SEW, isActive: true, name: "Stitching" },
  ] as never);
});

describe("createContractor", () => {
  it("rejects a duplicate code without ever touching the database's create call", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue({ id: "existing-id" } as never);

    await expect(createContractor(actor, baseInput)).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
    expect(ContractorRepository.createInTx).not.toHaveBeenCalled();
  });

  it("creates the contractor and saves its stages in working order", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ContractorRepository.createInTx).mockResolvedValue({ id: "new-id" } as never);
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "new-id", ...baseInput, stages: [] } as never);

    const result = await createContractor(actor, { ...baseInput, stageIds: [STAGE_SEW, STAGE_CUT] });

    expect(result).toMatchObject({ id: "new-id" });
    expect(ContractorRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: "co-1", code: "CONTR-00001" }),
    );
    expect(ContractorRepository.replaceStagesInTx).toHaveBeenCalledWith(expect.anything(), "new-id", [STAGE_SEW, STAGE_CUT]);
  });

  it("rejects a stage that doesn't belong to this company", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ContractorRepository.findStagesByIds).mockResolvedValue([] as never);
    await expect(createContractor(actor, { ...baseInput, stageIds: [STAGE_CUT] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ContractorRepository.createInTx).not.toHaveBeenCalled();
  });

  it("rejects adding an inactive stage", async () => {
    vi.mocked(ContractorRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ContractorRepository.findStagesByIds).mockResolvedValue([{ id: STAGE_CUT, isActive: false, name: "Cutting" }] as never);
    await expect(createContractor(actor, { ...baseInput, stageIds: [STAGE_CUT] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("updateContractor", () => {
  it("only touches keys actually present in the PATCH body, leaving stages alone when omitted", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput, stages: [] } as never);

    await updateContractor(actor, "id-1", { name: "HP Cotton Renamed" });

    expect(ContractorRepository.updateInTx).toHaveBeenCalledWith(expect.anything(), "id-1", { name: "HP Cotton Renamed" });
    expect(ContractorRepository.replaceStagesInTx).not.toHaveBeenCalled();
  });

  it("replaces the stage list when stageIds is supplied (empty clears it)", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput, stages: [] } as never);
    await updateContractor(actor, "id-1", { stageIds: [] });
    expect(ContractorRepository.replaceStagesInTx).toHaveBeenCalledWith(expect.anything(), "id-1", []);
  });

  it("keeps an already-linked stage that was later deactivated", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({
      id: "id-1",
      ...baseInput,
      stages: [{ productionStageId: STAGE_CUT }],
    } as never);
    vi.mocked(ContractorRepository.findStagesByIds).mockResolvedValue([{ id: STAGE_CUT, isActive: false, name: "Cutting" }] as never);
    await updateContractor(actor, "id-1", { stageIds: [STAGE_CUT] });
    expect(ContractorRepository.replaceStagesInTx).toHaveBeenCalledWith(expect.anything(), "id-1", [STAGE_CUT]);
  });

  it("throws NOT_FOUND when the contractor doesn't exist for this company", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue(null);

    await expect(updateContractor(actor, "missing-id", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ContractorRepository.updateInTx).not.toHaveBeenCalled();
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

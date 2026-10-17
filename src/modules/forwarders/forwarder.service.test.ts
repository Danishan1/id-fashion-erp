import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  advanceMasterCodeSequence: vi.fn(),
  previewNextMasterCode: vi.fn(),
}));
vi.mock("./forwarder.repository", () => ({
  ForwarderRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

const { previewNextMasterCode, advanceMasterCodeSequence } = await import(
  "@/core/numbering/DocumentNumberingService"
);
const { ForwarderRepository } = await import("./forwarder.repository");
const { createForwarder, updateForwarder, getForwarderById, setForwarderActiveStatus, deactivateForwarder } = await import(
  "./forwarder.service"
);

const actor = { companyId: "co-1", userId: "user-1" };
const baseInput = {
  code: "FWD-00001",
  name: "Blue Dart Express",
  type: "COURIER" as const,
  contactPerson: "",
  phone: "",
  altPhone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  country: "",
  postalCode: "",
  gstin: "",
  remarks: "",
  isActive: true,
};

beforeEach(() => {
  vi.mocked(ForwarderRepository.findByCode).mockReset();
  vi.mocked(ForwarderRepository.create).mockReset();
  vi.mocked(ForwarderRepository.update).mockReset();
  vi.mocked(ForwarderRepository.findById).mockReset();
  vi.mocked(previewNextMasterCode).mockReset();
  vi.mocked(advanceMasterCodeSequence).mockReset();
});

describe("createForwarder", () => {
  it("auto-resolves next available code if the requested code is already taken", async () => {
    vi.mocked(ForwarderRepository.findByCode)
      .mockResolvedValueOnce({ id: "existing-id" } as never) // baseInput.code is taken
      .mockResolvedValueOnce(null); // previewed FWD-00002 is free
    vi.mocked(previewNextMasterCode).mockResolvedValue("FWD-00002");
    vi.mocked(ForwarderRepository.create).mockResolvedValue({ id: "new-id", ...baseInput, code: "FWD-00002" } as never);

    const result = await createForwarder(actor, baseInput);

    expect(result.code).toBe("FWD-00002");
    expect(ForwarderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", code: "FWD-00002" })
    );
    expect(advanceMasterCodeSequence).toHaveBeenCalledWith("co-1", "FORWARDER");
  });

  it("auto-generates code if no code is provided", async () => {
    vi.mocked(previewNextMasterCode).mockResolvedValue("FWD-00001");
    vi.mocked(ForwarderRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ForwarderRepository.create).mockResolvedValue({ id: "new-id", ...baseInput, code: "FWD-00001" } as never);

    const { code: _, ...inputWithoutCode } = baseInput;
    const result = await createForwarder(actor, inputWithoutCode);

    expect(result.code).toBe("FWD-00001");
    expect(ForwarderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", code: "FWD-00001" })
    );
  });

  it("creates the forwarder with every field mapped, nulling blank optional fields", async () => {
    vi.mocked(ForwarderRepository.findByCode).mockResolvedValue(null);
    vi.mocked(ForwarderRepository.create).mockResolvedValue({ id: "new-id", ...baseInput } as never);

    const result = await createForwarder(actor, baseInput);

    expect(result).toMatchObject({ id: "new-id" });
    expect(ForwarderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-1", code: "FWD-00001", type: "COURIER", contactPerson: null, phone: null })
    );
  });
});

describe("updateForwarder", () => {
  it("only touches keys actually present in the PATCH body", async () => {
    vi.mocked(ForwarderRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput } as never);
    vi.mocked(ForwarderRepository.update).mockResolvedValue({ id: "id-1", ...baseInput, name: "Renamed" } as never);

    await updateForwarder(actor, "id-1", { name: "Renamed" });

    expect(ForwarderRepository.update).toHaveBeenCalledWith("id-1", { name: "Renamed" });
  });

  it("throws NOT_FOUND when the forwarder doesn't exist for this company", async () => {
    vi.mocked(ForwarderRepository.findById).mockResolvedValue(null);

    await expect(updateForwarder(actor, "missing-id", { name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ForwarderRepository.update).not.toHaveBeenCalled();
  });
});

describe("getForwarderById", () => {
  it("throws NOT_FOUND when the repository returns nothing", async () => {
    vi.mocked(ForwarderRepository.findById).mockResolvedValue(null);
    await expect(getForwarderById("co-1", "missing-id")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setForwarderActiveStatus", () => {
  it("only ever touches isActive, never any other field", async () => {
    vi.mocked(ForwarderRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput } as never);
    vi.mocked(ForwarderRepository.update).mockResolvedValue({ id: "id-1", isActive: false } as never);

    await setForwarderActiveStatus(actor, "id-1", false);

    expect(ForwarderRepository.update).toHaveBeenCalledWith("id-1", { isActive: false });
  });
});

describe("deactivateForwarder", () => {
  it("sets isActive false and stamps deletedAt (soft delete, never a real row delete)", async () => {
    vi.mocked(ForwarderRepository.findById).mockResolvedValue({ id: "id-1", ...baseInput } as never);
    vi.mocked(ForwarderRepository.update).mockResolvedValue({ id: "id-1", isActive: false } as never);

    await deactivateForwarder(actor, "id-1");

    expect(ForwarderRepository.update).toHaveBeenCalledWith("id-1", { isActive: false, deletedAt: expect.any(Date) });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: {
    unit: { findUnique: vi.fn() },
  },
}));
vi.mock("./fabric-config.repository", () => ({
  FabricConfigRepository: {
    gsm: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    weaveType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    width: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    composition: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    dyeType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    dye: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { FabricConfigRepository } = await import("./fabric-config.repository");
const {
  listFabricGsms,
  createFabricGsm,
  updateFabricGsm,
  createFabricWeaveType,
  createFabricWidth,
  createFabricComposition,
  createFabricDyeType,
  createFabricDye,
} = await import("./fabric-config.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(LookupRepository.unit.findUnique).mockReset().mockResolvedValue({ id: "uom-1", name: "MTR" } as never);

  vi.mocked(FabricConfigRepository.gsm.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(FabricConfigRepository.gsm.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.gsm.create).mockReset();
  vi.mocked(FabricConfigRepository.gsm.update).mockReset();

  vi.mocked(FabricConfigRepository.weaveType.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.weaveType.create).mockReset();

  vi.mocked(FabricConfigRepository.width.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.width.create).mockReset();

  vi.mocked(FabricConfigRepository.composition.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.composition.create).mockReset();

  vi.mocked(FabricConfigRepository.dyeType.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.dyeType.create).mockReset();

  vi.mocked(FabricConfigRepository.dye.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FabricConfigRepository.dye.create).mockReset();
});

describe("Fabric Config Service (Unit Tests)", () => {
  describe("Fabric GSM", () => {
    it("lists GSMs for the company ordered by name asc", async () => {
      const gsms = [{ id: "gsm-1", code: "180", name: "180 GSM", companyId: "co-1" }];
      vi.mocked(FabricConfigRepository.gsm.findMany).mockResolvedValue(gsms as never);

      const result = await listFabricGsms("co-1");
      expect(result).toEqual(gsms);
      expect(FabricConfigRepository.gsm.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { name: "asc" },
      });
    });

    it("creates GSM and writes audit log", async () => {
      const created = { id: "gsm-1", code: "200", name: "200 GSM", isActive: true, companyId: "co-1" };
      vi.mocked(FabricConfigRepository.gsm.create).mockResolvedValue(created as never);

      const result = await createFabricGsm(actor, { code: "200", name: "200 GSM", isActive: true });
      expect(result).toEqual(created);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "fabric_gsms",
          recordId: "gsm-1",
          action: "CREATE",
        })
      );
    });

    it("rejects duplicate GSM code within company", async () => {
      vi.mocked(FabricConfigRepository.gsm.findFirst).mockResolvedValue({ id: "gsm-existing", code: "200" } as never);

      await expect(createFabricGsm(actor, { code: "200", name: "200 GSM", isActive: true })).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'GSM code "200" is already in use.',
      });
    });

    it("updates GSM and writes audit log", async () => {
      const existing = { id: "gsm-1", companyId: "co-1", code: "180", name: "Old", isActive: true };
      const updated = { ...existing, name: "180 Single Jersey" };
      vi.mocked(FabricConfigRepository.gsm.findFirst).mockResolvedValue(existing as never);
      vi.mocked(FabricConfigRepository.gsm.update).mockResolvedValue(updated as never);

      const result = await updateFabricGsm(actor, "gsm-1", { code: "180", name: "180 Single Jersey", isActive: true });
      expect(result).toEqual(updated);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "fabric_gsms",
          action: "UPDATE",
        })
      );
    });

    it("throws NOT_FOUND when updating foreign company GSM (tenant isolation)", async () => {
      vi.mocked(FabricConfigRepository.gsm.findFirst).mockResolvedValue(null);

      await expect(updateFabricGsm(actor, "gsm-other", { code: "180", name: "Test", isActive: true })).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "GSM not found.",
      });
    });
  });

  describe("Fabric Weave, Width, Composition & Dye Type", () => {
    it("creates fabric weave type", async () => {
      const created = { id: "w-1", code: "TWILL", name: "Twill", isActive: true, companyId: "co-1" };
      vi.mocked(FabricConfigRepository.weaveType.create).mockResolvedValue(created as never);

      const result = await createFabricWeaveType(actor, { code: "TWILL", name: "Twill", isActive: true });
      expect(result).toEqual(created);
    });

    it("creates fabric width", async () => {
      const created = { id: "wid-1", code: "W58", name: "58 inches", isActive: true, companyId: "co-1" };
      vi.mocked(FabricConfigRepository.width.create).mockResolvedValue(created as never);

      const result = await createFabricWidth(actor, { code: "W58", name: "58 inches", isActive: true });
      expect(result).toEqual(created);
    });

    it("creates fabric composition", async () => {
      const created = { id: "c-1", code: "COT100", name: "100% Cotton", isActive: true, companyId: "co-1" };
      vi.mocked(FabricConfigRepository.composition.create).mockResolvedValue(created as never);

      const result = await createFabricComposition(actor, { code: "COT100", name: "100% Cotton", isActive: true });
      expect(result).toEqual(created);
    });

    it("creates fabric dye type", async () => {
      const created = { id: "dt-1", code: "REACTIVE", name: "Reactive Dye", isActive: true, companyId: "co-1" };
      vi.mocked(FabricConfigRepository.dyeType.create).mockResolvedValue(created as never);

      const result = await createFabricDyeType(actor, { code: "REACTIVE", name: "Reactive Dye", isActive: true });
      expect(result).toEqual(created);
    });
  });

  describe("Fabric Dye with FK validations", () => {
    it("creates fabric dye when dyeType belongs to company and unit exists", async () => {
      vi.mocked(FabricConfigRepository.dyeType.findFirst).mockResolvedValue({ id: "dt-1", companyId: "co-1" } as never);
      vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({ id: "uom-1" } as never);
      const created = { id: "dye-1", code: "DYE-RED", name: "Reactive Red", companyId: "co-1" };
      vi.mocked(FabricConfigRepository.dye.create).mockResolvedValue(created as never);

      const result = await createFabricDye(actor, {
        code: "DYE-RED",
        name: "Reactive Red",
        dyeTypeId: "dt-1",
        unitId: "uom-1",
        isActive: true,
      });

      expect(result).toEqual(created);
    });

    it("rejects creating dye if dyeTypeId does not belong to the company", async () => {
      vi.mocked(FabricConfigRepository.dyeType.findFirst).mockResolvedValue(null);

      await expect(
        createFabricDye(actor, {
          code: "DYE-RED",
          name: "Reactive Red",
          dyeTypeId: "dt-foreign",
          isActive: true,
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Dye type not found.",
      });
    });

    it("rejects creating width if unitId does not exist", async () => {
      vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue(null);

      await expect(
        createFabricWidth(actor, {
          code: "W58",
          name: "58 inches",
          unitId: "uom-invalid",
          isActive: true,
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Unit not found.",
      });
    });
  });
});

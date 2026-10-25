import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./production-config.repository", () => ({
  ProductionConfigRepository: {
    stage: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    line: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    machine: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    salesAgent: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { ProductionConfigRepository } = await import("./production-config.repository");
const {
  listProductionStages,
  createProductionStage,
  updateProductionStage,
  createProductionLine,
  createMachine,
} = await import("./production-config.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();

  vi.mocked(ProductionConfigRepository.stage.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(ProductionConfigRepository.stage.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(ProductionConfigRepository.stage.create).mockReset();
  vi.mocked(ProductionConfigRepository.stage.update).mockReset();

  vi.mocked(ProductionConfigRepository.line.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(ProductionConfigRepository.line.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(ProductionConfigRepository.line.create).mockReset();

  vi.mocked(ProductionConfigRepository.machine.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(ProductionConfigRepository.machine.create).mockReset();
});

describe("Production Config Service (Unit Tests)", () => {
  describe("Production Stages", () => {
    it("lists production stages ordered by sequence asc", async () => {
      const stages = [
        { id: "stg-1", code: "CUT", name: "Cutting", sequence: 1, companyId: "co-1" },
        { id: "stg-2", code: "STITCH", name: "Stitching", sequence: 2, companyId: "co-1" },
      ];
      vi.mocked(ProductionConfigRepository.stage.findMany).mockResolvedValue(stages as never);

      const result = await listProductionStages("co-1");
      expect(result).toEqual(stages);
      expect(ProductionConfigRepository.stage.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { sequence: "asc" },
      });
    });

    it("creates production stage with flags (isFinal, allowRework, allowsExtraQuantity)", async () => {
      const created = {
        id: "stg-1",
        code: "CUT",
        name: "Cutting",
        sequence: 1,
        isActive: true,
        isFinal: false,
        allowRework: true,
        allowsExtraQuantity: true,
        companyId: "co-1",
      };
      vi.mocked(ProductionConfigRepository.stage.create).mockResolvedValue(created as never);

      const result = await createProductionStage(actor, {
        code: "CUT",
        name: "Cutting",
        sequence: 1,
        isActive: true,
        isFinal: false,
        allowRework: true,
        allowsExtraQuantity: true,
      });

      expect(result).toEqual(created);
      expect(ProductionConfigRepository.stage.create).toHaveBeenCalledWith({
        data: {
          companyId: "co-1",
          code: "CUT",
          name: "Cutting",
          sequence: 1,
          isActive: true,
          isFinal: false,
          allowRework: true,
          allowsExtraQuantity: true,
        },
      });
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "production_stages",
          recordId: "stg-1",
          action: "CREATE",
        })
      );
    });

    it("rejects duplicate stage code within the same company", async () => {
      vi.mocked(ProductionConfigRepository.stage.findFirst).mockResolvedValue({ id: "stg-old", code: "CUT" } as never);

      await expect(
        createProductionStage(actor, {
          code: "CUT",
          name: "Cutting",
          sequence: 1,
          isActive: true,
          isFinal: false,
          allowRework: true,
          allowsExtraQuantity: true,
        })
      ).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'Stage code "CUT" is already in use.',
      });
    });

    it("updates production stage and writes audit log", async () => {
      const existing = {
        id: "stg-1",
        code: "PAK",
        name: "Packing",
        sequence: 5,
        isActive: true,
        isFinal: true,
        allowRework: false,
        allowsExtraQuantity: false,
        companyId: "co-1",
      };
      const updated = { ...existing, name: "Final Packing & Boxing" };
      vi.mocked(ProductionConfigRepository.stage.findFirst).mockResolvedValue(existing as never);
      vi.mocked(ProductionConfigRepository.stage.update).mockResolvedValue(updated as never);

      const result = await updateProductionStage(actor, "stg-1", {
        code: "PAK",
        name: "Final Packing & Boxing",
        sequence: 5,
        isActive: true,
        isFinal: true,
        allowRework: false,
        allowsExtraQuantity: false,
      });

      expect(result).toEqual(updated);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "production_stages",
          action: "UPDATE",
        })
      );
    });

    it("throws NOT_FOUND when updating stage belonging to another company (tenant isolation)", async () => {
      vi.mocked(ProductionConfigRepository.stage.findFirst).mockResolvedValue(null);

      await expect(
        updateProductionStage(actor, "stg-other", {
          code: "PAK",
          name: "Packing",
          sequence: 5,
          isActive: true,
          isFinal: true,
          allowRework: false,
          allowsExtraQuantity: false,
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Stage not found.",
      });
    });
  });

  describe("Production Lines & Machines", () => {
    it("creates production line and checks duplicate code in company", async () => {
      const created = { id: "line-1", code: "LINE-A", name: "Assembly Line A", companyId: "co-1" };
      vi.mocked(ProductionConfigRepository.line.create).mockResolvedValue(created as never);

      const result = await createProductionLine(actor, { code: "LINE-A", name: "Assembly Line A", isActive: true });
      expect(result).toEqual(created);
    });

    it("creates machine and checks duplicate code in company", async () => {
      const created = { id: "mac-1", code: "MAC-SN-01", name: "Single Needle Machine", companyId: "co-1" };
      vi.mocked(ProductionConfigRepository.machine.create).mockResolvedValue(created as never);

      const result = await createMachine(actor, { code: "MAC-SN-01", name: "Single Needle Machine", isActive: true });
      expect(result).toEqual(created);
    });
  });
});

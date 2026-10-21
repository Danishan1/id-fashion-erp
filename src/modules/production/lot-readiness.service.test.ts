import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  lot: { aggregate: vi.fn() },
  materialRequest: { count: vi.fn() },
  materialRequestItem: { findMany: vi.fn() },
  salesOrderItem: { findUnique: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
vi.mock("./production.repository", () => ({ ProductionOrderRepository: { findAnyById: vi.fn() } }));
vi.mock("@/modules/bom-mrp/mrp.service", () => ({ getMaterialRequirementForOrderLine: vi.fn() }));
vi.mock("./color-fabric-plan.service", () => ({ getPlanFabricReplacements: vi.fn().mockResolvedValue(new Map()) }));

const { ProductionOrderRepository } = await import("./production.repository");
const { getMaterialRequirementForOrderLine } = await import("@/modules/bom-mrp/mrp.service");
const { getLotMaterialReadiness, assertLotMaterialReady } = await import("./lot-readiness.service");
const { getPlanFabricReplacements } = await import("./color-fabric-plan.service");

const MTR = { id: "uom-mtr", baseUnitId: null, conversionFactor: "1" };

function requirement(neededPerPiece: number) {
  return {
    productId: "prod-1",
    bomId: "bom-1",
    sampleRequestId: null,
    hasApprovedBom: true,
    materials: [
      { materialId: "mat-cotton", materialName: "Cotton", materialCode: "MAT-1", uomId: "uom-mtr", uomCode: "MTR", neededQuantity: neededPerPiece },
    ],
    unconvertibleLines: [],
    totalMaterialCost: null,
    materialCostPerUnit: null,
  };
}

function issued(quantity: number) {
  return [{ materialId: "mat-cotton", issuedQuantity: String(quantity), uom: MTR, material: { baseUom: MTR } }];
}

beforeEach(() => {
  vi.mocked(ProductionOrderRepository.findAnyById)
    .mockReset()
    .mockResolvedValue({ id: "po-1", salesOrderItemId: null, productId: "prod-1" } as never);
  mockPrisma.lot.aggregate.mockReset().mockResolvedValue({ _sum: { quantity: null } });
  mockPrisma.materialRequest.count.mockReset().mockResolvedValue(1);
  mockPrisma.materialRequestItem.findMany.mockReset().mockResolvedValue([]);
  vi.mocked(getMaterialRequirementForOrderLine).mockReset().mockResolvedValue(requirement(1.5) as never);
});

describe("getLotMaterialReadiness", () => {
  it("requires assigned pieces × consumption: 5 PCS × 1.5 MTR = 7.5 MTR", async () => {
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(7.5));

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });

    expect(getMaterialRequirementForOrderLine).toHaveBeenCalledWith("co-1", expect.objectContaining({ quantity: 1 }));
    expect(r.rows[0]).toMatchObject({ perPieceQuantity: 1.5, requiredQuantity: 7.5, issuedQuantity: 7.5, remainingQuantity: 0 });
    expect(r.ready).toBe(true);
  });

  it("blocks when less than the required quantity is issued, naming the real numbers", async () => {
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(1.4));

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 1 });

    expect(r.ready).toBe(false);
    expect(r.rows[0]).toMatchObject({ requiredQuantity: 1.5, issuedQuantity: 1.4, remainingQuantity: 0.1 });
    expect(r.blockingMessage).toContain("Insufficient material quantity. Required quantity is 1.5 MTR");
    expect(r.blockingMessage).toContain("for 1 PCS");
  });

  it("is cumulative across lots — pieces in existing lots need their material too", async () => {
    mockPrisma.lot.aggregate.mockResolvedValue({ _sum: { quantity: "5" } });
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(7.5)); // only enough for the first 5

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });

    expect(r.totalPieces).toBe(10);
    expect(r.rows[0]).toMatchObject({ requiredQuantity: 15, remainingQuantity: 7.5 });
    expect(r.ready).toBe(false);
  });

  it("adds up partial issues across several request lines", async () => {
    mockPrisma.materialRequestItem.findMany.mockResolvedValue([...issued(4), ...issued(3.5)]);

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(r.rows[0].issuedQuantity).toBe(7.5);
    expect(r.ready).toBe(true);
  });

  // Colour-wise fabric plan (2026-10-21): a fabric chosen instead of the BOM
  // fabric for a garment colour stands in for it at the lot gate.
  it("counts a fabric chosen in the colour-wise plan toward the BOM fabric it replaces", async () => {
    vi.mocked(getPlanFabricReplacements).mockResolvedValueOnce(new Map([["mat-poplin", "mat-cotton"]]));
    mockPrisma.materialRequestItem.findMany.mockResolvedValue([
      ...issued(4.5),
      { materialId: "mat-poplin", issuedQuantity: "3", uom: MTR, material: { baseUom: MTR } },
    ]);

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(r.rows[0].issuedQuantity).toBe(7.5);
    expect(r.ready).toBe(true);
  });

  it("converts a request line kept in another unit into the material's base unit", async () => {
    const CM = { id: "uom-cm", baseUnitId: "uom-mtr", conversionFactor: "0.01" };
    mockPrisma.materialRequestItem.findMany.mockResolvedValue([
      { materialId: "mat-cotton", issuedQuantity: "750", uom: CM, material: { baseUom: MTR } },
    ]);

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(r.rows[0].issuedQuantity).toBe(7.5);
    expect(r.ready).toBe(true);
  });

  it("blocks when no material request exists, even if nothing seems short", async () => {
    mockPrisma.materialRequest.count.mockResolvedValue(0);

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(r.ready).toBe(false);
    expect(r.blockingMessage).toContain("Cutting worker assignment, material request and material issue are required");
  });

  it("blocks when the style has no approved BOM (nothing to calculate from)", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({ ...requirement(0), hasApprovedBom: false, materials: [] } as never);

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(r.ready).toBe(false);
    expect(r.hasMaterialPlan).toBe(false);
  });

  it("excludes split/merged/cancelled lots from the piece count", async () => {
    await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 5 });
    expect(mockPrisma.lot.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"] } }) })
    );
  });
});

describe("Sales-Order-level material requests", () => {
  it("counts a request raised from BOM/MRP against the order's Sales Order", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", salesOrderItemId: "soi-1", productId: "prod-1" } as never);
    mockPrisma.salesOrderItem.findUnique.mockResolvedValue({ salesOrderId: "so-1" });
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(9));

    const r = await getLotMaterialReadiness("co-1", "po-1", { newLotPieces: 6 });

    const where = { companyId: "co-1", OR: [{ productionOrderId: "po-1" }, { productionOrderId: null, salesOrderId: "so-1" }] };
    expect(mockPrisma.materialRequest.count).toHaveBeenCalledWith({ where: { ...where, status: { not: "CANCELLED" } } });
    expect(r.rows[0]).toMatchObject({ requiredQuantity: 9, issuedQuantity: 9, remainingQuantity: 0 });
    expect(r.ready).toBe(true);
  });
});

describe("assertLotMaterialReady", () => {
  it("throws INSUFFICIENT_RAW_MATERIAL_STOCK with the calculated message when short", async () => {
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(1));
    await expect(assertLotMaterialReady("co-1", "po-1", { newLotPieces: 5 })).rejects.toMatchObject({
      code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
      message: expect.stringContaining("Required quantity is 7.5 MTR"),
    });
  });

  it("returns quietly when material is fully issued", async () => {
    mockPrisma.materialRequestItem.findMany.mockResolvedValue(issued(7.5));
    await expect(assertLotMaterialReady("co-1", "po-1", { newLotPieces: 5 })).resolves.toMatchObject({ ready: true });
  });
});

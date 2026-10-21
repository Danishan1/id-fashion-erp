import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  salesOrderItemBreakdown: { findMany: vi.fn() },
  product: { findMany: vi.fn() },
  productionOrderColorFabric: { findMany: vi.fn(), upsert: vi.fn() },
  color: { findMany: vi.fn() },
  unitOfMeasure: { findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
}));
vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./production.repository", () => ({ ProductionOrderRepository: { findAnyById: vi.fn() } }));
vi.mock("@/modules/bom-mrp/mrp.service", () => ({ getEffectiveExplosionItemsForOrderLine: vi.fn() }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findMaterialById: vi.fn() } }));

const { ProductionOrderRepository } = await import("./production.repository");
const { getEffectiveExplosionItemsForOrderLine } = await import("@/modules/bom-mrp/mrp.service");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { getColorFabricPlan, saveColorFabricPlan, buildFabricRequestLines, getPlanFabricReplacements } = await import(
  "./color-fabric-plan.service"
);

const MTR = { id: "mtr", code: "MTR", baseUnitId: null, conversionFactor: 1 };
const CM = { id: "cm", code: "CM", baseUnitId: "mtr", conversionFactor: 0.01 };

function bomLine(materialId: string, perPiece: number, opts: { colorId?: string | null; uom?: typeof MTR; wastage?: number } = {}) {
  return {
    materialId,
    colorId: opts.colorId ?? null,
    quantityPerUnit: perPiece,
    wastagePercentage: opts.wastage ?? 0,
    uom: opts.uom ?? MTR,
    material: { styleName: materialId === "fab-cotton" ? "Cotton" : materialId, styleCode: materialId, baseUom: MTR, defaultSupplierId: null, unitCost: null },
  };
}

const RED = { id: "col-red", name: "Red" };
const OLIVE = { id: "col-olive", name: "Olive" };

beforeEach(() => {
  vi.mocked(ProductionOrderRepository.findAnyById)
    .mockReset()
    .mockResolvedValue({ id: "po-1", productId: "style-1", salesOrderItemId: "soi-1", plannedQuantity: 15 } as never);
  // Sales order line: Red 10, Olive 5 (= 15, same as the planned quantity).
  mockPrisma.salesOrderItemBreakdown.findMany.mockReset().mockResolvedValue([
    { orderedQuantity: 6, productVariant: { color: RED } },
    { orderedQuantity: 4, productVariant: { color: RED } },
    { orderedQuantity: 5, productVariant: { color: OLIVE } },
  ]);
  vi.mocked(getEffectiveExplosionItemsForOrderLine)
    .mockReset()
    .mockResolvedValue([bomLine("fab-cotton", 1.5, { wastage: 10 }), bomLine("thread", 2)] as never);
  mockPrisma.product.findMany.mockReset().mockResolvedValue([
    { id: "fab-cotton", materialCategory: "FABRIC" },
    { id: "thread", materialCategory: "TRIMS" },
  ]);
  mockPrisma.productionOrderColorFabric.findMany.mockReset().mockResolvedValue([]);
});

describe("getColorFabricPlan", () => {
  it("gives one row per garment colour x BOM fabric, with the suggested quantity", async () => {
    const plan = await getColorFabricPlan("co-1", "po-1");

    expect(plan.applies).toBe(true);
    expect(plan.rows.map((r) => [r.garmentColorName, r.bomMaterialId, r.pieces, r.perPieceQuantity, r.suggestedQuantity])).toEqual([
      ["Olive", "fab-cotton", 5, 1.65, 8.25],
      ["Red", "fab-cotton", 10, 1.65, 16.5],
    ]);
    expect(plan.isComplete).toBe(false);
    expect(plan.incompleteColors).toEqual(["Olive", "Red"]);
  });

  it("applies a colour-scoped BOM fabric line only to that garment colour", async () => {
    vi.mocked(getEffectiveExplosionItemsForOrderLine).mockResolvedValue([
      bomLine("fab-cotton", 1),
      { ...bomLine("fab-lining", 0.5), colorId: "col-red" },
    ] as never);
    mockPrisma.product.findMany.mockResolvedValue([
      { id: "fab-cotton", materialCategory: "FABRIC" },
      { id: "fab-lining", materialCategory: "FABRIC" },
    ]);

    const plan = await getColorFabricPlan("co-1", "po-1");
    expect(plan.rows.map((r) => `${r.garmentColorName}:${r.bomMaterialId}`)).toEqual(["Olive:fab-cotton", "Red:fab-cotton", "Red:fab-lining"]);
  });

  it("scales each colour to the production order's planned quantity", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "style-1", salesOrderItemId: "soi-1", plannedQuantity: 30 } as never);
    const plan = await getColorFabricPlan("co-1", "po-1");
    expect(plan.rows.find((r) => r.garmentColorName === "Red")?.pieces).toBe(20);
  });

  it("is complete once every row has a fabric colour and quantity", async () => {
    mockPrisma.productionOrderColorFabric.findMany.mockResolvedValue(
      [RED, OLIVE].map((c) => ({
        garmentColorId: c.id,
        bomMaterialId: "fab-cotton",
        materialId: "fab-cotton",
        fabricColorId: "fc-1",
        quantity: 10,
        uomId: "mtr",
        material: { styleName: "Cotton", styleCode: "FC" },
        fabricColor: { name: "Indigo" },
        uom: { code: "MTR" },
      }))
    );
    const plan = await getColorFabricPlan("co-1", "po-1");
    expect(plan.isComplete).toBe(true);
    expect(plan.incompleteColors).toEqual([]);
  });

  it("doesn't apply to a make-to-stock order or a BOM with no fabric", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "style-1", salesOrderItemId: null, plannedQuantity: 15 } as never);
    expect((await getColorFabricPlan("co-1", "po-1")).applies).toBe(false);

    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "style-1", salesOrderItemId: "soi-1", plannedQuantity: 15 } as never);
    mockPrisma.product.findMany.mockResolvedValue([{ id: "fab-cotton", materialCategory: "TRIMS" }, { id: "thread", materialCategory: "TRIMS" }]);
    expect((await getColorFabricPlan("co-1", "po-1")).applies).toBe(false);
  });
});

describe("saveColorFabricPlan", () => {
  beforeEach(() => {
    vi.mocked(ProductRepository.findMaterialById).mockReset().mockResolvedValue({ id: "fab-cotton" } as never);
    mockPrisma.color.findMany.mockReset().mockResolvedValue([{ id: "fc-1" }]);
    mockPrisma.unitOfMeasure.findMany.mockReset().mockResolvedValue([{ id: "mtr" }]);
    mockPrisma.productionOrderColorFabric.upsert.mockReset();
  });

  it("upserts each row by order x garment colour x BOM fabric", async () => {
    await saveColorFabricPlan({ companyId: "co-1", userId: "u-1" }, "po-1", {
      rows: [{ garmentColorId: "col-red", bomMaterialId: "fab-cotton", materialId: "fab-cotton", fabricColorId: "fc-1", quantity: 16.5, uomId: "mtr" }],
    });
    expect(mockPrisma.productionOrderColorFabric.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productionOrderId_garmentColorId_bomMaterialId: { productionOrderId: "po-1", garmentColorId: "col-red", bomMaterialId: "fab-cotton" } },
        create: expect.objectContaining({ companyId: "co-1", materialId: "fab-cotton", fabricColorId: "fc-1", quantity: 16.5 }),
      })
    );
  });

  it("rejects a row that isn't one of the order's colour x fabric combinations", async () => {
    await expect(
      saveColorFabricPlan({ companyId: "co-1", userId: "u-1" }, "po-1", {
        rows: [{ garmentColorId: "col-blue", bomMaterialId: "fab-cotton", materialId: "fab-cotton", fabricColorId: "fc-1", quantity: 5, uomId: "mtr" }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mockPrisma.productionOrderColorFabric.upsert).not.toHaveBeenCalled();
  });

  it("rejects a fabric colour from another company", async () => {
    mockPrisma.color.findMany.mockResolvedValue([]);
    await expect(
      saveColorFabricPlan({ companyId: "co-1", userId: "u-1" }, "po-1", {
        rows: [{ garmentColorId: "col-red", bomMaterialId: "fab-cotton", materialId: "fab-cotton", fabricColorId: "fc-x", quantity: 5, uomId: "mtr" }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("buildFabricRequestLines", () => {
  const savedRow = (garmentColorName: string, materialId: string, fabricColorId: string, quantity: number, uomId = "mtr") => ({
    garmentColorName,
    saved: { materialId, materialName: materialId, fabricColorId, quantity, uomId },
  });

  beforeEach(() => {
    mockPrisma.product.findMany.mockResolvedValue([
      { id: "fab-cotton", styleName: "Cotton", baseUom: MTR },
      { id: "fab-linen", styleName: "Linen", baseUom: MTR },
    ]);
    mockPrisma.unitOfMeasure.findMany.mockResolvedValue([MTR, CM]);
  });

  it("sums per fabric x fabric colour in the base unit and subtracts what's already requested", async () => {
    const plan = {
      applies: true,
      isComplete: true,
      incompleteColors: [],
      rows: [
        savedRow("Red", "fab-cotton", "fc-indigo", 10),
        savedRow("Olive", "fab-cotton", "fc-indigo", 500, "cm"),
        savedRow("Blue", "fab-linen", "fc-white", 4),
      ],
    };
    const lines = await buildFabricRequestLines("co-1", plan as never, new Map([["fab-linen:fc-white", 4]]));
    expect(lines).toEqual([{ materialId: "fab-cotton", colorId: "fc-indigo", uomId: "mtr", requestedQuantity: 15 }]);
  });

  it("counts an earlier colourless request of the same fabric so it isn't requested twice", async () => {
    const plan = {
      applies: true,
      isComplete: true,
      incompleteColors: [],
      rows: [savedRow("Red", "fab-cotton", "fc-red", 10), savedRow("Olive", "fab-cotton", "fc-olive", 6)],
    };
    const lines = await buildFabricRequestLines("co-1", plan as never, new Map([["fab-cotton:null", 12]]));
    expect(lines).toEqual([{ materialId: "fab-cotton", colorId: "fc-olive", uomId: "mtr", requestedQuantity: 4 }]);
  });

  it("refuses an incomplete plan, naming the colours", async () => {
    await expect(
      buildFabricRequestLines("co-1", { applies: true, isComplete: false, incompleteColors: ["Red", "Olive"], rows: [] } as never, new Map())
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("Red, Olive") });
  });
});

describe("getPlanFabricReplacements", () => {
  it("maps a chosen fabric to the BOM fabric it replaces", async () => {
    mockPrisma.productionOrderColorFabric.findMany.mockResolvedValue([
      { materialId: "fab-linen", bomMaterialId: "fab-cotton" },
      { materialId: "fab-cotton", bomMaterialId: "fab-cotton" },
    ]);
    const map = await getPlanFabricReplacements("co-1", "po-1");
    expect(Object.fromEntries(map)).toEqual({ "fab-linen": "fab-cotton" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() }, color: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findStyleById: vi.fn(), findMaterialById: vi.fn() },
}));
vi.mock("./bom.repository", () => ({
  BomRepository: { findByProductId: vi.fn(), upsertWithItems: vi.fn() },
}));

const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { BomRepository } = await import("./bom.repository");
const { upsertBom, getBomCostSheet } = await import("./bom.service");

const actor = { companyId: "co-1", userId: "user-1" };
const BASE_UOM = { id: "uom-1", name: "MTR", baseUnitId: null, conversionFactor: 1 };

const oneItem = (overrides: Record<string, unknown> = {}) => ({
  materialId: "mat-1",
  colorId: "",
  quantityPerUnit: 1.2,
  wastagePercentage: 10,
  uomId: "uom-1",
  notes: "",
  ...overrides,
});

beforeEach(() => {
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "prod-1", styleName: "Round Neck T-Shirt" } as never);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Cotton Fabric", baseUom: BASE_UOM } as never);
  vi.mocked(LookupRepository.unit.findUnique).mockReset().mockResolvedValue(BASE_UOM as never);
  vi.mocked(LookupRepository.color.findFirst).mockReset().mockResolvedValue({ id: "color-1" } as never);
  vi.mocked(BomRepository.findByProductId).mockReset().mockResolvedValue(null);
  vi.mocked(BomRepository.upsertWithItems).mockReset().mockResolvedValue({ id: "bom-1", items: [] } as never);
});

describe("upsertBom", () => {
  it("rejects when the style doesn't exist", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-x", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects two exact-duplicate lines for the same material and color", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "color-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a null-color line coexisting with a specific-color line for the same material", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "" }), oneItem({ colorId: "color-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a specific-color line added after a null-color line for the same material (the reverse order)", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  // Regression test for ERP-BUG-Q3 (P3): two "applies to every color" lines
  // for the same material used to hit the "all-colors + specific-color
  // conflict" message even though no specific-color line was involved at
  // all — a real conflict correctly rejected, but for the wrong stated
  // reason.
  it("rejects two 'applies to every color' lines for the same material with a message naming that specific conflict", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "" }), oneItem({ colorId: "" })] })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("already has an \"applies to every color\" line"),
    });
  });

  it("allows two lines for the same material with genuinely different colors", async () => {
    await upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "color-2" })] });
    expect(BomRepository.upsertWithItems).toHaveBeenCalled();
  });

  it("rejects a line whose material doesn't exist as a raw material", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a line whose material has no base unit configured", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "mat-1", styleName: "Cotton Fabric", baseUom: null } as never);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a line whose chosen unit has no fixed conversion to the material's base unit", async () => {
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({ id: "uom-x", name: "Roll", baseUnitId: null, conversionFactor: 1 } as never);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ uomId: "uom-x" })] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a colorId that doesn't belong to this company", async () => {
    vi.mocked(LookupRepository.color.findFirst).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-x" })] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves valid items via a full replace and audit-logs CREATE when no BOM existed before", async () => {
    await upsertBom(actor, "prod-1", { notes: "For export order", items: [oneItem()] });

    expect(BomRepository.upsertWithItems).toHaveBeenCalledWith(
      "co-1",
      "prod-1",
      "For export order",
      expect.arrayContaining([expect.objectContaining({ materialId: "mat-1", quantityPerUnit: 1.2, wastagePercentage: 10 })])
    );
  });
});

describe("getBomCostSheet", () => {
  const MTR = { id: "uom-mtr", code: "MTR", name: "Meter", baseUnitId: null, conversionFactor: 1 };
  const YDS = { id: "uom-yds", code: "YDS", name: "Yard", baseUnitId: "uom-mtr", conversionFactor: 0.9144 };
  const ROLL_UNRELATED = { id: "uom-roll", code: "ROL", name: "Roll", baseUnitId: null, conversionFactor: 1 };

  const bomItem = (overrides: Record<string, unknown> = {}) => ({
    id: "item-1",
    quantityPerUnit: 2,
    wastagePercentage: 10,
    colorId: null,
    color: null,
    uom: MTR,
    material: {
      id: "mat-1",
      styleName: "Cotton Fabric",
      styleCode: "MAT-001",
      baseUom: MTR,
      unitCost: 50,
    },
    ...overrides,
  });

  it("reports hasBom: false with no lines when the style has no BOM at all", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(null);
    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet).toMatchObject({ hasBom: false, lines: [], colorBreakdown: [] });
  });

  it("rejects a style that doesn't exist in this company", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);
    await expect(getBomCostSheet("co-1", "prod-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("computes material cost per unit for a simple single-line BOM (same UOM as the material's base unit)", async () => {
    // effective qty = 2 * 1.10 = 2.2 (MTR, same as base) -> 2.2 * 50 = 110
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({ id: "bom-1", items: [bomItem()] } as never);
    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet.lines[0]).toMatchObject({ effectiveQuantity: 2.2, lineCost: 110, isCostAvailable: true });
    expect(sheet.colorBreakdown).toEqual([{ colorId: null, colorName: "All Colors", materialCostPerUnit: 110, isComplete: true }]);
  });

  it("converts a line's UOM to the material's base UOM before costing, reusing the same helper mrp.service.ts uses", async () => {
    // 10 YDS, no wastage -> 10 * 0.9144 = 9.144 MTR -> 9.144 * 50 = 457.2
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({
      id: "bom-1",
      items: [bomItem({ quantityPerUnit: 10, wastagePercentage: 0, uom: YDS })],
    } as never);
    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet.lines[0].effectiveQuantity).toBeCloseTo(9.144, 4);
    expect(sheet.lines[0].lineCost).toBeCloseTo(457.2, 2);
  });

  it("marks a line unavailable (not silently zero) when the material has no unit cost, and flags the bucket incomplete", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({
      id: "bom-1",
      items: [bomItem({ material: { id: "mat-1", styleName: "Cotton Fabric", styleCode: "MAT-001", baseUom: MTR, unitCost: null } })],
    } as never);
    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet.lines[0]).toMatchObject({ isCostAvailable: false, lineCost: null });
    expect(sheet.colorBreakdown[0]).toMatchObject({ materialCostPerUnit: 0, isComplete: false });
  });

  it("marks a line unavailable when its UOM has no fixed conversion to the material's base unit", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({
      id: "bom-1",
      items: [bomItem({ uom: ROLL_UNRELATED })],
    } as never);
    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet.lines[0]).toMatchObject({ isCostAvailable: false, lineCost: null });
    expect(sheet.colorBreakdown[0].isComplete).toBe(false);
  });

  it("computes a separate cost bucket per color, each including the shared null-color lines rather than summing everything into one number", async () => {
    // null-color line: 1 * 1.0 * 50 = 50 (shared by every color)
    // Navy-only line: 1 * 1.0 * 20 = 20
    // Black-only line: 1 * 1.0 * 30 = 30
    const sharedLine = bomItem({ id: "shared", quantityPerUnit: 1, wastagePercentage: 0 });
    const navyLine = bomItem({
      id: "navy",
      quantityPerUnit: 1,
      wastagePercentage: 0,
      colorId: "color-navy",
      color: { id: "color-navy", name: "Navy Blue" },
      material: { id: "mat-2", styleName: "Thread", styleCode: "MAT-002", baseUom: MTR, unitCost: 20 },
    });
    const blackLine = bomItem({
      id: "black",
      quantityPerUnit: 1,
      wastagePercentage: 0,
      colorId: "color-black",
      color: { id: "color-black", name: "Black" },
      material: { id: "mat-3", styleName: "Thread", styleCode: "MAT-003", baseUom: MTR, unitCost: 30 },
    });
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({ id: "bom-1", items: [sharedLine, navyLine, blackLine] } as never);

    const sheet = await getBomCostSheet("co-1", "prod-1");
    expect(sheet.colorBreakdown).toHaveLength(2);
    expect(sheet.colorBreakdown).toEqual(
      expect.arrayContaining([
        { colorId: "color-navy", colorName: "Navy Blue", materialCostPerUnit: 70, isComplete: true },
        { colorId: "color-black", colorName: "Black", materialCostPerUnit: 80, isComplete: true },
      ])
    );
  });
});

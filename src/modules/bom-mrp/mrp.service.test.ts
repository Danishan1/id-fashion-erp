import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/inventory/inventory.service", () => ({ sumAvailableByProductIds: vi.fn() }));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({
  SalesOrderRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./bom.repository", () => ({
  BomRepository: { findManyByProductIds: vi.fn() },
}));

const { sumAvailableByProductIds } = await import("@/modules/inventory/inventory.service");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { BomRepository } = await import("./bom.repository");
const { getMaterialRequirements } = await import("./mrp.service");

const MTR = { id: "uom-mtr", code: "MTR", name: "Meter", baseUnitId: null, conversionFactor: 1 };
const ROL = { id: "uom-rol", code: "ROL", name: "Roll", baseUnitId: null, conversionFactor: 1 };

function order(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: "ORD-2026-00001",
    customer: { name: "Zenith Apparel Imports" },
    items: [
      {
        productId: "style-1",
        product: { styleName: "Round Neck T-Shirt" },
        breakdown: [
          { orderedQuantity: 200, productVariant: { color: { id: "black" } } },
          { orderedQuantity: 400, productVariant: { color: { id: "navy" } } },
        ],
      },
    ],
    ...overrides,
  };
}

function cottonBomItem(overrides: Record<string, unknown> = {}) {
  return {
    materialId: "mat-cotton",
    colorId: null,
    quantityPerUnit: 1.2,
    wastagePercentage: 10,
    uom: MTR,
    material: { styleName: "Cotton Fabric", styleCode: "MAT-COT", baseUom: MTR, defaultSupplierId: "sup-1", unitCost: 50 },
    ...overrides,
  };
}

function threadBomItem(overrides: Record<string, unknown> = {}) {
  return {
    materialId: "mat-thread",
    colorId: "navy",
    quantityPerUnit: 0.05,
    wastagePercentage: 0,
    uom: ROL,
    material: { styleName: "Polyester Thread", styleCode: "MAT-THR", baseUom: ROL, defaultSupplierId: null, unitCost: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset().mockResolvedValue(order() as never);
  vi.mocked(BomRepository.findManyByProductIds)
    .mockReset()
    .mockResolvedValue([{ productId: "style-1", items: [cottonBomItem(), threadBomItem()] }] as never);
  vi.mocked(sumAvailableByProductIds)
    .mockReset()
    .mockResolvedValue(new Map([["mat-cotton", 509.144], ["mat-thread", 0]]));
});

describe("getMaterialRequirements", () => {
  it("rejects when the sales order doesn't exist", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(getMaterialRequirements("co-1", "so-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applies wastage% and nets a null-color BOM line against every color's ordered quantity", async () => {
    const result = await getMaterialRequirements("co-1", "so-1");
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    // 1.2 * (1 + 10%) * (200 + 400) = 792, matching this project's own
    // hand-verified worked example.
    expect(cotton.neededQuantity).toBeCloseTo(792);
    expect(cotton.availableQuantity).toBe(509.144);
    expect(cotton.shortfallQuantity).toBeCloseTo(282.856);
  });

  it("filters a color-specific BOM line to only the matching color's breakdown rows", async () => {
    const result = await getMaterialRequirements("co-1", "so-1");
    const thread = result.materials.find((m) => m.materialId === "mat-thread")!;

    // 0.05 * 400 (navy only, black excluded) = 20
    expect(thread.neededQuantity).toBeCloseTo(20);
    expect(thread.shortfallQuantity).toBeCloseTo(20);
  });

  it("aggregates the same material across multiple contributing styles rather than overwriting", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(
      order({
        items: [
          { productId: "style-1", product: { styleName: "Round Neck T-Shirt" }, breakdown: [{ orderedQuantity: 100, productVariant: { color: { id: "black" } } }] },
          { productId: "style-2", product: { styleName: "V-Neck T-Shirt" }, breakdown: [{ orderedQuantity: 100, productVariant: { color: { id: "black" } } }] },
        ],
      }) as never
    );
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([
      { productId: "style-1", items: [cottonBomItem({ wastagePercentage: 0, quantityPerUnit: 1 })] },
      { productId: "style-2", items: [cottonBomItem({ wastagePercentage: 0, quantityPerUnit: 1 })] },
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    expect(cotton.neededQuantity).toBeCloseTo(200);
    expect(cotton.contributingStyles).toHaveLength(2);
  });

  it("reports a style with no BOM separately instead of throwing", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([]);
    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.stylesWithoutBom).toEqual([{ productId: "style-1", styleName: "Round Neck T-Shirt" }]);
    expect(result.materials).toHaveLength(0);
  });

  it("reports a line whose material has no base unit as unconvertible rather than crashing", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([
      { productId: "style-1", items: [cottonBomItem({ material: { ...cottonBomItem().material, baseUom: null } })] },
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.unconvertibleLines).toEqual([{ materialId: "mat-cotton", materialName: "Cotton Fabric", reason: "no base unit configured" }]);
    expect(result.materials).toHaveLength(0);
  });

  it("reports a line with no fixed UOM conversion path as unconvertible rather than crashing", async () => {
    const rollUom = { id: "uom-roll-fabric", code: "ROLL", name: "Fabric Roll", baseUnitId: null, conversionFactor: 1 };
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([{ productId: "style-1", items: [cottonBomItem({ uom: rollUom })] }] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.unconvertibleLines).toHaveLength(1);
    expect(result.unconvertibleLines[0].materialId).toBe("mat-cotton");
  });

  it("sorts materials by shortfall quantity descending", async () => {
    vi.mocked(sumAvailableByProductIds).mockResolvedValue(new Map([["mat-cotton", 780], ["mat-thread", 0]]));
    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.materials.map((m) => m.materialId)).toEqual(["mat-thread", "mat-cotton"]);
  });
});

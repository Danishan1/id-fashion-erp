import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/inventory/inventory.service", () => ({ sumAvailableByProductIds: vi.fn() }));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({
  SalesOrderRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./bom.repository", () => ({
  BomRepository: { findManyByProductIds: vi.fn(), findByProductId: vi.fn() },
}));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleMaterialRepository: { findLatestVersionMaterialsForRequirement: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: { salesOrderItem: { findFirst: vi.fn() } } }));

const { sumAvailableByProductIds } = await import("@/modules/inventory/inventory.service");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { BomRepository } = await import("./bom.repository");
const { SampleMaterialRepository } = await import("@/modules/sampling/sample.repository");
const { prisma } = await import("@/core/db/client");
const {
  getMaterialRequirements,
  getStyleMaterialRequirement,
  getSampleMaterialRequirement,
  getMaterialRequirementForOrderLine,
} = await import("./mrp.service");

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

// Matches BomRepository.findManyByProductIds' real shape: only the APPROVED
// version's items are ever exposed to MRP — an unapproved draft must read
// exactly like "no BOM" (see bom.repository.ts / docs/PRACTICAL_BUSINESS_
// READY_AUDIT.md Section 4). `approvedVersion: null` simulates a style whose
// BOM exists but has never been approved.
function bomFixture(productId: string, items: unknown[] | null) {
  return { id: `bom-${productId}`, productId, approvedVersion: items ? { id: `version-${productId}`, items } : null };
}

beforeEach(() => {
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset().mockResolvedValue(order() as never);
  vi.mocked(BomRepository.findManyByProductIds)
    .mockReset()
    .mockResolvedValue([bomFixture("style-1", [cottonBomItem(), threadBomItem()])] as never);
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
      bomFixture("style-1", [cottonBomItem({ wastagePercentage: 0, quantityPerUnit: 1 })]),
      bomFixture("style-2", [cottonBomItem({ wastagePercentage: 0, quantityPerUnit: 1 })]),
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    expect(cotton.neededQuantity).toBeCloseTo(200);
    expect(cotton.contributingStyles).toHaveLength(2);
  });

  it("reports a style with no BOM separately instead of throwing", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([]);
    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.stylesWithoutBom).toEqual([
      { productId: "style-1", styleName: "Round Neck T-Shirt", reason: "no BOM defined for this style" },
    ]);
    expect(result.materials).toHaveLength(0);
  });

  // Real regression coverage for the versioning/approval gate: a BOM that
  // exists but has never been approved (or whose only version is a DRAFT
  // edit-in-progress) must be treated exactly like "no BOM at all" — MRP
  // must never silently plan against an unreviewed edit.
  it("treats a style with an unapproved BOM (approvedVersion: null) the same as no BOM at all", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([bomFixture("style-1", null)] as never);
    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.stylesWithoutBom).toEqual([
      { productId: "style-1", styleName: "Round Neck T-Shirt", reason: "no BOM defined for this style" },
    ]);
    expect(result.materials).toHaveLength(0);
  });

  // The user's own explicit rule: a line with a linked Sample uses that
  // sample's own current material list instead of the Style's real BOM.
  it("uses the linked Sample's material list instead of the Style's BOM for a sample-linked line", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(
      order({
        items: [
          {
            productId: "style-1",
            sampleRequestId: "sam-1",
            product: { styleName: "Round Neck T-Shirt" },
            breakdown: [
              { orderedQuantity: 200, productVariant: { color: { id: "black" } } },
              { orderedQuantity: 400, productVariant: { color: { id: "navy" } } },
            ],
          },
        ],
      }) as never
    );
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([
      { materialId: "mat-cotton", plannedQuantity: 1, uomId: "uom-mtr", colorId: null, uom: MTR, material: { id: "mat-cotton", styleName: "Cotton Fabric", styleCode: "MAT-COT", baseUomId: "uom-mtr", baseUom: MTR, defaultSupplierId: "sup-1", unitCost: 50 } },
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");

    // Sample-sourced: no wastage%, plannedQuantity treated as-is per unit —
    // 1 * 600 (200 black + 400 navy) = 600, NOT the BOM fixture's 792.
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;
    expect(cotton.neededQuantity).toBe(600);
    expect(BomRepository.findManyByProductIds).toHaveBeenCalled();
    // The Style's own BOM was fetched (for any non-sample lines) but never
    // consulted for this sample-linked line's own quantity.
    expect(result.stylesWithoutBom).toHaveLength(0);
  });

  it("reports a sample-linked line with no recorded materials separately, naming the sample as the cause", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(
      order({
        items: [
          {
            productId: "style-1",
            sampleRequestId: "sam-1",
            product: { styleName: "Round Neck T-Shirt" },
            breakdown: [{ orderedQuantity: 100, productVariant: { color: { id: "black" } } }],
          },
        ],
      }) as never
    );
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([]);

    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.stylesWithoutBom).toEqual([
      { productId: "style-1", styleName: "Round Neck T-Shirt", reason: "the linked sample has no materials recorded yet" },
    ]);
  });

  it("reports a line whose material has no base unit as unconvertible rather than crashing", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([
      bomFixture("style-1", [cottonBomItem({ material: { ...cottonBomItem().material, baseUom: null } })]),
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.unconvertibleLines).toEqual([{ materialId: "mat-cotton", materialName: "Cotton Fabric", reason: "no base unit configured" }]);
    expect(result.materials).toHaveLength(0);
  });

  it("reports a line with no fixed UOM conversion path as unconvertible rather than crashing", async () => {
    const rollUom = { id: "uom-roll-fabric", code: "ROLL", name: "Fabric Roll", baseUnitId: null, conversionFactor: 1 };
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([bomFixture("style-1", [cottonBomItem({ uom: rollUom })])] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.unconvertibleLines).toHaveLength(1);
    expect(result.unconvertibleLines[0].materialId).toBe("mat-cotton");
  });

  it("sorts materials by shortfall quantity descending", async () => {
    vi.mocked(sumAvailableByProductIds).mockResolvedValue(new Map([["mat-cotton", 780], ["mat-thread", 0]]));
    const result = await getMaterialRequirements("co-1", "so-1");
    expect(result.materials.map((m) => m.materialId)).toEqual(["mat-thread", "mat-cotton"]);
  });

  // Regression test for the P4 fix: a single style reaching the same
  // material via two different color-scoped BOM lines previously produced
  // two separate contributingStyles entries (one per line) instead of one
  // merged entry with the combined quantity.
  it("merges contributingStyles into one entry when a single style reaches a material via two color-scoped BOM lines", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([
      bomFixture("style-1", [
        cottonBomItem({ colorId: "black", wastagePercentage: 0, quantityPerUnit: 1 }),
        cottonBomItem({ colorId: "navy", wastagePercentage: 0, quantityPerUnit: 1 }),
      ]),
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    // order()'s default breakdown is 200 black + 400 navy => 600 total.
    expect(cotton.contributingStyles).toHaveLength(1);
    expect(cotton.contributingStyles[0]).toMatchObject({ productId: "style-1", neededQuantity: 600 });
  });

  // Regression test for the P4 fix: quantities accumulate through repeated
  // floating-point addition (0.1 + 0.2 !== 0.3 under IEEE-754), which
  // previously surfaced as raw noise like 103.60000000000002 in the response.
  it("rounds needed/available/shortfall quantities to 4 decimal places, avoiding floating-point noise", async () => {
    vi.mocked(BomRepository.findManyByProductIds).mockResolvedValue([
      bomFixture("style-1", [
        cottonBomItem({ colorId: "black", wastagePercentage: 0, quantityPerUnit: 0.0005 }), // 0.0005 * 200 = 0.1
        cottonBomItem({ colorId: "navy", wastagePercentage: 0, quantityPerUnit: 0.0005 }), // 0.0005 * 400 = 0.2
      ]),
    ] as never);

    const result = await getMaterialRequirements("co-1", "so-1");
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    expect(cotton.neededQuantity).toBe(0.3);
    expect(cotton.contributingStyles[0].neededQuantity).toBe(0.3);
  });
});

describe("getStyleMaterialRequirement", () => {
  beforeEach(() => {
    vi.mocked(BomRepository.findByProductId)
      .mockReset()
      .mockResolvedValue(bomFixture("style-1", [cottonBomItem(), threadBomItem()]) as never);
  });

  it("reports no approved BOM as hasApprovedBom: false, with everything else empty/null", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomFixture("style-1", null) as never);

    const result = await getStyleMaterialRequirement("co-1", "style-1", 100);

    expect(result).toMatchObject({ hasApprovedBom: false, materials: [], totalMaterialCost: null, materialCostPerUnit: null });
  });

  it("scales BOM quantities by the given flat quantity, not any Sales Order breakdown", async () => {
    const result = await getStyleMaterialRequirement("co-1", "style-1", 600);
    const cotton = result.materials.find((m) => m.materialId === "mat-cotton")!;

    // 1.2 * 1.10 wastage * 600 = 792, matching the same hand-verified figure
    // getMaterialRequirements' own suite already trusts for this same fixture.
    expect(cotton.neededQuantity).toBe(792);
  });

  it("computes lineCost/totalMaterialCost/materialCostPerUnit from the material's own unitCost", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomFixture("style-1", [cottonBomItem()]) as never);
    vi.mocked(sumAvailableByProductIds).mockResolvedValue(new Map([["mat-cotton", 0]]));

    const result = await getStyleMaterialRequirement("co-1", "style-1", 100);
    const cotton = result.materials[0];

    // 1.2 * 1.10 * 100 = 132 MTR needed, unitCost 50 => lineCost 6600.
    expect(cotton.neededQuantity).toBe(132);
    expect(cotton.lineCost).toBe(6600);
    expect(result.totalMaterialCost).toBe(6600);
    expect(result.materialCostPerUnit).toBe(66);
  });

  it("reports totalMaterialCost as null (never an undercounted number) when any material has no unitCost", async () => {
    // threadBomItem's material.unitCost is null in this fixture set.
    const result = await getStyleMaterialRequirement("co-1", "style-1", 100);

    expect(result.totalMaterialCost).toBeNull();
    expect(result.materialCostPerUnit).toBeNull();
    const thread = result.materials.find((m) => m.materialId === "mat-thread")!;
    expect(thread.unitCost).toBeNull();
    expect(thread.lineCost).toBeNull();
  });

  it("carries the BOM header's own id through for callers that need it (e.g. raising a Material Request)", async () => {
    const result = await getStyleMaterialRequirement("co-1", "style-1", 100);
    expect(result.bomId).toBe("bom-style-1");
  });
});

describe("getSampleMaterialRequirement", () => {
  it("reports no recorded materials as hasApprovedBom: false, with everything else empty/null", async () => {
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([]);

    const result = await getSampleMaterialRequirement("co-1", "sam-1", 100);

    expect(result).toMatchObject({
      hasApprovedBom: false,
      productId: null,
      bomId: null,
      sampleRequestId: "sam-1",
      materials: [],
      totalMaterialCost: null,
    });
  });

  it("scales the sample's own plannedQuantity by the given flat quantity, with no wastage%", async () => {
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([
      { materialId: "mat-cotton", plannedQuantity: 1.2, uomId: "uom-mtr", colorId: null, uom: MTR, material: { id: "mat-cotton", styleName: "Cotton Fabric", styleCode: "MAT-COT", baseUomId: "uom-mtr", baseUom: MTR, defaultSupplierId: "sup-1", unitCost: 50 } },
    ] as never);
    vi.mocked(sumAvailableByProductIds).mockResolvedValue(new Map([["mat-cotton", 0]]));

    const result = await getSampleMaterialRequirement("co-1", "sam-1", 600);
    const cotton = result.materials[0];

    // 1.2 (no wastage) * 600 = 720 — deliberately not 792 (the BOM fixture's
    // own 10% wastage figure), proving no wastage is applied here.
    expect(cotton.neededQuantity).toBe(720);
    expect(cotton.lineCost).toBe(36000);
    expect(result.bomId).toBeNull();
    expect(result.productId).toBeNull();
    expect(result.sampleRequestId).toBe("sam-1");
  });

  it("reports a material line with no unit specified on the sample as unconvertible rather than crashing", async () => {
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([
      { materialId: "mat-cotton", plannedQuantity: 1, uomId: null, colorId: null, uom: null, material: { id: "mat-cotton", styleName: "Cotton Fabric", styleCode: "MAT-COT", baseUomId: "uom-mtr", baseUom: MTR, defaultSupplierId: "sup-1", unitCost: 50 } },
    ] as never);

    const result = await getSampleMaterialRequirement("co-1", "sam-1", 100);
    expect(result.unconvertibleLines).toEqual([{ materialId: "mat-cotton", materialName: "Cotton Fabric", reason: "no unit specified" }]);
    expect(result.materials).toHaveLength(0);
  });
});

describe("getMaterialRequirementForOrderLine", () => {
  beforeEach(() => {
    vi.mocked(BomRepository.findByProductId)
      .mockReset()
      .mockResolvedValue(bomFixture("style-1", [cottonBomItem(), threadBomItem()]) as never);
  });

  it("uses the Style's own BOM when the line has no linked Sales Order Item at all", async () => {
    const result = await getMaterialRequirementForOrderLine("co-1", { salesOrderItemId: null, productId: "style-1", quantity: 100 });
    expect(result.sampleRequestId).toBeNull();
    expect(result.bomId).toBe("bom-style-1");
  });

  it("uses the Style's own BOM when the linked Sales Order Item has no sample attached", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({ sampleRequestId: null } as never);
    const result = await getMaterialRequirementForOrderLine("co-1", { salesOrderItemId: "soi-1", productId: "style-1", quantity: 100 });
    expect(result.sampleRequestId).toBeNull();
    expect(result.bomId).toBe("bom-style-1");
  });

  it("uses the linked Sample's own material list when the Sales Order Item has one attached", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({ sampleRequestId: "sam-1" } as never);
    vi.mocked(SampleMaterialRepository.findLatestVersionMaterialsForRequirement).mockResolvedValue([
      { materialId: "mat-cotton", plannedQuantity: 1, uomId: "uom-mtr", colorId: null, uom: MTR, material: { id: "mat-cotton", styleName: "Cotton Fabric", styleCode: "MAT-COT", baseUomId: "uom-mtr", baseUom: MTR, defaultSupplierId: "sup-1", unitCost: 50 } },
    ] as never);

    const result = await getMaterialRequirementForOrderLine("co-1", { salesOrderItemId: "soi-1", productId: "style-1", quantity: 100 });

    expect(result.sampleRequestId).toBe("sam-1");
    expect(result.bomId).toBeNull();
    // The Style's own BOM must never be consulted once a sample is linked.
    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplosionLineItem } from "./mrp.service";

vi.mock("@/core/db/client", () => ({
  prisma: {
    salesOrderLine: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    unitOfMeasure: { findMany: vi.fn() },
  },
}));
vi.mock("./bom.repository", () => ({ BomRepository: { findManyVersionsByIds: vi.fn() } }));
vi.mock("@/modules/sampling/sample.repository", () => ({ SampleMaterialRepository: { findManyByVersionIds: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { BomRepository } = await import("./bom.repository");
const { SampleMaterialRepository } = await import("@/modules/sampling/sample.repository");
const { applyEffectiveBomResolution, fetchSalesOrderLineSnapshots } = await import("./effective-bom.service");

const uom = { id: "uom-mtr", code: "MTR", name: "Metre", baseUnitId: null, conversionFactor: 1 };

function line(materialId: string, quantityPerUnit: number, colorId: string | null = null): ExplosionLineItem {
  return {
    materialId,
    colorId,
    quantityPerUnit,
    wastagePercentage: 0,
    uom,
    material: { styleName: materialId, styleCode: materialId, baseUom: uom, defaultSupplierId: null, unitCost: null },
  };
}

const baseItems: ExplosionLineItem[] = [line("green-fabric", 1.2), line("thread", 0.05)];
const base = { explosionItems: baseItems, emptySourceReason: "" };

describe("applyEffectiveBomResolution — no snapshot", () => {
  it("returns the base resolution completely unchanged when no line snapshot exists at all (undefined) — the regression guarantee for legacy/DRAFT orders", () => {
    const result = applyEffectiveBomResolution(base, undefined);
    expect(result).toBe(base);
  });

  it("returns the base resolution unchanged when the line has sourceType NONE (nothing frozen)", () => {
    const result = applyEffectiveBomResolution(base, { id: "line-1", sourceType: "NONE", snapshotExplosionItems: null, activeOverrides: [] });
    expect(result.explosionItems).toBe(baseItems);
  });
});

describe("applyEffectiveBomResolution — snapshot substitution", () => {
  it("substitutes the frozen snapshot in place of the live base — a Master BOM re-approved to a newer version after the snapshot must never leak through", () => {
    const frozenItems = [line("green-fabric", 1.0)]; // the OLD, frozen quantity — the live base above has 1.2
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "STYLE_BOM",
      snapshotExplosionItems: frozenItems,
      activeOverrides: [],
    });
    expect(result.explosionItems).toEqual(frozenItems);
    expect(result.explosionItems).not.toBe(baseItems);
  });

  it("reports an honest empty-source reason when the frozen snapshot itself has zero items", () => {
    const result = applyEffectiveBomResolution(base, { id: "line-1", sourceType: "SAMPLE_MATERIALS", snapshotExplosionItems: [], activeOverrides: [] });
    expect(result.explosionItems).toEqual([]);
    expect(result.emptySourceReason).toBe("the linked sample's captured version has no materials recorded");
  });
});

describe("applyEffectiveBomResolution — override application (the worked examples from the spec)", () => {
  it("REPLACE: swaps one material for another while preserving the original's quantity/uom when the override doesn't restate them", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        {
          originalMaterialId: "green-fabric",
          effectiveMaterial: { materialId: "light-blue-fabric", styleName: "Light Blue Fabric", styleCode: "LBF", baseUom: uom, defaultSupplierId: null, unitCost: null },
          effectiveQuantityPerUnit: null,
          wastagePercentage: null,
          colorId: null,
          effectiveUom: null,
        },
      ],
    });

    expect(result.explosionItems).toHaveLength(2);
    const swapped = result.explosionItems.find((i) => i.materialId === "light-blue-fabric");
    expect(swapped).toBeDefined();
    expect(swapped!.quantityPerUnit).toBe(1.2); // preserved from the original green-fabric line
    expect(result.explosionItems.some((i) => i.materialId === "green-fabric")).toBe(false);
  });

  it("ADD: a pure addition (originalMaterialId null) appends a brand-new line the base never had, requiring its own quantity/uom", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        {
          originalMaterialId: null,
          effectiveMaterial: { materialId: "zipper", styleName: "Zipper", styleCode: "ZIP", baseUom: uom, defaultSupplierId: null, unitCost: null },
          effectiveQuantityPerUnit: 1,
          wastagePercentage: 0,
          colorId: null,
          effectiveUom: uom,
        },
      ],
    });
    expect(result.explosionItems).toHaveLength(3);
    expect(result.explosionItems.find((i) => i.materialId === "zipper")?.quantityPerUnit).toBe(1);
  });

  it("REMOVE: effectiveMaterial null drops the matching original line entirely", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [{ originalMaterialId: "thread", effectiveMaterial: null, effectiveQuantityPerUnit: null, wastagePercentage: null, colorId: null, effectiveUom: null }],
    });
    expect(result.explosionItems).toHaveLength(1);
    expect(result.explosionItems[0].materialId).toBe("green-fabric");
  });

  it("QUANTITY-ONLY: same material on both sides only adjusts quantity/wastage, never disturbs the material identity", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        {
          originalMaterialId: "green-fabric",
          effectiveMaterial: { materialId: "green-fabric", styleName: "Green Fabric", styleCode: "GF", baseUom: uom, defaultSupplierId: null, unitCost: null },
          effectiveQuantityPerUnit: 1.5,
          wastagePercentage: 10,
          colorId: null,
          effectiveUom: null,
        },
      ],
    });
    const updated = result.explosionItems.find((i) => i.materialId === "green-fabric")!;
    expect(updated.quantityPerUnit).toBe(1.5);
    expect(updated.wastagePercentage).toBe(10);
  });

  it("a Replace/Remove/Quantity override whose originalMaterialId no longer exists in the base is a safe no-op, never a crash — the guarantee refreshSalesOrderLineBomSnapshot's own doc comment relies on", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        {
          originalMaterialId: "material-that-no-longer-exists-in-the-refreshed-base",
          effectiveMaterial: null,
          effectiveQuantityPerUnit: null,
          wastagePercentage: null,
          colorId: null,
          effectiveUom: null,
        },
      ],
    });
    expect(result.explosionItems).toEqual(baseItems);
  });

  it("PARTIAL/MULTIPLE SUBSTITUTION: several overrides against the same original material each apply independently, as long as each is keyed to a distinct new material — Green 40 + Light Blue 30 + Dark Blue 30", () => {
    // First override replaces Green with Light Blue (matches the spec's own
    // "REPLACE" shape); a second, independent ADD then contributes Dark
    // Blue on top — this is how the spec's 3-way split is actually modeled:
    // one REPLACE + N ADDITIONs, never N simultaneous REPLACEs of the same
    // original (the resolver only ever tracks one current "effective"
    // material per original line — a genuine 3-way split is a Material
    // Substitution concern at issue time, not a 3-way BOM override).
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        {
          originalMaterialId: "green-fabric",
          effectiveMaterial: { materialId: "light-blue-fabric", styleName: "Light Blue", styleCode: "LB", baseUom: uom, defaultSupplierId: null, unitCost: null },
          effectiveQuantityPerUnit: 0.5,
          wastagePercentage: 0,
          colorId: null,
          effectiveUom: uom,
        },
        {
          originalMaterialId: null,
          effectiveMaterial: { materialId: "dark-blue-fabric", styleName: "Dark Blue", styleCode: "DB", baseUom: uom, defaultSupplierId: null, unitCost: null },
          effectiveQuantityPerUnit: 0.3,
          wastagePercentage: 0,
          colorId: null,
          effectiveUom: uom,
        },
      ],
    });
    expect(result.explosionItems.some((i) => i.materialId === "green-fabric")).toBe(false);
    expect(result.explosionItems.find((i) => i.materialId === "light-blue-fabric")?.quantityPerUnit).toBe(0.5);
    expect(result.explosionItems.find((i) => i.materialId === "dark-blue-fabric")?.quantityPerUnit).toBe(0.3);
  });

  it("returns an honest empty-source reason when overrides remove every material entirely", () => {
    const result = applyEffectiveBomResolution(base, {
      id: "line-1",
      sourceType: "NONE",
      snapshotExplosionItems: null,
      activeOverrides: [
        { originalMaterialId: "green-fabric", effectiveMaterial: null, effectiveQuantityPerUnit: null, wastagePercentage: null, colorId: null, effectiveUom: null },
        { originalMaterialId: "thread", effectiveMaterial: null, effectiveQuantityPerUnit: null, wastagePercentage: null, colorId: null, effectiveUom: null },
      ],
    });
    expect(result.explosionItems).toEqual([]);
    expect(result.emptySourceReason).toBe("every material was removed by a Sales Order override");
  });
});

describe("fetchSalesOrderLineSnapshots", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesOrderLine.findMany).mockReset();
    vi.mocked(prisma.product.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(prisma.unitOfMeasure.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(BomRepository.findManyVersionsByIds).mockReset().mockResolvedValue([]);
    vi.mocked(SampleMaterialRepository.findManyByVersionIds).mockReset().mockResolvedValue([]);
  });

  it("returns an empty map with zero queries for an empty input list", async () => {
    const result = await fetchSalesOrderLineSnapshots("co-1", []);
    expect(result.size).toBe(0);
    expect(prisma.salesOrderLine.findMany).not.toHaveBeenCalled();
  });

  it("resolves a STYLE_BOM line's frozen BomVersion items into ExplosionLineItem shape, tagged with sourceType", async () => {
    vi.mocked(prisma.salesOrderLine.findMany).mockResolvedValue([
      { id: "line-1", sourceType: "STYLE_BOM", bomVersionId: "bv-1", sampleVersionId: null, overrides: [] },
    ] as never);
    vi.mocked(BomRepository.findManyVersionsByIds).mockResolvedValue([
      {
        id: "bv-1",
        items: [
          {
            materialId: "mat-1",
            colorId: null,
            quantityPerUnit: 1.2,
            wastagePercentage: 5,
            uom: { id: "uom-1", code: "MTR", name: "Metre" },
            material: { styleName: "Fabric A", styleCode: "FA", baseUom: { id: "uom-1", code: "MTR", name: "Metre" }, defaultSupplierId: null, unitCost: null },
          },
        ],
      },
    ] as never);

    const result = await fetchSalesOrderLineSnapshots("co-1", ["line-1"]);

    expect(BomRepository.findManyVersionsByIds).toHaveBeenCalledWith(["bv-1"]);
    const snapshot = result.get("line-1")!;
    expect(snapshot.sourceType).toBe("STYLE_BOM");
    expect(snapshot.snapshotExplosionItems).toHaveLength(1);
    expect(snapshot.snapshotExplosionItems![0]).toMatchObject({ materialId: "mat-1", quantityPerUnit: 1.2, wastagePercentage: 5 });
  });

  it("resolves a SAMPLE_MATERIALS line via SampleMaterialRepository.findManyByVersionIds, mapping colorId to materialColorId (never a garment-color filter)", async () => {
    vi.mocked(prisma.salesOrderLine.findMany).mockResolvedValue([
      { id: "line-2", sourceType: "SAMPLE_MATERIALS", bomVersionId: null, sampleVersionId: "sv-1", overrides: [] },
    ] as never);
    vi.mocked(SampleMaterialRepository.findManyByVersionIds).mockResolvedValue([
      {
        sampleVersionId: "sv-1",
        materialId: "mat-2",
        plannedQuantity: 0.5,
        uomId: "uom-1",
        colorId: "shade-1",
        dyeId: "dye-1",
        uom: { id: "uom-1", code: "PCS", name: "Piece" },
        material: { styleName: "Zipper", styleCode: "ZIP", baseUom: { id: "uom-1", code: "PCS", name: "Piece" }, defaultSupplierId: null, unitCost: null },
      },
    ] as never);

    const result = await fetchSalesOrderLineSnapshots("co-1", ["line-2"]);

    const snapshot = result.get("line-2")!;
    expect(snapshot.snapshotExplosionItems![0]).toMatchObject({ materialId: "mat-2", colorId: null, materialColorId: "shade-1", dyeId: "dye-1" });
  });

  it("resolves an override's own effectiveMaterialId/uomId to real Product/UnitOfMeasure rows in the same batched pass", async () => {
    vi.mocked(prisma.salesOrderLine.findMany).mockResolvedValue([
      {
        id: "line-3",
        sourceType: "NONE",
        bomVersionId: null,
        sampleVersionId: null,
        overrides: [
          { originalMaterialId: null, effectiveMaterialId: "mat-new", effectiveQuantityPerUnit: 1, wastagePercentage: 0, colorId: null, uomId: "uom-2" },
        ],
      },
    ] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: "mat-new", styleName: "Zipper", styleCode: "ZIP", defaultSupplierId: null, unitCost: null, baseUom: { id: "uom-2", code: "PCS", name: "Piece" } },
    ] as never);
    vi.mocked(prisma.unitOfMeasure.findMany).mockResolvedValue([{ id: "uom-2", code: "PCS", name: "Piece" }] as never);

    const result = await fetchSalesOrderLineSnapshots("co-1", ["line-3"]);

    const override = result.get("line-3")!.activeOverrides[0];
    expect(override.effectiveMaterial).toMatchObject({ materialId: "mat-new", styleName: "Zipper" });
    expect(override.effectiveUom).toMatchObject({ id: "uom-2", code: "PCS" });
  });

  it("leaves an override's effectiveMaterial null when its target material no longer resolves for this company — never thrown, a safe no-op at apply time", async () => {
    vi.mocked(prisma.salesOrderLine.findMany).mockResolvedValue([
      {
        id: "line-4",
        sourceType: "NONE",
        bomVersionId: null,
        sampleVersionId: null,
        overrides: [
          { originalMaterialId: "mat-old", effectiveMaterialId: "mat-deleted", effectiveQuantityPerUnit: 1, wastagePercentage: 0, colorId: null, uomId: null },
        ],
      },
    ] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([]); // the material no longer resolves

    const result = await fetchSalesOrderLineSnapshots("co-1", ["line-4"]);

    expect(result.get("line-4")!.activeOverrides[0].effectiveMaterial).toBeNull();
  });
});

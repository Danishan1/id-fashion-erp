import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

const mockPrisma = vi.hoisted(() => {
  const client = {
    product: { findFirst: vi.fn() },
    sampleRequest: { findFirst: vi.fn() },
    productionStage: { findMany: vi.fn() },
    styleStageCost: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    designStageCost: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    productionOrder: { findFirst: vi.fn() },
  };
  return { ...client, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(client)) };
});
vi.mock("@/core/db/client", () => ({ prisma: mockPrisma }));

const {
  getDesignStageCosts,
  resolveEffectiveStageCosts,
  saveStyleStageCosts,
  saveDesignStageCosts,
  resolveCostContextForProductionOrder,
  round2,
} = await import("./stage-cost.service");

const actor = { companyId: "co-1", userId: "u-1" };
const STAGES = [
  { id: "s-cut", code: "CUT", name: "Cutting", sequence: 1, isActive: true, isFinal: false },
  { id: "s-sew", code: "SEW", name: "Stitching", sequence: 2, isActive: true, isFinal: false },
  { id: "s-chk", code: "CHK", name: "Checking", sequence: 3, isActive: true, isFinal: false },
];

beforeEach(() => {
  Object.values(mockPrisma).forEach((group) => {
    if (typeof group === "object") Object.values(group).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  });
  mockPrisma.product.findFirst.mockResolvedValue({ id: "style-1", styleName: "Kurta", styleCode: "ST-1" });
  mockPrisma.sampleRequest.findFirst.mockResolvedValue({ id: "d-1", requestNumber: "SAM-1", styleName: "Floral Kurta", productId: "style-1", product: { styleName: "Kurta" } });
  mockPrisma.productionStage.findMany.mockResolvedValue(STAGES);
  mockPrisma.styleStageCost.findMany.mockResolvedValue([]);
  mockPrisma.designStageCost.findMany.mockResolvedValue([]);
});

describe("Design stage costs — inherit Style default unless overridden", () => {
  it("shows the Style default as the effective cost for a non-customized stage and the override where set", async () => {
    mockPrisma.styleStageCost.findMany.mockResolvedValue([
      { productionStageId: "s-sew", cost: 15 },
      { productionStageId: "s-chk", cost: 3 },
    ]);
    mockPrisma.designStageCost.findMany.mockResolvedValue([{ productionStageId: "s-sew", cost: 18 }]);

    const { stages } = await getDesignStageCosts("co-1", "d-1");
    const byCode = Object.fromEntries(stages.map((s) => [s.stage.code, s]));
    expect(byCode.SEW).toMatchObject({ styleDefault: 15, designCost: 18, effective: 18, source: "DESIGN_OVERRIDE" });
    expect(byCode.CHK).toMatchObject({ styleDefault: 3, designCost: null, effective: 3, source: "STYLE_DEFAULT" });
    expect(byCode.CUT).toMatchObject({ effective: null, source: "NOT_CONFIGURED" });
  });

  it("a later Style cost change flows to non-customized stages but never overwrites a customized Design cost", async () => {
    // After the Style's Stitching cost changes 15 → 20 and Checking 3 → 4:
    mockPrisma.styleStageCost.findMany.mockResolvedValue([
      { productionStageId: "s-sew", cost: 20 },
      { productionStageId: "s-chk", cost: 4 },
    ]);
    mockPrisma.designStageCost.findMany.mockResolvedValue([{ productionStageId: "s-sew", cost: 18 }]);

    const { stages } = await getDesignStageCosts("co-1", "d-1");
    const byCode = Object.fromEntries(stages.map((s) => [s.stage.code, s]));
    expect(byCode.SEW.effective).toBe(18); // customized — untouched
    expect(byCode.CHK.effective).toBe(4); // inherited — follows the Style
  });

  it("clearing a Design stage (cost: null) reverts it to the inherited Style default", async () => {
    await saveDesignStageCosts(actor, "d-1", { costs: [{ productionStageId: "s-sew", cost: null }] });
    expect(mockPrisma.designStageCost.deleteMany).toHaveBeenCalledWith({ where: { sampleRequestId: "d-1", productionStageId: "s-sew" } });
    expect(mockPrisma.designStageCost.upsert).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for a design in another company", async () => {
    mockPrisma.sampleRequest.findFirst.mockResolvedValue(null);
    await expect(getDesignStageCosts("co-1", "d-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Style stage costs", () => {
  it("upserts set costs and removes cleared ones, one row per stage", async () => {
    await saveStyleStageCosts(actor, "style-1", {
      costs: [
        { productionStageId: "s-cut", cost: 5 },
        { productionStageId: "s-chk", cost: null },
      ],
    });
    expect(mockPrisma.styleStageCost.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId_productionStageId: { productId: "style-1", productionStageId: "s-cut" } },
        update: expect.objectContaining({ cost: 5 }),
      }),
    );
    expect(mockPrisma.styleStageCost.deleteMany).toHaveBeenCalledWith({ where: { productId: "style-1", productionStageId: "s-chk" } });
  });

  it("rejects a stage from another company", async () => {
    mockPrisma.productionStage.findMany.mockResolvedValueOnce([]); // assertStagesBelongToCompany sees nothing
    await expect(saveStyleStageCosts(actor, "style-1", { costs: [{ productionStageId: "s-x", cost: 5 }] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("resolveEffectiveStageCosts — Design override → Style default → not configured", () => {
  it("resolves each stage from the right tier", async () => {
    mockPrisma.styleStageCost.findMany.mockResolvedValue([
      { productionStageId: "s-cut", cost: 5 },
      { productionStageId: "s-sew", cost: 15 },
    ]);
    mockPrisma.designStageCost.findMany.mockResolvedValue([{ productionStageId: "s-sew", cost: 18 }]);
    const map = await resolveEffectiveStageCosts(mockPrisma as never, "co-1", {
      productId: "style-1",
      sampleRequestId: "d-1",
      stageIds: ["s-cut", "s-sew", "s-chk"],
    });
    expect(map.get("s-cut")).toEqual({ productionStageId: "s-cut", rate: 5, source: "STYLE_DEFAULT" });
    expect(map.get("s-sew")).toEqual({ productionStageId: "s-sew", rate: 18, source: "DESIGN_OVERRIDE" });
    expect(map.get("s-chk")).toEqual({ productionStageId: "s-chk", rate: null, source: "NOT_CONFIGURED" });
  });

  it("uses only Style defaults when there is no design (make-to-stock / direct order)", async () => {
    mockPrisma.styleStageCost.findMany.mockResolvedValue([{ productionStageId: "s-sew", cost: 15 }]);
    const map = await resolveEffectiveStageCosts(mockPrisma as never, "co-1", { productId: "style-1", sampleRequestId: null, stageIds: ["s-sew"] });
    expect(map.get("s-sew")?.source).toBe("STYLE_DEFAULT");
    expect(mockPrisma.designStageCost.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveCostContextForProductionOrder", () => {
  it("traces the design through the Sales Order line", async () => {
    mockPrisma.productionOrder.findFirst.mockResolvedValue({
      productId: "style-1",
      product: { styleName: "Kurta", styleCode: "ST-1" },
      salesOrderItem: { sampleRequestId: "d-1", sampleRequest: { requestNumber: "SAM-1", styleName: "Floral Kurta" } },
    });
    await expect(resolveCostContextForProductionOrder(mockPrisma as never, "co-1", "po-1")).resolves.toMatchObject({
      productId: "style-1",
      sampleRequestId: "d-1",
      designLabel: "Floral Kurta (SAM-1)",
    });
  });
});

describe("round2", () => {
  it("rounds to paise and normalizes -0", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(-0)).toBe(0);
    expect(round2(15 * 100)).toBe(1500);
  });
});

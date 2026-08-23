import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: {} }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateDocumentNumber: vi.fn(),
  advanceMasterCodeSequence: vi.fn(),
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findByStyleCode: vi.fn(), create: vi.fn() },
}));
vi.mock("./sample.repository", () => ({
  SampleRequestRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  SampleVersionRepository: {
    findLatest: vi.fn(),
    findById: vi.fn(),
    findWithRequestOwner: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findByIdTx: vi.fn(),
    updateCostingIfUnlocked: vi.fn(),
    updateCostingIfLocked: vi.fn(),
  },
  SampleMaterialRepository: {
    createMany: vi.fn(),
    findByVersionId: vi.fn(),
    findByVersionAndMergeKey: vi.fn(),
    findWithRequestOwner: vi.fn(),
    update: vi.fn(),
    updateCosting: vi.fn(),
    findByVersionIdTx: vi.fn(),
  },
  SampleOtherChargeRepository: {
    findByVersionId: vi.fn(),
    findByVersionIdTx: vi.fn(),
    findWithVersionOwner: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  SampleApprovalRepository: { create: vi.fn() },
  SampleCommentRepository: { create: vi.fn() },
}));

const { SampleVersionRepository, SampleMaterialRepository, SampleOtherChargeRepository } = await import(
  "./sample.repository"
);
const { recalculateSampleVersionCosting, addSampleMaterial } = await import("./sample.service");

const actor = { companyId: "co-1", userId: "user-1" };
const fakeTx = {} as never;

beforeEach(() => {
  vi.mocked(SampleVersionRepository.findByIdTx).mockReset();
  vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockReset();
  vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockReset();
  vi.mocked(SampleVersionRepository.findWithRequestOwner).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionAndMergeKey).mockReset();
  vi.mocked(SampleMaterialRepository.update).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionId).mockReset();
});

describe("recalculateSampleVersionCosting", () => {
  it("computes finalTotal from materials + other charges through the full margin/commission/freight formula", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([
      { plannedQuantity: "10", rate: "5", gstPercentage: "10" },
      { plannedQuantity: "2", rate: "100", gstPercentage: null },
    ] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([{ amount: "45" }] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);

    // materialCost = 10*5*1.10 + 2*100*1 = 55 + 200 = 255
    // costSubtotal = 255 + 45 = 300
    // grossTotal = 300 * 1.10 = 330
    // finalTotal = 330 * 1.05 + 20 = 346.5 + 20 = 366.5
    const result = await recalculateSampleVersionCosting(fakeTx, "v-1", {
      marginPercent: 10,
      commissionPercent: 5,
      freightAmount: 20,
    });

    expect(result).toEqual({ applied: true, finalTotal: 366.5 });
    expect(SampleVersionRepository.updateCostingIfUnlocked).toHaveBeenCalledWith(
      fakeTx,
      "v-1",
      expect.objectContaining({
        costSubtotal: 300,
        finalTotal: 366.5,
        marginPercent: 10,
        commissionPercent: 5,
        freightAmount: 20,
        // hasPricedData is true (materials have a rate) — computed mode.
        estimatedCostPerUnit: 366.5,
      })
    );
  });

  it("treats a material with rate = null as contributing 0, never as priced-at-zero", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([
      { plannedQuantity: "10", rate: null, gstPercentage: null },
    ] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);

    const result = await recalculateSampleVersionCosting(fakeTx, "v-1");

    expect(result.finalTotal).toBe(0);
    const [, , data] = vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mock.calls[0];
    // hasPricedData is false (no rate, no charges) — manual mode, so
    // estimatedCostPerUnit must not be touched at all.
    expect(data).not.toHaveProperty("estimatedCostPerUnit");
  });

  it("throws INVALID_STATE_TRANSITION when the guarded write reports the version is locked or superseded", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 0 } as never);

    await expect(recalculateSampleVersionCosting(fakeTx, "v-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("tolerates a blocked guard silently when throwIfBlocked is false (addSampleMaterial's own call)", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 0 } as never);

    const result = await recalculateSampleVersionCosting(fakeTx, "v-1", { throwIfBlocked: false });
    expect(result.applied).toBe(false);
  });
});

describe("estimatedCostPerUnit manual/computed mode switch", () => {
  const noPricedRow = { id: "v-1", marginPercent: null, commissionPercent: null, freightAmount: null, estimatedCostPerUnit: "12" };

  beforeEach(() => {
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
  });

  it("leaves estimatedCostPerUnit untouched when no priced data exists and no manual value is given", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue(noPricedRow as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([{ plannedQuantity: "5", rate: null, gstPercentage: null }] as never);

    await recalculateSampleVersionCosting(fakeTx, "v-1");

    const [, , data] = vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mock.calls[0];
    expect(data).not.toHaveProperty("estimatedCostPerUnit");
  });

  it("writes the manual value when no priced data exists but one is explicitly given", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue(noPricedRow as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([{ plannedQuantity: "5", rate: null, gstPercentage: null }] as never);

    await recalculateSampleVersionCosting(fakeTx, "v-1", { manualEstimatedCostPerUnit: 42 });

    const [, , data] = vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mock.calls[0];
    expect(data).toMatchObject({ estimatedCostPerUnit: 42 });
  });

  it("ignores a manual value and computes from finalTotal once real priced data exists", async () => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue(noPricedRow as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([{ plannedQuantity: "5", rate: "10", gstPercentage: null }] as never);

    await recalculateSampleVersionCosting(fakeTx, "v-1", { manualEstimatedCostPerUnit: 42 });

    const [, , data] = vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mock.calls[0];
    // materialCost = 5*10 = 50, no margin/commission/freight -> finalTotal = 50
    expect(data).toMatchObject({ estimatedCostPerUnit: 50, finalTotal: 50 });
  });
});

describe("addSampleMaterial merge branch", () => {
  it("triggers a costing recompute on merge, not just on create (regression for the missed-trigger fix)", async () => {
    vi.mocked(SampleVersionRepository.findWithRequestOwner).mockResolvedValue({
      id: "v-1",
      sampleRequest: { companyId: "co-1", requestedByUserId: "user-1" },
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionAndMergeKey).mockResolvedValue({
      id: "m-1",
      plannedQuantity: "5",
      notes: null,
    } as never);
    vi.mocked(SampleMaterialRepository.update).mockResolvedValue({} as never);
    vi.mocked(SampleMaterialRepository.findByVersionId).mockResolvedValue([] as never);

    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);

    await addSampleMaterial(actor, "v-1", { materialId: "mat-1", plannedQuantity: 3, uomId: "", colorId: "", dyeId: "", notes: "" });

    expect(SampleMaterialRepository.update).toHaveBeenCalledWith("m-1", expect.objectContaining({ plannedQuantity: 8 }));
    expect(SampleVersionRepository.updateCostingIfUnlocked).toHaveBeenCalled();
  });
});

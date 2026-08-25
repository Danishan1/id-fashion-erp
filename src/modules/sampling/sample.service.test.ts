import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: { crmFollowup: { create: vi.fn() } } }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateDocumentNumber: vi.fn(),
  advanceMasterCodeSequence: vi.fn(),
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findByStyleCode: vi.fn(), create: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
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

const { prisma } = await import("@/core/db/client");
const { SampleRequestRepository, SampleVersionRepository, SampleMaterialRepository, SampleOtherChargeRepository } = await import(
  "./sample.repository"
);
const { ProductRepository } = await import("@/modules/products/product.repository");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { recalculateSampleVersionCosting, addSampleMaterial, transitionSampleStatus, createSampleRequest } = await import("./sample.service");

const actor = { companyId: "co-1", userId: "user-1" };
const fakeTx = {} as never;

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("SAM-2026-00001");
  vi.mocked(ProductRepository.findAnyById).mockReset().mockResolvedValue({ id: "prod-1" } as never);
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset().mockResolvedValue({ id: "cust-1", buyers: [{ id: "buyer-1" }] } as never);
  vi.mocked(SampleRequestRepository.create).mockReset();
  vi.mocked(SampleVersionRepository.findByIdTx).mockReset();
  vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockReset();
  vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockReset();
  vi.mocked(SampleVersionRepository.findWithRequestOwner).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionAndMergeKey).mockReset();
  vi.mocked(SampleMaterialRepository.update).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionId).mockReset();
  vi.mocked(SampleRequestRepository.findAnyById).mockReset();
  vi.mocked(SampleRequestRepository.update).mockReset();
  vi.mocked(prisma.crmFollowup.create).mockReset().mockResolvedValue({} as never);
  vi.mocked(SampleVersionRepository.findLatest).mockReset();
  vi.mocked(SampleVersionRepository.update).mockReset();
});

describe("createSampleRequest", () => {
  const input = { customerId: "cust-1", buyerId: "buyer-1", productId: "prod-1", styleName: "Test", sampleType: "PROTO", requestDate: "2026-08-25" };

  // customerId/buyerId/productId were previously written straight from
  // client input with zero ownership check — a direct API call with
  // another tenant's id would succeed, and findByIdWithDetails's
  // unrestricted `include` would then return that tenant's full
  // Customer/Buyer/Product record on every subsequent read (confirmed
  // cross-tenant disclosure, fixed). These reproduce that exact bug class.
  it("rejects a customerId belonging to another company", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);
    await expect(createSampleRequest(actor, input as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a buyerId that doesn't belong to the given customer", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue({ id: "cust-1", buyers: [{ id: "buyer-other" }] } as never);
    await expect(createSampleRequest(actor, input as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a productId belonging to another company", async () => {
    vi.mocked(ProductRepository.findAnyById).mockResolvedValue(null);
    await expect(createSampleRequest(actor, input as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.create).not.toHaveBeenCalled();
  });

  it("succeeds when the customer, buyer, and product all belong to this company", async () => {
    vi.mocked(SampleRequestRepository.create).mockResolvedValue({ id: "sam-1" } as never);
    await createSampleRequest(actor, input as never);
    expect(SampleRequestRepository.create).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cust-1", buyerId: "buyer-1", productId: "prod-1" }));
  });
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

describe("transitionSampleStatus", () => {
  it("auto-creates a 3-day follow-up against the customer when a sample moves to SUBMITTED_TO_CUSTOMER", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({
      id: "sam-1",
      status: "INTERNAL_QC",
      requestNumber: "SAM-2026-00001",
      styleName: "V-Neck T-Shirt",
      customerId: "cust-1",
    } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "SUBMITTED_TO_CUSTOMER" } as never);

    await transitionSampleStatus(actor, "sam-1", "SUBMITTED_TO_CUSTOMER" as never);

    expect(prisma.crmFollowup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relatedModule: "CUSTOMER", relatedRecordId: "cust-1", type: "EMAIL" }),
      })
    );
  });

  it("does not create a follow-up for a transition that isn't SUBMITTED_TO_CUSTOMER", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "REQUESTED", customerId: "cust-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "ON_HOLD" } as never);

    await transitionSampleStatus(actor, "sam-1", "ON_HOLD" as never);

    expect(prisma.crmFollowup.create).not.toHaveBeenCalled();
  });

  // Regression tests for the P3 fix: SampleVersion.status previously stayed
  // frozen at "IN_DEVELOPMENT" from creation through Internal QC and
  // Submitted-to-Customer — the header's own status is now mirrored onto the
  // current, still-live version for these three in-flight stages.
  it("mirrors the header's new status onto the current version for INTERNAL_QC/SUBMITTED_TO_CUSTOMER", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT", customerId: "cust-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "INTERNAL_QC" } as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", status: "IN_DEVELOPMENT" } as never);

    await transitionSampleStatus(actor, "sam-1", "INTERNAL_QC" as never);

    expect(SampleVersionRepository.update).toHaveBeenCalledWith("ver-1", { status: "INTERNAL_QC" });
  });

  it("maps SUBMITTED_TO_CUSTOMER to the version's own SUBMITTED value, not the header's literal name", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "INTERNAL_QC", customerId: "cust-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "SUBMITTED_TO_CUSTOMER" } as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", status: "INTERNAL_QC" } as never);

    await transitionSampleStatus(actor, "sam-1", "SUBMITTED_TO_CUSTOMER" as never);

    expect(SampleVersionRepository.update).toHaveBeenCalledWith("ver-1", { status: "SUBMITTED" });
  });

  it("never overwrites a terminal version status (APPROVED/REJECTED/SUPERSEDED)", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "TECH_PACK_READY", customerId: "cust-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT" } as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-old", status: "SUPERSEDED" } as never);

    await transitionSampleStatus(actor, "sam-1", "IN_DEVELOPMENT" as never);

    expect(SampleVersionRepository.update).not.toHaveBeenCalled();
  });

  it("does not touch version status for a transition with no version-status counterpart (e.g. ON_HOLD)", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT", customerId: "cust-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "ON_HOLD" } as never);

    await transitionSampleStatus(actor, "sam-1", "ON_HOLD" as never);

    expect(SampleVersionRepository.findLatest).not.toHaveBeenCalled();
    expect(SampleVersionRepository.update).not.toHaveBeenCalled();
  });
});

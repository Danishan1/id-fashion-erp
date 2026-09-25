import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/db/client", () => ({
  prisma: { crmFollowup: { create: vi.fn() }, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) },
}));
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
vi.mock("@/modules/bom-mrp/bom.repository", () => ({
  BomRepository: { findByProductId: vi.fn() },
}));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { assert: vi.fn() },
}));
vi.mock("@/core/attachments/AttachmentService", () => ({
  getAttachmentMetadata: vi.fn(),
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
    delete: vi.fn(),
    updateCosting: vi.fn(),
    findByVersionIdTx: vi.fn(),
    updatePlannedQuantityInTx: vi.fn(),
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
const { SampleRequestRepository, SampleVersionRepository, SampleMaterialRepository, SampleOtherChargeRepository, SampleApprovalRepository } =
  await import("./sample.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { BomRepository } = await import("@/modules/bom-mrp/bom.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { getAttachmentMetadata } = await import("@/core/attachments/AttachmentService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const {
  recalculateSampleVersionCosting,
  addSampleMaterial,
  transitionSampleStatus,
  createSampleRequest,
  recordSampleApproval,
  addSampleVersion,
  updateSampleBomMaterials,
  removeSampleMaterial,
  setSampleRequestMainImage,
  duplicateSampleRequest,
} = await import("./sample.service");

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
  vi.mocked(SampleVersionRepository.findById).mockReset();
  vi.mocked(SampleApprovalRepository.create).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAttachmentMetadata).mockReset();
  vi.mocked(SampleVersionRepository.create).mockReset();
  vi.mocked(SampleMaterialRepository.createMany).mockReset();
  vi.mocked(SampleMaterialRepository.updatePlannedQuantityInTx).mockReset();
  vi.mocked(SampleMaterialRepository.delete).mockReset();
  vi.mocked(BomRepository.findByProductId).mockReset();
});

describe("recordSampleApproval — self-approval guard now lives in the service, not just the route", () => {
  const version = { id: "v-1", sampleRequestId: "sam-1", status: "SUBMITTED" };
  const request = { id: "sam-1", status: "SUBMITTED_TO_CUSTOMER", requestedByUserId: "user-1" };

  it("asserts the self-approval-guarded 'approve' action using the request's own requestedByUserId, with no route involved", async () => {
    vi.mocked(SampleVersionRepository.findById).mockResolvedValue(version as never);
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(request as never);
    vi.mocked(SampleApprovalRepository.create).mockResolvedValue({ id: "appr-1" } as never);
    vi.mocked(SampleVersionRepository.update).mockResolvedValue({} as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "APPROVED" } as never);

    await recordSampleApproval(actor, "v-1", { decision: "APPROVED" } as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "sampling", "approve", { createdBy: "user-1" });
  });

  it("regression: a direct call to the service (simulating a future second caller with no route-level check) still denies self-approval", async () => {
    vi.mocked(SampleVersionRepository.findById).mockResolvedValue(version as never);
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(request as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(
      Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" })
    );

    await expect(recordSampleApproval(actor, "v-1", { decision: "APPROVED" } as never)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(SampleApprovalRepository.create).not.toHaveBeenCalled();
  });

  it("asserts 'reject' (not self-approval-guarded) for a REJECTED decision", async () => {
    vi.mocked(SampleVersionRepository.findById).mockResolvedValue(version as never);
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(request as never);
    vi.mocked(SampleApprovalRepository.create).mockResolvedValue({ id: "appr-1" } as never);
    vi.mocked(SampleVersionRepository.update).mockResolvedValue({} as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "REJECTED" } as never);

    await recordSampleApproval(actor, "v-1", { decision: "REJECTED" } as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "sampling", "reject", { createdBy: "user-1" });
  });
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

describe("duplicateSampleRequest — 'Copy Design'", () => {
  const source = {
    id: "sam-src",
    companyId: "co-1",
    productId: "prod-1",
    sampleType: "PROTO",
    colorId: null,
    sizeId: null,
    currentVersionNumber: 1,
  };
  const newRequest = { id: "sam-new", status: "REQUESTED", currentVersionNumber: 0, productId: "prod-1" };
  const copyInput = { styleName: "Copy of Test", customerId: "cust-1", buyerId: "buyer-1" };

  beforeEach(() => {
    vi.mocked(SampleRequestRepository.findAnyById).mockImplementation((async (_companyId: string, id: string) => {
      if (id === "sam-src") return source;
      if (id === "sam-new") return newRequest;
      return null;
    }) as never);
    vi.mocked(SampleRequestRepository.create).mockResolvedValue(newRequest as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue(newRequest as never);
    vi.mocked(SampleVersionRepository.create).mockResolvedValue({ id: "v-new-1" } as never);
    vi.mocked(SampleVersionRepository.update).mockResolvedValue({} as never);
    vi.mocked(SampleVersionRepository.findWithRequestOwner).mockResolvedValue({
      id: "v-new-1",
      sampleRequest: { companyId: "co-1" },
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionAndMergeKey).mockResolvedValue(null);
    // addSampleMaterial's own trailing costing recompute (recalculateSampleVersionCosting) —
    // a harmless no-op here since the freshly-copied line has no rate yet.
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "v-new-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
      estimatedCostPerUnit: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);
    vi.mocked(SampleMaterialRepository.findByVersionId).mockResolvedValue([] as never);
  });

  it("rejects a source request belonging to another company", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(null);
    await expect(duplicateSampleRequest(actor, "sam-src", copyInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.create).not.toHaveBeenCalled();
  });

  it("copies Style/Sample Type from the source but sets copiedFromRequestId, and never seeds materials from the Style's own BOM", async () => {
    vi.mocked(SampleVersionRepository.findLatest).mockImplementation((async (id: string) => {
      if (id === "sam-src") return { id: "v-src-1", versionNumber: 1, techPackNotes: "Handle with care" };
      return null;
    }) as never);
    vi.mocked(SampleMaterialRepository.findByVersionId).mockResolvedValue([
      { materialId: "mat-1", plannedQuantity: "5.0000", uomId: "uom-1", colorId: "color-1", dyeId: null, notes: "From the source" },
    ] as never);

    await duplicateSampleRequest(actor, "sam-src", copyInput);

    expect(SampleRequestRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "prod-1", sampleType: "PROTO", styleName: "Copy of Test", copiedFromRequestId: "sam-src" })
    );
    // seedFromStyleBom: false — copyStyleBomIntoSampleVersion (gated on this
    // exact call) must never run, or the source's own copied materials
    // would end up merged with stray "Copied from Style BOM" lines.
    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
    expect(SampleVersionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRequestId: "sam-new", techPackNotes: "Handle with care" })
    );
    expect(SampleMaterialRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        sampleVersionId: "v-new-1",
        materialId: "mat-1",
        plannedQuantity: 5,
        uomId: "uom-1",
        colorId: "color-1",
        dyeId: null,
        notes: "From the source",
      }),
    ]);
  });

  it("falls back sampleType to OTHER for a legacy source request with no sampleType set", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockImplementation((async (_companyId: string, id: string) => {
      if (id === "sam-src") return { ...source, sampleType: null };
      if (id === "sam-new") return newRequest;
      return null;
    }) as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue(null);

    await duplicateSampleRequest(actor, "sam-src", copyInput);

    expect(SampleRequestRepository.create).toHaveBeenCalledWith(expect.objectContaining({ sampleType: "OTHER" }));
  });

  it("creates no version/materials when the source has never had a version", async () => {
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue(null);

    await duplicateSampleRequest(actor, "sam-src", copyInput);

    expect(SampleVersionRepository.create).not.toHaveBeenCalled();
    expect(SampleMaterialRepository.createMany).not.toHaveBeenCalled();
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

  // Internal QC gate (RBAC audit, 2026-09-24): a Merchandiser (sampling.edit
  // only, no qc.edit) could previously walk a sample into and out of
  // INTERNAL_QC single-handedly, since every non-terminal transition shared
  // one generic sampling.edit check. These three transitions now require
  // qc.edit specifically; every other transition stays on sampling.edit.
  describe("Internal QC gate", () => {
    it.each([
      ["IN_DEVELOPMENT", "INTERNAL_QC"],
      ["INTERNAL_QC", "SUBMITTED_TO_CUSTOMER"],
      ["INTERNAL_QC", "IN_DEVELOPMENT"],
    ])("asserts qc.edit, not sampling.edit, for %s -> %s", async (from, to) => {
      vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: from, customerId: "cust-1" } as never);
      vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: to } as never);

      await transitionSampleStatus(actor, "sam-1", to as never);

      expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "qc", "edit");
      expect(PermissionService.assert).not.toHaveBeenCalledWith(actor.userId, "sampling", "edit");
    });

    it.each([
      ["TECH_PACK_READY", "IN_DEVELOPMENT"],
      ["INTERNAL_QC", "ON_HOLD"],
      ["INTERNAL_QC", "CANCELLED"],
    ])("keeps asserting sampling.edit, not qc.edit, for %s -> %s", async (from, to) => {
      vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: from, customerId: "cust-1" } as never);
      vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: to } as never);

      await transitionSampleStatus(actor, "sam-1", to as never);

      expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "sampling", "edit");
      expect(PermissionService.assert).not.toHaveBeenCalledWith(actor.userId, "qc", "edit");
    });

    it("rejects the transition outright when the actor lacks qc.edit, even though sampling.edit would have passed", async () => {
      vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT", customerId: "cust-1" } as never);
      vi.mocked(PermissionService.assert).mockImplementation(async (_userId, module) => {
        if (module === "qc") throw new BusinessRuleError("PERMISSION_DENIED", "You do not have permission to edit in qc.");
      });

      await expect(transitionSampleStatus(actor, "sam-1", "INTERNAL_QC" as never)).rejects.toThrow(BusinessRuleError);
      expect(SampleRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  // "Send Back to Development" from Submitted to Customer (2026-09-24) — a
  // direct retraction for a sample submitted by mistake, before any real
  // customer feedback exists. Deliberately NOT internal-QC-gated (it has
  // nothing to do with QC sign-off) and deliberately does NOT go through
  // recordSampleApproval()/create a new version — same current version,
  // just its own display status mirrored back to IN_DEVELOPMENT.
  describe("Send Back to Development from Submitted to Customer", () => {
    it("allows SUBMITTED_TO_CUSTOMER -> IN_DEVELOPMENT and asserts plain sampling.edit, not qc.edit", async () => {
      vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "SUBMITTED_TO_CUSTOMER", customerId: "cust-1" } as never);
      vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT" } as never);
      vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", status: "SUBMITTED" } as never);

      await transitionSampleStatus(actor, "sam-1", "IN_DEVELOPMENT" as never);

      expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "sampling", "edit");
      expect(PermissionService.assert).not.toHaveBeenCalledWith(actor.userId, "qc", "edit");
      expect(SampleRequestRepository.update).toHaveBeenCalledWith("sam-1", expect.objectContaining({ status: "IN_DEVELOPMENT" }));
    });

    it("mirrors the current version's own status back to IN_DEVELOPMENT, without creating a new version", async () => {
      vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "SUBMITTED_TO_CUSTOMER", customerId: "cust-1" } as never);
      vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT" } as never);
      vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", status: "SUBMITTED" } as never);

      await transitionSampleStatus(actor, "sam-1", "IN_DEVELOPMENT" as never);

      expect(SampleVersionRepository.update).toHaveBeenCalledWith("ver-1", { status: "IN_DEVELOPMENT" });
      expect(SampleVersionRepository.create).not.toHaveBeenCalled();
    });
  });
});

describe("addSampleVersion — copies the Style's approved BOM into version 1", () => {
  const versionInput = { techPackNotes: "" };

  beforeEach(() => {
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue(null);
    vi.mocked(SampleVersionRepository.create).mockResolvedValue({ id: "ver-1", versionNumber: 1 } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "TECH_PACK_READY" } as never);
  });

  it("copies every approved BOM line into fresh SampleMaterial rows when this is version 1 for a sample linked to an existing style", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({
      id: "sam-1",
      status: "REQUESTED",
      currentVersionNumber: 0,
      productId: "prod-1",
    } as never);
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({
      id: "bom-1",
      approvedVersion: {
        items: [
          { materialId: "mat-cotton", quantityPerUnit: "1.2", uomId: "uom-mtr", colorId: null, notes: null },
          { materialId: "mat-thread", quantityPerUnit: "0.05", uomId: "uom-rol", colorId: "navy", notes: "for collar" },
        ],
      },
    } as never);

    await addSampleVersion(actor, "sam-1", versionInput as never);

    expect(SampleMaterialRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ sampleVersionId: "ver-1", materialId: "mat-cotton", plannedQuantity: "1.2", colorId: null }),
      expect.objectContaining({ sampleVersionId: "ver-1", materialId: "mat-thread", plannedQuantity: "0.05", colorId: "navy" }),
    ]);
  });

  it("copies nothing when the sample isn't linked to an existing style (a brand-new style has no BOM yet)", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({
      id: "sam-1",
      status: "REQUESTED",
      currentVersionNumber: 0,
      productId: null,
    } as never);

    await addSampleVersion(actor, "sam-1", versionInput as never);

    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
    expect(SampleMaterialRepository.createMany).not.toHaveBeenCalled();
  });

  it("copies nothing when the linked style has no approved BOM yet", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({
      id: "sam-1",
      status: "REQUESTED",
      currentVersionNumber: 0,
      productId: "prod-1",
    } as never);
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({ id: "bom-1", approvedVersion: null } as never);

    await addSampleVersion(actor, "sam-1", versionInput as never);

    expect(SampleMaterialRepository.createMany).not.toHaveBeenCalled();
  });

  it("does not re-copy the BOM for a later revision (version 2+), even when the sample is style-linked", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({
      id: "sam-1",
      status: "REVISION_REQUESTED",
      currentVersionNumber: 1,
      productId: "prod-1",
    } as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", versionNumber: 1 } as never);
    vi.mocked(SampleVersionRepository.create).mockResolvedValue({ id: "ver-2", versionNumber: 2 } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT" } as never);

    await addSampleVersion(actor, "sam-1", versionInput as never);

    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
    expect(SampleMaterialRepository.createMany).not.toHaveBeenCalled();
  });
});

describe("updateSampleBomMaterials — 'Update BOM', never touches the Style's real BOM", () => {
  const materials = [
    { id: "sm-1", plannedQuantity: "1.2" },
    { id: "sm-2", plannedQuantity: "0.05" },
  ];

  beforeEach(() => {
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "ver-1", versionNumber: 1 } as never);
    vi.mocked(SampleMaterialRepository.findByVersionId).mockResolvedValue(materials as never);
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({ id: "ver-1", marginPercent: null, commissionPercent: null, freightAmount: null } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);
  });

  it("rejects while sampling isn't complete (status other than APPROVED)", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "IN_DEVELOPMENT" } as never);

    await expect(
      updateSampleBomMaterials(actor, "sam-1", { updates: [{ sampleMaterialId: "sm-1", plannedQuantity: 2 }] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a sampleMaterialId that doesn't belong to the current version", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "APPROVED" } as never);

    await expect(
      updateSampleBomMaterials(actor, "sam-1", { updates: [{ sampleMaterialId: "sm-other", plannedQuantity: 2 }] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates each line's plannedQuantity and recalculates costing, never writing to the Style's own Bom/BomItem tables", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", status: "APPROVED" } as never);

    await updateSampleBomMaterials(actor, "sam-1", {
      updates: [
        { sampleMaterialId: "sm-1", plannedQuantity: 1.5 },
        { sampleMaterialId: "sm-2", plannedQuantity: 0.08 },
      ],
    });

    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
    // recalculateSampleVersionCosting's own guarded write is the only real
    // signal this ran inside the transaction — confirms the costing rollup
    // fires as part of this action, matching addSampleMaterial's own
    // "never blocked by a costing lock" tolerance (throwIfBlocked: false).
    expect(SampleVersionRepository.updateCostingIfUnlocked).toHaveBeenCalled();
  });
});

describe("removeSampleMaterial", () => {
  const material = { id: "sm-1", sampleVersionId: "ver-1", materialId: "mat-1", plannedQuantity: "1.2" };

  beforeEach(() => {
    vi.mocked(SampleVersionRepository.findByIdTx).mockResolvedValue({
      id: "ver-1",
      marginPercent: null,
      commissionPercent: null,
      freightAmount: null,
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdTx).mockResolvedValue([] as never);
    vi.mocked(SampleOtherChargeRepository.findByVersionIdTx).mockResolvedValue([] as never);
  });

  it("rejects a materialId belonging to another company", async () => {
    vi.mocked(SampleMaterialRepository.findWithRequestOwner).mockResolvedValue({
      ...material,
      sampleVersion: { sampleRequest: { companyId: "co-other" } },
    } as never);

    await expect(removeSampleMaterial(actor, "sm-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleMaterialRepository.delete).not.toHaveBeenCalled();
  });

  it("deletes the line and recalculates costing when unlocked", async () => {
    vi.mocked(SampleMaterialRepository.findWithRequestOwner).mockResolvedValue({
      ...material,
      sampleVersion: { sampleRequest: { companyId: "co-1" } },
    } as never);
    vi.mocked(SampleMaterialRepository.delete).mockResolvedValue({} as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 1 } as never);
    vi.mocked(SampleMaterialRepository.findByVersionId).mockResolvedValue([] as never);

    await removeSampleMaterial(actor, "sm-1");

    expect(SampleMaterialRepository.delete).toHaveBeenCalledWith(expect.anything(), "sm-1");
    expect(SampleVersionRepository.updateCostingIfUnlocked).toHaveBeenCalled();
  });

  // Unlike add/edit (which never block on a costing lock), removal is a
  // structural change — same "blocked while locked" reasoning already
  // proven for deleteSampleOtherCharge. The real Postgres transaction rolls
  // the delete back too when this guard fails; this test only asserts the
  // thrown error, which is all a mocked $transaction can verify.
  it("rejects when the version's costing is locked", async () => {
    vi.mocked(SampleMaterialRepository.findWithRequestOwner).mockResolvedValue({
      ...material,
      sampleVersion: { sampleRequest: { companyId: "co-1" } },
    } as never);
    vi.mocked(SampleMaterialRepository.delete).mockResolvedValue({} as never);
    vi.mocked(SampleVersionRepository.updateCostingIfUnlocked).mockResolvedValue({ count: 0 } as never);

    await expect(removeSampleMaterial(actor, "sm-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("setSampleRequestMainImage", () => {
  it("rejects when the sample request doesn't exist for this company", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(null);

    await expect(setSampleRequestMainImage(actor, "sam-1", "att-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.update).not.toHaveBeenCalled();
  });

  it("rejects an attachment that belongs to a different sample request", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: null } as never);
    vi.mocked(getAttachmentMetadata).mockResolvedValue({ id: "att-1", relatedModule: "SAMPLE_REQUEST", relatedRecordId: "sam-2" } as never);

    await expect(setSampleRequestMainImage(actor, "sam-1", "att-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SampleRequestRepository.update).not.toHaveBeenCalled();
  });

  it("rejects an attachment that isn't a SAMPLE_REQUEST attachment at all", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: null } as never);
    vi.mocked(getAttachmentMetadata).mockResolvedValue({ id: "att-1", relatedModule: "PRODUCT", relatedRecordId: "sam-1" } as never);

    await expect(setSampleRequestMainImage(actor, "sam-1", "att-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sets a valid, matching attachment as the main image", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: null } as never);
    vi.mocked(getAttachmentMetadata).mockResolvedValue({ id: "att-1", relatedModule: "SAMPLE_REQUEST", relatedRecordId: "sam-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: "att-1" } as never);

    const result = await setSampleRequestMainImage(actor, "sam-1", "att-1");

    expect(SampleRequestRepository.update).toHaveBeenCalledWith("sam-1", { mainImageAttachmentId: "att-1" });
    expect(result).toMatchObject({ mainImageAttachmentId: "att-1" });
  });

  it("clears the main image when attachmentId is null, without re-checking any attachment", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: "att-1" } as never);
    vi.mocked(SampleRequestRepository.update).mockResolvedValue({ id: "sam-1", mainImageAttachmentId: null } as never);

    await setSampleRequestMainImage(actor, "sam-1", null);

    expect(getAttachmentMetadata).not.toHaveBeenCalled();
    expect(SampleRequestRepository.update).toHaveBeenCalledWith("sam-1", { mainImageAttachmentId: null });
  });
});

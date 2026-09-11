import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/modules/purchasing/purchase-order.service", () => ({ createPurchaseOrder: vi.fn() }));
vi.mock("@/modules/bom-mrp/mrp.service", () => ({ getMaterialRequirements: vi.fn() }));
vi.mock("@/modules/bom-mrp/bom.repository", () => ({ BomRepository: { findByProductId: vi.fn() } }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findMaterialById: vi.fn() } }));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({ SalesOrderRepository: { findAnyById: vi.fn() } }));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleVersionRepository: { findWithRequestOwner: vi.fn() },
  SampleMaterialRepository: { findByVersionIdForMaterialRequest: vi.fn() },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({ LookupRepository: { unit: { findUnique: vi.fn() } } }));
vi.mock("./inventory.service", () => ({ getAvailableQuantity: vi.fn(), recordInventoryTransaction: vi.fn() }));
vi.mock("./material-request.repository", () => ({
  MaterialRequestRepository: {
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    createWithLines: vi.fn(),
    update: vi.fn(),
    countLinkedPurchaseOrderItems: vi.fn(),
    countIssuedLines: vi.fn(),
    countLockedLines: vi.fn(),
    replaceLines: vi.fn(),
    findOpenDuplicateLines: vi.fn(),
    findOpenBySampleVersion: vi.fn(),
  },
  MaterialRequestItemRepository: {
    findWithRequestOwner: vi.fn(),
    guardedIncrementIssued: vi.fn(),
    findManyForStatusRecompute: vi.fn(),
    findLinesForShortfallGeneration: vi.fn(),
  },
}));

const { MaterialRequestRepository, MaterialRequestItemRepository } = await import("./material-request.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { createPurchaseOrder } = await import("@/modules/purchasing/purchase-order.service");
const { getMaterialRequirements } = await import("@/modules/bom-mrp/mrp.service");
const { BomRepository } = await import("@/modules/bom-mrp/bom.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { SampleVersionRepository, SampleMaterialRepository } = await import("@/modules/sampling/sample.repository");
const {
  computeMaterialRequestStatus,
  computeRequiresPurchaseAction,
  transitionMaterialRequestStatus,
  generatePurchaseOrdersForShortfall,
  findDuplicateMaterialRequests,
  createMaterialRequestFromShortfall,
  createMaterialRequestFromSampleVersion,
  findMaterialRequestsBySampleVersion,
  createMaterialRequest,
  updateMaterialRequestLines,
} = await import("./material-request.service");

const actor = { companyId: "co-1", userId: "user-1" };

function activePoItem(orderedQuantity: string, status = "SENT_TO_SUPPLIER") {
  return { id: "poi", purchaseOrderId: "po", orderedQuantity, purchaseOrder: { id: "po", orderNumber: "PO-1", status } };
}

beforeEach(() => {
  vi.mocked(MaterialRequestRepository.findAnyById).mockReset();
  vi.mocked(MaterialRequestRepository.findByIdWithDetails).mockReset();
  vi.mocked(MaterialRequestRepository.createWithLines).mockReset();
  vi.mocked(MaterialRequestRepository.update).mockReset();
  vi.mocked(MaterialRequestRepository.countLinkedPurchaseOrderItems).mockReset().mockResolvedValue(0);
  vi.mocked(MaterialRequestRepository.countIssuedLines).mockReset().mockResolvedValue(0);
  vi.mocked(MaterialRequestRepository.countLockedLines).mockReset().mockResolvedValue(0);
  vi.mocked(MaterialRequestRepository.replaceLines).mockReset();
  vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockReset().mockResolvedValue([]);
  vi.mocked(MaterialRequestRepository.findOpenBySampleVersion).mockReset().mockResolvedValue([]);
  vi.mocked(SampleVersionRepository.findWithRequestOwner).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockReset();
  vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(createPurchaseOrder).mockReset();
  vi.mocked(getMaterialRequirements).mockReset();
  vi.mocked(BomRepository.findByProductId).mockReset();
  // Defaults to "found" — every pre-existing createMaterialRequestFromShortfall
  // test passes a real salesOrderId and doesn't care about this new check;
  // only the dedicated describe block below overrides it to null.
  vi.mocked(SalesOrderRepository.findAnyById).mockReset().mockResolvedValue({ id: "so-1" } as never);
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("MR-2026-00001");
  vi.mocked(MaterialRequestRepository.createWithLines).mockResolvedValue({ id: "mr-1" } as never);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Test Material", baseUom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 } } as never);
});

describe("computeMaterialRequestStatus", () => {
  it("stays OPEN when there are no lines at all (the empty-set guard)", () => {
    expect(computeMaterialRequestStatus([])).toBe("OPEN");
  });

  it("stays OPEN when nothing has been issued or escalated yet", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [] }];
    expect(computeMaterialRequestStatus(lines)).toBe("OPEN");
  });

  it("reports PARTIALLY_FULFILLED when only some lines are fulfilled", () => {
    const lines = [
      { requestedQuantity: "10", issuedQuantity: "10", purchaseOrderItems: [] },
      { requestedQuantity: "5", issuedQuantity: "0", purchaseOrderItems: [] },
    ];
    expect(computeMaterialRequestStatus(lines)).toBe("PARTIALLY_FULFILLED");
  });

  it("does NOT treat a line as fulfilled merely because active PO quantity covers the remaining gap — a PO is a commitment, not material in hand (direct user feedback, 2026-09-05)", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [activePoItem("10")] }];
    expect(computeMaterialRequestStatus(lines)).toBe("OPEN");
  });

  it("still does not fulfill a line when the active PO only covers part of the gap", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [activePoItem("4")] }];
    expect(computeMaterialRequestStatus(lines)).toBe("OPEN");
  });

  it("ignores PO quantity entirely (active or cancelled) when checking fulfillment — only issuedQuantity counts now", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [activePoItem("10", "CANCELLED")] }];
    expect(computeMaterialRequestStatus(lines)).toBe("OPEN");
  });

  it("does not fulfill a line from PO quantity even once issuedQuantity plus active PO quantity would cover it", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "2", purchaseOrderItems: [activePoItem("4"), activePoItem("4")] }];
    expect(computeMaterialRequestStatus(lines)).toBe("OPEN");
  });

  it("reports FULFILLED only when every line has actually been fully issued, regardless of any PO on the other line", () => {
    const lines = [
      { requestedQuantity: "10", issuedQuantity: "10", purchaseOrderItems: [] },
      { requestedQuantity: "5", issuedQuantity: "2", purchaseOrderItems: [activePoItem("3")] },
    ];
    expect(computeMaterialRequestStatus(lines)).toBe("PARTIALLY_FULFILLED");
  });

  it("reports FULFILLED once every line is actually fully issued from real received stock", () => {
    const lines = [
      { requestedQuantity: "10", issuedQuantity: "10", purchaseOrderItems: [] },
      { requestedQuantity: "5", issuedQuantity: "5", purchaseOrderItems: [activePoItem("5")] },
    ];
    expect(computeMaterialRequestStatus(lines)).toBe("FULFILLED");
  });
});

describe("computeRequiresPurchaseAction", () => {
  it("is false once a line is fully issued", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "10", purchaseOrderItems: [] }];
    expect(computeRequiresPurchaseAction(lines)).toBe(false);
  });

  it("is false once active POs fully cover the remaining gap", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [activePoItem("10")] }];
    expect(computeRequiresPurchaseAction(lines)).toBe(false);
  });

  it("is true when a real, uncovered shortfall exists", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "2", purchaseOrderItems: [activePoItem("3")] }];
    expect(computeRequiresPurchaseAction(lines)).toBe(true);
  });

  it("is true even though a cancelled PO also exists against the line (its quantity doesn't count)", () => {
    const lines = [{ requestedQuantity: "10", issuedQuantity: "0", purchaseOrderItems: [activePoItem("10", "CANCELLED")] }];
    expect(computeRequiresPurchaseAction(lines)).toBe(true);
  });
});

describe("transitionMaterialRequestStatus", () => {
  it("blocks cancelling once anything has already been issued, regardless of status label", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({
      id: "mr-1",
      companyId: "co-1",
      status: "PARTIALLY_FULFILLED",
    } as never);
    vi.mocked(MaterialRequestRepository.countIssuedLines).mockResolvedValue(1);

    await expect(transitionMaterialRequestStatus(actor, "mr-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(MaterialRequestRepository.update).not.toHaveBeenCalled();
  });

  it("blocks cancelling once a shortfall has been escalated to a purchase order", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({
      id: "mr-1",
      companyId: "co-1",
      status: "OPEN",
    } as never);
    vi.mocked(MaterialRequestRepository.countLinkedPurchaseOrderItems).mockResolvedValue(1);

    await expect(transitionMaterialRequestStatus(actor, "mr-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(MaterialRequestRepository.update).not.toHaveBeenCalled();
  });

  it("allows cancelling a fresh OPEN request with nothing issued or escalated", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({
      id: "mr-1",
      companyId: "co-1",
      status: "OPEN",
    } as never);
    vi.mocked(MaterialRequestRepository.update).mockResolvedValue({ id: "mr-1", status: "CANCELLED" } as never);

    await transitionMaterialRequestStatus(actor, "mr-1", "CANCELLED");
    expect(MaterialRequestRepository.update).toHaveBeenCalledWith("mr-1", expect.objectContaining({ status: "CANCELLED" }));
  });

  it("rejects a transition not reachable from the current status", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({
      id: "mr-1",
      companyId: "co-1",
      status: "CANCELLED",
    } as never);

    await expect(transitionMaterialRequestStatus(actor, "mr-1", "ON_HOLD")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });
});

describe("updateMaterialRequestLines — line-level editability", () => {
  const editInput = {
    requestType: "PRODUCTION_REQUIREMENT" as const,
    departmentId: "",
    warehouseId: "wh-1",
    requiredDate: "",
    purpose: "",
    salesOrderId: "",
    productionOrderId: "",
    bomId: "",
    originalMaterialRequestId: "",
    remarks: "",
    lines: [{ materialId: "mat-1", colorId: "", dyeId: "", uomId: "uom-1", requestedQuantity: 5, damageReason: "", remarks: "" }],
  };

  it("rejects editing a CANCELLED or CLOSED request outright — unchanged, request-level guard", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", status: "CLOSED" } as never);

    await expect(updateMaterialRequestLines(actor, "mr-1", editInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(MaterialRequestRepository.replaceLines).not.toHaveBeenCalled();
  });

  it("succeeds on a request with zero locked lines — the ordinary, pre-existing case still works", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", status: "OPEN" } as never);
    vi.mocked(MaterialRequestRepository.countLockedLines).mockResolvedValue(0);
    vi.mocked(MaterialRequestRepository.replaceLines).mockResolvedValue({ id: "mr-1", lines: [{ id: "line-1" }] } as never);

    await updateMaterialRequestLines(actor, "mr-1", editInput);

    expect(MaterialRequestRepository.replaceLines).toHaveBeenCalledWith(
      "mr-1",
      expect.objectContaining({ warehouseId: "wh-1" }),
      expect.arrayContaining([expect.objectContaining({ materialId: "mat-1", requestedQuantity: 5 })])
    );
  });

  it("succeeds even when OTHER lines on the same request are already locked — the actual fix: no whole-request block anymore", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({
      id: "mr-1",
      companyId: "co-1",
      status: "PARTIALLY_FULFILLED",
    } as never);
    vi.mocked(MaterialRequestRepository.countLockedLines).mockResolvedValue(1); // one sibling line already issued
    vi.mocked(MaterialRequestRepository.replaceLines).mockResolvedValue({ id: "mr-1", lines: [{ id: "line-2" }] } as never);

    await updateMaterialRequestLines(actor, "mr-1", editInput);

    // The submitted line array is only ever the still-unlocked portion —
    // replaceLines itself is what leaves the locked sibling line untouched
    // (see material-request.repository.ts's own UNLOCKED_LINE_WHERE).
    expect(MaterialRequestRepository.replaceLines).toHaveBeenCalledWith(
      "mr-1",
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ materialId: "mat-1" })])
    );
  });

  it("lets the substitute material/color/quantity through unchanged from the client's submitted values — no substitution concept, just an ordinary field edit", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", status: "OPEN" } as never);
    vi.mocked(MaterialRequestRepository.countLockedLines).mockResolvedValue(0);
    vi.mocked(MaterialRequestRepository.replaceLines).mockResolvedValue({ id: "mr-1", lines: [] } as never);

    await updateMaterialRequestLines(actor, "mr-1", {
      ...editInput,
      lines: [{ materialId: "mat-2", colorId: "color-9", dyeId: "", uomId: "uom-1", requestedQuantity: 12, damageReason: "", remarks: "" }],
    });

    expect(MaterialRequestRepository.replaceLines).toHaveBeenCalledWith(
      "mr-1",
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ materialId: "mat-2", colorId: "color-9", requestedQuantity: 12 })])
    );
  });

  it("rejects an edit that would leave the request with zero lines total (no locked lines to fall back on, and nothing submitted)", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", status: "OPEN" } as never);
    vi.mocked(MaterialRequestRepository.countLockedLines).mockResolvedValue(0);

    await expect(updateMaterialRequestLines(actor, "mr-1", { ...editInput, lines: [] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(MaterialRequestRepository.replaceLines).not.toHaveBeenCalled();
  });

  it("allows submitting zero lines when locked lines already cover the request — removing the last remaining editable line is legitimate", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", status: "PARTIALLY_FULFILLED" } as never);
    vi.mocked(MaterialRequestRepository.countLockedLines).mockResolvedValue(1);
    vi.mocked(MaterialRequestRepository.replaceLines).mockResolvedValue({ id: "mr-1", lines: [] } as never);

    await updateMaterialRequestLines(actor, "mr-1", { ...editInput, lines: [] });

    expect(MaterialRequestRepository.replaceLines).toHaveBeenCalledWith("mr-1", expect.anything(), []);
  });
});

describe("findDuplicateMaterialRequests", () => {
  it("surfaces an OPEN match that still has a real remainder", async () => {
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      { id: "line-1", requestedQuantity: "10", issuedQuantity: "2", materialRequest: { id: "mr-1", requestNumber: "MR-2026-00001" } },
    ] as never);

    const result = await findDuplicateMaterialRequests("co-1", "so-1", ["mat-1"]);
    expect(result["mat-1"]).toEqual([{ requestId: "mr-1", requestNumber: "MR-2026-00001", remainingQuantity: 8 }]);
  });

  it("excludes a match with no real remainder left (fully issued)", async () => {
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      { id: "line-1", requestedQuantity: "10", issuedQuantity: "10", materialRequest: { id: "mr-1", requestNumber: "MR-2026-00001" } },
    ] as never);

    const result = await findDuplicateMaterialRequests("co-1", "so-1", ["mat-1"]);
    expect(result["mat-1"]).toBeUndefined();
  });
});

describe("generatePurchaseOrdersForShortfall", () => {
  const line = (id: string, materialId: string, requestedQuantity: string, uomId = "uom-1") => ({
    id,
    materialId,
    uomId,
    requestedQuantity,
    issuedQuantity: "0",
    material: { id: materialId, styleName: `Material ${materialId}`, styleCode: materialId, defaultSupplierId: null },
    uom: { id: uomId, code: "MTR" },
    purchaseOrderItems: [],
  });

  beforeEach(() => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-1", companyId: "co-1", requestNumber: "MR-2026-00001" } as never);
    vi.mocked(MaterialRequestRepository.update).mockResolvedValue({} as never);
    vi.mocked(MaterialRequestRepository.findByIdWithDetails).mockResolvedValue({ id: "mr-1", lines: [] } as never);
    vi.mocked(MaterialRequestItemRepository.findManyForStatusRecompute).mockResolvedValue([]);
  });

  it("groups by the submitted supplierId and passes purchaseQuantity through verbatim, even above the suggestion", async () => {
    vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockResolvedValue([
      line("line-1", "mat-1", "100"),
    ] as never);
    vi.mocked(createPurchaseOrder).mockResolvedValue({ id: "po-1", orderNumber: "PO-2026-00001" } as never);

    await generatePurchaseOrdersForShortfall(actor, "mr-1", {
      lines: [{ materialRequestItemId: "line-1", purchaseQuantity: 500, supplierId: "sup-1", unitPrice: 25 }],
    });

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "purchasing", "create");
    expect(createPurchaseOrder).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        supplierId: "sup-1",
        items: [expect.objectContaining({ productId: "mat-1", orderedQuantity: 500, materialRequestItemId: "line-1" })],
      })
    );
  });

  it("skips a materialRequestItemId that isn't a valid line on this request", async () => {
    vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockResolvedValue([] as never);

    const result = await generatePurchaseOrdersForShortfall(actor, "mr-1", {
      lines: [{ materialRequestItemId: "not-real", purchaseQuantity: 10, supplierId: "sup-1", unitPrice: 25 }],
    });

    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([{ materialRequestItemId: "not-real", reason: expect.any(String) }]);
  });

  it("skips a line already fully covered by an existing active purchase order", async () => {
    const covered = line("line-1", "mat-1", "10");
    covered.purchaseOrderItems = [activePoItem("10")] as never;
    vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockResolvedValue([covered] as never);

    const result = await generatePurchaseOrdersForShortfall(actor, "mr-1", {
      lines: [{ materialRequestItemId: "line-1", purchaseQuantity: 5, supplierId: "sup-1", unitPrice: 25 }],
    });

    expect(createPurchaseOrder).not.toHaveBeenCalled();
    expect(result.skipped[0].materialRequestItemId).toBe("line-1");
  });

  it("does not let one supplier group's failure abort another group's success", async () => {
    vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockResolvedValue([
      line("line-1", "mat-1", "100"),
      line("line-2", "mat-2", "50"),
    ] as never);
    vi.mocked(createPurchaseOrder)
      .mockRejectedValueOnce(new Error("supplier A failed"))
      .mockResolvedValueOnce({ id: "po-2", orderNumber: "PO-2026-00002" } as never);

    const result = await generatePurchaseOrdersForShortfall(actor, "mr-1", {
      lines: [
        { materialRequestItemId: "line-1", purchaseQuantity: 100, supplierId: "sup-a", unitPrice: 25 },
        { materialRequestItemId: "line-2", purchaseQuantity: 50, supplierId: "sup-b", unitPrice: 40 },
      ],
    });

    const statuses = result.results.map((r) => r.status).sort();
    expect(statuses).toEqual(["failed", "success"]);
  });
});

describe("createMaterialRequestFromShortfall", () => {
  beforeEach(() => {
    vi.mocked(MaterialRequestRepository.createWithLines).mockResolvedValue({ id: "mr-new", requestNumber: "MR-2026-00099" } as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Material",
      baseUom: { id: "uom-1", name: "Meter" },
    } as never);
  });

  it("recomputes requirements server-side rather than trusting client-sent quantities", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [
        {
          materialId: "mat-1",
          uomId: "uom-1",
          shortfallQuantity: 42,
          contributingStyles: [{ productId: "prod-1" }],
        },
      ],
    } as never);
    vi.mocked(BomRepository.findByProductId).mockResolvedValue({ id: "bom-1" } as never);

    await createMaterialRequestFromShortfall(actor, {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      materialIds: ["mat-1"],
    });

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({
        salesOrderId: "so-1",
        bomId: "bom-1",
        lines: { create: [expect.objectContaining({ materialId: "mat-1", requestedQuantity: 42 })] },
      })
    );
  });

  it("leaves bomId unset when the selection spans more than one style", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [
        { materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 10, contributingStyles: [{ productId: "prod-1" }] },
        { materialId: "mat-2", uomId: "uom-1", shortfallQuantity: 5, contributingStyles: [{ productId: "prod-2" }] },
      ],
    } as never);

    await createMaterialRequestFromShortfall(actor, {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      materialIds: ["mat-1", "mat-2"],
    });

    expect(BomRepository.findByProductId).not.toHaveBeenCalled();
    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ bomId: null }));
  });

  it("blocks with DUPLICATE_MATERIAL_REQUEST_EXISTS when an open duplicate exists and no override is given", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [{ materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 10, contributingStyles: [{ productId: "prod-1" }] }],
    } as never);
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      { id: "line-x", requestedQuantity: "5", issuedQuantity: "0", materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001" } },
    ] as never);

    await expect(
      createMaterialRequestFromShortfall(actor, { salesOrderId: "so-1", warehouseId: "wh-1", materialIds: ["mat-1"] })
    ).rejects.toMatchObject({ code: "DUPLICATE_MATERIAL_REQUEST_EXISTS" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("proceeds despite a duplicate when overrideDuplicateCheck is set", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [{ materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 10, contributingStyles: [{ productId: "prod-1" }] }],
    } as never);
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      { id: "line-x", requestedQuantity: "5", issuedQuantity: "0", materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001" } },
    ] as never);

    await createMaterialRequestFromShortfall(actor, {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      materialIds: ["mat-1"],
      overrideDuplicateCheck: true,
    });

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalled();
  });
});

describe("createMaterialRequestFromSampleVersion", () => {
  const version = { id: "ver-1", sampleRequest: { companyId: "co-1", requestedByUserId: "user-x" } };

  beforeEach(() => {
    vi.mocked(SampleVersionRepository.findWithRequestOwner).mockResolvedValue(version as never);
    vi.mocked(MaterialRequestRepository.createWithLines).mockResolvedValue({ id: "mr-new", requestNumber: "MR-2026-00099" } as never);
  });

  it("rejects with NOT_FOUND when the version doesn't belong to the actor's own company", async () => {
    vi.mocked(SampleVersionRepository.findWithRequestOwner).mockResolvedValue({
      id: "ver-1",
      sampleRequest: { companyId: "other-co", requestedByUserId: "user-x" },
    } as never);

    await expect(
      createMaterialRequestFromSampleVersion(actor, { sampleVersionId: "ver-1", warehouseId: "wh-1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("rejects with VALIDATION_ERROR when the version has no materials to request", async () => {
    vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockResolvedValue([]);

    await expect(
      createMaterialRequestFromSampleVersion(actor, { sampleVersionId: "ver-1", warehouseId: "wh-1" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("rejects with VALIDATION_ERROR naming the material when a line has no uomId and its material has no base unit either", async () => {
    vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockResolvedValue([
      {
        id: "sm-1",
        materialId: "mat-1",
        plannedQuantity: "10",
        uomId: null,
        colorId: null,
        dyeId: null,
        material: { styleName: "Cotton Fabric", baseUomId: null },
      },
    ] as never);

    await expect(
      createMaterialRequestFromSampleVersion(actor, { sampleVersionId: "ver-1", warehouseId: "wh-1" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("Cotton Fabric") });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("falls back to the material's own base unit when the sample material line has no uomId of its own", async () => {
    // assertLinesHaveConvertibleUom (createMaterialRequest's own guard) needs
    // the resolved line's uomId to match this material's baseUom exactly, or
    // it'll try a real UOM-conversion lookup this test doesn't mock.
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Cotton Fabric",
      baseUom: { id: "uom-base-1" },
    } as never);
    vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockResolvedValue([
      {
        id: "sm-1",
        materialId: "mat-1",
        plannedQuantity: "10",
        uomId: null,
        colorId: "color-1",
        dyeId: "dye-1",
        material: { styleName: "Cotton Fabric", baseUomId: "uom-base-1" },
      },
    ] as never);

    await createMaterialRequestFromSampleVersion(actor, { sampleVersionId: "ver-1", warehouseId: "wh-1" });

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({
        requestType: "SAMPLING_REQUIREMENT",
        sampleVersionId: "ver-1",
        warehouseId: "wh-1",
        lines: {
          create: [
            expect.objectContaining({
              materialId: "mat-1",
              colorId: "color-1",
              dyeId: "dye-1",
              uomId: "uom-base-1",
              requestedQuantity: 10,
            }),
          ],
        },
      })
    );
  });

  it("blocks with DUPLICATE_MATERIAL_REQUEST_EXISTS when a request already exists for this version and no override is given", async () => {
    vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockResolvedValue([
      { id: "sm-1", materialId: "mat-1", plannedQuantity: "10", uomId: "uom-1", colorId: null, dyeId: null, material: { styleName: "X", baseUomId: null } },
    ] as never);
    vi.mocked(MaterialRequestRepository.findOpenBySampleVersion).mockResolvedValue([
      { id: "mr-existing", requestNumber: "MR-2026-00005", status: "OPEN", createdAt: new Date() },
    ] as never);

    await expect(
      createMaterialRequestFromSampleVersion(actor, { sampleVersionId: "ver-1", warehouseId: "wh-1" })
    ).rejects.toMatchObject({ code: "DUPLICATE_MATERIAL_REQUEST_EXISTS" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("proceeds despite an existing request when overrideDuplicateCheck is set", async () => {
    vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockResolvedValue([
      { id: "sm-1", materialId: "mat-1", plannedQuantity: "10", uomId: "uom-1", colorId: null, dyeId: null, material: { styleName: "X", baseUomId: null } },
    ] as never);
    vi.mocked(MaterialRequestRepository.findOpenBySampleVersion).mockResolvedValue([
      { id: "mr-existing", requestNumber: "MR-2026-00005", status: "OPEN", createdAt: new Date() },
    ] as never);

    await createMaterialRequestFromSampleVersion(actor, {
      sampleVersionId: "ver-1",
      warehouseId: "wh-1",
      overrideDuplicateCheck: true,
    });

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalled();
  });
});

describe("findMaterialRequestsBySampleVersion", () => {
  it("delegates straight to the repository, company-scoped", async () => {
    vi.mocked(MaterialRequestRepository.findOpenBySampleVersion).mockResolvedValue([
      { id: "mr-1", requestNumber: "MR-2026-00001", status: "OPEN", createdAt: new Date() },
    ] as never);

    const result = await findMaterialRequestsBySampleVersion("co-1", "ver-1");

    expect(MaterialRequestRepository.findOpenBySampleVersion).toHaveBeenCalledWith("co-1", "ver-1");
    expect(result).toHaveLength(1);
  });
});

// The manual create form's own optional Sales Order dropdown (2026-09-05) —
// previously salesOrderId was only ever set internally by
// createMaterialRequestFromShortfall (already company-scoped via
// getMaterialRequirements), so this check was never reachable before.
describe("createMaterialRequest — Sales Order link", () => {
  const oneLine = { materialId: "mat-1", uomId: "uom-1", requestedQuantity: 5 };

  it("rejects a salesOrderId that doesn't belong to this company", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue(null);

    await expect(
      createMaterialRequest(actor, { requestType: "PRODUCTION_REQUIREMENT", warehouseId: "wh-1", salesOrderId: "so-x", lines: [oneLine] } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("persists a real salesOrderId through to the created request", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1" } as never);

    await createMaterialRequest(actor, {
      requestType: "PRODUCTION_REQUIREMENT",
      warehouseId: "wh-1",
      salesOrderId: "so-1",
      lines: [oneLine],
    } as never);

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ salesOrderId: "so-1" }));
  });

  it("skips the Sales Order check entirely when none is supplied — the plain, order-independent case", async () => {
    await createMaterialRequest(actor, { requestType: "PRODUCTION_REQUIREMENT", warehouseId: "wh-1", lines: [oneLine] } as never);

    expect(SalesOrderRepository.findAnyById).not.toHaveBeenCalled();
    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ salesOrderId: null }));
  });
});

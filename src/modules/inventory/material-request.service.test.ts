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
    findOpenDuplicateLines: vi.fn(),
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
const {
  computeMaterialRequestStatus,
  computeRequiresPurchaseAction,
  transitionMaterialRequestStatus,
  generatePurchaseOrdersForShortfall,
  findDuplicateMaterialRequests,
  createMaterialRequestFromShortfall,
  createMaterialRequest,
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
  vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockReset().mockResolvedValue([]);
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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
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
vi.mock("./inventory.service", () => ({
  getAvailableQuantity: vi.fn(),
  getAvailableQuantityByColor: vi.fn(),
  getAvailableQuantityByDye: vi.fn(),
  getFabricRollAvailableQuantity: vi.fn(),
  getStockColorBreakdown: vi.fn(),
  recordInventoryTransaction: vi.fn(),
}));
vi.mock("./inventory.repository", () => ({ StockBalanceRepository: { findMany: vi.fn() } }));
vi.mock("@/modules/warehouses/warehouse.repository", () => ({ WarehouseRepository: { findMany: vi.fn() } }));
vi.mock("@/modules/purchasing/fabric-roll.repository", () => ({
  FabricRollRepository: {
    findByIdWithContext: vi.fn(),
    guardedDecrementRemaining: vi.fn(),
    findAvailableForMaterial: vi.fn(),
    findAvailableAcrossWarehousesForMaterial: vi.fn(),
  },
}));
vi.mock("./material-request.repository", () => ({
  MaterialRequestRepository: {
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    createWithLines: vi.fn(),
    update: vi.fn(),
    countLinkedPurchaseOrderItems: vi.fn(),
    countIssuedLines: vi.fn(),
    countLockedLines: vi.fn(),
    decideApproval: vi.fn(),
    replaceLines: vi.fn(),
    findOpenDuplicateLines: vi.fn(),
    findOpenBySampleVersion: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  MaterialRequestItemRepository: {
    findWithRequestOwner: vi.fn(),
    guardedIncrementIssued: vi.fn(),
    findManyForStatusRecompute: vi.fn(),
    findLinesForShortfallGeneration: vi.fn(),
    findById: vi.fn(),
  },
}));
vi.mock("./material-substitution.repository", () => ({
  MaterialSubstitutionRepository: { findById: vi.fn(), setInventoryTransactionInTx: vi.fn() },
}));

const { MaterialRequestRepository, MaterialRequestItemRepository } = await import("./material-request.repository");
const { FabricRollRepository } = await import("@/modules/purchasing/fabric-roll.repository");
const { recordInventoryTransaction, getAvailableQuantity, getAvailableQuantityByColor, getFabricRollAvailableQuantity, getStockColorBreakdown } = await import("./inventory.service");
const { StockBalanceRepository } = await import("./inventory.repository");
const { WarehouseRepository } = await import("@/modules/warehouses/warehouse.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { createPurchaseOrder } = await import("@/modules/purchasing/purchase-order.service");
const { getMaterialRequirements } = await import("@/modules/bom-mrp/mrp.service");
const { BomRepository } = await import("@/modules/bom-mrp/bom.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { SampleVersionRepository, SampleMaterialRepository } = await import("@/modules/sampling/sample.repository");
const { MaterialSubstitutionRepository } = await import("./material-substitution.repository");
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
  approveMaterialRequest,
  rejectMaterialRequest,
  updateMaterialRequestLines,
  issueMaterialRequestLine,
  issueSubstituteMaterial,
  getAvailableRollsForLine,
  getOtherWarehouseStockForLine,
  listMaterialRequests,
  getMaterialRequestById,
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
  vi.mocked(MaterialRequestRepository.decideApproval).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(MaterialRequestRepository.replaceLines).mockReset();
  vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockReset().mockResolvedValue([]);
  vi.mocked(MaterialRequestRepository.findOpenBySampleVersion).mockReset().mockResolvedValue([]);
  vi.mocked(SampleVersionRepository.findWithRequestOwner).mockReset();
  vi.mocked(SampleMaterialRepository.findByVersionIdForMaterialRequest).mockReset();
  vi.mocked(MaterialRequestItemRepository.findLinesForShortfallGeneration).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
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
  vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockReset();
  vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockReset();
  vi.mocked(MaterialRequestItemRepository.findById).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue({ id: "txn-1" } as never);
  vi.mocked(FabricRollRepository.findByIdWithContext).mockReset();
  vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockReset();
  vi.mocked(FabricRollRepository.findAvailableForMaterial).mockReset();
  vi.mocked(FabricRollRepository.findAvailableAcrossWarehousesForMaterial).mockReset();
  vi.mocked(getAvailableQuantity).mockReset();
  vi.mocked(getAvailableQuantityByColor).mockReset().mockResolvedValue(0);
  vi.mocked(getFabricRollAvailableQuantity).mockReset().mockResolvedValue(0);
  // Default: all stock uncoloured, so the colour breakdown mirrors getAvailableQuantity.
  vi.mocked(getStockColorBreakdown)
    .mockReset()
    .mockImplementation(async (companyId, productId, warehouseId) => {
      const q = Number(await getAvailableQuantity(companyId, productId, warehouseId)) || 0;
      return { onHand: q, colors: [], noColorQuantity: q };
    });
  vi.mocked(StockBalanceRepository.findMany).mockReset();
  vi.mocked(MaterialSubstitutionRepository.findById).mockReset();
  vi.mocked(MaterialSubstitutionRepository.setInventoryTransactionInTx).mockReset();
  vi.mocked(WarehouseRepository.findMany).mockReset();
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
  it("surfaces an OPEN match that still has a real remainder, with the real stock at that request's own warehouse", async () => {
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      {
        id: "line-1",
        requestedQuantity: "10",
        issuedQuantity: "2",
        materialRequest: { id: "mr-1", requestNumber: "MR-2026-00001", warehouseId: "wh-palam", warehouse: { name: "E-52 Palam Vihar" } },
      },
    ] as never);
    // Company-wide MRP might show plenty of stock, but this test proves the
    // duplicate warning reports the *specific* warehouse's real number
    // instead (the exact confusion a mismatched-warehouse receipt causes).
    vi.mocked(getAvailableQuantity).mockResolvedValue(0);

    const result = await findDuplicateMaterialRequests("co-1", "so-1", ["mat-1"]);
    expect(getAvailableQuantity).toHaveBeenCalledWith("co-1", "mat-1", "wh-palam");
    expect(result["mat-1"]).toEqual([
      { requestId: "mr-1", requestNumber: "MR-2026-00001", remainingQuantity: 8, warehouseName: "E-52 Palam Vihar", availableAtWarehouse: 0 },
    ]);
  });

  it("excludes a match with no real remainder left (fully issued)", async () => {
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      {
        id: "line-1",
        requestedQuantity: "10",
        issuedQuantity: "10",
        materialRequest: { id: "mr-1", requestNumber: "MR-2026-00001", warehouseId: "wh-1", warehouse: { name: "Head Office" } },
      },
    ] as never);

    const result = await findDuplicateMaterialRequests("co-1", "so-1", ["mat-1"]);
    expect(result["mat-1"]).toBeUndefined();
    expect(getAvailableQuantity).not.toHaveBeenCalled();
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

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "material_request", "edit");
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
      {
        id: "line-x",
        requestedQuantity: "5",
        issuedQuantity: "0",
        materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001", warehouseId: "wh-x", warehouse: { name: "Existing Warehouse" } },
      },
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
      {
        id: "line-x",
        requestedQuantity: "5",
        issuedQuantity: "0",
        materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001", warehouseId: "wh-x", warehouse: { name: "Existing Warehouse" } },
      },
    ] as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(0);

    await createMaterialRequestFromShortfall(actor, {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      materialIds: ["mat-1"],
      overrideDuplicateCheck: true,
    });

    // Shortfall is 10, but 5 is already open on MR-2026-00001 — the new
    // request must be netted down to 5, not re-request the full 10 (which
    // would let both requests be issued in full and double the real need).
    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: { create: [expect.objectContaining({ materialId: "mat-1", requestedQuantity: 5 })] },
      })
    );
  });

  it("rejects when overriding but the full shortfall is already covered by open duplicates", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [{ materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 10, contributingStyles: [{ productId: "prod-1" }] }],
    } as never);
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      {
        id: "line-x",
        requestedQuantity: "10",
        issuedQuantity: "0",
        materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001", warehouseId: "wh-x", warehouse: { name: "Existing Warehouse" } },
      },
    ] as never);

    await expect(
      createMaterialRequestFromShortfall(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        materialIds: ["mat-1"],
        overrideDuplicateCheck: true,
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(MaterialRequestRepository.createWithLines).not.toHaveBeenCalled();
  });

  it("nets across multiple open duplicates for the same material when overriding", async () => {
    vi.mocked(getMaterialRequirements).mockResolvedValue({
      materials: [{ materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 50, contributingStyles: [{ productId: "prod-1" }] }],
    } as never);
    vi.mocked(MaterialRequestRepository.findOpenDuplicateLines).mockResolvedValue([
      {
        id: "line-x",
        requestedQuantity: "20",
        issuedQuantity: "0",
        materialRequest: { id: "mr-x", requestNumber: "MR-2026-00001", warehouseId: "wh-x", warehouse: { name: "Warehouse X" } },
      },
      {
        id: "line-y",
        requestedQuantity: "10",
        issuedQuantity: "5",
        materialRequest: { id: "mr-y", requestNumber: "MR-2026-00002", warehouseId: "wh-y", warehouse: { name: "Warehouse Y" } },
      },
    ] as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(0);

    await createMaterialRequestFromShortfall(actor, {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      materialIds: ["mat-1"],
      overrideDuplicateCheck: true,
    });

    // 50 shortfall − (20 remaining on mr-x + 5 remaining on mr-y) = 25.
    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: { create: [expect.objectContaining({ materialId: "mat-1", requestedQuantity: 25 })] },
      })
    );
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

describe("issueMaterialRequestLine — fabric roll (color/shade) selection", () => {
  function baseLine(overrides: Record<string, unknown> = {}) {
    return {
      id: "line-1",
      materialId: "mat-fabric",
      requestedQuantity: "10",
      issuedQuantity: "0",
      material: { id: "mat-fabric", styleName: "Cotton Fabric", materialCategory: "FABRIC", baseUomId: "uom-1", baseUom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 } },
      uom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 },
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "OPEN" },
      ...overrides,
    };
  }

  function inStockRoll(overrides: Record<string, unknown> = {}) {
    return {
      id: "roll-1",
      status: "IN_STOCK",
      remainingQuantity: "50",
      goodsReceiptItem: { productId: "mat-fabric", warehouseId: "wh-1" },
      ...overrides,
    };
  }

  it("issues against the selected roll: decrements it and records the roll on the ledger entry", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(inStockRoll() as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1");

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      {},
      actor,
      expect.objectContaining({ fabricRollId: "roll-1", quantity: -5 })
    );
    expect(FabricRollRepository.guardedDecrementRemaining).toHaveBeenCalledWith({}, "roll-1", 5);
  });

  // Colour-wise stock (2026-10-21).
  it("refuses a roll of another colour on a coloured line", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(
      baseLine({ colorId: "col-black", color: { id: "col-black", name: "Black" } }) as never
    );
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(
      inStockRoll({
        rollNumber: "R-9",
        goodsReceiptItem: { productId: "mat-fabric", warehouseId: "wh-1", purchaseOrderItem: { colorId: "col-navy", color: { name: "Navy Blue" } } },
      }) as never
    );

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Roll R-9 is Navy Blue"),
    });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a roll that belongs to a different material at this warehouse", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(
      inStockRoll({ goodsReceiptItem: { productId: "some-other-material", warehouseId: "wh-1" } }) as never
    );

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(FabricRollRepository.guardedDecrementRemaining).not.toHaveBeenCalled();
  });

  it("rejects issuing more than the selected roll actually has remaining", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(inStockRoll({ remainingQuantity: "3" }) as never);
    // Real flat balance is plenty here — the roll's own lower number is
    // meant to be the binding constraint this test is actually about.
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1")).rejects.toMatchObject({
      code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
    });
    expect(MaterialRequestItemRepository.guardedIncrementIssued).not.toHaveBeenCalled();
  });

  // Regression for a real reported bug: FabricRoll.remainingQuantity can
  // drift out of sync with the real StockBalance ledger (a roll left over
  // from before every issue kept rolls in sync). Trusting the roll's own
  // number alone would let the UI offer, and the server accept, a quantity
  // the ledger's own floor guard would reject anyway.
  it("caps against the real flat balance too, not just the roll's own (possibly drifted) remaining", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    // The roll itself claims 20 remaining, but the real ledger balance at
    // this warehouse is only 3.5 — the exact live-confirmed drift.
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(inStockRoll({ remainingQuantity: "20" }) as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(3.5 as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1")).rejects.toMatchObject({
      code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
      details: expect.objectContaining({ available: 3.5 }),
    });
    expect(MaterialRequestItemRepository.guardedIncrementIssued).not.toHaveBeenCalled();
  });

  it("surfaces a clean conflict error when the roll is decremented by someone else in the same instant", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue(inStockRoll() as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 0 } as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-1")).rejects.toMatchObject({
      code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
    });
  });

  it("falls back to the flat material-level check when no roll is selected — unchanged, backward-compatible behavior", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, null);

    expect(FabricRollRepository.findByIdWithContext).not.toHaveBeenCalled();
    expect(FabricRollRepository.guardedDecrementRemaining).not.toHaveBeenCalled();
    expect(recordInventoryTransaction).toHaveBeenCalledWith({}, actor, expect.objectContaining({ fabricRollId: null }));
  });
});

describe("issueMaterialRequestLine — Issue Extra widened to every request type (2026-09-22)", () => {
  function baseLine(overrides: Record<string, unknown> = {}) {
    return {
      id: "line-1",
      materialId: "mat-1",
      requestedQuantity: "10",
      issuedQuantity: "0",
      material: { id: "mat-1", styleName: "Plastic Buttons", materialCategory: "BUTTONS", baseUomId: "uom-1", baseUom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 } },
      uom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 },
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "OPEN", requestType: "PRODUCTION_REQUIREMENT" },
      ...overrides,
    };
  }

  it("allows over-issuing a PRODUCTION_REQUIREMENT line when a reason is supplied — no longer Sampling-only", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 12, null, null, "extra for wastage");

    // issueCap = requestedQuantity (10) + overRequested (2) = 12 — the
    // guarded increment's own ceiling widens by exactly the approved extra,
    // never an unlimited allowance.
    expect(MaterialRequestItemRepository.guardedIncrementIssued).toHaveBeenCalledWith({}, "line-1", 12, 12, null);
  });

  it("still rejects an over-issue on a PRODUCTION_REQUIREMENT line with no reason given", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 12, null, null)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(MaterialRequestItemRepository.guardedIncrementIssued).not.toHaveBeenCalled();
  });

  it("still rejects an over-issue on a DAMAGE_REPLACEMENT line with no reason given", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(
      baseLine({
        materialRequest: {
          id: "mr-1",
          companyId: "co-1",
          warehouseId: "wh-1",
          status: "OPEN",
          requestType: "DAMAGE_REPLACEMENT",
          // Already approved — this test is about the pre-existing "extra
          // quantity needs a reason" rule, not the newer (2026-09-24)
          // approval gate covered by its own dedicated describe block below.
          approvalStatus: "APPROVED",
        },
      }) as never
    );

    await expect(issueMaterialRequestLine(actor, "line-1", 12, null, null)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(MaterialRequestItemRepository.guardedIncrementIssued).not.toHaveBeenCalled();
  });

  it("issuing within the remaining quantity never requires a reason, on any request type", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 10, null, null);

    expect(MaterialRequestItemRepository.guardedIncrementIssued).toHaveBeenCalledWith({}, "line-1", 10, 10, null);
  });
});

describe("issueMaterialRequestLine — Change Warehouse override (2026-09-16)", () => {
  function baseLine(overrides: Record<string, unknown> = {}) {
    return {
      id: "line-1",
      materialId: "mat-fabric",
      requestedQuantity: "10",
      issuedQuantity: "0",
      material: {
        id: "mat-fabric",
        styleName: "Cotton Fabric",
        materialCategory: "FABRIC",
        baseUomId: "uom-1",
        baseUom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 },
      },
      uom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 },
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-request", status: "OPEN" },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(WarehouseRepository.findMany).mockReset().mockResolvedValue([{ id: "wh-alt", name: "Alt Warehouse" }] as never);
  });

  it("checks and decrements stock at the alternate warehouse, not the request's own, when issueWarehouseId is given", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, null, undefined, "wh-alt");

    expect(getAvailableQuantity).toHaveBeenCalledWith("co-1", "mat-fabric", "wh-alt");
    expect(recordInventoryTransaction).toHaveBeenCalledWith({}, actor, expect.objectContaining({ warehouseId: "wh-alt" }));
  });

  it("accepts a fabric roll that physically sits at the alternate warehouse, not the request's own", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue({
      id: "roll-alt",
      status: "IN_STOCK",
      remainingQuantity: "50",
      goodsReceiptItem: { productId: "mat-fabric", warehouseId: "wh-alt" },
    } as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, "roll-alt", undefined, "wh-alt");

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      {},
      actor,
      expect.objectContaining({ warehouseId: "wh-alt", fabricRollId: "roll-alt" })
    );
  });

  it("rejects a roll that sits at the request's own warehouse when a different warehouse was chosen", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue({
      id: "roll-request",
      status: "IN_STOCK",
      remainingQuantity: "50",
      goodsReceiptItem: { productId: "mat-fabric", warehouseId: "wh-request" },
    } as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, "roll-request", undefined, "wh-alt")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(FabricRollRepository.guardedDecrementRemaining).not.toHaveBeenCalled();
  });

  it("records the line's own unit code alongside the issued quantity in the audit log", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    const { writeAuditLog } = await import("@/core/audit/AuditLogger");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(
      baseLine({ uom: { id: "uom-1", code: "KG", baseUnitId: null, conversionFactor: 1 } }) as never
    );
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, null);

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ newValues: expect.objectContaining({ issuedQuantity: 5, uomCode: "KG" }) })
    );
  });

  it("records issuedFromWarehouseId/Name in the audit log only when it actually differs from the request's own", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    const { writeAuditLog } = await import("@/core/audit/AuditLogger");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(baseLine() as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await issueMaterialRequestLine(actor, "line-1", 5, null, null, undefined, "wh-alt");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValues: expect.objectContaining({ issuedFromWarehouseId: "wh-alt", issuedFromWarehouseName: "Alt Warehouse" }),
      })
    );

    vi.mocked(writeAuditLog).mockClear();
    await issueMaterialRequestLine(actor, "line-1", 5, null, null, undefined, "wh-request");
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        newValues: expect.not.objectContaining({ issuedFromWarehouseId: expect.anything(), issuedFromWarehouseName: expect.anything() }),
      })
    );
  });
});

describe("createMaterialRequest — Additional/Damage approval gate (Phase 7)", () => {
  it("creates a DAMAGE_REPLACEMENT request with approvalStatus PENDING", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ id: "mr-orig" } as never);

    await createMaterialRequest(actor, {
      requestType: "DAMAGE_REPLACEMENT",
      warehouseId: "wh-1",
      originalMaterialRequestId: "mr-orig",
      lines: [{ materialId: "mat-1", uomId: "uom-1", requestedQuantity: 5 }],
    } as never);

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: "PENDING" }));
  });

  it("leaves approvalStatus null for an ordinary PRODUCTION_REQUIREMENT request — no approval gate at all", async () => {
    await createMaterialRequest(actor, {
      requestType: "PRODUCTION_REQUIREMENT",
      warehouseId: "wh-1",
      lines: [{ materialId: "mat-1", uomId: "uom-1", requestedQuantity: 5 }],
    } as never);

    expect(MaterialRequestRepository.createWithLines).toHaveBeenCalledWith(expect.objectContaining({ approvalStatus: null }));
  });
});

describe("approveMaterialRequest / rejectMaterialRequest (Phase 7)", () => {
  const pendingRequest = { id: "mr-1", companyId: "co-1", approvalStatus: "PENDING", requestedByUserId: "user-2", requestType: "DAMAGE_REPLACEMENT" };

  it("approves a PENDING request, self-approval-guarded against the ORIGINAL requester", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue(pendingRequest as never);

    await approveMaterialRequest(actor, "mr-1", { approvalRemark: "Confirmed damage on the floor" });

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "production", "approve", { createdBy: "user-2" });
    expect(MaterialRequestRepository.decideApproval).toHaveBeenCalledWith(
      "mr-1",
      expect.objectContaining({ approvalStatus: "APPROVED", approvedByUserId: "user-1" })
    );
  });

  it("rejects deciding a request that has no approval gate at all (a PRODUCTION_REQUIREMENT request)", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ ...pendingRequest, approvalStatus: null } as never);
    await expect(approveMaterialRequest(actor, "mr-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects deciding an already-decided request", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue({ ...pendingRequest, approvalStatus: "APPROVED" } as never);
    await expect(approveMaterialRequest(actor, "mr-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("surfaces a clean error when a concurrent decision wins the race", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue(pendingRequest as never);
    vi.mocked(MaterialRequestRepository.decideApproval).mockResolvedValue({ count: 0 } as never);
    await expect(approveMaterialRequest(actor, "mr-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a PENDING request via rejectMaterialRequest", async () => {
    vi.mocked(MaterialRequestRepository.findAnyById).mockResolvedValue(pendingRequest as never);
    await rejectMaterialRequest(actor, "mr-1", { approvalRemark: "Not a genuine shortage" });
    expect(MaterialRequestRepository.decideApproval).toHaveBeenCalledWith("mr-1", expect.objectContaining({ approvalStatus: "REJECTED" }));
  });
});

describe("issueMaterialRequestLine — Additional/Damage approval gate (Phase 7)", () => {
  function damageLine(approvalStatus: string | null) {
    return {
      id: "line-1",
      materialId: "mat-1",
      requestedQuantity: "10",
      issuedQuantity: "0",
      material: { id: "mat-1", styleName: "Plastic Buttons", materialCategory: "BUTTONS", baseUomId: "uom-1", baseUom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 } },
      uom: { id: "uom-1", baseUnitId: null, conversionFactor: 1 },
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "OPEN", requestType: "DAMAGE_REPLACEMENT", approvalStatus },
    };
  }

  it("blocks issuing against a still-PENDING damage request", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(damageLine("PENDING") as never);
    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, null)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(MaterialRequestItemRepository.guardedIncrementIssued).not.toHaveBeenCalled();
  });

  it("blocks issuing against a REJECTED damage request", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(damageLine("REJECTED") as never);
    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, null)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("allows issuing once the damage request is genuinely APPROVED", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(damageLine("APPROVED") as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, null)).resolves.toBeDefined();
  });

  it("never blocks an ordinary PRODUCTION_REQUIREMENT line — the gate is a no-op there (approvalStatus is always null)", async () => {
    const { getAvailableQuantity } = await import("./inventory.service");
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      ...damageLine(null),
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "OPEN", requestType: "PRODUCTION_REQUIREMENT", approvalStatus: null },
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(20 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialRequestItemRepository.findById).mockResolvedValue({ id: "line-1" } as never);

    await expect(issueMaterialRequestLine(actor, "line-1", 5, null, null)).resolves.toBeDefined();
  });
});

describe("issueSubstituteMaterial — Material Substitution inventory issue integration (Phase 6)", () => {
  const uom = { id: "uom-mtr", code: "MTR", name: "Metre", baseUnitId: null, conversionFactor: 1 };

  function approvedSubstitution(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub-1",
      companyId: "co-1",
      materialRequestItemId: "line-1",
      status: "APPROVED",
      inventoryTransactionId: null,
      substituteMaterialId: "light-blue-fabric",
      quantity: 40,
      uom,
      substituteMaterial: { id: "light-blue-fabric", styleName: "Light Blue Fabric" },
      ...overrides,
    };
  }

  function issuableLine(overrides: Record<string, unknown> = {}) {
    return {
      id: "line-1",
      materialId: "green-fabric",
      requestedQuantity: 100,
      material: { styleName: "Green Fabric", baseUom: uom },
      materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "PARTIALLY_FULFILLED" },
      ...overrides,
    };
  }

  it("posts the InventoryTransaction against the SUBSTITUTE material, never the original — the spec's own worked example", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(issuableLine() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "light-blue-fabric", styleName: "Light Blue Fabric", baseUom: uom } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);
    vi.mocked(MaterialSubstitutionRepository.setInventoryTransactionInTx).mockResolvedValue({} as never);

    await issueSubstituteMaterial(actor, "sub-1");

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      {},
      actor,
      expect.objectContaining({ productId: "light-blue-fabric", quantity: -40, transactionType: "MATERIAL_ISSUE" })
    );
    expect(MaterialSubstitutionRepository.setInventoryTransactionInTx).toHaveBeenCalledWith({}, "sub-1", "txn-1");
  });

  it("advances the LINE's own issuedQuantity accumulator (never Green's own stock) by the substitution's quantity", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(issuableLine() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "light-blue-fabric", styleName: "Light Blue Fabric", baseUom: uom } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);

    await issueSubstituteMaterial(actor, "sub-1");

    expect(MaterialRequestItemRepository.guardedIncrementIssued).toHaveBeenCalledWith({}, "line-1", 100, 40, undefined);
  });

  it("rejects issuing a still-PENDING substitution", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution({ status: "PENDING" }) as never);
    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects issuing a substitution that's already been issued once", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution({ inventoryTransactionId: "txn-old" }) as never);
    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects when the substitute material's stock at the warehouse is insufficient — never touches the original material's own balance", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(issuableLine() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "light-blue-fabric", styleName: "Light Blue Fabric", baseUom: uom } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(10 as never); // only 10 of the 40 needed

    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "INSUFFICIENT_RAW_MATERIAL_STOCK" });
    expect(getAvailableQuantity).toHaveBeenCalledWith("co-1", "light-blue-fabric", "wh-1");
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the underlying request is CANCELLED/CLOSED/ON_HOLD", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(
      issuableLine({ materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "CLOSED" } }) as never
    );
    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects substituting against a DAMAGE_REPLACEMENT request that's still pending approval — Phase 7's gate applies here too", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(
      issuableLine({
        materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "PARTIALLY_FULFILLED", requestType: "DAMAGE_REPLACEMENT", approvalStatus: "PENDING" },
      }) as never
    );
    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the substitution doesn't exist for this company", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(null);
    await expect(issueSubstituteMaterial(actor, "sub-missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("surfaces a clean error when a concurrent issue on the same line wins the race", async () => {
    vi.mocked(MaterialSubstitutionRepository.findById).mockResolvedValue(approvedSubstitution() as never);
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(issuableLine() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "light-blue-fabric", styleName: "Light Blue Fabric", baseUom: uom } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(100 as never);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 0 } as never);

    await expect(issueSubstituteMaterial(actor, "sub-1")).rejects.toMatchObject({ code: "OVER_ISSUE_NOT_ALLOWED" });
  });
});

describe("getAvailableRollsForLine", () => {
  it("returns the color/shade breakdown for the line's material at its request's warehouse", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-fabric",
      colorId: null,
      materialRequest: { companyId: "co-1", warehouseId: "wh-1" },
    } as never);
    vi.mocked(FabricRollRepository.findAvailableForMaterial).mockResolvedValue([
      { id: "roll-1", rollNumber: "R-1", remainingQuantity: "50", dye: { id: "dye-1", name: "Navy Blue", pantone: "19-4030" }, goodsReceiptItem: { purchaseOrderItem: { color: { id: "col-navy", name: "Navy Blue" } } } },
      { id: "roll-2", rollNumber: "R-2", remainingQuantity: "30", dye: null, goodsReceiptItem: { purchaseOrderItem: null } },
    ] as never);

    const rolls = await getAvailableRollsForLine(actor, "line-1");

    expect(FabricRollRepository.findAvailableForMaterial).toHaveBeenCalledWith("co-1", "mat-fabric", "wh-1", null);
    expect(rolls).toEqual([
      { id: "roll-1", rollNumber: "R-1", remainingQuantity: "50", color: { id: "col-navy", name: "Navy Blue" }, dye: { id: "dye-1", name: "Navy Blue", pantone: "19-4030" } },
      { id: "roll-2", rollNumber: "R-2", remainingQuantity: "30", color: null, dye: null },
    ]);
  });

  // Colour-wise stock (2026-10-21): a coloured line lists only rolls received in its colour.
  it("lists only rolls of the line's own colour", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-fabric",
      colorId: "col-black",
      materialRequest: { companyId: "co-1", warehouseId: "wh-1" },
    } as never);
    vi.mocked(FabricRollRepository.findAvailableForMaterial).mockResolvedValue([] as never);

    await getAvailableRollsForLine(actor, "line-1");

    expect(FabricRollRepository.findAvailableForMaterial).toHaveBeenCalledWith("co-1", "mat-fabric", "wh-1", "col-black");
  });

  it("rejects a line that doesn't belong to this company", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-fabric",
      materialRequest: { companyId: "some-other-co", warehouseId: "wh-1" },
    } as never);

    await expect(getAvailableRollsForLine(actor, "line-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getOtherWarehouseStockForLine", () => {
  it("returns a color/shade-wise breakdown for a FABRIC material, excluding the request's own warehouse", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-fabric",
      material: { materialCategory: "FABRIC" },
      materialRequest: { companyId: "co-1", warehouseId: "wh-request" },
    } as never);
    vi.mocked(StockBalanceRepository.findMany).mockResolvedValue([
      { warehouseId: "wh-other", quantityOnHand: "100" },
    ] as never);
    vi.mocked(WarehouseRepository.findMany).mockResolvedValue([{ id: "wh-other", name: "Dharam Colony" }] as never);
    vi.mocked(FabricRollRepository.findAvailableAcrossWarehousesForMaterial).mockResolvedValue([
      {
        id: "roll-1",
        rollNumber: "R-1",
        remainingQuantity: "60",
        dye: { name: "Navy Blue", pantone: "19-4030" },
        gsm: { name: "150 GSM" },
        composition: { name: "100% Cotton" },
        goodsReceiptItem: { warehouseId: "wh-other" },
      },
      // A roll sitting at the request's OWN warehouse must never leak into
      // this "other warehouses" breakdown.
      {
        id: "roll-2",
        rollNumber: "R-2",
        remainingQuantity: "5",
        dye: null,
        gsm: null,
        composition: null,
        goodsReceiptItem: { warehouseId: "wh-request" },
      },
    ] as never);

    const result = await getOtherWarehouseStockForLine(actor, "line-1");

    expect(StockBalanceRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "mat-fabric", warehouseId: { not: "wh-request" } }),
      {}
    );
    expect(result).toEqual([
      {
        warehouseId: "wh-other",
        warehouseName: "Dharam Colony",
        totalQuantity: 100,
        rolls: [
          {
            id: "roll-1",
            rollNumber: "R-1",
            remainingQuantity: 60,
            dye: { name: "Navy Blue", pantone: "19-4030" },
            gsm: { name: "150 GSM" },
            composition: { name: "100% Cotton" },
          },
        ],
      },
    ]);
  });

  it("skips the roll lookup entirely for a non-FABRIC material", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-trim",
      material: { materialCategory: "TRIMS" },
      materialRequest: { companyId: "co-1", warehouseId: "wh-request" },
    } as never);
    vi.mocked(StockBalanceRepository.findMany).mockResolvedValue([{ warehouseId: "wh-other", quantityOnHand: "20" }] as never);
    vi.mocked(WarehouseRepository.findMany).mockResolvedValue([{ id: "wh-other", name: "Dharam Colony" }] as never);

    const result = await getOtherWarehouseStockForLine(actor, "line-1");

    expect(FabricRollRepository.findAvailableAcrossWarehousesForMaterial).not.toHaveBeenCalled();
    expect(result).toEqual([{ warehouseId: "wh-other", warehouseName: "Dharam Colony", totalQuantity: 20, rolls: [] }]);
  });

  it("rejects a line that doesn't belong to this company", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialId: "mat-fabric",
      material: { materialCategory: "FABRIC" },
      materialRequest: { companyId: "some-other-co", warehouseId: "wh-request" },
    } as never);

    await expect(getOtherWarehouseStockForLine(actor, "line-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(MaterialRequestRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(MaterialRequestRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listMaterialRequests adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listMaterialRequests(actor, listQuery);

    const whereArg = vi.mocked(MaterialRequestRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listMaterialRequests adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listMaterialRequests(actor, listQuery);

    expect(MaterialRequestRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getMaterialRequestById throws NOT_FOUND for a request outside the user's allowed branches", async () => {
    vi.mocked(MaterialRequestRepository.findByIdWithDetails).mockResolvedValue({
      id: "mr-1",
      branchId: "branch-2",
      warehouseId: "wh-1",
      lines: [],
    } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getMaterialRequestById(actor, "mr-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getMaterialRequestById succeeds for a request inside the user's allowed branches", async () => {
    vi.mocked(MaterialRequestRepository.findByIdWithDetails).mockResolvedValue({
      id: "mr-1",
      branchId: "branch-1",
      warehouseId: "wh-1",
      lines: [],
    } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getMaterialRequestById(actor, "mr-1");
    expect(result.id).toBe("mr-1");
  });
});

// Colour-wise stock (2026-10-21): a coloured line issues only its colour; the
// substitute can be the same material in another colour.
describe("colour-wise issue", () => {
  const coloredLine = {
    id: "line-1",
    materialId: "mat-linen",
    colorId: "col-green",
    color: { id: "col-green", name: "Green" },
    dyeId: null,
    uomId: "uom-mtr",
    requestedQuantity: 10.5,
    issuedQuantity: 0,
    uom: { id: "uom-mtr", code: "MTR", baseUnitId: null, conversionFactor: 1 },
    material: { id: "mat-linen", styleName: "Linen", materialCategory: "FABRIC", baseUomId: "uom-mtr", baseUom: { id: "uom-mtr", baseUnitId: null, conversionFactor: 1 } },
    materialRequest: { id: "mr-1", companyId: "co-1", warehouseId: "wh-1", status: "OPEN", requestType: "PRODUCTION_REQUIREMENT", approvalStatus: null },
  };

  it("refuses to issue a Green line when only uncoloured stock exists, pointing to Substitute", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(coloredLine as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(96.5);
    vi.mocked(getAvailableQuantityByColor).mockResolvedValue(0);

    await expect(issueMaterialRequestLine(actor, "line-1", 5)).rejects.toMatchObject({
      code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
      message: expect.stringContaining("in Green"),
    });
    expect(getAvailableQuantityByColor).toHaveBeenCalledWith("co-1", "mat-linen", "wh-1", "col-green");
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("issues a Green line from Green stock and posts the colour", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue(coloredLine as never);
    vi.mocked(getAvailableQuantityByColor).mockResolvedValue(20);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);

    await issueMaterialRequestLine(actor, "line-1", 5);

    expect(recordInventoryTransaction).toHaveBeenCalledWith(expect.anything(), actor, expect.objectContaining({ quantity: -5, colorId: "col-green" }));
  });

  it("uses fabric roll quantity when line is fabric and has colour", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      ...coloredLine,
      material: { ...coloredLine.material, materialCategory: "FABRIC" },
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);
    vi.mocked(getFabricRollAvailableQuantity).mockResolvedValue(30);
    vi.mocked(getAvailableQuantityByColor).mockResolvedValue(0);
    vi.mocked(MaterialRequestItemRepository.guardedIncrementIssued).mockResolvedValue({ count: 1 } as never);

    await issueMaterialRequestLine(actor, "line-1", 5);

    expect(getFabricRollAvailableQuantity).toHaveBeenCalledWith("co-1", "mat-linen", "wh-1", "col-green", null);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(expect.anything(), actor, expect.objectContaining({ quantity: -5, colorId: "col-green" }));
  });
});

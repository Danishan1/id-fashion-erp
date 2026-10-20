import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/modules/bom-mrp/bom.repository", () => ({ BomRepository: { findByProductId: vi.fn() } }));
vi.mock("./material-request-scope", () => ({
  materialRequestScopeForOrder: vi.fn(async (companyId: string, productionOrderId: string) => ({ companyId, OR: [{ productionOrderId }] })),
}));
vi.mock("@/modules/bom-mrp/mrp.service", () => ({ getMaterialRequirementForOrderLine: vi.fn() }));
vi.mock("./production-progress.service", () => ({ getProductionOrderProgress: vi.fn() }));
vi.mock("./dispatch-readiness.service", () => ({
  attachDispatchReadiness: vi.fn(async (_companyId: string, orders: Array<Record<string, unknown>>) =>
    orders.map((o) => ({ ...o, dispatchReadiness: null, producedQuantity: 0 }))
  ),
}));
vi.mock("@/modules/inventory/material-request.service", () => ({ createMaterialRequest: vi.fn() }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findStyleById: vi.fn() } }));
vi.mock("./production.repository", () => ({
  LotRepository: { findByProductionOrderId: vi.fn() },
  ProductionOrderRepository: {
    create: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    update: vi.fn(),
    updateStatusInTx: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
}));
const mockTx = vi.hoisted(() => ({
  productionOrder: { updateMany: vi.fn() },
  productionOrderQuantityChange: { create: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)),
    salesOrderItem: { findFirst: vi.fn() },
    productionOrder: { aggregate: vi.fn(), findFirst: vi.fn() },
    productionOrderQuantityChange: { findMany: vi.fn() },
    materialRequestItem: { findMany: vi.fn() },
    inventoryTransaction: { groupBy: vi.fn() },
    product: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { getAllowedBranchIds: vi.fn(), can: vi.fn().mockResolvedValue(true) } }));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { getMaterialRequirementForOrderLine } = await import("@/modules/bom-mrp/mrp.service");
const { getProductionOrderProgress } = await import("./production-progress.service");
const { createMaterialRequest } = await import("@/modules/inventory/material-request.service");
const { LotRepository, ProductionOrderRepository } = await import("./production.repository");
const { prisma } = await import("@/core/db/client");
const {
  createProductionOrder,
  generateMaterialRequestForOrder,
  getSalesOrderLineCommitment,
  getProductionOrderById,
  updateProductionOrderQuantity,
  addExtraProductionQuantity,
  listProductionOrders,
  getProductionOrderMaterialComparison,
  releaseProductionOrderToDispatch,
  revokeProductionOrderDispatchRelease,
} = await import("./production-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "prod-1" } as never);
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("PROD-2026-00001");
  vi.mocked(ProductionOrderRepository.create).mockReset().mockResolvedValue({ id: "po-1" } as never);
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset();
  vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(ProductionOrderRepository.update).mockReset().mockResolvedValue({ id: "po-1" } as never);
  vi.mocked(LotRepository.findByProductionOrderId).mockReset().mockResolvedValue([] as never);
  vi.mocked(prisma.salesOrderItem.findFirst).mockReset();
  vi.mocked(prisma.productionOrder.aggregate).mockReset().mockResolvedValue({ _sum: { plannedQuantity: null } } as never);
  vi.mocked(getProductionOrderProgress).mockReset().mockResolvedValue({ progressStatus: "PLANNED" } as never);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(getMaterialRequirementForOrderLine).mockReset();
  vi.mocked(prisma.materialRequestItem.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.inventoryTransaction.groupBy).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.product.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.productionOrder.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.productionOrderQuantityChange.findMany).mockReset().mockResolvedValue([]);
  mockTx.productionOrder.updateMany.mockReset().mockResolvedValue({ count: 1 });
  mockTx.productionOrderQuantityChange.create.mockReset().mockResolvedValue({ id: "chg-1" });
});

describe("duplicate production order for the same Sale Order line (2026-09-29)", () => {
  it("refuses a second production order and names the existing one", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-existing", orderNumber: "PROD-2026-00016", status: "IN_PROGRESS" } as never);

    await expect(
      createProductionOrder(actor, { productId: "prod-1", salesOrderItemId: "soi-1", plannedQuantity: 50, priority: "NORMAL" } as never)
    ).rejects.toMatchObject({
      code: "PRODUCTION_ORDER_EXISTS",
      details: { existingProductionOrderId: "po-existing", existingOrderNumber: "PROD-2026-00016" },
    });
    expect(ProductionOrderRepository.create).not.toHaveBeenCalled();
  });
});

describe("addExtraProductionQuantity (2026-09-29)", () => {
  const order = { id: "po-1", status: "IN_PROGRESS", plannedQuantity: "100" };

  it("blocks extra production while the assigned quantity isn't fully processed", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ plannedQuantity: 100, producedQuantity: 80, rejectedQuantity: 0 } as never);

    await expect(addExtraProductionQuantity(actor, "po-1", { extraQuantity: 20 })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      message: expect.stringContaining("Completed quantity is not equal to assigned quantity"),
    });
    expect(mockTx.productionOrder.updateMany).not.toHaveBeenCalled();
  });

  it("adds the extra quantity once everything assigned is processed, and records the change", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ plannedQuantity: 100, producedQuantity: 100, rejectedQuantity: 0 } as never);

    await addExtraProductionQuantity(actor, "po-1", { extraQuantity: 20, reason: "Buyer top-up" });

    expect(mockTx.productionOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "po-1", plannedQuantity: "100" }), data: { plannedQuantity: 120 } })
    );
    expect(mockTx.productionOrderQuantityChange.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changeType: "EXTRA_PRODUCTION", previousQuantity: 100, addedQuantity: 20, newQuantity: 120, reason: "Buyer top-up" }),
    });
  });

  it("counts rejected/damaged pieces as processed (they were worked, just not good)", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ plannedQuantity: 100, producedQuantity: 95, rejectedQuantity: 5 } as never);

    await addExtraProductionQuantity(actor, "po-1", { extraQuantity: 5 });
    expect(mockTx.productionOrderQuantityChange.create).toHaveBeenCalled();
  });

  it("reopens a CLOSED order when extra quantity is added", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ ...order, status: "CLOSED" } as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ plannedQuantity: 100, producedQuantity: 100, rejectedQuantity: 0 } as never);

    await addExtraProductionQuantity(actor, "po-1", { extraQuantity: 10 });
    expect(mockTx.productionOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { plannedQuantity: 110, status: "IN_PROGRESS", actualEndDate: null } })
    );
  });

  it("fails cleanly when someone else changed the quantity at the same moment", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ plannedQuantity: 100, producedQuantity: 100, rejectedQuantity: 0 } as never);
    mockTx.productionOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(addExtraProductionQuantity(actor, "po-1", { extraQuantity: 10 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(mockTx.productionOrderQuantityChange.create).not.toHaveBeenCalled();
  });

  it("refuses a cancelled order", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ ...order, status: "CANCELLED" } as never);
    await expect(addExtraProductionQuantity(actor, "po-1", { extraQuantity: 10 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("createProductionOrder", () => {
  it("allows Make-to-Stock (no salesOrderItemId) with no cap at all", async () => {
    const order = await createProductionOrder(actor, { productId: "prod-1", plannedQuantity: 999999, priority: "NORMAL" } as never);
    expect(ProductionOrderRepository.create).toHaveBeenCalled();
    expect(prisma.salesOrderItem.findFirst).not.toHaveBeenCalled();
    expect(order.salesOrderContext).toBeNull();
  });

  it("allows planning MORE than the Sales Order line's ordered quantity, returning informational context instead of rejecting", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 5 }],
    } as never);

    const order = await createProductionOrder(actor, {
      salesOrderItemId: "soi-1",
      productId: "prod-1",
      plannedQuantity: 500,
      priority: "NORMAL",
    } as never);

    expect(ProductionOrderRepository.create).toHaveBeenCalled();
    expect(order.salesOrderContext).toEqual({ orderedTotal: 5, otherCommitted: 0, remaining: 5 });
  });

  it("allows planning LESS than the Sales Order line's ordered quantity", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 100 }],
    } as never);
    vi.mocked(prisma.productionOrder.aggregate).mockResolvedValue({ _sum: { plannedQuantity: 60 } } as never);

    const order = await createProductionOrder(actor, {
      salesOrderItemId: "soi-1",
      productId: "prod-1",
      plannedQuantity: 5,
      priority: "NORMAL",
    } as never);

    expect(ProductionOrderRepository.create).toHaveBeenCalled();
    expect(order.salesOrderContext).toEqual({ orderedTotal: 100, otherCommitted: 60, remaining: 40 });
  });

  it("rejects a Sales Order line that doesn't exist or belongs to another company", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue(null);

    await expect(
      createProductionOrder(actor, { salesOrderItemId: "soi-missing", productId: "prod-1", plannedQuantity: 10, priority: "NORMAL" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getSalesOrderLineCommitment", () => {
  it("excludes the given production order id from the committed sum", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 100 }],
    } as never);
    vi.mocked(prisma.productionOrder.aggregate).mockResolvedValue({ _sum: { plannedQuantity: 30 } } as never);

    const result = await getSalesOrderLineCommitment("co-1", "soi-1", "po-self");

    expect(prisma.productionOrder.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: "po-self" } }) })
    );
    expect(result).toEqual({ orderedTotal: 100, otherCommitted: 30, remaining: 70 });
  });
});

describe("getProductionOrderById", () => {
  it("attaches salesOrderContext when a Sales Order line is linked", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      salesOrderItemId: "soi-1",
    } as never);
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 100 }],
    } as never);
    vi.mocked(prisma.productionOrder.aggregate).mockResolvedValue({ _sum: { plannedQuantity: 20 } } as never);

    const order = await getProductionOrderById(actor, "po-1");

    expect(order.salesOrderContext).toEqual({ orderedTotal: 100, otherCommitted: 20, remaining: 80 });
  });

  it("returns null salesOrderContext for a Make-to-Stock order", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", salesOrderItemId: null } as never);

    const order = await getProductionOrderById(actor, "po-1");

    expect(order.salesOrderContext).toBeNull();
    expect(prisma.salesOrderItem.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a production order that doesn't exist", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(getProductionOrderById(actor, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("attaches the derived progress summary", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", salesOrderItemId: null } as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ progressStatus: "IN_PRODUCTION", producedQuantity: 40 } as never);

    const order = await getProductionOrderById(actor, "po-1");

    expect(getProductionOrderProgress).toHaveBeenCalledWith("co-1", "po-1");
    expect(order.progress).toEqual({ progressStatus: "IN_PRODUCTION", producedQuantity: 40 });
  });
});

describe("updateProductionOrderQuantity", () => {
  it("updates plannedQuantity while PLANNED and no lots exist", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "PLANNED", plannedQuantity: 100 } as never);
    vi.mocked(LotRepository.findByProductionOrderId).mockResolvedValue([] as never);

    await updateProductionOrderQuantity(actor, "po-1", 250);

    expect(ProductionOrderRepository.update).toHaveBeenCalledWith("po-1", { plannedQuantity: 250 });
  });

  it("rejects once any lot exists", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "PLANNED", plannedQuantity: 100 } as never);
    vi.mocked(LotRepository.findByProductionOrderId).mockResolvedValue([{ id: "lot-1" }] as never);

    await expect(updateProductionOrderQuantity(actor, "po-1", 250)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(ProductionOrderRepository.update).not.toHaveBeenCalled();
  });

  it("rejects once status is IN_PROGRESS or beyond", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "IN_PROGRESS", plannedQuantity: 100 } as never);
    vi.mocked(LotRepository.findByProductionOrderId).mockResolvedValue([] as never);

    await expect(updateProductionOrderQuantity(actor, "po-1", 250)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a production order that doesn't exist", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(null);
    await expect(updateProductionOrderQuantity(actor, "missing", 250)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("generateMaterialRequestForOrder", () => {
  beforeEach(() => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1", plannedQuantity: 100 } as never);
    vi.mocked(createMaterialRequest).mockReset().mockResolvedValue({ id: "mr-1" } as never);
  });

  it("rejects when the style has no approved BOM", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: false,
      bomId: null,
      sampleRequestId: null,
      materials: [],
    } as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(createMaterialRequest).not.toHaveBeenCalled();
  });

  it("names the linked sample (not the Style/BOM) as the rejection cause when a sample-sourced requirement has no materials", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: false,
      bomId: null,
      sampleRequestId: "sam-1",
      materials: [],
    } as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("linked sample"),
    });
  });

  it("rejects when this order's existing requests already cover everything it needs", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      sampleRequestId: null,
      materials: [{ materialId: "mat-1", uomId: "uom-1", neededQuantity: 40, shortfallQuantity: 0 }],
      unconvertibleLines: [],
    } as never);
    const U = { id: "uom-1", baseUnitId: null, conversionFactor: "1" };
    vi.mocked(prisma.materialRequestItem.findMany).mockResolvedValue([
      { materialId: "mat-1", requestedQuantity: "40", uom: U, material: { baseUom: U } },
    ] as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("already cover everything"),
    });
  });

  it("requests the full need even when stock already covers it (the store issues from stock)", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      sampleRequestId: null,
      materials: [{ materialId: "mat-1", uomId: "uom-1", neededQuantity: 25, availableQuantity: 100, shortfallQuantity: 0 }],
      unconvertibleLines: [],
    } as never);

    await generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" });
    expect(createMaterialRequest).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ lines: [{ materialId: "mat-1", uomId: "uom-1", requestedQuantity: 25 }] })
    );
  });

  it("names a unit-conversion problem instead of silently raising nothing", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      sampleRequestId: null,
      materials: [],
      unconvertibleLines: [{ materialId: "mat-1", materialName: "Cotton Lycra", reason: '"Kilogram" has no fixed conversion to its base unit' }],
    } as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "UOM_CONVERSION_UNAVAILABLE",
      message: expect.stringContaining("Cotton Lycra"),
    });
  });

  it("raises a Material Request for need minus what's already requested, using the shared calc's own bomId/uomId", async () => {
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      sampleRequestId: null,
      materials: [
        { materialId: "mat-1", uomId: "uom-1", neededQuantity: 50, shortfallQuantity: 40 },
        { materialId: "mat-2", uomId: "uom-2", neededQuantity: 8, shortfallQuantity: 0 },
      ],
      unconvertibleLines: [],
    } as never);
    const U1 = { id: "uom-1", baseUnitId: null, conversionFactor: "1" };
    const U2 = { id: "uom-2", baseUnitId: null, conversionFactor: "1" };
    vi.mocked(prisma.materialRequestItem.findMany).mockResolvedValue([
      { materialId: "mat-1", requestedQuantity: "10", uom: U1, material: { baseUom: U1 } },
      { materialId: "mat-2", requestedQuantity: "8", uom: U2, material: { baseUom: U2 } },
    ] as never);

    await generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" });

    expect(getMaterialRequirementForOrderLine).toHaveBeenCalledWith("co-1", {
      salesOrderItemId: undefined,
      productId: "prod-1",
      quantity: 100,
    });
    expect(createMaterialRequest).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        bomId: "bom-1",
        productionOrderId: "po-1",
        lines: [{ materialId: "mat-1", uomId: "uom-1", requestedQuantity: 40 }], // 50 needed − 10 already requested
      })
    );
  });

  it("passes this order's own linked salesOrderItemId through, so the shared calc can resolve a linked Sample", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      productId: "prod-1",
      plannedQuantity: 100,
      salesOrderItemId: "soi-1",
    } as never);
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      hasApprovedBom: true,
      bomId: null,
      sampleRequestId: "sam-1",
      materials: [{ materialId: "mat-1", uomId: "uom-1", neededQuantity: 40, shortfallQuantity: 40 }],
      unconvertibleLines: [],
    } as never);

    await generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" });

    expect(getMaterialRequirementForOrderLine).toHaveBeenCalledWith("co-1", {
      salesOrderItemId: "soi-1",
      productId: "prod-1",
      quantity: 100,
    });
    // A sample-sourced requirement has no real Bom row — bomId must pass
    // through as undefined (createMaterialRequest's own schema field), never
    // a stray non-null-asserted null.
    expect(createMaterialRequest).toHaveBeenCalledWith(actor, expect.objectContaining({ bomId: undefined }));
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(ProductionOrderRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(ProductionOrderRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listProductionOrders limits an assigned-only worker to orders carrying their own assignment (P1)", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);
    vi.mocked(PermissionService.can).mockResolvedValueOnce(false);
    const { prisma } = await import("@/core/db/client");
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ employeeId: "emp-1" } as never);

    await listProductionOrders(actor, listQuery);

    const whereArg = vi.mocked(ProductionOrderRepository.findMany).mock.calls[0][0];
    expect(whereArg).toMatchObject({
      lots: { some: { jobOrders: { some: { assignments: { some: { employeeId: "emp-1" } } } } } },
    });
  });

  it("listProductionOrders adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listProductionOrders(actor, listQuery);

    const whereArg = vi.mocked(ProductionOrderRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listProductionOrders adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listProductionOrders(actor, listQuery);

    expect(ProductionOrderRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getProductionOrderById succeeds for an order inside the user's allowed branches", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      branchId: "branch-1",
      salesOrderItemId: null,
    } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const order = await getProductionOrderById(actor, "po-1");
    expect(order.id).toBe("po-1");
  });

  it("getProductionOrderById throws NOT_FOUND for an order outside the user's allowed branches", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "po-1",
      branchId: "branch-2",
      salesOrderItemId: null,
    } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getProductionOrderById(actor, "po-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getProductionOrderMaterialComparison — Planned vs Issued (Phase 8)", () => {
  it("matches the spec's own worked example: Green Fabric Planned 100/Issued 60, Light Blue Planned 0/Issued 40 (a substitute never in the plan)", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      productId: "style-1",
      plannedQuantity: "50",
      salesOrderItemId: "soi-1",
    } as never);
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      materials: [{ materialId: "green-fabric", materialName: "Green Fabric", materialCode: "GF", uomCode: "MTR", neededQuantity: 100 }],
    } as never);
    vi.mocked(prisma.materialRequestItem.findMany).mockResolvedValue([{ id: "mri-1" }, { id: "mri-2" }] as never);
    vi.mocked(prisma.inventoryTransaction.groupBy).mockResolvedValue([
      { productId: "green-fabric", _sum: { quantity: -60 } },
      { productId: "light-blue-fabric", _sum: { quantity: -40 } },
    ] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: "light-blue-fabric", styleName: "Light Blue Fabric", styleCode: "LBF", baseUom: { code: "MTR" } },
    ] as never);

    const rows = await getProductionOrderMaterialComparison("co-1", "po-1");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ materialId: "green-fabric", plannedQuantity: 100, issuedQuantity: 60, isSubstitute: false }),
        expect.objectContaining({ materialId: "light-blue-fabric", plannedQuantity: 0, issuedQuantity: 40, isSubstitute: true }),
      ])
    );
    expect(prisma.materialRequestItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { materialRequest: { companyId: "co-1", OR: [{ productionOrderId: "po-1" }] } } })
    );
  });

  it("never modifies the Effective BOM's own planned figure just because a substitute was issued — Green stays 100 regardless", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      productId: "style-1",
      plannedQuantity: "50",
      salesOrderItemId: "soi-1",
    } as never);
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({
      materials: [{ materialId: "green-fabric", materialName: "Green Fabric", materialCode: "GF", uomCode: "MTR", neededQuantity: 100 }],
    } as never);
    vi.mocked(prisma.materialRequestItem.findMany).mockResolvedValue([{ id: "mri-1" }] as never);
    vi.mocked(prisma.inventoryTransaction.groupBy).mockResolvedValue([{ productId: "light-blue-fabric", _sum: { quantity: -40 } }] as never);
    vi.mocked(prisma.product.findMany).mockResolvedValue([
      { id: "light-blue-fabric", styleName: "Light Blue Fabric", styleCode: "LBF", baseUom: { code: "MTR" } },
    ] as never);

    const rows = await getProductionOrderMaterialComparison("co-1", "po-1");

    const green = rows.find((r) => r.materialId === "green-fabric")!;
    expect(green.plannedQuantity).toBe(100);
    expect(green.issuedQuantity).toBe(0); // nothing of the original material was actually issued in this scenario
  });

  it("returns an empty list with zero ledger queries when the order has no linked Material Requests at all", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      productId: "style-1",
      plannedQuantity: "50",
      salesOrderItemId: null,
    } as never);
    vi.mocked(getMaterialRequirementForOrderLine).mockResolvedValue({ materials: [] } as never);
    vi.mocked(prisma.materialRequestItem.findMany).mockResolvedValue([]);

    const rows = await getProductionOrderMaterialComparison("co-1", "po-1");

    expect(rows).toEqual([]);
    expect(prisma.inventoryTransaction.groupBy).not.toHaveBeenCalled();
  });

  it("rejects for an order that doesn't exist for this company", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(null);
    await expect(getProductionOrderMaterialComparison("co-1", "po-missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("releaseProductionOrderToDispatch / revokeProductionOrderDispatchRelease (2026-10-10)", () => {
  it("rejects when the production order doesn't exist for this company", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue(null);
    await expect(releaseProductionOrderToDispatch(actor, "po-missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["PLANNED", "MATERIAL_ALLOCATED", "ON_HOLD", "CANCELLED", "CLOSED"])(
    "rejects releasing an order in %s status — only IN_PROGRESS is eligible",
    async (status) => {
      vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
        id: "po-1",
        status,
        releasedToDispatchAt: null,
      } as never);

      await expect(releaseProductionOrderToDispatch(actor, "po-1")).rejects.toMatchObject({
        code: "INVALID_STATE_TRANSITION",
      });
      expect(ProductionOrderRepository.update).not.toHaveBeenCalled();
    }
  );

  it("rejects releasing an order that's already released", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      status: "IN_PROGRESS",
      releasedToDispatchAt: new Date("2026-10-01"),
    } as never);

    await expect(releaseProductionOrderToDispatch(actor, "po-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(ProductionOrderRepository.update).not.toHaveBeenCalled();
  });

  it("stamps releasedToDispatchAt/releasedToDispatchByUserId when IN_PROGRESS and not yet released", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      status: "IN_PROGRESS",
      releasedToDispatchAt: null,
    } as never);
    vi.mocked(ProductionOrderRepository.update).mockResolvedValue({
      id: "po-1",
      releasedToDispatchAt: new Date(),
    } as never);

    await releaseProductionOrderToDispatch(actor, "po-1");

    expect(ProductionOrderRepository.update).toHaveBeenCalledWith(
      "po-1",
      expect.objectContaining({ releasedToDispatchAt: expect.any(Date), releasedToDispatchByUserId: "user-1" })
    );
  });

  it("rejects revoking a release on an order that was never released", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      releasedToDispatchAt: null,
    } as never);

    await expect(revokeProductionOrderDispatchRelease(actor, "po-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
    expect(ProductionOrderRepository.update).not.toHaveBeenCalled();
  });

  it("clears both fields when revoking a real release", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      releasedToDispatchAt: new Date("2026-10-01"),
    } as never);
    vi.mocked(ProductionOrderRepository.update).mockResolvedValue({ id: "po-1", releasedToDispatchAt: null } as never);

    await revokeProductionOrderDispatchRelease(actor, "po-1");

    expect(ProductionOrderRepository.update).toHaveBeenCalledWith("po-1", {
      releasedToDispatchAt: null,
      releasedToDispatchByUserId: null,
    });
  });
});

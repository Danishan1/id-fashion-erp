import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/modules/bom-mrp/bom.repository", () => ({ BomRepository: { findByProductId: vi.fn() } }));
vi.mock("@/modules/bom-mrp/mrp.service", () => ({ getStyleMaterialRequirement: vi.fn() }));
vi.mock("./production-progress.service", () => ({ getProductionOrderProgress: vi.fn() }));
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
  },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    salesOrderItem: { findFirst: vi.fn() },
    productionOrder: { aggregate: vi.fn() },
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { getStyleMaterialRequirement } = await import("@/modules/bom-mrp/mrp.service");
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

    const order = await getProductionOrderById("co-1", "po-1");

    expect(order.salesOrderContext).toEqual({ orderedTotal: 100, otherCommitted: 20, remaining: 80 });
  });

  it("returns null salesOrderContext for a Make-to-Stock order", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", salesOrderItemId: null } as never);

    const order = await getProductionOrderById("co-1", "po-1");

    expect(order.salesOrderContext).toBeNull();
    expect(prisma.salesOrderItem.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a production order that doesn't exist", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(getProductionOrderById("co-1", "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("attaches the derived progress summary", async () => {
    vi.mocked(ProductionOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", salesOrderItemId: null } as never);
    vi.mocked(getProductionOrderProgress).mockResolvedValue({ progressStatus: "IN_PRODUCTION", producedQuantity: 40 } as never);

    const order = await getProductionOrderById("co-1", "po-1");

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
    vi.mocked(getStyleMaterialRequirement).mockResolvedValue({ hasApprovedBom: false, bomId: null, materials: [] } as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(createMaterialRequest).not.toHaveBeenCalled();
  });

  it("rejects when nothing is short", async () => {
    vi.mocked(getStyleMaterialRequirement).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      materials: [{ materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 0 }],
    } as never);

    await expect(generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("raises a Material Request for exactly the shortfall lines, using the shared calc's own bomId/uomId", async () => {
    vi.mocked(getStyleMaterialRequirement).mockResolvedValue({
      hasApprovedBom: true,
      bomId: "bom-1",
      materials: [
        { materialId: "mat-1", uomId: "uom-1", shortfallQuantity: 40 },
        { materialId: "mat-2", uomId: "uom-2", shortfallQuantity: 0 },
      ],
    } as never);

    await generateMaterialRequestForOrder(actor, "po-1", { warehouseId: "wh-1" });

    expect(getStyleMaterialRequirement).toHaveBeenCalledWith("co-1", "prod-1", 100);
    expect(createMaterialRequest).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        bomId: "bom-1",
        productionOrderId: "po-1",
        lines: [{ materialId: "mat-1", uomId: "uom-1", requestedQuantity: 40 }],
      })
    );
  });
});

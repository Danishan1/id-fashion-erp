import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/modules/bom-mrp/bom.repository", () => ({ BomRepository: { findByProductId: vi.fn() } }));
vi.mock("@/modules/inventory/inventory.service", () => ({ sumAvailableByProductIds: vi.fn() }));
vi.mock("@/modules/inventory/material-request.service", () => ({ createMaterialRequest: vi.fn() }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findStyleById: vi.fn() } }));
vi.mock("./production.repository", () => ({
  LotRepository: {},
  ProductionOrderRepository: { create: vi.fn(), findAnyById: vi.fn(), updateStatusInTx: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    salesOrderItem: { findFirst: vi.fn() },
    productionOrder: { aggregate: vi.fn() },
  },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { ProductionOrderRepository } = await import("./production.repository");
const { prisma } = await import("@/core/db/client");
const { createProductionOrder } = await import("./production-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "prod-1" } as never);
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("PROD-2026-00001");
  vi.mocked(ProductionOrderRepository.create).mockReset().mockResolvedValue({ id: "po-1" } as never);
  vi.mocked(prisma.salesOrderItem.findFirst).mockReset();
  vi.mocked(prisma.productionOrder.aggregate).mockReset().mockResolvedValue({ _sum: { plannedQuantity: null } } as never);
});

describe("createProductionOrder", () => {
  it("allows Make-to-Stock (no salesOrderItemId) with no cap at all", async () => {
    await createProductionOrder(actor, { productId: "prod-1", plannedQuantity: 999999, priority: "NORMAL" } as never);
    expect(ProductionOrderRepository.create).toHaveBeenCalled();
    expect(prisma.salesOrderItem.findFirst).not.toHaveBeenCalled();
  });

  it("rejects planning more than the Sales Order line's actual ordered quantity", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 5 }],
    } as never);

    await expect(
      createProductionOrder(actor, { salesOrderItemId: "soi-1", productId: "prod-1", plannedQuantity: 500, priority: "NORMAL" } as never)
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });
    expect(ProductionOrderRepository.create).not.toHaveBeenCalled();
  });

  it("allows planning exactly the remaining unplanned quantity once other Production Orders have committed some of it", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 100 }],
    } as never);
    vi.mocked(prisma.productionOrder.aggregate).mockResolvedValue({ _sum: { plannedQuantity: 60 } } as never);

    await createProductionOrder(actor, { salesOrderItemId: "soi-1", productId: "prod-1", plannedQuantity: 40, priority: "NORMAL" } as never);
    expect(ProductionOrderRepository.create).toHaveBeenCalled();
  });

  it("rejects a second Production Order that would exceed what's left once another already committed some of the line", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 100 }],
    } as never);
    vi.mocked(prisma.productionOrder.aggregate).mockResolvedValue({ _sum: { plannedQuantity: 60 } } as never);

    await expect(
      createProductionOrder(actor, { salesOrderItemId: "soi-1", productId: "prod-1", plannedQuantity: 41, priority: "NORMAL" } as never)
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });
  });

  it("rejects a Sales Order line that doesn't exist or belongs to another company", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue(null);

    await expect(
      createProductionOrder(actor, { salesOrderItemId: "soi-missing", productId: "prod-1", plannedQuantity: 10, priority: "NORMAL" } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

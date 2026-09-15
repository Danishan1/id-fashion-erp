import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() }, color: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/fabric-config/fabric-config.repository", () => ({
  FabricConfigRepository: { dye: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/inventory/material-request.repository", () => ({
  MaterialRequestItemRepository: { findWithRequestOwner: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("./purchase-order.repository", () => ({
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
  PurchaseOrderRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyById: vi.fn(),
    findAnyByIdWithItemPrices: vi.fn(),
    createWithItems: vi.fn(),
    update: vi.fn(),
    replaceItems: vi.fn(),
    countActiveReceipts: vi.fn(),
    countInvoicedItems: vi.fn(),
  },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { FabricConfigRepository } = await import("@/modules/fabric-config/fabric-config.repository");
const { MaterialRequestItemRepository } = await import("@/modules/inventory/material-request.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { CompanyRepository, PurchaseOrderRepository } = await import("./purchase-order.repository");
const {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  markPurchaseOrderSentToSupplier,
  closePurchaseOrder,
  transitionPurchaseOrderStatus,
  resumePurchaseOrderFromHold,
  listPurchaseOrders,
  getPurchaseOrderById,
} = await import("./purchase-order.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const BASE_UOM = { id: "uom-1", baseUnitId: null, conversionFactor: 1 };

const oneItem = (overrides: Record<string, unknown> = {}) => ({
  productId: "mat-1",
  uomId: "uom-1",
  orderedQuantity: 10,
  unitPrice: 50,
  notes: "",
  ...overrides,
});

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("PO-2026-00001");
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(SupplierRepository.findById).mockReset().mockResolvedValue({ id: "sup-1" } as never);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Test Material", baseUom: BASE_UOM } as never);
  vi.mocked(LookupRepository.unit.findUnique).mockReset();
  vi.mocked(LookupRepository.color.findFirst).mockReset();
  vi.mocked(FabricConfigRepository.dye.findFirst).mockReset();
  vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockReset();
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset().mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(PurchaseOrderRepository.createWithItems).mockReset().mockResolvedValue({ id: "po-1", items: [] } as never);
  vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(PurchaseOrderRepository.findAnyById).mockReset();
  vi.mocked(PurchaseOrderRepository.findAnyByIdWithItemPrices).mockReset();
  vi.mocked(PurchaseOrderRepository.update).mockReset();
  vi.mocked(PurchaseOrderRepository.replaceItems).mockReset();
  vi.mocked(PurchaseOrderRepository.countActiveReceipts).mockReset().mockResolvedValue(0);
  vi.mocked(PurchaseOrderRepository.countInvoicedItems).mockReset().mockResolvedValue(0);
});

describe("createPurchaseOrder", () => {
  it("rejects when the supplier doesn't exist", async () => {
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);
    await expect(createPurchaseOrder(actor, { supplierId: "sup-x", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a line whose material has no base unit configured", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "mat-1", styleName: "Test Material", baseUom: null } as never);
    await expect(
      createPurchaseOrder(actor, { supplierId: "sup-1", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a line whose chosen unit has no fixed conversion path to the material's base unit", async () => {
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({ id: "uom-roll", name: "Roll", baseUnitId: null, conversionFactor: 1 } as never);
    await expect(
      createPurchaseOrder(actor, {
        supplierId: "sup-1",
        orderDate: "2026-08-24",
        expectedDeliveryDate: "",
        items: [oneItem({ uomId: "uom-roll" })],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(PurchaseOrderRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("rejects a materialRequestItemId that doesn't belong to this company", async () => {
    vi.mocked(MaterialRequestItemRepository.findWithRequestOwner).mockResolvedValue({
      materialRequest: { companyId: "co-2" },
    } as never);
    await expect(
      createPurchaseOrder(actor, {
        supplierId: "sup-1",
        orderDate: "2026-08-24",
        expectedDeliveryDate: "",
        items: [oneItem({ materialRequestItemId: "mri-1" })],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a colorId that doesn't belong to this company", async () => {
    vi.mocked(LookupRepository.color.findFirst).mockResolvedValue(null);
    await expect(
      createPurchaseOrder(actor, {
        supplierId: "sup-1",
        orderDate: "2026-08-24",
        expectedDeliveryDate: "",
        items: [oneItem({ colorId: "color-x" })],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(PurchaseOrderRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("rejects a dyeId (Shade/Pantone) that doesn't belong to this company", async () => {
    vi.mocked(FabricConfigRepository.dye.findFirst).mockResolvedValue(null);
    await expect(
      createPurchaseOrder(actor, {
        supplierId: "sup-1",
        orderDate: "2026-08-24",
        expectedDeliveryDate: "",
        items: [oneItem({ dyeId: "dye-x" })],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(PurchaseOrderRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("persists a real colorId/dyeId through to the created item", async () => {
    vi.mocked(LookupRepository.color.findFirst).mockResolvedValue({ id: "color-1" } as never);
    vi.mocked(FabricConfigRepository.dye.findFirst).mockResolvedValue({ id: "dye-1" } as never);

    await createPurchaseOrder(actor, {
      supplierId: "sup-1",
      orderDate: "2026-08-24",
      expectedDeliveryDate: "",
      items: [oneItem({ colorId: "color-1", dyeId: "dye-1" })],
    });

    expect(PurchaseOrderRepository.createWithItems).toHaveBeenCalledWith(
      expect.objectContaining({ items: { create: [expect.objectContaining({ colorId: "color-1", dyeId: "dye-1" })] } })
    );
  });

  it("always forces currencyCode to the company's own base currency, never a supplier-specific one", async () => {
    await createPurchaseOrder(actor, { supplierId: "sup-1", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] });

    expect(PurchaseOrderRepository.createWithItems).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCode: "INR", baseCurrencyCode: "INR", exchangeRate: 1 })
    );
  });

  it("computes totalAmount as the sum of unitPrice * orderedQuantity across lines", async () => {
    await createPurchaseOrder(actor, {
      supplierId: "sup-1",
      orderDate: "2026-08-24",
      expectedDeliveryDate: "",
      items: [oneItem({ unitPrice: 50, orderedQuantity: 10 }), oneItem({ unitPrice: 20, orderedQuantity: 5 })],
    });

    expect(PurchaseOrderRepository.createWithItems).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 600, baseTotalAmount: 600 }));
  });
});

describe("updatePurchaseOrder", () => {
  it("blocks editing once the order has moved past APPROVED", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", status: "SENT_TO_SUPPLIER", totalAmount: 500 } as never);

    await expect(
      updatePurchaseOrder(actor, "po-1", { supplierId: "sup-1", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(PurchaseOrderRepository.replaceItems).not.toHaveBeenCalled();
  });

  it("reverts an APPROVED order back to DRAFT on edit, forcing re-approval", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", status: "APPROVED", totalAmount: 500 } as never);
    vi.mocked(PurchaseOrderRepository.replaceItems).mockResolvedValue({ id: "po-1", status: "DRAFT", items: [] } as never);

    await updatePurchaseOrder(actor, "po-1", { supplierId: "sup-1", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] });

    expect(PurchaseOrderRepository.replaceItems).toHaveBeenCalledWith("po-1", expect.objectContaining({ status: "DRAFT" }), expect.anything());
  });

  it("does not force a status change when editing a DRAFT order", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", status: "DRAFT", totalAmount: 500 } as never);
    vi.mocked(PurchaseOrderRepository.replaceItems).mockResolvedValue({ id: "po-1", status: "DRAFT", items: [] } as never);

    await updatePurchaseOrder(actor, "po-1", { supplierId: "sup-1", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] });

    const headerData = vi.mocked(PurchaseOrderRepository.replaceItems).mock.calls[0][1];
    expect(headerData).not.toHaveProperty("status");
  });

  // supplierId was validated on create but not re-validated here on update —
  // a direct API call could swap in another tenant's supplierId on an
  // existing order (confirmed cross-tenant risk, fixed).
  it("rejects a supplierId belonging to another company", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", status: "DRAFT", totalAmount: 500 } as never);
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);

    await expect(
      updatePurchaseOrder(actor, "po-1", { supplierId: "sup-x", orderDate: "2026-08-24", expectedDeliveryDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(PurchaseOrderRepository.replaceItems).not.toHaveBeenCalled();
  });
});

describe("approvePurchaseOrder", () => {
  it("rejects approving a non-DRAFT order", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyByIdWithItemPrices).mockResolvedValue({
      id: "po-1",
      status: "APPROVED",
      requestedByUserId: "user-1",
      items: [{ id: "item-1", unitPrice: 50 }],
    } as never);

    await expect(approvePurchaseOrder(actor, "po-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects approving an order with a zero/unset unit price on any line — the BUG-04 regression", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyByIdWithItemPrices).mockResolvedValue({
      id: "po-1",
      status: "DRAFT",
      requestedByUserId: "user-1",
      items: [{ id: "item-1", unitPrice: 50 }, { id: "item-2", unitPrice: 0 }],
    } as never);

    await expect(approvePurchaseOrder(actor, "po-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(PermissionService.assert).not.toHaveBeenCalled();
    expect(PurchaseOrderRepository.update).not.toHaveBeenCalled();
  });

  it("asserts the self-approval guard with the order's own requester as createdBy", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyByIdWithItemPrices).mockResolvedValue({
      id: "po-1",
      status: "DRAFT",
      requestedByUserId: "user-2",
      items: [{ id: "item-1", unitPrice: 50 }],
    } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "APPROVED" } as never);

    await approvePurchaseOrder(actor, "po-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "purchasing", "approve", { createdBy: "user-2" });
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "APPROVED" });
  });
});

describe("markPurchaseOrderSentToSupplier", () => {
  it("rejects from any status other than APPROVED", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "DRAFT" } as never);
    await expect(markPurchaseOrderSentToSupplier(actor, "po-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("succeeds from APPROVED", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "APPROVED" } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "SENT_TO_SUPPLIER" } as never);

    await markPurchaseOrderSentToSupplier(actor, "po-1");
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "SENT_TO_SUPPLIER" });
  });
});

describe("closePurchaseOrder", () => {
  it("rejects closing anything other than a FULLY_RECEIVED order", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "PARTIALLY_RECEIVED" } as never);
    await expect(closePurchaseOrder(actor, "po-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("succeeds from FULLY_RECEIVED", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "FULLY_RECEIVED" } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "CLOSED" } as never);

    await closePurchaseOrder(actor, "po-1");
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "CLOSED" });
  });
});

describe("transitionPurchaseOrderStatus", () => {
  it("rejects an illegal transition", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "CLOSED" } as never);
    await expect(transitionPurchaseOrderStatus(actor, "po-1", "CANCELLED")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("blocks cancellation once any active goods receipt exists, checked by a real query not the status label", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "PARTIALLY_RECEIVED" } as never);
    vi.mocked(PurchaseOrderRepository.countActiveReceipts).mockResolvedValue(1);

    await expect(transitionPurchaseOrderStatus(actor, "po-1", "CANCELLED")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(PurchaseOrderRepository.update).not.toHaveBeenCalled();
  });

  it("blocks cancellation from ON_HOLD once invoiced lines exist — the label-vs-real-state bug class this project has fixed before", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "ON_HOLD" } as never);
    vi.mocked(PurchaseOrderRepository.countActiveReceipts).mockResolvedValue(0);
    vi.mocked(PurchaseOrderRepository.countInvoicedItems).mockResolvedValue(1);

    await expect(transitionPurchaseOrderStatus(actor, "po-1", "CANCELLED")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(PurchaseOrderRepository.update).not.toHaveBeenCalled();
  });

  it("allows cancellation when no receipts or invoiced lines exist", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "DRAFT" } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "CANCELLED" } as never);

    await transitionPurchaseOrderStatus(actor, "po-1", "CANCELLED");
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "CANCELLED" });
  });

  it("captures statusBeforeHold when moving to ON_HOLD", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "SENT_TO_SUPPLIER" } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "ON_HOLD" } as never);

    await transitionPurchaseOrderStatus(actor, "po-1", "ON_HOLD");
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "ON_HOLD", statusBeforeHold: "SENT_TO_SUPPLIER" });
  });
});

describe("resumePurchaseOrderFromHold", () => {
  it("restores the exact prior status", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "ON_HOLD", statusBeforeHold: "PARTIALLY_RECEIVED" } as never);
    vi.mocked(PurchaseOrderRepository.update).mockResolvedValue({ id: "po-1", status: "PARTIALLY_RECEIVED" } as never);

    await resumePurchaseOrderFromHold(actor, "po-1");
    expect(PurchaseOrderRepository.update).toHaveBeenCalledWith("po-1", { status: "PARTIALLY_RECEIVED", statusBeforeHold: null });
  });

  it("rejects resuming an order that isn't on hold", async () => {
    vi.mocked(PurchaseOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", status: "DRAFT", statusBeforeHold: null } as never);
    await expect(resumePurchaseOrderFromHold(actor, "po-1")).rejects.toThrow(BusinessRuleError);
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(PurchaseOrderRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(PurchaseOrderRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listPurchaseOrders adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listPurchaseOrders(actor, listQuery);

    const whereArg = vi.mocked(PurchaseOrderRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listPurchaseOrders adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listPurchaseOrders(actor, listQuery);

    expect(PurchaseOrderRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getPurchaseOrderById succeeds for an order inside the user's allowed branches", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const order = await getPurchaseOrderById(actor, "po-1");
    expect(order.id).toBe("po-1");
  });

  it("getPurchaseOrderById throws NOT_FOUND for an order outside the user's allowed branches", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "po-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getPurchaseOrderById(actor, "po-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

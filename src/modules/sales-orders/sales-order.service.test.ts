import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
vi.mock("@/core/db/client", () => {
  const salesOrderUpdateMany = vi.fn();
  const dispatchFindMany = vi.fn().mockResolvedValue([]);
  return {
    prisma: {
      salesOrder: { updateMany: salesOrderUpdateMany },
      dispatch: { findMany: dispatchFindMany },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          salesOrder: { updateMany: salesOrderUpdateMany },
          dispatch: { findMany: dispatchFindMany },
        })
      ),
    },
  };
});
vi.mock("@/modules/finished-goods-inventory/finished-goods-reservation.service", () => ({
  releaseActiveReservationsForSalesOrderInTx: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findStyleById: vi.fn() },
}));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleRequestRepository: { findMany: vi.fn(), findAnyById: vi.fn() },
}));
vi.mock("@/modules/accounts/sales-invoice.repository", () => ({
  SalesInvoiceRepository: { findActiveByOrderId: vi.fn() },
}));
vi.mock("@/modules/dispatch/dispatch.repository", () => ({
  DispatchRepository: { findAnyByOrderId: vi.fn() },
}));
vi.mock("@/modules/production/production-progress.service", () => ({
  getSalesOrderItemProductionSummary: vi.fn(),
}));
vi.mock("./sales-order.repository", () => ({
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
  SalesOrderRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyById: vi.fn(),
    createHeader: vi.fn(),
    update: vi.fn(),
    updateStatusConditional: vi.fn(),
    replaceItems: vi.fn(),
    findLastOrderedItem: vi.fn(),
    findOrderedPriceHistory: vi.fn(),
  },
}));
// Effective BOM (2026-09-24) — mocked as a pure pass-through here (identity
// on the submitted items, tagged with a dummy lineLink no test in this file
// inspects) since these tests only care about sales-order.service.ts's own
// pre-existing guards/behavior. sales-order-bom.service.test.ts covers the
// real reconciliation/snapshot logic in isolation.
vi.mock("./sales-order-bom.service", () => ({
  buildReconciledItemPlan: vi.fn(),
  snapshotUnsnapshottedLinesInTx: vi.fn(),
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SampleRequestRepository } = await import("@/modules/sampling/sample.repository");
const { SalesInvoiceRepository } = await import("@/modules/accounts/sales-invoice.repository");
const { DispatchRepository } = await import("@/modules/dispatch/dispatch.repository");
const { getSalesOrderItemProductionSummary } = await import("@/modules/production/production-progress.service");
const { releaseActiveReservationsForSalesOrderInTx } = await import("@/modules/finished-goods-inventory/finished-goods-reservation.service");
const { CompanyRepository, SalesOrderRepository } = await import("./sales-order.repository");
const { buildReconciledItemPlan, snapshotUnsnapshottedLinesInTx } = await import("./sales-order-bom.service");
const {
  createSalesOrder,
  updateSalesOrder,
  confirmSalesOrder,
  transitionSalesOrderStatus,
  resumeSalesOrderFromHold,
  getSalesOrderById,
  getLastOrderedPrice,
  getSalesOrderPriceHistory,
  listSalesOrders,
} = await import("./sales-order.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

const oneItem = (overrides: Record<string, unknown> = {}) => ({
  productId: "style-1",
  sampleRequestId: "",
  unitPrice: 100,
  notes: "",
  breakdown: [{ productVariantId: "variant-1", orderedQuantity: 10 }],
  ...overrides,
});

beforeEach(() => {
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset().mockResolvedValue({ id: "cust-1", buyers: [] } as never);
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "style-1", itemType: "STYLE", isActive: true, styleName: "Kurta" } as never);
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset().mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(prisma.salesOrder.updateMany).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.dispatch.findMany).mockReset().mockResolvedValue([] as never);
  vi.mocked(releaseActiveReservationsForSalesOrderInTx).mockReset().mockResolvedValue(0 as never);
  vi.mocked(SalesOrderRepository.createHeader).mockReset().mockResolvedValue({ id: "so-1" } as never);
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(SalesOrderRepository.findAnyById).mockReset();
  vi.mocked(SalesOrderRepository.update).mockReset();
  vi.mocked(SalesOrderRepository.updateStatusConditional).mockReset();
  vi.mocked(SalesOrderRepository.replaceItems).mockReset().mockResolvedValue({ id: "so-1", items: [] } as never);
  vi.mocked(SalesOrderRepository.findOrderedPriceHistory).mockReset();
  vi.mocked(buildReconciledItemPlan)
    .mockReset()
    .mockImplementation(async (_actor, _id, _isConfirmed, items) => items as never);
  vi.mocked(snapshotUnsnapshottedLinesInTx).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getSalesOrderItemProductionSummary).mockReset().mockResolvedValue({ orderedTotal: 0 } as never);
  vi.mocked(SalesInvoiceRepository.findActiveByOrderId).mockReset().mockResolvedValue(null);
  vi.mocked(DispatchRepository.findAnyByOrderId).mockReset().mockResolvedValue(null);
  vi.mocked(SampleRequestRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(SampleRequestRepository.findAnyById)
    .mockReset()
    .mockResolvedValue({ id: "sam-1", requestNumber: "SAM-2026-00001", status: "APPROVED", productId: "style-1", customerId: "other-customer" } as never);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
});

describe("createSalesOrder", () => {
  it("rejects when the customer doesn't exist", async () => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(null);
    await expect(
      createSalesOrder(actor, { customerId: "cust-x", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a line item whose product is not a Style — the P0 fix, closing the gap every sibling module already guards", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);

    await expect(
      createSalesOrder(actor, {
        customerId: "cust-1",
        buyerId: "",
        orderDate: "2026-08-24",
        requiredShipDate: "",
       
        items: [oneItem({ productId: "raw-material-1" })],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SalesOrderRepository.createHeader).not.toHaveBeenCalled();
  });

  it("always forces currencyCode to the company's own base currency with exchangeRate 1", async () => {
    await createSalesOrder(actor, { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] });

    expect(SalesOrderRepository.createHeader).toHaveBeenCalledWith(
      expect.objectContaining({ currencyCode: "INR", baseCurrencyCode: "INR", exchangeRate: 1 })
    );
  });

  it("computes totalAmount as unitPrice times the summed breakdown quantity across lines", async () => {
    await createSalesOrder(actor, {
      customerId: "cust-1",
      buyerId: "",
      orderDate: "2026-08-24",
      requiredShipDate: "",
     
      items: [oneItem({ unitPrice: 100, breakdown: [{ productVariantId: "v-1", orderedQuantity: 5 }, { productVariantId: "v-2", orderedQuantity: 5 }] })],
    });

    expect(SalesOrderRepository.createHeader).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 1000, baseTotalAmount: 1000 }));
  });
  it("lets a new customer order a design originally developed for ANOTHER customer — referenced as-is, not duplicated", async () => {
    await createSalesOrder(actor, {
      customerId: "cust-1",
      buyerId: "",
      orderDate: "2026-08-24",
      requiredShipDate: "",
     
      items: [oneItem({ sampleRequestId: "sam-1" })],
    });
    expect(SalesOrderRepository.createHeader).toHaveBeenCalled();
  });

  it("rejects a linked design that doesn't exist in this company", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue(null);
    await expect(
      createSalesOrder(actor, { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem({ sampleRequestId: "sam-x" })] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a cancelled/rejected design", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", requestNumber: "SAM-1", status: "CANCELLED", productId: "style-1" } as never);
    await expect(
      createSalesOrder(actor, { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem({ sampleRequestId: "sam-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a design belonging to a different Style than the line's", async () => {
    vi.mocked(SampleRequestRepository.findAnyById).mockResolvedValue({ id: "sam-1", requestNumber: "SAM-1", status: "APPROVED", productId: "style-2" } as never);
    await expect(
      createSalesOrder(actor, { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem({ sampleRequestId: "sam-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an inactive Style on a new order", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue({ id: "style-1", itemType: "STYLE", isActive: false, styleName: "Old" } as never);
    await expect(
      createSalesOrder(actor, { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("updateSalesOrder", () => {
  it("blocks editing an order that has moved past CONFIRMED", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "IN_PRODUCTION", requestedByUserId: "user-1", items: [] } as never);

    await expect(
      updateSalesOrder(actor, "so-1", { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a line item whose product is not a Style", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "DRAFT", requestedByUserId: "user-1", items: [] } as never);
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);

    await expect(
      updateSalesOrder(actor, "so-1", { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SalesOrderRepository.replaceItems).not.toHaveBeenCalled();
  });

  it("blocks editing once an active Sales Invoice already exists against this order", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "CONFIRMED", requestedByUserId: "user-1", items: [] } as never);
    vi.mocked(SalesInvoiceRepository.findActiveByOrderId).mockResolvedValue({ id: "inv-1", invoiceNumber: "INV-2026-00001" } as never);

    await expect(
      updateSalesOrder(actor, "so-1", { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });

  it("blocks editing once ANY dispatch references this order, even a cancelled one", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "CONFIRMED", requestedByUserId: "user-1", items: [] } as never);
    vi.mocked(DispatchRepository.findAnyByOrderId).mockResolvedValue({ id: "dsp-1", dispatchNumber: "DSP-2026-00001" } as never);

    await expect(
      updateSalesOrder(actor, "so-1", { customerId: "cust-1", buyerId: "", orderDate: "2026-08-24", requiredShipDate: "", items: [oneItem()] })
    ).rejects.toMatchObject({ code: "REFERENCED_RECORD_IN_USE" });
  });

  it("re-runs the sample-approval gate when editing a CONFIRMED order, blocking an unapproved sample without an override", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "CONFIRMED", requestedByUserId: "user-1", items: [] } as never);
    vi.mocked(SampleRequestRepository.findMany).mockResolvedValue([{ id: "sam-1", status: "IN_DEVELOPMENT" }] as never);

    await expect(
      updateSalesOrder(actor, "so-1", {
        customerId: "cust-1",
        buyerId: "",
        orderDate: "2026-08-24",
        requiredShipDate: "",
        items: [oneItem({ sampleRequestId: "sam-1" })],
      })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("confirmSalesOrder", () => {
  it("rejects confirming an order that isn't DRAFT", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "CONFIRMED", requestedByUserId: "user-1", items: [] } as never);
    await expect(confirmSalesOrder(actor, "so-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("blocks confirmation when a linked sample isn't Approved and no override reason is given", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "DRAFT",
      requestedByUserId: "user-1",
      items: [{ sampleRequestId: "sam-1", sampleRequest: { status: "IN_DEVELOPMENT" } }],
    } as never);

    await expect(confirmSalesOrder(actor, "so-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it("allows a Management override with a reason, self-approval-guarded against the order's own requester", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "DRAFT",
      requestedByUserId: "user-2",
      items: [{ sampleRequestId: "sam-1", sampleRequest: { status: "IN_DEVELOPMENT" } }],
    } as never);
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", status: "CONFIRMED" } as never);

    await confirmSalesOrder(actor, "so-1", { overrideReason: "Customer urgently needs this before sample sign-off" });

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "sales_orders", "approve", { createdBy: "user-2" });
    expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({ where: { id: "so-1", status: "DRAFT" }, data: { status: "CONFIRMED" } });
    // Effective BOM (2026-09-24) — every still-unsnapshotted line gets
    // backfilled atomically inside the same transaction as the status flip.
    expect(snapshotUnsnapshottedLinesInTx).toHaveBeenCalledWith(expect.anything(), actor, "so-1");
  });

  it("rejects when a concurrent confirm already moved the order out of DRAFT (the race guard)", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status: "DRAFT", requestedByUserId: "user-1", items: [] } as never);
    vi.mocked(prisma.salesOrder.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(confirmSalesOrder(actor, "so-1", {})).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    // The race guard failing must roll back the whole transaction — no
    // snapshot should be backfilled for an order that didn't actually confirm.
    expect(snapshotUnsnapshottedLinesInTx).not.toHaveBeenCalled();
  });

  it("confirms cleanly when no line has a linked sample at all", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "DRAFT",
      requestedByUserId: "user-1",
      items: [{ sampleRequestId: null, sampleRequest: null }],
    } as never);
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", status: "CONFIRMED" } as never);

    await confirmSalesOrder(actor, "so-1", {});
    expect(PermissionService.assert).not.toHaveBeenCalled();
  });
});

describe("transitionSalesOrderStatus", () => {
  it("rejects an illegal transition (e.g. out of a terminal status)", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", status: "CANCELLED" } as never);
    await expect(transitionSalesOrderStatus(actor, "so-1", "ON_HOLD")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("captures statusBeforeHold when moving to ON_HOLD", async () => {
    vi.mocked(SalesOrderRepository.findAnyById)
      .mockResolvedValueOnce({ id: "so-1", status: "CONFIRMED" } as never)
      .mockResolvedValueOnce({ id: "so-1", status: "ON_HOLD" } as never);
    vi.mocked(SalesOrderRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await transitionSalesOrderStatus(actor, "so-1", "ON_HOLD");
    expect(SalesOrderRepository.updateStatusConditional).toHaveBeenCalledWith("so-1", "CONFIRMED", { status: "ON_HOLD", statusBeforeHold: "CONFIRMED" });
  });

  it("rejects when a concurrent update already moved the order out of the expected prior status", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", orderNumber: "SO-001", status: "CONFIRMED" } as never);
    vi.mocked(prisma.salesOrder.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(transitionSalesOrderStatus(actor, "so-1", "CANCELLED")).rejects.toThrow(BusinessRuleError);
  });

  it("atomically cancels the sales order and releases active finished goods reservations", async () => {
    vi.mocked(SalesOrderRepository.findAnyById)
      .mockResolvedValueOnce({ id: "so-1", orderNumber: "SO-001", status: "CONFIRMED" } as never)
      .mockResolvedValueOnce({ id: "so-1", orderNumber: "SO-001", status: "CANCELLED" } as never);
    vi.mocked(prisma.dispatch.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.salesOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(releaseActiveReservationsForSalesOrderInTx).mockResolvedValue(2 as never);

    const result = await transitionSalesOrderStatus(actor, "so-1", "CANCELLED");

    expect(result.status).toBe("CANCELLED");
    expect(prisma.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: "so-1", status: "CONFIRMED" },
      data: { status: "CANCELLED" },
    });
    expect(releaseActiveReservationsForSalesOrderInTx).toHaveBeenCalledWith(expect.anything(), "so-1");
  });

  it("blocks cancellation when open dispatches exist in DRAFT, PACKED, or ON_HOLD status", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", orderNumber: "SO-001", status: "CONFIRMED" } as never);
    vi.mocked(prisma.dispatch.findMany).mockResolvedValue([
      { id: "dsp-1", dispatchNumber: "DSP-0001", status: "PACKED" },
    ] as never);

    await expect(transitionSalesOrderStatus(actor, "so-1", "CANCELLED")).rejects.toMatchObject({
      code: "REFERENCED_RECORD_IN_USE",
      details: { salesOrderId: "so-1", openDispatchNumbers: ["DSP-0001"] },
    });
    expect(prisma.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(releaseActiveReservationsForSalesOrderInTx).not.toHaveBeenCalled();
  });
});

describe("resumeSalesOrderFromHold", () => {
  it("restores the exact prior status", async () => {
    vi.mocked(SalesOrderRepository.findAnyById)
      .mockResolvedValueOnce({ id: "so-1", status: "ON_HOLD", statusBeforeHold: "CONFIRMED" } as never)
      .mockResolvedValueOnce({ id: "so-1", status: "CONFIRMED" } as never);
    vi.mocked(SalesOrderRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await resumeSalesOrderFromHold(actor, "so-1");
    expect(SalesOrderRepository.updateStatusConditional).toHaveBeenCalledWith("so-1", "ON_HOLD", { status: "CONFIRMED", statusBeforeHold: null });
  });

  it("rejects resuming an order that isn't on hold", async () => {
    vi.mocked(SalesOrderRepository.findAnyById).mockResolvedValue({ id: "so-1", status: "DRAFT", statusBeforeHold: null } as never);
    await expect(resumeSalesOrderFromHold(actor, "so-1")).rejects.toThrow(BusinessRuleError);
  });
});

describe("getSalesOrderById", () => {
  it("attaches a production summary onto each item, keyed by that item's own id", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      items: [
        { id: "item-1", productId: "style-1" },
        { id: "item-2", productId: "style-2" },
      ],
    } as never);
    vi.mocked(getSalesOrderItemProductionSummary)
      .mockResolvedValueOnce({ salesOrderItemId: "item-1", orderedTotal: 100 } as never)
      .mockResolvedValueOnce({ salesOrderItemId: "item-2", orderedTotal: 50 } as never);

    const order = await getSalesOrderById(actor, "so-1");

    expect(getSalesOrderItemProductionSummary).toHaveBeenCalledWith("co-1", "item-1");
    expect(getSalesOrderItemProductionSummary).toHaveBeenCalledWith("co-1", "item-2");
    expect(order.items[0].productionSummary).toEqual({ salesOrderItemId: "item-1", orderedTotal: 100 });
    expect(order.items[1].productionSummary).toEqual({ salesOrderItemId: "item-2", orderedTotal: 50 });
  });

  it("rejects a sales order that doesn't exist", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(getSalesOrderById(actor, "missing")).rejects.toThrow(BusinessRuleError);
  });
});

describe("getLastOrderedPrice", () => {
  it("returns the price/order details from the most recent prior item, delegated straight to the repository", async () => {
    vi.mocked(SalesOrderRepository.findLastOrderedItem).mockResolvedValue({
      unitPrice: { toString: () => "320" },
      salesOrder: { orderNumber: "ORD-2026-00014", orderDate: new Date("2026-09-10") },
    } as never);

    const result = await getLastOrderedPrice("co-1", "cust-1", "style-1");

    expect(SalesOrderRepository.findLastOrderedItem).toHaveBeenCalledWith("co-1", "cust-1", "style-1", undefined);
    expect(result).toEqual({ unitPrice: "320", orderNumber: "ORD-2026-00014", orderDate: new Date("2026-09-10") });
  });

  it("passes excludeOrderId through, so an in-progress edit never suggests its own not-yet-saved price back to itself", async () => {
    vi.mocked(SalesOrderRepository.findLastOrderedItem).mockResolvedValue(null);
    await getLastOrderedPrice("co-1", "cust-1", "style-1", "so-being-edited");
    expect(SalesOrderRepository.findLastOrderedItem).toHaveBeenCalledWith("co-1", "cust-1", "style-1", "so-being-edited");
  });

  it("returns null (not an error) when there's no prior order at all — the common, expected case for a first-time line", async () => {
    vi.mocked(SalesOrderRepository.findLastOrderedItem).mockResolvedValue(null);
    const result = await getLastOrderedPrice("co-1", "cust-1", "style-1");
    expect(result).toBeNull();
  });
});

describe("getSalesOrderPriceHistory", () => {
  it("returns every real price this customer was charged for this style, most-recent first, delegated straight to the repository", async () => {
    vi.mocked(SalesOrderRepository.findOrderedPriceHistory).mockResolvedValue([
      { unitPrice: { toString: () => "320" }, salesOrder: { orderNumber: "ORD-2026-00014", orderDate: new Date("2026-09-10") } },
      { unitPrice: { toString: () => "300" }, salesOrder: { orderNumber: "ORD-2026-00009", orderDate: new Date("2026-08-01") } },
    ] as never);

    const result = await getSalesOrderPriceHistory("co-1", "cust-1", "style-1");

    expect(SalesOrderRepository.findOrderedPriceHistory).toHaveBeenCalledWith("co-1", "cust-1", "style-1", undefined, undefined);
    expect(result).toEqual([
      { unitPrice: 320, orderNumber: "ORD-2026-00014", orderDate: new Date("2026-09-10").toISOString() },
      { unitPrice: 300, orderNumber: "ORD-2026-00009", orderDate: new Date("2026-08-01").toISOString() },
    ]);
  });

  it("passes excludeOrderId and sinceDate through unchanged", async () => {
    vi.mocked(SalesOrderRepository.findOrderedPriceHistory).mockResolvedValue([]);
    const sinceDate = new Date("2025-09-16");

    await getSalesOrderPriceHistory("co-1", "cust-1", "style-1", "so-being-edited", sinceDate);

    expect(SalesOrderRepository.findOrderedPriceHistory).toHaveBeenCalledWith("co-1", "cust-1", "style-1", "so-being-edited", sinceDate);
  });

  it("returns an empty array (not an error) when there's no prior order at all", async () => {
    vi.mocked(SalesOrderRepository.findOrderedPriceHistory).mockResolvedValue([]);
    const result = await getSalesOrderPriceHistory("co-1", "cust-1", "style-1");
    expect(result).toEqual([]);
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(SalesOrderRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(SalesOrderRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listSalesOrders adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listSalesOrders(actor, listQuery);

    const whereArg = vi.mocked(SalesOrderRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listSalesOrders adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listSalesOrders(actor, listQuery);

    expect(SalesOrderRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getSalesOrderById succeeds for an order inside the user's allowed branches", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", branchId: "branch-1", items: [] } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const order = await getSalesOrderById(actor, "so-1");
    expect(order.id).toBe("so-1");
  });

  it("getSalesOrderById throws NOT_FOUND for an order outside the user's allowed branches", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", branchId: "branch-2", items: [] } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getSalesOrderById(actor, "so-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

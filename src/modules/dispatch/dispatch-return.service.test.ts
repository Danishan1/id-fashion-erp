import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("./dispatch.repository", () => ({ DispatchRepository: { findByIdWithDetails: vi.fn() } }));
vi.mock("@/modules/finished-goods-inventory/finished-goods-receipt.repository", () => ({
  FinishedGoodsReceiptRepository: { createWithItemsInTx: vi.fn() },
}));

const tx = {
  $queryRaw: vi.fn(),
  salesInvoice: { findMany: vi.fn() },
  dispatchReturnItem: { findMany: vi.fn() },
  salesOrderItem: { updateMany: vi.fn(), findMany: vi.fn() },
  salesOrder: { update: vi.fn() },
  dispatchReturn: { create: vi.fn() },
  dispatch: { updateMany: vi.fn() },
};
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } }));

const { DispatchRepository } = await import("./dispatch.repository");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { FinishedGoodsReceiptRepository } = await import("@/modules/finished-goods-inventory/finished-goods-receipt.repository");
const { returnDispatchItems } = await import("./dispatch-return.service");

const actor = { companyId: "co-1", userId: "user-1" };

const pick = (id: string, quantity: number, locId: string | null) => ({
  id,
  productVariantId: `var-${id}`,
  warehouseLocationId: locId,
  quantity,
  productVariant: { color: { name: "Black" }, size: { name: id } },
});

function dispatchFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "dsp-1",
    dispatchNumber: "DSP-2026-00001",
    status: "DELIVERED",
    salesOrderId: "so-1",
    warehouseId: "wh-1",
    items: [
      {
        id: "di-1",
        productId: "prod-1",
        dispatchedQuantity: 10,
        extraDispatchQuantity: 0,
        product: { styleName: "Shirt" },
        salesOrderItem: { id: "soi-1" },
        pickLines: [pick("S", 6, "loc-A"), pick("M", 4, null)],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateDocumentNumber).mockResolvedValue("RET-2026-00001");
  tx.salesInvoice.findMany.mockResolvedValue([]);
  tx.dispatchReturnItem.findMany.mockResolvedValue([]);
  tx.salesOrderItem.updateMany.mockResolvedValue({ count: 1 });
  tx.salesOrderItem.findMany.mockResolvedValue([{ regularDispatchedQuantity: 8, breakdown: [{ orderedQuantity: 10 }] }]);
  tx.dispatchReturn.create.mockResolvedValue({ id: "ret-1", totalQuantity: 2, items: [] });
  tx.dispatch.updateMany.mockResolvedValue({ count: 1 });
});

describe("returnDispatchItems", () => {
  it("partial return: lowers the order's shipped qty and sends the pieces to FG Receive (pending), suggesting the pick location", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture() as never);

    await returnDispatchItems(actor, "dsp-1", {
      remarks: "2 pcs stitching defect",
      lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 2, remark: "defect" }],
    });

    expect(tx.salesOrderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { dispatchedQuantity: { decrement: 2 }, regularDispatchedQuantity: { decrement: 2 } } })
    );
    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        source: "CUSTOMER_RETURN",
        status: "PENDING",
        dispatchId: "dsp-1",
        dispatchReturnId: "ret-1",
        totalQuantity: 2,
        items: [{ productVariantId: "var-S", quantity: 2, suggestedLocationId: "loc-A" }],
      })
    );
    expect(tx.salesOrder.update).toHaveBeenCalledWith({ where: { id: "so-1" }, data: { status: "PARTIALLY_DISPATCHED" } });
    expect(tx.dispatch.updateMany).not.toHaveBeenCalled(); // not everything came back
  });

  it("marks the dispatch REVERSED once every piece is back", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture() as never);
    tx.dispatchReturnItem.findMany.mockResolvedValue([{ dispatchItemId: "di-1", pickLineId: "S", quantity: 6, regularQuantity: 6 }]);

    await returnDispatchItems(actor, "dsp-1", { remarks: "rest back", lines: [{ dispatchItemId: "di-1", pickLineId: "M", quantity: 4 }] });

    expect(tx.dispatch.updateMany).toHaveBeenCalledWith({ where: { id: "dsp-1", status: "DELIVERED" }, data: { status: "REVERSED" } });
  });

  it("refuses to return more of a colour/size than was shipped minus already returned", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture() as never);
    tx.dispatchReturnItem.findMany.mockResolvedValue([{ dispatchItemId: "di-1", pickLineId: "S", quantity: 5, regularQuantity: 5 }]);

    await expect(
      returnDispatchItems(actor, "dsp-1", { remarks: "x", lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 2 }] })
    ).rejects.toMatchObject({ code: "OVER_REVERSAL_NOT_ALLOWED" });
    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).not.toHaveBeenCalled();
  });

  it("extra (beyond-order) pieces come back first and don't lower the order's fulfilment", async () => {
    const d = dispatchFixture();
    d.items[0].extraDispatchQuantity = 3;
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(d as never);

    await returnDispatchItems(actor, "dsp-1", { remarks: "x", lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 5 }] });

    expect(tx.salesOrderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { dispatchedQuantity: { decrement: 5 }, regularDispatchedQuantity: { decrement: 2 } } })
    );
  });

  it("numbers the return and its FG receipt from the dispatch's own branch series", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture({ branchId: "br-9" }) as never);

    await returnDispatchItems(actor, "dsp-1", { remarks: "x", lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 1 }] });

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ branchId: "br-9", documentType: "CUSTOMER_RETURN" }));
    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ branchId: "br-9", documentType: "FG_RECEIPT" }));
    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ branchId: "br-9" }));
  });

  it("is blocked while a posted sales invoice exists", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture() as never);
    tx.salesInvoice.findMany.mockResolvedValue([{ invoiceNumber: "INV-1" }]);

    await expect(
      returnDispatchItems(actor, "dsp-1", { remarks: "x", lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 1 }] })
    ).rejects.toMatchObject({ code: "ACTIVE_INVOICE_EXISTS" });
  });

  it("only works on a Dispatched/Delivered dispatch", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchFixture({ status: "DRAFT" }) as never);

    await expect(
      returnDispatchItems(actor, "dsp-1", { remarks: "x", lines: [{ dispatchItemId: "di-1", pickLineId: "S", quantity: 1 }] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

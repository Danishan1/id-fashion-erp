import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn() }));
vi.mock("./finished-goods-reservation.service", () => ({ applyPackingCompletionReservationsInTx: vi.fn() }));

const tx = {
  $queryRaw: vi.fn(),
  finishedGoodsReceiptItem: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  finishedGoodsReceiptPosting: { create: vi.fn() },
  finishedGoodsReceipt: { update: vi.fn() },
  warehouseLocation: { findFirst: vi.fn(), count: vi.fn() },
};
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)),
    finishedGoodsReceiptItem: { findMany: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { recordInventoryTransaction } = await import("@/modules/inventory/inventory.service");
const { applyPackingCompletionReservationsInTx } = await import("./finished-goods-reservation.service");
const { receiveFinishedGoods, listPendingReceiptLines } = await import("./finished-goods-receive.service");

const actor = { companyId: "co-1", userId: "user-1" };

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcpt-1",
    companyId: "co-1",
    receiptNumber: "FGR-2026-00001",
    status: "PENDING",
    source: "PRODUCTION",
    productId: "prod-1",
    warehouseId: "wh-1",
    lotId: "lot-1",
    ...overrides,
  };
}

function line(overrides: Record<string, unknown> = {}) {
  return { id: "item-1", productVariantId: "var-1", quantity: 10, receivedQuantity: 0, finishedGoodsReceipt: receipt(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.warehouseLocation.findFirst.mockResolvedValue({ id: "loc-A", isActive: true });
  tx.warehouseLocation.count.mockResolvedValue(2);
  tx.finishedGoodsReceiptItem.findMany.mockResolvedValue([{ quantity: 10, receivedQuantity: 10 }]);
  vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);
});

describe("receiveFinishedGoods", () => {
  it("posts packed goods into stock at the chosen location, logs the receive, and marks the receipt RECEIVED", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line());

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10, warehouseLocationId: "loc-A" }] });

    expect(result).toMatchObject({ received: 1, failed: 0 });
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      tx,
      actor,
      expect.objectContaining({
        transactionType: "PRODUCTION_RECEIPT",
        quantity: 10,
        productVariantId: "var-1",
        warehouseLocationId: "loc-A",
        referenceModule: "PRODUCTION_ORDER",
        referenceRecordId: "lot-1",
      })
    );
    expect(tx.finishedGoodsReceiptPosting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 10, warehouseLocationId: "loc-A", inventoryTransactionId: "txn-1", receivedByUserId: "user-1" }),
    });
    expect(tx.finishedGoodsReceipt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RECEIVED" }) }));
  });

  it("a customer return is posted as CUSTOMER_RETURN, and a part-receive leaves the receipt PARTIALLY_RECEIVED", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line({ finishedGoodsReceipt: receipt({ source: "CUSTOMER_RETURN", lotId: null }) }));
    tx.finishedGoodsReceiptItem.findMany.mockResolvedValue([{ quantity: 10, receivedQuantity: 4 }]);

    await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 4, warehouseLocationId: "loc-A" }] });

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      tx,
      actor,
      expect.objectContaining({ transactionType: "CUSTOMER_RETURN", referenceModule: "FINISHED_GOODS_RECEIPT", referenceRecordId: "rcpt-1" })
    );
    expect(tx.finishedGoodsReceipt.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PARTIALLY_RECEIVED" } }));
  });

  it("refuses to receive more than is still waiting, posting nothing", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line({ receivedQuantity: 8 }));

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 5, warehouseLocationId: "loc-A" }] });

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toMatch(/Only 2 pcs/);
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("requires a location when the warehouse has locations", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line());

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10 }] });

    expect(result.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/location/) });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a location from another warehouse", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line());
    tx.warehouseLocation.findFirst.mockResolvedValue(null);

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10, warehouseLocationId: "loc-X" }] });

    expect(result.results[0].ok).toBe(false);
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("never touches another company's receipt", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line({ finishedGoodsReceipt: receipt({ companyId: "co-2" }) }));

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10, warehouseLocationId: "loc-A" }] });

    expect(result.results[0]).toMatchObject({ ok: false, error: "Receipt line not found." });
  });

  it("reserves packed goods for their Sales Order only when they are received", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(
      line({ finishedGoodsReceipt: receipt({ productionOrderId: "po-1", branchId: "br-1" }) })
    );

    await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 6, warehouseLocationId: "loc-A" }] });

    expect(applyPackingCompletionReservationsInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ branchId: "br-1" }), {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 6 }],
    });
  });

  it("never reserves a customer return", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line({ finishedGoodsReceipt: receipt({ source: "CUSTOMER_RETURN", lotId: null }) }));

    await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10, warehouseLocationId: "loc-A" }] });

    expect(applyPackingCompletionReservationsInTx).not.toHaveBeenCalled();
  });

  it("a style with no colour/size variants is received without a location, as style-level stock", async () => {
    tx.finishedGoodsReceiptItem.findUnique.mockResolvedValue(line({ productVariantId: null }));

    const result = await receiveFinishedGoods(actor, { lines: [{ receiptItemId: "item-1", quantity: 10 }] });

    expect(result.received).toBe(1);
    const posted = vi.mocked(recordInventoryTransaction).mock.calls[0][2] as unknown as Record<string, unknown>;
    expect(posted).not.toHaveProperty("productVariantId");
    expect(posted).not.toHaveProperty("warehouseLocationId");
    expect(tx.warehouseLocation.count).not.toHaveBeenCalled();
  });

  it("one bad line doesn't stop the others", async () => {
    tx.finishedGoodsReceiptItem.findUnique
      .mockResolvedValueOnce(line({ receivedQuantity: 10 }))
      .mockResolvedValueOnce(line({ id: "item-2" }));

    const result = await receiveFinishedGoods(actor, {
      lines: [
        { receiptItemId: "item-1", quantity: 1, warehouseLocationId: "loc-A" },
        { receiptItemId: "item-2", quantity: 10, warehouseLocationId: "loc-A" },
      ],
    });

    expect(result).toMatchObject({ received: 1, failed: 1 });
  });
});

describe("listPendingReceiptLines", () => {
  it("returns only lines with pieces still waiting, with their pending quantity", async () => {
    vi.mocked(prisma.finishedGoodsReceiptItem.findMany).mockResolvedValue([
      { id: "a", quantity: 10, receivedQuantity: 4 },
      { id: "b", quantity: 5, receivedQuantity: 5 },
    ] as never);

    const rows = await listPendingReceiptLines(actor);

    expect(rows.map((r) => [r.id, r.pendingQuantity])).toEqual([["a", 6]]);
  });
});

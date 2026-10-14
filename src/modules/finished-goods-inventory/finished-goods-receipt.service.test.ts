import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-receipt.repository", () => ({
  FinishedGoodsReceiptRepository: {
    createWithItemsInTx: vi.fn(),
    findByLotId: vi.fn(),
  },
}));

vi.mock("@/core/numbering/DocumentNumberingService", () => ({
  generateDocumentNumber: vi.fn(),
}));

vi.mock("@/modules/inventory/inventory.service", () => ({
  recordInventoryTransaction: vi.fn(),
}));

const { FinishedGoodsReceiptRepository } = await import("./finished-goods-receipt.repository");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { recordInventoryTransaction } = await import("@/modules/inventory/inventory.service");
const { createFinishedGoodsReceiptInTx } = await import("./finished-goods-receipt.service");

const tx = {} as never;
const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

const baseParams = {
  productId: "prod-1",
  lotId: "lot-1",
  jobOrderId: "jo-1",
  productionOrderId: "po-1",
  warehouseId: "wh-1",
};

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("FGR-2026-00001");
  vi.mocked(recordInventoryTransaction).mockReset();
  vi.mocked(FinishedGoodsReceiptRepository.createWithItemsInTx).mockReset().mockResolvedValue({ id: "receipt-1" } as never);
});

describe("createFinishedGoodsReceiptInTx", () => {
  it("rejects an empty breakdown before generating any document number or posting anything", async () => {
    await expect(
      createFinishedGoodsReceiptInTx(tx, actor, { ...baseParams, quantity: 10, variantBreakdown: [] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(generateDocumentNumber).not.toHaveBeenCalled();
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a breakdown that sums to less than the stated quantity", async () => {
    await expect(
      createFinishedGoodsReceiptInTx(tx, actor, {
        ...baseParams,
        quantity: 100,
        variantBreakdown: [{ productVariantId: "var-1", quantity: 60 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", details: { breakdownSum: 60, quantity: 100 } });
  });

  it("rejects a breakdown that sums to more than the stated quantity", async () => {
    await expect(
      createFinishedGoodsReceiptInTx(tx, actor, {
        ...baseParams,
        quantity: 100,
        variantBreakdown: [
          { productVariantId: "var-1", quantity: 60 },
          { productVariantId: "var-2", quantity: 50 },
        ],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a breakdown within the project's own EPSILON tolerance (0.0001)", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);

    await expect(
      createFinishedGoodsReceiptInTx(tx, actor, {
        ...baseParams,
        quantity: 100,
        variantBreakdown: [{ productVariantId: "var-1", quantity: 100.00005 }],
      })
    ).resolves.toBeDefined();
  });

  it("posts exactly one recordInventoryTransaction call per breakdown line, each carrying productVariantId + stockStatus SALEABLE", async () => {
    vi.mocked(recordInventoryTransaction)
      .mockResolvedValueOnce({ id: "txn-1" } as never)
      .mockResolvedValueOnce({ id: "txn-2" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 70,
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 50 },
        { productVariantId: "var-2", quantity: 20 },
      ],
    });

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      actor,
      expect.objectContaining({
        productId: "prod-1",
        warehouseId: "wh-1",
        transactionType: "PRODUCTION_RECEIPT",
        quantity: 50,
        referenceModule: "FINISHED_GOODS_RECEIPT",
        referenceRecordId: "lot-1",
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      })
    );
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
      2,
      tx,
      actor,
      expect.objectContaining({ productVariantId: "var-2", quantity: 20, stockStatus: "SALEABLE" })
    );
  });

  it("the sum of quantities posted via recordInventoryTransaction always exactly equals the flat quantity for the same call (the double-counting-prevention invariant, §4.5 point 2)", async () => {
    vi.mocked(recordInventoryTransaction)
      .mockResolvedValueOnce({ id: "txn-1" } as never)
      .mockResolvedValueOnce({ id: "txn-2" } as never)
      .mockResolvedValueOnce({ id: "txn-3" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 123,
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 50 },
        { productVariantId: "var-2", quantity: 33 },
        { productVariantId: "var-3", quantity: 40 },
      ],
    });

    const postedQuantities = vi.mocked(recordInventoryTransaction).mock.calls.map(([, , input]) => (input as { quantity: number }).quantity);
    const postedSum = postedQuantities.reduce((a, b) => a + b, 0);
    expect(postedSum).toBe(123);
  });

  it("never posts a separate (N+1)th flat-total recordInventoryTransaction call — only the N breakdown lines", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 10,
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    // Exactly 1 call for 1 breakdown line — never 2 (which would mean a
    // flat call was added on top of the breakdown, double-posting
    // StockBalance).
    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
  });

  it("generates the receipt number via the FG_RECEIPT document type, scoped to the actor's company/branch", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 10,
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(generateDocumentNumber).toHaveBeenCalledWith({ companyId: "co-1", branchId: "br-1", documentType: "FG_RECEIPT" });
  });

  it("defaults branchId to null in the receipt number request when the actor carries none", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);

    await createFinishedGoodsReceiptInTx(tx, { companyId: "co-1", userId: "user-1" }, {
      ...baseParams,
      quantity: 10,
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ branchId: null }));
  });

  it("maps each item's own inventoryTransactionId to the real ledger row that specific line posted, not the first/last call's id reused for every item", async () => {
    vi.mocked(recordInventoryTransaction)
      .mockResolvedValueOnce({ id: "txn-A" } as never)
      .mockResolvedValueOnce({ id: "txn-B" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 30,
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 10 },
        { productVariantId: "var-2", quantity: 20 },
      ],
    });

    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        items: [
          { productVariantId: "var-1", quantity: 10, inventoryTransactionId: "txn-A" },
          { productVariantId: "var-2", quantity: 20, inventoryTransactionId: "txn-B" },
        ],
      })
    );
  });

  it("stores totalQuantity as the validated breakdown sum, never an independently re-entered/recomputed number", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      // A deliberately EPSILON-close-but-not-identical quantity, to prove
      // totalQuantity stores the real breakdown sum (60), not this input.
      quantity: 60.00003,
      variantBreakdown: [{ productVariantId: "var-1", quantity: 60 }],
    });

    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ totalQuantity: 60 }));
  });

  it("creates every real identifying field correctly on the FinishedGoodsReceipt header", async () => {
    vi.mocked(recordInventoryTransaction).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(generateDocumentNumber).mockResolvedValue("FGR-2026-00042");

    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 10,
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        companyId: "co-1",
        branchId: "br-1",
        receiptNumber: "FGR-2026-00042",
        productId: "prod-1",
        lotId: "lot-1",
        jobOrderId: "jo-1",
        productionOrderId: "po-1",
        warehouseId: "wh-1",
        postedByUserId: "user-1",
      })
    );
  });
});

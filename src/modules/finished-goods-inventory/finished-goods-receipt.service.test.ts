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

  it("creates a PENDING receipt from packing and posts NO stock — stock comes only when the store receives it", async () => {
    await createFinishedGoodsReceiptInTx(tx, actor, {
      ...baseParams,
      quantity: 30,
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 10 },
        { productVariantId: "var-2", quantity: 20 },
      ],
    });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
    expect(FinishedGoodsReceiptRepository.createWithItemsInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        source: "PRODUCTION",
        status: "PENDING",
        totalQuantity: 30,
        items: [
          { productVariantId: "var-1", quantity: 10 },
          { productVariantId: "var-2", quantity: 20 },
        ],
      })
    );
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

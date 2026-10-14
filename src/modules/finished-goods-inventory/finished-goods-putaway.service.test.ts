import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn() }));
vi.mock("@/modules/inventory/inventory.repository", () => ({
  FinishedGoodsStockBalanceRepository: { findOne: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductVariantRepository: { findManyByIds: vi.fn() },
}));
vi.mock("@/modules/warehouses/warehouse.repository", () => ({
  WarehouseLocationRepository: { findByIdWithWarehouse: vi.fn() },
}));
vi.mock("./finished-goods-putaway.repository", () => ({
  FinishedGoodsPutawayRepository: { createWithItemsInTx: vi.fn(), findManyStaging: vi.fn() },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { recordInventoryTransaction } = await import("@/modules/inventory/inventory.service");
const { FinishedGoodsStockBalanceRepository } = await import("@/modules/inventory/inventory.repository");
const { ProductVariantRepository } = await import("@/modules/products/product.repository");
const { WarehouseLocationRepository } = await import("@/modules/warehouses/warehouse.repository");
const { FinishedGoodsPutawayRepository } = await import("./finished-goods-putaway.repository");
const { listStagingBalances, putawayStock } = await import("./finished-goods-putaway.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

const baseInput = {
  productId: "prod-1",
  productVariantId: "var-1",
  warehouseId: "wh-1",
  stockStatus: "SALEABLE" as const,
  allocations: [{ warehouseLocationId: "loc-1", quantity: 20 }],
};

function locationInWarehouse(warehouseId: string, companyId = "co-1") {
  return { id: "loc-1", warehouseId, warehouse: { id: warehouseId, companyId } } as never;
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("FGP-2026-00001");
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue({ id: "txn-1" } as never);
  vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockReset().mockResolvedValue({ quantityOnHand: "100" } as never);
  vi.mocked(ProductVariantRepository.findManyByIds).mockReset().mockResolvedValue([{ id: "var-1", productId: "prod-1" }] as never);
  vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockReset().mockResolvedValue(locationInWarehouse("wh-1"));
  vi.mocked(FinishedGoodsPutawayRepository.createWithItemsInTx).mockReset().mockResolvedValue({ id: "putaway-1" } as never);
  vi.mocked(FinishedGoodsPutawayRepository.findManyStaging).mockReset().mockResolvedValue([]);
  vi.mocked(writeAuditLog).mockReset();
});

describe("listStagingBalances", () => {
  it("delegates to the repository with the actor's own companyId and no warehouse filter by default", async () => {
    await listStagingBalances({ companyId: "co-1" });
    expect(FinishedGoodsPutawayRepository.findManyStaging).toHaveBeenCalledWith("co-1", {});
  });

  it("passes a warehouseId filter through unchanged when supplied", async () => {
    await listStagingBalances({ companyId: "co-1" }, { warehouseId: "wh-9" });
    expect(FinishedGoodsPutawayRepository.findManyStaging).toHaveBeenCalledWith("co-1", { warehouseId: "wh-9" });
  });
});

describe("putawayStock", () => {
  it("rejects a destination location belonging to a different company — before any write", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue(locationInWarehouse("wh-1", "co-OTHER"));

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
    expect(FinishedGoodsPutawayRepository.createWithItemsInTx).not.toHaveBeenCalled();
  });

  it("rejects a destination location belonging to a different warehouse than the staging stock — before any write", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue(locationInWarehouse("wh-DIFFERENT"));

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the colour/size variant does not belong to the selected style — before any write", async () => {
    vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([{ id: "var-1", productId: "prod-DIFFERENT" }] as never);

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects NOT_FOUND when the colour/size variant doesn't exist at all", async () => {
    vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([]);

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the total being put away exceeds what's genuinely available in staging", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue({ quantityOnHand: "10" } as never);

    await expect(
      putawayStock(actor, { ...baseInput, allocations: [{ warehouseLocationId: "loc-1", quantity: 20 }] })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT", details: { available: 10, requested: 20 } });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("treats a missing staging row as zero available, not an error", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue(null);

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK_FOR_MOVEMENT",
      details: { available: 0 },
    });
  });

  it("posts exactly one negative entry at the staging row (warehouseLocationId null) for the total being moved", async () => {
    await putawayStock(actor, { ...baseInput, allocations: [{ warehouseLocationId: "loc-1", quantity: 20 }] });

    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      actor,
      expect.objectContaining({
        productId: "prod-1",
        warehouseId: "wh-1",
        warehouseLocationId: null,
        transactionType: "STOCK_TRANSFER",
        quantity: -20,
        referenceModule: "FINISHED_GOODS_PUTAWAY",
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      })
    );
  });

  it("the single negative entry and every positive entry share the SAME referenceRecordId (the header's own id)", async () => {
    await putawayStock(actor, { ...baseInput, allocations: [{ warehouseLocationId: "loc-1", quantity: 20 }] });

    const refIds = vi
      .mocked(recordInventoryTransaction)
      .mock.calls.map(([, , input]) => (input as { referenceRecordId: string }).referenceRecordId);
    expect(new Set(refIds).size).toBe(1);
    expect(typeof refIds[0]).toBe("string");
  });

  it("posts exactly N positive entries, one per destination location, each with its own exact quantity (the sum invariant the acceptance criteria requires)", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse)
      .mockResolvedValueOnce(locationInWarehouse("wh-1"))
      .mockResolvedValueOnce({ id: "loc-2", warehouseId: "wh-1", warehouse: { id: "wh-1", companyId: "co-1" } } as never);

    await putawayStock(actor, {
      ...baseInput,
      allocations: [
        { warehouseLocationId: "loc-1", quantity: 12 },
        { warehouseLocationId: "loc-2", quantity: 8 },
      ],
    });

    // 1 negative (staging) + 2 positive (destinations) = 3 calls total.
    expect(recordInventoryTransaction).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(recordInventoryTransaction).mock.calls;
    const negative = (calls[0][2] as { quantity: number }).quantity;
    const positives = calls.slice(1).map(([, , input]) => (input as { quantity: number; warehouseLocationId: string }));
    expect(negative).toBe(-20);
    expect(positives).toEqual([
      expect.objectContaining({ warehouseLocationId: "loc-1", quantity: 12 }),
      expect.objectContaining({ warehouseLocationId: "loc-2", quantity: 8 }),
    ]);
    // The staging decrement and the sum of every destination increment are
    // EXACTLY equal — never a rounded/evenly-divided share.
    const positiveSum = positives.reduce((sum, p) => sum + p.quantity, 0);
    expect(positiveSum).toBe(Math.abs(negative));
  });

  it("maps each item's own real inventoryTransactionId to the ledger row that SPECIFIC destination line posted, not the first/last call's id reused for every item", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse)
      .mockResolvedValueOnce(locationInWarehouse("wh-1"))
      .mockResolvedValueOnce({ id: "loc-2", warehouseId: "wh-1", warehouse: { id: "wh-1", companyId: "co-1" } } as never);
    vi.mocked(recordInventoryTransaction)
      .mockResolvedValueOnce({ id: "txn-staging" } as never)
      .mockResolvedValueOnce({ id: "txn-A" } as never)
      .mockResolvedValueOnce({ id: "txn-B" } as never);

    await putawayStock(actor, {
      ...baseInput,
      allocations: [
        { warehouseLocationId: "loc-1", quantity: 12 },
        { warehouseLocationId: "loc-2", quantity: 8 },
      ],
    });

    expect(FinishedGoodsPutawayRepository.createWithItemsInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        items: [
          { warehouseLocationId: "loc-1", quantity: 12, inventoryTransactionId: "txn-A" },
          { warehouseLocationId: "loc-2", quantity: 8, inventoryTransactionId: "txn-B" },
        ],
      })
    );
  });

  it("stores totalQuantity as the validated allocation sum, never independently recomputed", async () => {
    await putawayStock(actor, {
      ...baseInput,
      allocations: [{ warehouseLocationId: "loc-1", quantity: 20 }],
    });

    expect(FinishedGoodsPutawayRepository.createWithItemsInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ totalQuantity: 20 })
    );
  });

  it("generates the putaway number via the FG_PUTAWAY document type, scoped to the actor's company/branch", async () => {
    await putawayStock(actor, baseInput);
    expect(generateDocumentNumber).toHaveBeenCalledWith({ companyId: "co-1", branchId: "br-1", documentType: "FG_PUTAWAY" });
  });

  it("defaults branchId to null in the putaway number request when the actor carries none", async () => {
    await putawayStock({ companyId: "co-1", userId: "user-1" }, baseInput);
    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ branchId: null }));
  });

  it("writes a real audit log entry after a successful putaway", async () => {
    await putawayStock(actor, baseInput);

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        userId: "user-1",
        tableName: "finished_goods_putaways",
        recordId: "putaway-1",
        action: "CREATE",
        newValues: expect.objectContaining({ totalQuantity: 20, locationCount: 1 }),
      })
    );
  });

  it("never writes an audit log entry when the action is rejected", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue({ quantityOnHand: "0" } as never);

    await expect(putawayStock(actor, baseInput)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./inventory.repository", () => ({
  InventoryTransactionRepository: { create: vi.fn(), findLocationBreakdownForPair: vi.fn() },
  StockBalanceRepository: {
    upsertIncrement: vi.fn(),
    guardedDecrement: vi.fn(),
    findOne: vi.fn(),
    sumByProductIds: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  FinishedGoodsStockBalanceRepository: {
    upsertIncrement: vi.fn(),
    guardedDecrement: vi.fn(),
    findOne: vi.fn(),
  },
  InventoryScopeRepository: { findProductCompanyId: vi.fn(), findWarehouseCompanyId: vi.fn() },
}));

const { InventoryTransactionRepository, StockBalanceRepository, FinishedGoodsStockBalanceRepository, InventoryScopeRepository } = await import(
  "./inventory.repository"
);
const { recordInventoryTransaction, getAvailableQuantity, getFinishedGoodsSaleableQuantity, sumAvailableByProductIds, listStockBalances } =
  await import("./inventory.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
// Transaction client for the colour-balance writes (2026-10-21).
const tx = {
  stockBalance: { findFirst: vi.fn() },
  stockColorBalance: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn() },
};
const baseInput = {
  productId: "prod-1",
  warehouseId: "wh-1",
  transactionType: "MATERIAL_ISSUE" as const,
  referenceModule: "STOCK_MOVEMENT" as const,
  referenceRecordId: "ref-1",
};

beforeEach(() => {
  tx.stockBalance.findFirst.mockReset().mockResolvedValue({ quantityOnHand: 100 });
  tx.stockColorBalance.upsert.mockReset();
  tx.stockColorBalance.updateMany.mockReset().mockResolvedValue({ count: 1 });
  tx.stockColorBalance.findMany.mockReset().mockResolvedValue([]);
  tx.stockColorBalance.update.mockReset();
  vi.mocked(InventoryTransactionRepository.create).mockReset().mockResolvedValue({ id: "txn-1" } as never);
  vi.mocked(StockBalanceRepository.upsertIncrement).mockReset().mockResolvedValue({} as never);
  vi.mocked(StockBalanceRepository.guardedDecrement).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(StockBalanceRepository.findOne).mockReset();
  vi.mocked(StockBalanceRepository.sumByProductIds).mockReset();
  vi.mocked(StockBalanceRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(StockBalanceRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(FinishedGoodsStockBalanceRepository.upsertIncrement).mockReset().mockResolvedValue({} as never);
  vi.mocked(FinishedGoodsStockBalanceRepository.guardedDecrement).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockReset();
  vi.mocked(InventoryTransactionRepository.findLocationBreakdownForPair).mockReset();
  vi.mocked(InventoryScopeRepository.findProductCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
  vi.mocked(InventoryScopeRepository.findWarehouseCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
});

describe("recordInventoryTransaction", () => {
  it("rejects a product that doesn't belong to the acting company", async () => {
    vi.mocked(InventoryScopeRepository.findProductCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(InventoryTransactionRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a warehouse that doesn't belong to the acting company", async () => {
    vi.mocked(InventoryScopeRepository.findWarehouseCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a product/warehouse that doesn't exist at all", async () => {
    vi.mocked(InventoryScopeRepository.findProductCompanyId).mockResolvedValue(null);
    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses a plain upsert for a positive quantity (a receipt can never drive the balance negative)", async () => {
    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 25 });

    expect(StockBalanceRepository.upsertIncrement).toHaveBeenCalledWith(tx, "co-1", "prod-1", "wh-1", 25);
    expect(StockBalanceRepository.guardedDecrement).not.toHaveBeenCalled();
  });

  it("uses the atomic guarded decrement for a negative quantity, not a plain upsert", async () => {
    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -10 });

    expect(StockBalanceRepository.guardedDecrement).toHaveBeenCalledWith(tx, "co-1", "prod-1", "wh-1", 10, expect.closeTo(10, 3));
    expect(StockBalanceRepository.upsertIncrement).not.toHaveBeenCalled();
  });

  it("rejects the transaction when the guarded decrement affects zero rows — the P0 fix: no balance row, or an insufficient one, must never post", async () => {
    vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -10 })).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK_FOR_MOVEMENT",
    });
  });

  it("still writes the InventoryTransaction row before the guard check — the caller's own $transaction rolls it back on throw", async () => {
    vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -10 })).rejects.toThrow();
    // The ledger row insert still happens — atomicity is the caller's own
    // prisma.$transaction's job (this function never opens its own), so
    // throwing here is what causes the whole transaction to roll back,
    // including this insert.
    expect(InventoryTransactionRepository.create).toHaveBeenCalled();
  });

  it("passes the exact signed quantity through to the ledger row regardless of direction", async () => {
    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -10 });
    expect(InventoryTransactionRepository.create).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ quantity: -10, productId: "prod-1", warehouseId: "wh-1" })
    );
  });

  describe("Finished Goods Inventory module (FGI-010) — the new, purely additive branch", () => {
    it("never touches FinishedGoodsStockBalanceRepository at all when productVariantId/stockStatus are omitted — every existing caller's exact behavior", async () => {
      await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 25 });

      expect(FinishedGoodsStockBalanceRepository.upsertIncrement).not.toHaveBeenCalled();
      expect(FinishedGoodsStockBalanceRepository.guardedDecrement).not.toHaveBeenCalled();
    });

    it("rejects when productVariantId is supplied without stockStatus — an incomplete key is a caller bug, not a silent partial write", async () => {
      await expect(
        recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 5, productVariantId: "var-1" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(InventoryTransactionRepository.create).not.toHaveBeenCalled();
    });

    it("rejects when stockStatus is supplied without productVariantId", async () => {
      await expect(
        recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 5, stockStatus: "SALEABLE" })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("also records productVariantId/stockStatus directly on the ledger row itself when supplied", async () => {
      await recordInventoryTransaction(tx as never, actor, {
        ...baseInput,
        quantity: 25,
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      });

      expect(InventoryTransactionRepository.create).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ productVariantId: "var-1", stockStatus: "SALEABLE" })
      );
    });

    it("upserts the FinishedGoodsStockBalance row for a positive quantity, keyed on the full tuple including warehouseLocationId", async () => {
      await recordInventoryTransaction(tx as never, actor, {
        ...baseInput,
        warehouseLocationId: "loc-1",
        quantity: 25,
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      });

      expect(FinishedGoodsStockBalanceRepository.upsertIncrement).toHaveBeenCalledWith(
        tx,
        {
          companyId: "co-1",
          productId: "prod-1",
          productVariantId: "var-1",
          warehouseId: "wh-1",
          warehouseLocationId: "loc-1",
          stockStatus: "SALEABLE",
        },
        25
      );
      expect(FinishedGoodsStockBalanceRepository.guardedDecrement).not.toHaveBeenCalled();
    });

    it("defaults warehouseLocationId to null on the FG key when the ledger-level one is omitted (the 'unassigned/staging' bucket)", async () => {
      await recordInventoryTransaction(tx as never, actor, {
        ...baseInput,
        quantity: 25,
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      });

      expect(FinishedGoodsStockBalanceRepository.upsertIncrement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ warehouseLocationId: null }),
        25
      );
    });

    it("uses the guarded decrement for a negative quantity against the FG balance too, not a plain upsert", async () => {
      await recordInventoryTransaction(tx as never, actor, {
        ...baseInput,
        quantity: -10,
        productVariantId: "var-1",
        stockStatus: "SALEABLE",
      });

      expect(FinishedGoodsStockBalanceRepository.guardedDecrement).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ productVariantId: "var-1", stockStatus: "SALEABLE" }),
        10,
        expect.closeTo(10, 3)
      );
      expect(FinishedGoodsStockBalanceRepository.upsertIncrement).not.toHaveBeenCalled();
    });

    it("rejects with a Finished-Goods-specific message when the FG guarded decrement affects zero rows, even though the flat StockBalance guard already passed", async () => {
      // The flat guard passes (plenty of style-level stock), but this exact
      // variant/location/status combination has none — proving the two
      // checks are genuinely independent, not one gate standing in for both.
      vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 1 } as never);
      vi.mocked(FinishedGoodsStockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

      await expect(
        recordInventoryTransaction(tx as never, actor, {
          ...baseInput,
          quantity: -10,
          productVariantId: "var-1",
          stockStatus: "SALEABLE",
        })
      ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });
    });

    it("never reaches the FG branch at all when the flat StockBalance guard already rejected — the whole transaction aborts first", async () => {
      vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

      await expect(
        recordInventoryTransaction(tx as never, actor, {
          ...baseInput,
          quantity: -10,
          productVariantId: "var-1",
          stockStatus: "SALEABLE",
        })
      ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });
      expect(FinishedGoodsStockBalanceRepository.guardedDecrement).not.toHaveBeenCalled();
    });
  });
});

describe("getAvailableQuantity", () => {
  it("returns 0 when no balance row exists yet, not null/undefined", async () => {
    vi.mocked(StockBalanceRepository.findOne).mockResolvedValue(null);
    await expect(getAvailableQuantity("co-1", "prod-1", "wh-1")).resolves.toBe(0);
  });

  it("returns the real balance when one exists", async () => {
    vi.mocked(StockBalanceRepository.findOne).mockResolvedValue({ quantityOnHand: 42 } as never);
    await expect(getAvailableQuantity("co-1", "prod-1", "wh-1")).resolves.toBe(42);
  });
});

describe("getFinishedGoodsSaleableQuantity (FGI-010)", () => {
  it("returns 0 when no FinishedGoodsStockBalance row exists yet", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue(null);
    await expect(getFinishedGoodsSaleableQuantity("co-1", "prod-1", "var-1", "wh-1")).resolves.toBe(0);
  });

  it("returns the real balance when one exists, always scoped to SALEABLE status", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue({ quantityOnHand: 17 } as never);
    await expect(getFinishedGoodsSaleableQuantity("co-1", "prod-1", "var-1", "wh-1", "loc-1")).resolves.toBe(17);
    expect(FinishedGoodsStockBalanceRepository.findOne).toHaveBeenCalledWith({
      companyId: "co-1",
      productId: "prod-1",
      productVariantId: "var-1",
      warehouseId: "wh-1",
      warehouseLocationId: "loc-1",
      stockStatus: "SALEABLE",
    });
  });

  it("defaults warehouseLocationId to null when omitted", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.findOne).mockResolvedValue(null);
    await getFinishedGoodsSaleableQuantity("co-1", "prod-1", "var-1", "wh-1");
    expect(FinishedGoodsStockBalanceRepository.findOne).toHaveBeenCalledWith(expect.objectContaining({ warehouseLocationId: null }));
  });
});

describe("sumAvailableByProductIds", () => {
  it("returns an empty map for an empty input without querying", async () => {
    const result = await sumAvailableByProductIds("co-1", []);
    expect(result.size).toBe(0);
    expect(StockBalanceRepository.sumByProductIds).not.toHaveBeenCalled();
  });

  it("treats a product with no StockBalance row as absent from the map, not zero-filled", async () => {
    vi.mocked(StockBalanceRepository.sumByProductIds).mockResolvedValue([{ productId: "prod-1", _sum: { quantityOnHand: 100 } }] as never);
    const result = await sumAvailableByProductIds("co-1", ["prod-1", "prod-2"]);
    expect(result.get("prod-1")).toBe(100);
    expect(result.has("prod-2")).toBe(false);
  });
});

const listQuery = { page: 1, pageSize: 20, skip: 0, take: 20, sortBy: "updatedAt", sortOrder: "desc" as const };

describe("listStockBalances — real per-location breakdown, opt-in (2026-09-05, revised same day)", () => {
  it("does not derive locations at all when includeLocationBreakdown is omitted (the Excel export's own call shape)", async () => {
    vi.mocked(StockBalanceRepository.findMany).mockResolvedValue([{ productId: "prod-1", warehouseId: "wh-1" }] as never);

    const result = await listStockBalances("co-1", listQuery);

    expect(InventoryTransactionRepository.findLocationBreakdownForPair).not.toHaveBeenCalled();
    expect(result.data[0]).not.toHaveProperty("locations");
  });

  it("merges every location this product/warehouse pair genuinely has stock at, not just one", async () => {
    vi.mocked(StockBalanceRepository.findMany).mockResolvedValue([{ productId: "prod-1", warehouseId: "wh-1" }] as never);
    vi.mocked(InventoryTransactionRepository.findLocationBreakdownForPair).mockResolvedValue([
      { id: "loc-1", code: "A1", zone: "Zone A", rack: null, bin: null, quantity: 30 },
      { id: "loc-2", code: "B2", zone: "Zone B", rack: null, bin: null, quantity: 70 },
    ] as never);

    const result = await listStockBalances("co-1", listQuery, {}, { includeLocationBreakdown: true });

    expect(InventoryTransactionRepository.findLocationBreakdownForPair).toHaveBeenCalledWith("co-1", "prod-1", "wh-1");
    expect(result.data[0]).toMatchObject({
      locations: [
        { code: "A1", quantity: 30 },
        { code: "B2", quantity: 70 },
      ],
    });
  });

  it("reports an empty array, not a thrown error, when the ledger never recorded a location for this pair", async () => {
    vi.mocked(StockBalanceRepository.findMany).mockResolvedValue([{ productId: "prod-1", warehouseId: "wh-1" }] as never);
    vi.mocked(InventoryTransactionRepository.findLocationBreakdownForPair).mockResolvedValue([]);

    const result = await listStockBalances("co-1", listQuery, {}, { includeLocationBreakdown: true });

    expect(result.data[0]).toMatchObject({ locations: [] });
  });
});

// Colour-wise raw-material stock (2026-10-21).
describe("recordInventoryTransaction — colour balances", () => {
  beforeEach(() => {
    vi.mocked(InventoryScopeRepository.findProductCompanyId).mockResolvedValue({ companyId: "co-1" } as never);
    vi.mocked(InventoryScopeRepository.findWarehouseCompanyId).mockResolvedValue({ companyId: "co-1" } as never);
  });
  const key = { companyId: "co-1", productId: "prod-1", warehouseId: "wh-1" };

  it("adds a coloured receipt to that colour's balance and stores the colour on the ledger row", async () => {
    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: 25, colorId: "col-red" });

    expect(InventoryTransactionRepository.create).toHaveBeenCalledWith(tx, expect.objectContaining({ colorId: "col-red" }));
    expect(tx.stockColorBalance.upsert).toHaveBeenCalledWith({
      where: { companyId_productId_warehouseId_colorId: { ...key, colorId: "col-red" } },
      create: { ...key, colorId: "col-red", quantityOnHand: 25 },
      update: { quantityOnHand: { increment: 25 } },
    });
  });

  it("refuses a coloured issue larger than that colour holds", async () => {
    tx.stockColorBalance.updateMany.mockResolvedValue({ count: 0 });

    await expect(recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -10, colorId: "col-red" })).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK_FOR_MOVEMENT",
    });
    expect(tx.stockColorBalance.updateMany).toHaveBeenCalledWith({
      where: { ...key, colorId: "col-red", quantityOnHand: { gte: 10 - 0.0001 } },
      data: { quantityOnHand: { decrement: 10 } },
    });
  });

  it("an uncoloured issue takes 'No colour' stock first, then the largest colour", async () => {
    // After the issue the warehouse holds 30; Red 25 + Green 15 = 40 coloured -> 10 must come out of colours.
    tx.stockBalance.findFirst.mockResolvedValue({ quantityOnHand: 30 });
    tx.stockColorBalance.findMany.mockResolvedValue([
      { id: "row-red", quantityOnHand: 25 },
      { id: "row-green", quantityOnHand: 15 },
    ]);

    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -20 });

    expect(tx.stockColorBalance.update).toHaveBeenCalledTimes(1);
    expect(tx.stockColorBalance.update).toHaveBeenCalledWith({ where: { id: "row-red" }, data: { quantityOnHand: { decrement: 10 } } });
  });

  it("an uncoloured issue covered by 'No colour' stock leaves colours untouched", async () => {
    tx.stockBalance.findFirst.mockResolvedValue({ quantityOnHand: 50 });
    tx.stockColorBalance.findMany.mockResolvedValue([{ id: "row-red", quantityOnHand: 25 }]);

    await recordInventoryTransaction(tx as never, actor, { ...baseInput, quantity: -20 });

    expect(tx.stockColorBalance.update).not.toHaveBeenCalled();
  });
});

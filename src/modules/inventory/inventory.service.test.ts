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
  InventoryScopeRepository: { findProductCompanyId: vi.fn(), findWarehouseCompanyId: vi.fn() },
}));

const { InventoryTransactionRepository, StockBalanceRepository, InventoryScopeRepository } = await import("./inventory.repository");
const { recordInventoryTransaction, getAvailableQuantity, sumAvailableByProductIds, listStockBalances } = await import("./inventory.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const baseInput = {
  productId: "prod-1",
  warehouseId: "wh-1",
  transactionType: "MATERIAL_ISSUE" as const,
  referenceModule: "STOCK_MOVEMENT" as const,
  referenceRecordId: "ref-1",
};

beforeEach(() => {
  vi.mocked(InventoryTransactionRepository.create).mockReset().mockResolvedValue({ id: "txn-1" } as never);
  vi.mocked(StockBalanceRepository.upsertIncrement).mockReset().mockResolvedValue({} as never);
  vi.mocked(StockBalanceRepository.guardedDecrement).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(StockBalanceRepository.findOne).mockReset();
  vi.mocked(StockBalanceRepository.sumByProductIds).mockReset();
  vi.mocked(StockBalanceRepository.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(StockBalanceRepository.count).mockReset().mockResolvedValue(0);
  vi.mocked(InventoryTransactionRepository.findLocationBreakdownForPair).mockReset();
  vi.mocked(InventoryScopeRepository.findProductCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
  vi.mocked(InventoryScopeRepository.findWarehouseCompanyId).mockReset().mockResolvedValue({ companyId: "co-1" } as never);
});

describe("recordInventoryTransaction", () => {
  it("rejects a product that doesn't belong to the acting company", async () => {
    vi.mocked(InventoryScopeRepository.findProductCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(InventoryTransactionRepository.create).not.toHaveBeenCalled();
  });

  it("rejects a warehouse that doesn't belong to the acting company", async () => {
    vi.mocked(InventoryScopeRepository.findWarehouseCompanyId).mockResolvedValue({ companyId: "co-2" } as never);
    await expect(recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a product/warehouse that doesn't exist at all", async () => {
    vi.mocked(InventoryScopeRepository.findProductCompanyId).mockResolvedValue(null);
    await expect(recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses a plain upsert for a positive quantity (a receipt can never drive the balance negative)", async () => {
    await recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: 25 });

    expect(StockBalanceRepository.upsertIncrement).toHaveBeenCalledWith({}, "co-1", "prod-1", "wh-1", 25);
    expect(StockBalanceRepository.guardedDecrement).not.toHaveBeenCalled();
  });

  it("uses the atomic guarded decrement for a negative quantity, not a plain upsert", async () => {
    await recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: -10 });

    expect(StockBalanceRepository.guardedDecrement).toHaveBeenCalledWith({}, "co-1", "prod-1", "wh-1", 10, expect.closeTo(10, 3));
    expect(StockBalanceRepository.upsertIncrement).not.toHaveBeenCalled();
  });

  it("rejects the transaction when the guarded decrement affects zero rows — the P0 fix: no balance row, or an insufficient one, must never post", async () => {
    vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

    await expect(recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: -10 })).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK_FOR_MOVEMENT",
    });
  });

  it("still writes the InventoryTransaction row before the guard check — the caller's own $transaction rolls it back on throw", async () => {
    vi.mocked(StockBalanceRepository.guardedDecrement).mockResolvedValue({ count: 0 } as never);

    await expect(recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: -10 })).rejects.toThrow();
    // The ledger row insert still happens — atomicity is the caller's own
    // prisma.$transaction's job (this function never opens its own), so
    // throwing here is what causes the whole transaction to roll back,
    // including this insert.
    expect(InventoryTransactionRepository.create).toHaveBeenCalled();
  });

  it("passes the exact signed quantity through to the ledger row regardless of direction", async () => {
    await recordInventoryTransaction({} as never, actor, { ...baseInput, quantity: -10 });
    expect(InventoryTransactionRepository.create).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ quantity: -10, productId: "prod-1", warehouseId: "wh-1" })
    );
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

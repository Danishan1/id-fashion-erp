import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-reconciliation.repository", () => ({
  FinishedGoodsReconciliationRepository: {
    groupByProductWarehouse: vi.fn(),
    findManyStockBalances: vi.fn(),
  },
}));

const { FinishedGoodsReconciliationRepository } = await import("./finished-goods-reconciliation.repository");
const { getFinishedGoodsReconciliationReport } = await import("./finished-goods-reconciliation.service");

beforeEach(() => {
  vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockReset();
  vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockReset().mockResolvedValue([]);
});

describe("getFinishedGoodsReconciliationReport", () => {
  it("returns an empty report and never queries StockBalance at all when the company has no FG-tracked rows", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([]);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result).toEqual([]);
    expect(FinishedGoodsReconciliationRepository.findManyStockBalances).not.toHaveBeenCalled();
  });

  it("reports a clean pair (StockBalance exactly matches the FG sum) as hasMismatch: false, drift: 0", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 100 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", quantityOnHand: 100 },
    ] as never);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result).toEqual([
      { productId: "prod-1", warehouseId: "wh-1", stockBalanceQuantity: 100, finishedGoodsSumQuantity: 100, drift: 0, hasMismatch: false },
    ]);
  });

  it("flags a real drift (the deliberately-corrupted fixture case): StockBalance ahead of the FG sum", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 70 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", quantityOnHand: 100 },
    ] as never);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result[0]).toMatchObject({ stockBalanceQuantity: 100, finishedGoodsSumQuantity: 70, drift: 30, hasMismatch: true });
  });

  it("flags a real drift the other direction too: the FG sum ahead of StockBalance", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 100 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", quantityOnHand: 70 },
    ] as never);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result[0]).toMatchObject({ drift: -30, hasMismatch: true });
  });

  it("treats a missing StockBalance row as 0, not an error — and still correctly flags the mismatch against a real FG sum", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 50 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([]);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result[0]).toMatchObject({ stockBalanceQuantity: 0, finishedGoodsSumQuantity: 50, drift: -50, hasMismatch: true });
  });

  it("does not flag a drift within the project's own EPSILON tolerance (0.0001) as a mismatch", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 99.99995 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", quantityOnHand: 100 },
    ] as never);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result[0].hasMismatch).toBe(false);
  });

  it("handles multiple distinct (productId, warehouseId) pairs in one batch, correctly matching each to its own StockBalance row", async () => {
    vi.mocked(FinishedGoodsReconciliationRepository.groupByProductWarehouse).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", sumQuantityOnHand: 100 },
      { productId: "prod-2", warehouseId: "wh-1", sumQuantityOnHand: 40 },
      { productId: "prod-1", warehouseId: "wh-2", sumQuantityOnHand: 10 },
    ]);
    vi.mocked(FinishedGoodsReconciliationRepository.findManyStockBalances).mockResolvedValue([
      { productId: "prod-1", warehouseId: "wh-1", quantityOnHand: 100 },
      { productId: "prod-2", warehouseId: "wh-1", quantityOnHand: 999 }, // deliberately corrupted
      { productId: "prod-1", warehouseId: "wh-2", quantityOnHand: 10 },
    ] as never);

    const result = await getFinishedGoodsReconciliationReport("co-1");

    expect(result).toHaveLength(3);
    expect(result.find((r) => r.productId === "prod-1" && r.warehouseId === "wh-1")).toMatchObject({ hasMismatch: false });
    expect(result.find((r) => r.productId === "prod-2" && r.warehouseId === "wh-1")).toMatchObject({ drift: 959, hasMismatch: true });
    expect(result.find((r) => r.productId === "prod-1" && r.warehouseId === "wh-2")).toMatchObject({ hasMismatch: false });

    // Batch fetch, not N+1 — exactly one call to findManyStockBalances regardless of row count.
    expect(FinishedGoodsReconciliationRepository.findManyStockBalances).toHaveBeenCalledTimes(1);
    expect(FinishedGoodsReconciliationRepository.findManyStockBalances).toHaveBeenCalledWith(
      "co-1",
      expect.arrayContaining(["prod-1", "prod-2"]),
      expect.arrayContaining(["wh-1", "wh-2"])
    );
  });
});

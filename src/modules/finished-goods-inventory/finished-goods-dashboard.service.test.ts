import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-dashboard.repository", () => ({
  FinishedGoodsDashboardRepository: {
    sumSaleable: vi.fn(),
    sumRejected: vi.fn(),
    countDistinctStyles: vi.fn(),
    countFinishedGoodsWarehouses: vi.fn(),
    findManyUnallocatedLegacyStock: vi.fn(),
  },
}));

const { FinishedGoodsDashboardRepository } = await import("./finished-goods-dashboard.repository");
const { getFinishedGoodsDashboard } = await import("./finished-goods-dashboard.service");

beforeEach(() => {
  vi.mocked(FinishedGoodsDashboardRepository.sumSaleable).mockReset().mockResolvedValue({ _sum: { quantityOnHand: null } } as never);
  vi.mocked(FinishedGoodsDashboardRepository.sumRejected).mockReset().mockResolvedValue({ _sum: { quantityOnHand: null } } as never);
  vi.mocked(FinishedGoodsDashboardRepository.countDistinctStyles).mockReset().mockResolvedValue([]);
  vi.mocked(FinishedGoodsDashboardRepository.countFinishedGoodsWarehouses).mockReset().mockResolvedValue(0);
  vi.mocked(FinishedGoodsDashboardRepository.findManyUnallocatedLegacyStock).mockReset().mockResolvedValue([]);
});

describe("getFinishedGoodsDashboard (FGI-050)", () => {
  it("returns all-zero tiles and an empty unallocated list for a company with no FG data at all", async () => {
    const result = await getFinishedGoodsDashboard("co-1");

    expect(result).toEqual({
      totalSaleableQuantity: 0,
      totalRejectedQuantity: 0,
      distinctStyleCount: 0,
      finishedGoodsWarehouseCount: 0,
      unallocatedLegacyStock: [],
    });
  });

  it("sums Saleable and Rejected quantities separately, never combining them into one figure", async () => {
    vi.mocked(FinishedGoodsDashboardRepository.sumSaleable).mockResolvedValue({ _sum: { quantityOnHand: 500 } } as never);
    vi.mocked(FinishedGoodsDashboardRepository.sumRejected).mockResolvedValue({ _sum: { quantityOnHand: 12 } } as never);

    const result = await getFinishedGoodsDashboard("co-1");

    expect(result.totalSaleableQuantity).toBe(500);
    expect(result.totalRejectedQuantity).toBe(12);
  });

  it("counts distinct styles from the number of rows returned, not a quantity sum", async () => {
    vi.mocked(FinishedGoodsDashboardRepository.countDistinctStyles).mockResolvedValue([{ productId: "p-1" }, { productId: "p-2" }] as never);

    const result = await getFinishedGoodsDashboard("co-1");

    expect(result.distinctStyleCount).toBe(2);
  });

  it("maps every unallocated-legacy-stock row with its real style and warehouse display fields", async () => {
    vi.mocked(FinishedGoodsDashboardRepository.findManyUnallocatedLegacyStock).mockResolvedValue([
      {
        product: { id: "prod-1", styleCode: "ST-001", styleName: "Classic Tee" },
        warehouse: { id: "wh-1", code: "WH1", name: "Main Warehouse" },
        quantityOnHand: 42,
      },
    ] as never);

    const result = await getFinishedGoodsDashboard("co-1");

    expect(result.unallocatedLegacyStock).toEqual([
      { productId: "prod-1", styleCode: "ST-001", styleName: "Classic Tee", warehouseId: "wh-1", warehouseCode: "WH1", warehouseName: "Main Warehouse", quantity: 42 },
    ]);
  });

  it("queries every aggregate concurrently (Promise.all), not sequentially", async () => {
    const callOrder: string[] = [];
    vi.mocked(FinishedGoodsDashboardRepository.sumSaleable).mockImplementation((async () => {
      callOrder.push("sumSaleable-start");
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push("sumSaleable-end");
      return { _sum: { quantityOnHand: 0 } };
    }) as never);
    vi.mocked(FinishedGoodsDashboardRepository.countFinishedGoodsWarehouses).mockImplementation((async () => {
      callOrder.push("countWarehouses-start");
      return 0;
    }) as never);

    await getFinishedGoodsDashboard("co-1");

    // If these ran sequentially, "countWarehouses-start" would only appear
    // after "sumSaleable-end" — concurrently, it fires while sumSaleable is
    // still awaiting its own artificial delay.
    expect(callOrder.indexOf("countWarehouses-start")).toBeLessThan(callOrder.indexOf("sumSaleable-end"));
  });
});

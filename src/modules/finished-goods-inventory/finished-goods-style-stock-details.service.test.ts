import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-style-stock-details.repository", () => ({
  FinishedGoodsStyleStockDetailsRepository: {
    sumSaleableForProduct: vi.fn(),
    sumRejectedForProduct: vi.fn(),
    countDistinctVariantsForProduct: vi.fn(),
    countDistinctWarehousesForProduct: vi.fn(),
    findActiveOrderLinesForProduct: vi.fn(),
  },
}));

vi.mock("@/modules/products/product.service", () => ({
  getProductById: vi.fn(),
}));

const { FinishedGoodsStyleStockDetailsRepository } = await import("./finished-goods-style-stock-details.repository");
const { getProductById } = await import("@/modules/products/product.service");
const { getStyleStockSummary } = await import("./finished-goods-style-stock-details.service");

beforeEach(() => {
  vi.mocked(getProductById)
    .mockReset()
    .mockResolvedValue({ id: "prod-1", styleCode: "ST-001", styleName: "Classic Tee" } as never);
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct)
    .mockReset()
    .mockResolvedValue({ _sum: { quantityOnHand: null } } as never);
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct)
    .mockReset()
    .mockResolvedValue({ _sum: { quantityOnHand: null } } as never);
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct).mockReset().mockResolvedValue([]);
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct).mockReset().mockResolvedValue([]);
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockReset().mockResolvedValue([]);
});

describe("getStyleStockSummary (FGI-052)", () => {
  it("re-throws getProductById's own NOT_FOUND for a missing/wrong-company/non-Style id, without touching any FG repository call", async () => {
    vi.mocked(getProductById).mockRejectedValue(new Error("Style not found."));

    await expect(getStyleStockSummary("co-1", "prod-x")).rejects.toThrow("Style not found.");
    expect(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).not.toHaveBeenCalled();
  });

  it("returns all-zero figures for a real style with no FG stock recorded at all", async () => {
    const result = await getStyleStockSummary("co-1", "prod-1");

    expect(result).toEqual({
      product: { id: "prod-1", styleCode: "ST-001", styleName: "Classic Tee" },
      saleableQuantity: 0,
      rejectedQuantity: 0,
      distinctVariantCount: 0,
      distinctWarehouseCount: 0,
      allocatedQuantity: 0,
      unallocatedQuantity: 0,
    });
  });

  it("sums Saleable and Rejected quantities separately, never combining them into one figure", async () => {
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 220 } } as never);
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct).mockResolvedValue({ _sum: { quantityOnHand: 5 } } as never);

    const result = await getStyleStockSummary("co-1", "prod-1");

    expect(result.saleableQuantity).toBe(220);
    expect(result.rejectedQuantity).toBe(5);
  });

  it("counts distinct variants/warehouses from the number of distinct rows returned, not a quantity sum", async () => {
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct).mockResolvedValue([
      { productVariantId: "var-1" },
      { productVariantId: "var-2" },
    ] as never);
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct).mockResolvedValue([{ warehouseId: "wh-1" }] as never);

    const result = await getStyleStockSummary("co-1", "prod-1");

    expect(result.distinctVariantCount).toBe(2);
    expect(result.distinctWarehouseCount).toBe(1);
  });

  it("scopes every repository call to the given companyId and productId", async () => {
    await getStyleStockSummary("co-1", "prod-1");

    expect(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).toHaveBeenCalledWith("co-1", "prod-1");
    expect(FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct).toHaveBeenCalledWith("co-1", "prod-1");
    expect(FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct).toHaveBeenCalledWith("co-1", "prod-1");
    expect(FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct).toHaveBeenCalledWith("co-1", "prod-1");
    expect(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).toHaveBeenCalledWith("co-1", "prod-1");
  });

  describe("allocated / unallocated quantity (process-flow clarity fix, 2026-10-16)", () => {
    it("matches the spec's own worked example: 100 ordered, 150 produced-to-stock -> 50 unallocated", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 150 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(100);
      expect(result.unallocatedQuantity).toBe(50);
    });

    it("sums claims across multiple active order lines before subtracting from on-hand stock", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 300 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
        { regularDispatchedQuantity: 20, breakdown: [{ orderedQuantity: 80 }] }, // claim 60
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(160);
      expect(result.unallocatedQuantity).toBe(140);
    });

    it("never goes negative when active claims exceed real on-hand stock (production still catching up)", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 40 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(100);
      expect(result.unallocatedQuantity).toBe(0);
    });

    it("a fully-regular-dispatched line contributes zero claim, even if the order itself is still open", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 50 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(0);
      expect(result.unallocatedQuantity).toBe(50);
    });

    it("sums a multi-row breakdown (size/color split) into one ordered total per line", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 100 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 30 }, { orderedQuantity: 40 }] },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(70);
    });
  });

  it("queries every aggregate concurrently (Promise.all), not sequentially", async () => {
    const callOrder: string[] = [];
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockImplementation((async () => {
      callOrder.push("sumSaleable-start");
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push("sumSaleable-end");
      return { _sum: { quantityOnHand: 0 } };
    }) as never);
    vi.mocked(FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct).mockImplementation((async () => {
      callOrder.push("countWarehouses-start");
      return [];
    }) as never);

    await getStyleStockSummary("co-1", "prod-1");

    expect(callOrder.indexOf("countWarehouses-start")).toBeLessThan(callOrder.indexOf("sumSaleable-end"));
  });
});

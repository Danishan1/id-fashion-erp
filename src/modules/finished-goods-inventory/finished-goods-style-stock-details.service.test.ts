import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-style-stock-details.repository", () => ({
  FinishedGoodsStyleStockDetailsRepository: {
    sumSaleableForProduct: vi.fn(),
    sumRejectedForProduct: vi.fn(),
    countDistinctVariantsForProduct: vi.fn(),
    countDistinctWarehousesForProduct: vi.fn(),
    findActiveOrderLinesForProduct: vi.fn(),
    findActiveReservationsForProduct: vi.fn(),
  },
}));

vi.mock("@/modules/products/product.service", () => ({
  getProductById: vi.fn(),
}));

vi.mock("@/modules/products/product.repository", () => ({
  ProductVariantRepository: { findManyActiveByProductId: vi.fn() },
}));

vi.mock("@/modules/production/production-progress.service", () => ({
  getSalesOrderItemProductionSummary: vi.fn(),
}));

const { FinishedGoodsStyleStockDetailsRepository } = await import("./finished-goods-style-stock-details.repository");
const { getProductById } = await import("@/modules/products/product.service");
const { ProductVariantRepository } = await import("@/modules/products/product.repository");
const { getSalesOrderItemProductionSummary } = await import("@/modules/production/production-progress.service");
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
  vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct).mockReset().mockResolvedValue([]);
  // No configured variants by default — every pre-existing test (none of
  // which know about the variant-bearing/no-variant branch) exercises the
  // no-variant, production-capped formula path, matching the original
  // (pre-reservation) behavior for an empty active-order-lines list.
  vi.mocked(ProductVariantRepository.findManyActiveByProductId).mockReset().mockResolvedValue([]);
  vi.mocked(getSalesOrderItemProductionSummary).mockReset();
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
    expect(FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct).toHaveBeenCalledWith("co-1", "prod-1");
    expect(ProductVariantRepository.findManyActiveByProductId).toHaveBeenCalledWith("prod-1");
  });

  describe("no-variant style — production-capped formula (process-flow Phase 1 correction, 2026-10-16)", () => {
    // No configured variants (the beforeEach default) — this branch always
    // applies for these tests.

    it("caps a freshly-confirmed order's claim at zero real production — the corrected rule: unproduced quantity must never claim/hide existing stock", async () => {
      // Ordered 100, zero regular-dispatched, but NOTHING has been produced
      // yet for this line. A pre-existing 150 units of real stock (from some
      // other, unrelated source) must show as fully available, not hidden
      // behind this order's own not-yet-produced demand.
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 150 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockResolvedValue({ totalProduced: 0 } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(0);
      expect(result.unallocatedQuantity).toBe(150);
    });

    it("matches the spec's own worked example once production exists: 100 ordered, 150 produced-to-stock -> 50 unallocated", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 150 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockResolvedValue({ totalProduced: 150 } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(100);
      expect(result.unallocatedQuantity).toBe(50);
    });

    it("caps the claim at real production even when that's LESS than the ordered quantity (production still catching up)", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 40 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockResolvedValue({ totalProduced: 40 } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(40);
      expect(result.unallocatedQuantity).toBe(0);
    });

    it("sums capped claims across multiple active order lines, fetching production per line concurrently", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 300 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] },
        { id: "soi-2", regularDispatchedQuantity: 20, breakdown: [{ orderedQuantity: 80 }] }, // claim 60
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockImplementation(async (_companyId, id) =>
        ({ "soi-1": { totalProduced: 100 }, "soi-2": { totalProduced: 100 } })[id as string] as never
      );

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(160);
      expect(result.unallocatedQuantity).toBe(140);
      expect(getSalesOrderItemProductionSummary).toHaveBeenCalledWith("co-1", "soi-1");
      expect(getSalesOrderItemProductionSummary).toHaveBeenCalledWith("co-1", "soi-2");
    });

    it("a fully-regular-dispatched line contributes zero claim, even if the order itself is still open", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 50 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] },
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockResolvedValue({ totalProduced: 100 } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(0);
      expect(result.unallocatedQuantity).toBe(50);
    });

    it("sums a multi-row breakdown (size/color split) into one ordered total per line before capping", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 100 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct).mockResolvedValue([
        { id: "soi-1", regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 30 }, { orderedQuantity: 40 }] },
      ] as never);
      vi.mocked(getSalesOrderItemProductionSummary).mockResolvedValue({ totalProduced: 100 } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(70);
    });
  });

  describe("variant-bearing style — real reservation lifecycle (process-flow Phase 1, 2026-10-16)", () => {
    beforeEach(() => {
      vi.mocked(ProductVariantRepository.findManyActiveByProductId).mockResolvedValue([{ id: "var-1" }, { id: "var-2" }] as never);
    });

    it("never calls getSalesOrderItemProductionSummary for a variant-bearing style — reservations are the whole story", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 150 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct).mockResolvedValue([
        { productVariantId: "var-1", reservedQuantity: 100, consumedQuantity: 0 },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(100);
      expect(result.unallocatedQuantity).toBe(50);
      expect(getSalesOrderItemProductionSummary).not.toHaveBeenCalled();
    });

    it("sums reservedQuantity minus consumedQuantity across every ACTIVE reservation", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 100 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct).mockResolvedValue([
        { productVariantId: "var-1", reservedQuantity: 40, consumedQuantity: 15 }, // unconsumed 25
        { productVariantId: "var-2", reservedQuantity: 30, consumedQuantity: 30 }, // fully consumed, contributes 0
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(25);
      expect(result.unallocatedQuantity).toBe(75);
    });

    it("a reservation with zero on-hand stock correctly floors unallocated at 0, never negative", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 10 } } as never);
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct).mockResolvedValue([
        { productVariantId: "var-1", reservedQuantity: 40, consumedQuantity: 0 },
      ] as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(40);
      expect(result.unallocatedQuantity).toBe(0);
    });

    it("no active reservations at all -> everything on hand is unallocated", async () => {
      vi.mocked(FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct).mockResolvedValue({ _sum: { quantityOnHand: 80 } } as never);

      const result = await getStyleStockSummary("co-1", "prod-1");

      expect(result.allocatedQuantity).toBe(0);
      expect(result.unallocatedQuantity).toBe(80);
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

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-reservation.repository", () => ({
  FinishedGoodsReservationRepository: {
    createMany: vi.fn(),
    findById: vi.fn(),
    findByIdInTx: vi.fn(),
    findActiveForSalesOrderLineIds: vi.fn(),
    sumActiveUnconsumedForVariant: vi.fn(),
    sumActiveUnconsumedForLineVariant: vi.fn(),
    guardedConsume: vi.fn(),
    guardedRelease: vi.fn(),
    releaseAllActiveForSalesOrderLineIdsInTx: vi.fn(),
    findActiveForLineAndVariantInTx: vi.fn(),
    upsertIncrementCappedInTx: vi.fn(),
  },
}));
// Finished Goods Inventory module (FGI-041).
vi.mock("@/modules/inventory/inventory.repository", () => ({
  FinishedGoodsStockBalanceRepository: { sumSaleableAcrossLocations: vi.fn() },
}));

const { FinishedGoodsReservationRepository } = await import("./finished-goods-reservation.repository");
const { FinishedGoodsStockBalanceRepository } = await import("@/modules/inventory/inventory.repository");
const {
  createReservationsForSalesOrderInTx,
  consumeReservation,
  releaseReservation,
  releaseActiveReservationsForSalesOrderInTx,
  getCommittedReservationQuantity,
  getFinishedGoodsAvailableQuantity,
  getFinishedGoodsAvailableForOrderLine,
  consumeReservationForDispatchInTx,
  applyPackingCompletionReservationsInTx,
} = await import("./finished-goods-reservation.service");

const tx = {
  salesOrderItem: { findMany: vi.fn(), findUnique: vi.fn() },
  salesOrderLine: { findMany: vi.fn() },
  productionOrder: { findUnique: vi.fn() },
} as never;

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(FinishedGoodsReservationRepository.createMany).mockReset().mockResolvedValue({ count: 0 } as never);
  vi.mocked(FinishedGoodsReservationRepository.findById).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.findActiveForSalesOrderLineIds).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.guardedRelease).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockReset();
  vi.mocked(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).mockReset().mockResolvedValue([] as never);
  vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockReset();
  (tx as unknown as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockReset();
  (tx as unknown as { salesOrderLine: { findMany: ReturnType<typeof vi.fn> } }).salesOrderLine.findMany.mockReset();
  (tx as unknown as { salesOrderItem: { findUnique: ReturnType<typeof vi.fn> } }).salesOrderItem.findUnique.mockReset();
  (tx as unknown as { productionOrder: { findUnique: ReturnType<typeof vi.fn> } }).productionOrder.findUnique.mockReset();
});

describe("createReservationsForSalesOrderInTx", () => {
  it("creates one reservation per distinct (salesOrderLineId, productVariantId) pair", async () => {
    (tx as never as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockResolvedValue([
      {
        salesOrderLineId: "line-1",
        breakdown: [
          { productVariantId: "var-1", orderedQuantity: 10 },
          { productVariantId: "var-2", orderedQuantity: 5 },
        ],
      },
    ]);

    const result = await createReservationsForSalesOrderInTx(tx, actor, "so-1");

    expect(FinishedGoodsReservationRepository.createMany).toHaveBeenCalledWith(tx, [
      { companyId: "co-1", branchId: "br-1", salesOrderLineId: "line-1", productVariantId: "var-1", warehouseId: null, reservedQuantity: 10 },
      { companyId: "co-1", branchId: "br-1", salesOrderLineId: "line-1", productVariantId: "var-2", warehouseId: null, reservedQuantity: 5 },
    ]);
    expect(result).toHaveLength(2);
  });

  it("sums orderedQuantity across multiple item rows sharing the same (line, variant) pair", async () => {
    (tx as never as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockResolvedValue([
      { salesOrderLineId: "line-1", breakdown: [{ productVariantId: "var-1", orderedQuantity: 10 }] },
      { salesOrderLineId: "line-1", breakdown: [{ productVariantId: "var-1", orderedQuantity: 7 }] },
    ]);

    await createReservationsForSalesOrderInTx(tx, actor, "so-1");

    expect(FinishedGoodsReservationRepository.createMany).toHaveBeenCalledWith(tx, [
      expect.objectContaining({ salesOrderLineId: "line-1", productVariantId: "var-1", reservedQuantity: 17 }),
    ]);
  });

  it("skips items with no salesOrderLineId (legacy/test rows) rather than crashing", async () => {
    (tx as never as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockResolvedValue([
      { salesOrderLineId: null, breakdown: [{ productVariantId: "var-1", orderedQuantity: 10 }] },
      { salesOrderLineId: "line-2", breakdown: [{ productVariantId: "var-2", orderedQuantity: 3 }] },
    ]);

    const result = await createReservationsForSalesOrderInTx(tx, actor, "so-1");

    expect(result).toEqual([expect.objectContaining({ salesOrderLineId: "line-2", productVariantId: "var-2", reservedQuantity: 3 })]);
  });

  it("creates nothing and never calls createMany when there's nothing to reserve", async () => {
    (tx as never as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockResolvedValue([]);

    const result = await createReservationsForSalesOrderInTx(tx, actor, "so-1");

    expect(result).toEqual([]);
    expect(FinishedGoodsReservationRepository.createMany).not.toHaveBeenCalled();
  });

  it("defaults branchId to null when the actor carries none", async () => {
    (tx as never as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockResolvedValue([
      { salesOrderLineId: "line-1", breakdown: [{ productVariantId: "var-1", orderedQuantity: 10 }] },
    ]);

    await createReservationsForSalesOrderInTx(tx, { companyId: "co-1", userId: "user-1" }, "so-1");

    expect(FinishedGoodsReservationRepository.createMany).toHaveBeenCalledWith(tx, [expect.objectContaining({ branchId: null })]);
  });
});

describe("consumeReservation", () => {
  it("resolves silently when the guarded raw-SQL update affects a row", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(1);
    await expect(consumeReservation(tx, "res-1", 10)).resolves.toBeUndefined();
    expect(FinishedGoodsReservationRepository.findByIdInTx).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the guard affects zero rows and the reservation doesn't exist at all", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(0);
    vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockResolvedValue(null);

    await expect(consumeReservation(tx, "res-1", 10)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws RESERVATION_NOT_ACTIVE when the guard fails because the reservation is already RELEASED/FULFILLED", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(0);
    vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockResolvedValue({
      id: "res-1",
      status: "RELEASED",
      reservedQuantity: 100,
      consumedQuantity: 0,
    } as never);

    await expect(consumeReservation(tx, "res-1", 10)).rejects.toMatchObject({ code: "RESERVATION_NOT_ACTIVE" });
  });

  it("throws OVER_CONSUMPTION_NOT_ALLOWED with the exact remaining amount when the increment would overshoot", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(0);
    vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockResolvedValue({
      id: "res-1",
      status: "ACTIVE",
      reservedQuantity: 100,
      consumedQuantity: 60,
    } as never);

    await expect(consumeReservation(tx, "res-1", 50)).rejects.toMatchObject({
      code: "OVER_CONSUMPTION_NOT_ALLOWED",
      details: { reservationId: "res-1", requested: 50, remaining: 40 },
    });
  });
});

describe("releaseReservation", () => {
  it("resolves silently when the guarded release affects a row", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedRelease).mockResolvedValue({ count: 1 } as never);
    await expect(releaseReservation(tx, "res-1")).resolves.toBeUndefined();
  });

  it("throws NOT_FOUND when the reservation doesn't exist", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedRelease).mockResolvedValue({ count: 0 } as never);
    vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockResolvedValue(null);

    await expect(releaseReservation(tx, "res-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws RESERVATION_NOT_ACTIVE when releasing an already-FULFILLED reservation", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedRelease).mockResolvedValue({ count: 0 } as never);
    vi.mocked(FinishedGoodsReservationRepository.findByIdInTx).mockResolvedValue({ id: "res-1", status: "FULFILLED" } as never);

    await expect(releaseReservation(tx, "res-1")).rejects.toMatchObject({ code: "RESERVATION_NOT_ACTIVE" });
  });

  it("never touches reservedQuantity/consumedQuantity itself — only the repository's status-only update is called", async () => {
    vi.mocked(FinishedGoodsReservationRepository.guardedRelease).mockResolvedValue({ count: 1 } as never);
    await releaseReservation(tx, "res-1");
    expect(FinishedGoodsReservationRepository.guardedRelease).toHaveBeenCalledWith(tx, "res-1");
  });
});

describe("releaseActiveReservationsForSalesOrderInTx", () => {
  it("returns 0 and never calls the repository release when the order has no lines", async () => {
    (tx as never as { salesOrderLine: { findMany: ReturnType<typeof vi.fn> } }).salesOrderLine.findMany.mockResolvedValue([]);

    const result = await releaseActiveReservationsForSalesOrderInTx(tx, "so-1");

    expect(result).toBe(0);
    expect(FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx).not.toHaveBeenCalled();
  });

  it("releases every ACTIVE reservation across all of the order's lines and returns the affected count", async () => {
    (tx as never as { salesOrderLine: { findMany: ReturnType<typeof vi.fn> } }).salesOrderLine.findMany.mockResolvedValue([
      { id: "line-1" },
      { id: "line-2" },
    ]);
    vi.mocked(FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx).mockResolvedValue({ count: 3 } as never);

    const result = await releaseActiveReservationsForSalesOrderInTx(tx, "so-1");

    expect(FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx).toHaveBeenCalledWith(tx, ["line-1", "line-2"]);
    expect(result).toBe(3);
  });

  it("is idempotent — a second call against an order whose reservations are already all non-ACTIVE affects zero rows, not an error", async () => {
    (tx as never as { salesOrderLine: { findMany: ReturnType<typeof vi.fn> } }).salesOrderLine.findMany.mockResolvedValue([{ id: "line-1" }]);
    vi.mocked(FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx).mockResolvedValue({ count: 0 } as never);

    await expect(releaseActiveReservationsForSalesOrderInTx(tx, "so-1")).resolves.toBe(0);
  });
});

describe("getCommittedReservationQuantity", () => {
  it("delegates to the repository's sum helper with the exact arguments", async () => {
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(42);

    await expect(getCommittedReservationQuantity("co-1", "var-1", "wh-1")).resolves.toBe(42);
    expect(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).toHaveBeenCalledWith("co-1", "var-1", "wh-1");
  });
});

describe("getFinishedGoodsAvailableQuantity (FGI-041)", () => {
  it("is Saleable (summed across every location) minus committed reservations", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockResolvedValue(100);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(30);

    await expect(getFinishedGoodsAvailableQuantity("co-1", "prod-1", "var-1", "wh-1")).resolves.toBe(70);
    expect(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).toHaveBeenCalledWith("co-1", "prod-1", "var-1", "wh-1");
    expect(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).toHaveBeenCalledWith("co-1", "var-1", "wh-1");
  });

  it("can go negative when reservations across the company exceed real Saleable stock — the caller's own pre-check comparison handles that, not this function", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockResolvedValue(10);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(25);

    await expect(getFinishedGoodsAvailableQuantity("co-1", "prod-1", "var-1", "wh-1")).resolves.toBe(-15);
  });
});

describe("consumeReservationForDispatchInTx (FGI-041)", () => {
  it("is a silent no-op when salesOrderLineId is null (a legacy/test SalesOrderItem row predating the Effective BOM column)", async () => {
    await consumeReservationForDispatchInTx(tx, "co-1", null, "var-1", 10);
    expect(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).not.toHaveBeenCalled();
  });

  it("is a silent no-op when no ACTIVE reservation exists for this (line, variant) pair — the common case today, since nothing wires reservation creation in yet", async () => {
    vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockResolvedValue(null);

    await consumeReservationForDispatchInTx(tx, "co-1", "line-1", "var-1", 10);

    expect(FinishedGoodsReservationRepository.guardedConsume).not.toHaveBeenCalled();
  });

  it("consumes exactly the picked quantity when the reservation has enough remaining", async () => {
    vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockResolvedValue({
      id: "res-1",
      reservedQuantity: 50,
      consumedQuantity: 10,
    } as never);
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(1 as never);

    await consumeReservationForDispatchInTx(tx, "co-1", "line-1", "var-1", 15);

    expect(FinishedGoodsReservationRepository.guardedConsume).toHaveBeenCalledWith(tx, "res-1", 15);
  });

  it("caps consumption at whatever remains, NEVER throwing, when the picked quantity exceeds the reservation's own remaining amount — this is Extra Dispatch Quantity's own 'ship beyond what was reserved' case, which must never be blocked by this purely-additive bookkeeping", async () => {
    vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockResolvedValue({
      id: "res-1",
      reservedQuantity: 50,
      consumedQuantity: 40, // only 10 remains
    } as never);
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(1 as never);

    await expect(consumeReservationForDispatchInTx(tx, "co-1", "line-1", "var-1", 25)).resolves.toBeUndefined();

    expect(FinishedGoodsReservationRepository.guardedConsume).toHaveBeenCalledWith(tx, "res-1", 10); // capped, not 25
  });

  it("is a silent no-op when the reservation is already fully consumed (remaining <= 0)", async () => {
    vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockResolvedValue({
      id: "res-1",
      reservedQuantity: 50,
      consumedQuantity: 50,
    } as never);

    await consumeReservationForDispatchInTx(tx, "co-1", "line-1", "var-1", 5);

    expect(FinishedGoodsReservationRepository.guardedConsume).not.toHaveBeenCalled();
  });

  it("throws OVER_CONSUMPTION_NOT_ALLOWED on a genuine concurrent race (the guard returns 0 despite the pre-capped amount)", async () => {
    vi.mocked(FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx).mockResolvedValue({
      id: "res-1",
      reservedQuantity: 50,
      consumedQuantity: 10,
    } as never);
    vi.mocked(FinishedGoodsReservationRepository.guardedConsume).mockResolvedValue(0 as never);

    await expect(consumeReservationForDispatchInTx(tx, "co-1", "line-1", "var-1", 15)).rejects.toMatchObject({
      code: "OVER_CONSUMPTION_NOT_ALLOWED",
    });
  });
});

describe("applyPackingCompletionReservationsInTx (process-flow Phase 1, 2026-10-16)", () => {
  const txSalesOrderItem = () => (tx as unknown as { salesOrderItem: { findUnique: ReturnType<typeof vi.fn> } }).salesOrderItem.findUnique;
  const txProductionOrder = () => (tx as unknown as { productionOrder: { findUnique: ReturnType<typeof vi.fn> } }).productionOrder.findUnique;

  it("is a no-op for Make-to-Stock production (no linked SalesOrderItem at all)", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: null });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(txSalesOrderItem()).not.toHaveBeenCalled();
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).not.toHaveBeenCalled();
  });

  it("is a no-op for a legacy SalesOrderItem with no salesOrderLineId (predates the Effective BOM column)", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({ salesOrderLineId: null, breakdown: [] });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).not.toHaveBeenCalled();
  });

  it("creates/increments a reservation capped at the exact variant's own orderedQuantity, not the style-level total", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({
      salesOrderLineId: "line-1",
      breakdown: [
        { productVariantId: "var-1", orderedQuantity: 100 },
        { productVariantId: "var-2", orderedQuantity: 50 },
      ],
    });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 30 }],
    });

    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledTimes(1);
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledWith(tx, {
      companyId: "co-1",
      branchId: "br-1",
      salesOrderLineId: "line-1",
      productVariantId: "var-1",
      warehouseId: "wh-1",
      capAt: 100,
      incrementBy: 30,
    });
  });

  it("fails safely: a completed variant with NO matching breakdown row on the order gets no reservation at all", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({
      salesOrderLineId: "line-1",
      breakdown: [{ productVariantId: "var-1", orderedQuantity: 100 }],
    });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      // "var-2" was never ordered on this line at all.
      variantBreakdown: [{ productVariantId: "var-2", quantity: 10 }],
    });

    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).not.toHaveBeenCalled();
  });

  it("aggregates duplicate rows for the same productVariantId in one completion's breakdown before applying any increment", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({
      salesOrderLineId: "line-1",
      breakdown: [{ productVariantId: "var-1", orderedQuantity: 100 }],
    });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 6 },
        { productVariantId: "var-1", quantity: 4 },
      ],
    });

    // Exactly ONE call, for the aggregated 10 — never two separate calls, and
    // never a silently-dropped row.
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledTimes(1);
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ productVariantId: "var-1", incrementBy: 10 })
    );
  });

  it("applies one call per distinct matched variant, each with its own real cap, when a completion spans several variants", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({
      salesOrderLineId: "line-1",
      breakdown: [
        { productVariantId: "var-1", orderedQuantity: 100 },
        { productVariantId: "var-2", orderedQuantity: 50 },
      ],
    });

    await applyPackingCompletionReservationsInTx(tx, actor, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [
        { productVariantId: "var-1", quantity: 20 },
        { productVariantId: "var-2", quantity: 15 },
      ],
    });

    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledTimes(2);
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ productVariantId: "var-1", capAt: 100, incrementBy: 20 })
    );
    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ productVariantId: "var-2", capAt: 50, incrementBy: 15 })
    );
  });

  it("passes a null branchId through unchanged when the actor has none", async () => {
    txProductionOrder().mockResolvedValue({ salesOrderItemId: "soi-1" });
    txSalesOrderItem().mockResolvedValue({
      salesOrderLineId: "line-1",
      breakdown: [{ productVariantId: "var-1", orderedQuantity: 100 }],
    });

    await applyPackingCompletionReservationsInTx(tx, { companyId: "co-1", userId: "user-1" }, {
      productionOrderId: "po-1",
      warehouseId: "wh-1",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 10 }],
    });

    expect(FinishedGoodsReservationRepository.upsertIncrementCappedInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ branchId: null })
    );
  });
});

// 2026-10-22: an order line's own reservation is available to its own dispatch.
describe("getFinishedGoodsAvailableForOrderLine", () => {
  it("adds back the line's own reservation — 36 saleable, all 36 reserved for this line = 36 available to it", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockResolvedValue(36);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(36);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForLineVariant).mockResolvedValue(36);

    await expect(getFinishedGoodsAvailableForOrderLine("co-1", "prod-1", "var-1", "wh-1", "sol-1")).resolves.toBe(36);
    expect(FinishedGoodsReservationRepository.sumActiveUnconsumedForLineVariant).toHaveBeenCalledWith("co-1", "sol-1", "var-1", "wh-1");
  });

  it("still subtracts other orders' reservations", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockResolvedValue(10);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(8);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForLineVariant).mockResolvedValue(3);

    await expect(getFinishedGoodsAvailableForOrderLine("co-1", "prod-1", "var-1", "wh-1", "sol-1")).resolves.toBe(5);
  });

  it("is the plain figure with no order line", async () => {
    vi.mocked(FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations).mockResolvedValue(10);
    vi.mocked(FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant).mockResolvedValue(4);

    await expect(getFinishedGoodsAvailableForOrderLine("co-1", "prod-1", "var-1", "wh-1", null)).resolves.toBe(6);
  });
});

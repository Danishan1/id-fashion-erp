import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./finished-goods-reservation.repository", () => ({
  FinishedGoodsReservationRepository: {
    createMany: vi.fn(),
    findById: vi.fn(),
    findByIdInTx: vi.fn(),
    findActiveForSalesOrderLineIds: vi.fn(),
    sumActiveUnconsumedForVariant: vi.fn(),
    guardedConsume: vi.fn(),
    guardedRelease: vi.fn(),
    releaseAllActiveForSalesOrderLineIdsInTx: vi.fn(),
  },
}));

const { FinishedGoodsReservationRepository } = await import("./finished-goods-reservation.repository");
const {
  createReservationsForSalesOrderInTx,
  consumeReservation,
  releaseReservation,
  releaseActiveReservationsForSalesOrderInTx,
  getCommittedReservationQuantity,
} = await import("./finished-goods-reservation.service");

const tx = {
  salesOrderItem: { findMany: vi.fn() },
  salesOrderLine: { findMany: vi.fn() },
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
  (tx as unknown as { salesOrderItem: { findMany: ReturnType<typeof vi.fn> } }).salesOrderItem.findMany.mockReset();
  (tx as unknown as { salesOrderLine: { findMany: ReturnType<typeof vi.fn> } }).salesOrderLine.findMany.mockReset();
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

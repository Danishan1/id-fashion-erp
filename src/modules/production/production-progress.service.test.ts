import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({
  prisma: {
    productionOrder: { findFirst: vi.fn(), findMany: vi.fn() },
    lot: { findMany: vi.fn() },
    jobOrder: { findMany: vi.fn() },
    productionStageTransaction: { groupBy: vi.fn() },
    salesOrderItem: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { getProductionOrderProgress, getSalesOrderItemProductionSummary } = await import("./production-progress.service");

const COMPANY = "co-1";

function lot(overrides: Record<string, unknown> = {}) {
  return { id: "lot-1", lotNumber: "PROD-1-L01", quantity: 100, status: "IN_PROGRESS", productionOrderId: "po-1", ...overrides };
}

function jobOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "jo-1",
    lotId: "lot-1",
    completedQuantity: 0,
    rejectedQuantity: 0,
    damagedQuantity: 0,
    productionStage: { isFinal: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.productionOrder.findFirst).mockReset();
  vi.mocked(prisma.productionOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.lot.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.jobOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.productionStageTransaction.groupBy).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.salesOrderItem.findFirst).mockReset();
});

describe("getProductionOrderProgress", () => {
  it("rejects a production order that doesn't exist", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue(null);
    await expect(getProductionOrderProgress(COMPANY, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports PLANNED with all-zero quantities when no lots exist yet", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([]);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");

    expect(progress).toMatchObject({
      plannedQuantity: 100,
      producedQuantity: 0,
      rejectedQuantity: 0,
      balanceQuantity: 100,
      overProductionQuantity: 0,
      progressPercent: 0,
      progressStatus: "PLANNED",
      lots: [],
    });
  });

  it("reports IN_PRODUCTION once a lot has started but nothing has finished yet", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([jobOrder({ productionStage: { isFinal: false } })] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.progressStatus).toBe("IN_PRODUCTION");
    expect(progress.producedQuantity).toBe(0);
  });

  it("sums completedQuantity only across final-stage JobOrders as producedQuantity — a non-final stage's own completedQuantity is not yet 'produced'", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ id: "jo-cutting", completedQuantity: 100, productionStage: { isFinal: false } }),
      jobOrder({ id: "jo-final", completedQuantity: 60, productionStage: { isFinal: true } }),
    ] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.producedQuantity).toBe(60);
    expect(progress.progressStatus).toBe("PARTIALLY_COMPLETED");
    expect(progress.balanceQuantity).toBe(40);
  });

  it("reports COMPLETED exactly when produced reaches planned, and OVER_PRODUCED once it exceeds planned", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot({ status: "COMPLETED" })] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ id: "jo-final", completedQuantity: 100, productionStage: { isFinal: true } }),
    ] as never);

    const exact = await getProductionOrderProgress(COMPANY, "po-1");
    expect(exact.progressStatus).toBe("COMPLETED");
    expect(exact.overProductionQuantity).toBe(0);

    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ id: "jo-final", completedQuantity: 110, productionStage: { isFinal: true } }),
    ] as never);
    const over = await getProductionOrderProgress(COMPANY, "po-1");
    expect(over.progressStatus).toBe("OVER_PRODUCED");
    expect(over.overProductionQuantity).toBe(10);
    expect(over.balanceQuantity).toBe(0);
  });

  it("counts damagedQuantity as permanently lost regardless of any rework", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([jobOrder({ damagedQuantity: 5 })] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.rejectedQuantity).toBe(5);
  });

  it("counts a plain-progress-entry rejection (no matching REWORK transaction) as fully, permanently lost", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([jobOrder({ rejectedQuantity: 8 })] as never);
    vi.mocked(prisma.productionStageTransaction.groupBy).mockResolvedValue([]);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.rejectedQuantity).toBe(8);
  });

  it("nets a QC-rejected quantity against its own matching outgoing REWORK transaction, so a unit sent for rework is not double-counted as both rejected and (once finished) produced", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    // jo-qc had 6 rejected via QC, all 6 immediately re-routed for rework —
    // should net to 0 "lost", not 6.
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ id: "jo-qc", rejectedQuantity: 6, productionStage: { isFinal: false } }),
      // The rework destination eventually reaches the final stage and finishes.
      jobOrder({ id: "jo-rework-final", completedQuantity: 6, productionStage: { isFinal: true } }),
    ] as never);
    vi.mocked(prisma.productionStageTransaction.groupBy).mockResolvedValue([
      { fromJobOrderId: "jo-qc", _sum: { quantity: 6 } },
    ] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.rejectedQuantity).toBe(0);
    expect(progress.producedQuantity).toBe(6);
  });

  it("counts only the still-unresolved portion when a REWORK transaction covers less than the full rejectedQuantity", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([jobOrder({ id: "jo-qc", rejectedQuantity: 10 })] as never);
    vi.mocked(prisma.productionStageTransaction.groupBy).mockResolvedValue([
      { fromJobOrderId: "jo-qc", _sum: { quantity: 4 } },
    ] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.rejectedQuantity).toBe(6);
  });

  it("aggregates produced/rejected quantities correctly across multiple lots, matching the user's own worked example (30+40+30=100)", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([
      lot({ id: "lot-1", lotNumber: "L01", quantity: 30, status: "COMPLETED" }),
      lot({ id: "lot-2", lotNumber: "L02", quantity: 40, status: "IN_PROGRESS" }),
      lot({ id: "lot-3", lotNumber: "L03", quantity: 30, status: "PLANNED" }),
    ] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ id: "jo-1", lotId: "lot-1", completedQuantity: 30, productionStage: { isFinal: true } }),
      jobOrder({ id: "jo-2", lotId: "lot-2", completedQuantity: 35, rejectedQuantity: 2, productionStage: { isFinal: true } }),
    ] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.producedQuantity).toBe(65);
    expect(progress.rejectedQuantity).toBe(2);
    expect(progress.lots).toHaveLength(3);
    expect(progress.lots.find((l) => l.lotId === "lot-1")).toMatchObject({ producedQuantity: 30, rejectedQuantity: 0, status: "COMPLETED" });
    expect(progress.lots.find((l) => l.lotId === "lot-2")).toMatchObject({ producedQuantity: 35, rejectedQuantity: 2, status: "IN_PROGRESS" });
    expect(progress.lots.find((l) => l.lotId === "lot-3")).toMatchObject({ producedQuantity: 0, rejectedQuantity: 0, status: "PLANNED" });
  });

  it("never reports a negative balance or over-production quantity", async () => {
    vi.mocked(prisma.productionOrder.findFirst).mockResolvedValue({ id: "po-1", plannedQuantity: 100 } as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot()] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([
      jobOrder({ completedQuantity: 50, productionStage: { isFinal: true } }),
      jobOrder({ id: "jo-2", rejectedQuantity: 60 }),
    ] as never);

    const progress = await getProductionOrderProgress(COMPANY, "po-1");
    expect(progress.balanceQuantity).toBeGreaterThanOrEqual(0);
    expect(progress.overProductionQuantity).toBeGreaterThanOrEqual(0);
  });
});

describe("getSalesOrderItemProductionSummary", () => {
  it("rejects a sales order line that doesn't exist or belongs to another company", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue(null);
    await expect(getSalesOrderItemProductionSummary(COMPANY, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("matches the user's own worked example: ordered 500, three Production Orders (200/150/250) totalling 600 planned, correctly flagged over-planned", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({
      id: "soi-1",
      breakdown: [{ orderedQuantity: 500 }],
    } as never);
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
      { id: "po-1", orderNumber: "PO-001", plannedQuantity: 200 },
      { id: "po-2", orderNumber: "PO-002", plannedQuantity: 150 },
      { id: "po-3", orderNumber: "PO-003", plannedQuantity: 250 },
    ] as never);
    // No lots for any of these three orders — produced/rejected stay 0.
    vi.mocked(prisma.lot.findMany).mockResolvedValue([]);

    const summary = await getSalesOrderItemProductionSummary(COMPANY, "soi-1");

    expect(summary.orderedTotal).toBe(500);
    expect(summary.totalPlanned).toBe(600);
    expect(summary.totalProduced).toBe(0);
    expect(summary.overPlannedVsOrdered).toBe(100);
    expect(summary.remainingProduction).toBe(500);
    expect(summary.productionOrders).toHaveLength(3);
  });

  it("excludes cancelled Production Orders from the query itself (not just the rollup)", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({ id: "soi-1", breakdown: [{ orderedQuantity: 100 }] } as never);
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([{ id: "po-1", orderNumber: "PO-001", plannedQuantity: 50 }] as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([]);

    await getSalesOrderItemProductionSummary(COMPANY, "soi-1");

    expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ salesOrderItemId: "soi-1", status: { not: "CANCELLED" } }) })
    );
  });

  it("reports zero remainingProduction once produced meets or exceeds what was ordered", async () => {
    vi.mocked(prisma.salesOrderItem.findFirst).mockResolvedValue({ id: "soi-1", breakdown: [{ orderedQuantity: 65 }] } as never);
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([{ id: "po-1", orderNumber: "PO-001", plannedQuantity: 100 }] as never);
    vi.mocked(prisma.lot.findMany).mockResolvedValue([lot({ productionOrderId: "po-1" })] as never);
    vi.mocked(prisma.jobOrder.findMany).mockResolvedValue([jobOrder({ completedQuantity: 110, productionStage: { isFinal: true } })] as never);

    const summary = await getSalesOrderItemProductionSummary(COMPANY, "soi-1");
    expect(summary.totalProduced).toBe(110);
    expect(summary.remainingProduction).toBe(0);
  });
});

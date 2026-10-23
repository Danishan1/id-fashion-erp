import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionOrderProgress } from "./production-progress.service";

vi.mock("@/core/db/client", () => ({
  prisma: {
    productionOrder: { findMany: vi.fn() },
    salesOrderItem: { findMany: vi.fn() },
    salesOrder: { findMany: vi.fn() },
    dispatchItem: { groupBy: vi.fn() },
    jobWorkOrder: { findMany: vi.fn() },
    finishedGoodsReceiptItem: { findMany: vi.fn() },
  },
}));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getAllowedBranchIds: vi.fn() },
}));
vi.mock("./production-progress.service", () => ({
  getProgressForOrders: vi.fn(),
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { getProgressForOrders } = await import("./production-progress.service");
const { listDispatchEligibleSalesOrders, listReadyForDispatch } = await import("./dispatch-readiness.service");

const actor = { companyId: "co-1", userId: "user-1" };

function productionOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    orderNumber: "PROD-2026-00001",
    status: "IN_PROGRESS",
    plannedQuantity: 100,
    salesOrderItemId: "soi-1",
    product: { styleName: "Round Neck T-Shirt", styleCode: "ST-001" },
    salesOrderItem: {
      salesOrder: { id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED", customer: { name: "Zenith" } },
    },
    ...overrides,
  };
}

function progress(overrides: Partial<ProductionOrderProgress> = {}): ProductionOrderProgress {
  return {
    productionOrderId: "po-1",
    plannedQuantity: 100,
    producedQuantity: 100,
    rejectedQuantity: 0,
    balanceQuantity: 0,
    overProductionQuantity: 0,
    progressPercent: 100,
    progressStatus: "COMPLETED",
    lots: [],
    totalQcAccepted: 100,
    totalQcRejected: 0,
    totalQcDamaged: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.productionOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.salesOrderItem.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.salesOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.finishedGoodsReceiptItem.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.dispatchItem.groupBy).mockReset().mockResolvedValue([]);
  vi.mocked(prisma.jobWorkOrder.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(getProgressForOrders).mockReset().mockResolvedValue(new Map());
});

describe("listDispatchEligibleSalesOrders", () => {
  it("includes a Sales Order whose production is fully produced and not yet fully shipped", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 0 }] as never);

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([{ id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED" }]);
  });

  it("excludes a Sales Order whose status isn't dispatch-eligible, even if production looks ready", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
      productionOrder({ salesOrderItem: { salesOrder: { id: "so-1", orderNumber: "ORD-2026-00001", status: "DRAFT", customer: null } } }),
    ] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([]);
  });

  it("excludes a line already fully (confirmed) shipped — nothing real left to dispatch", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    // Fully shipped already — readinessFor computes "DISPATCHED", not "READY_FOR_DISPATCH".
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 100 }] as never);

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([]);
  });

  it("excludes production still in progress (not fully processed yet)", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(
      new Map([["po-1", progress({ producedQuantity: 40, plannedQuantity: 100, rejectedQuantity: 0 })]])
    );

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([]);
  });

  it("de-duplicates when two Production Orders map to the same Sales Order", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
      productionOrder({ id: "po-1", salesOrderItemId: "soi-1" }),
      productionOrder({
        id: "po-2",
        salesOrderItemId: "soi-2",
        salesOrderItem: { salesOrder: { id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED", customer: { name: "Zenith" } } },
      }),
    ] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(
      new Map([
        ["po-1", progress({ productionOrderId: "po-1" })],
        ["po-2", progress({ productionOrderId: "po-2" })],
      ])
    );
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([
      { id: "soi-1", dispatchedQuantity: 0 },
      { id: "soi-2", dispatchedQuantity: 0 },
    ] as never);

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([{ id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED" }]);
  });

  it("also includes an already-DISPATCHED order with no production in progress — the Extra Dispatch path stays reachable", async () => {
    // Nothing in production at all; the order is simply fully (regular)
    // shipped already. Extra Dispatch Quantity (replacement/FOC/sample) must
    // still be able to target it (see DISPATCH_ELIGIBLE_ORDER_STATUSES).
    vi.mocked(prisma.salesOrder.findMany).mockResolvedValue([
      { id: "so-9", orderNumber: "ORD-2026-00009", status: "DISPATCHED" },
    ] as never);

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([{ id: "so-9", orderNumber: "ORD-2026-00009", status: "DISPATCHED" }]);
  });

  it("never lists the same Sales Order twice when it appears in both the ready set and the DISPATCHED set", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 0 }] as never);
    vi.mocked(prisma.salesOrder.findMany).mockResolvedValue([
      { id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED" },
    ] as never);

    const result = await listDispatchEligibleSalesOrders(actor);

    expect(result).toEqual([{ id: "so-1", orderNumber: "ORD-2026-00001", status: "CONFIRMED" }]);
  });

  it("scopes the DISPATCHED-order query to the actor's allowed branches, same as the production query", async () => {
    const allowed = new Set(["branch-1"]);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(allowed);

    await listDispatchEligibleSalesOrders(actor);

    expect(prisma.salesOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: { in: ["branch-1"] }, status: "DISPATCHED" }) })
    );
  });

  it("never re-queries production readiness more than once — no duplicate work against the shared helper", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 0 }] as never);

    await listDispatchEligibleSalesOrders(actor);

    expect(getProgressForOrders).toHaveBeenCalledTimes(1);
    expect(prisma.salesOrderItem.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("listReadyForDispatch", () => {
  it("shows packed pieces still waiting on Finished Goods Receive", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 0 }] as never);
    vi.mocked(prisma.jobWorkOrder.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.finishedGoodsReceiptItem.findMany).mockResolvedValue([
      { quantity: 10, receivedQuantity: 4, finishedGoodsReceipt: { productionOrderId: "po-1" } },
      { quantity: 5, receivedQuantity: 0, finishedGoodsReceipt: { productionOrderId: "po-1" } },
    ] as never);

    const [row] = await listReadyForDispatch(actor);

    expect(row.awaitingReceiptQuantity).toBe(11);
  });

  it("reuses the shared readiness computation exactly once — no second progress/dispatch-quantity query (2026-10-16 fix)", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 0 }] as never);

    await listReadyForDispatch(actor);

    expect(getProgressForOrders).toHaveBeenCalledTimes(1);
    expect(prisma.salesOrderItem.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns the ready row with correct produced/shipped/pending figures and attached job-work", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([productionOrder()] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(
      new Map([["po-1", progress({ producedQuantity: 100, rejectedQuantity: 5 })]])
    );
    vi.mocked(prisma.salesOrderItem.findMany).mockResolvedValue([{ id: "soi-1", dispatchedQuantity: 30 }] as never);
    vi.mocked(prisma.dispatchItem.groupBy).mockResolvedValue([
      { salesOrderItemId: "soi-1", _sum: { dispatchedQuantity: 10 } },
    ] as never);
    vi.mocked(prisma.jobWorkOrder.findMany).mockResolvedValue([
      {
        id: "jwo-1",
        jobWorkNumber: "JWO-2026-00001",
        status: "FULLY_RECEIVED",
        receivedQuantity: 50,
        contractor: { name: "HP Cotton" },
        jobOrder: { lot: { productionOrderId: "po-1" } },
      },
    ] as never);

    const [row] = await listReadyForDispatch(actor);

    expect(row).toMatchObject({
      productionOrderId: "po-1",
      salesOrderId: "so-1",
      salesOrderNumber: "ORD-2026-00001",
      customerName: "Zenith",
      style: "Round Neck T-Shirt (ST-001)",
      producedQuantity: 100,
      rejectedQuantity: 5,
      shippedQuantity: 30,
      inProgressDispatchQuantity: 10,
      pendingDispatchQuantity: 60, // 100 - 30 - 10
    });
    expect(row.jobWork).toEqual([
      { id: "jwo-1", jobWorkNumber: "JWO-2026-00001", status: "FULLY_RECEIVED", receivedQuantity: 50, contractorName: "HP Cotton" },
    ]);
  });

  it("excludes a production order whose linked Sales Order status isn't dispatch-eligible", async () => {
    vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
      productionOrder({ salesOrderItem: { salesOrder: { id: "so-1", orderNumber: "ORD-2026-00001", status: "DRAFT", customer: null } } }),
    ] as never);
    vi.mocked(getProgressForOrders).mockResolvedValue(new Map([["po-1", progress()]]));

    const result = await listReadyForDispatch(actor);

    expect(result).toEqual([]);
  });

  it("passes the real allowed-branch filter through to the production order query", async () => {
    const allowed = new Set(["branch-1"]);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(allowed);

    await listReadyForDispatch(actor);

    expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ branchId: { in: ["branch-1"] } }) })
    );
  });
});

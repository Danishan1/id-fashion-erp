import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/sales-orders/sales-order.repository", () => ({
  SalesOrderRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("@/modules/inventory/inventory.service", () => ({
  recordInventoryTransaction: vi.fn(),
  getAvailableQuantity: vi.fn(),
}));
vi.mock("./dispatch.repository", () => ({
  DispatchRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findAnyByOrderId: vi.fn(),
    createWithItems: vi.fn(),
    replaceItems: vi.fn(),
    setCartons: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { recordInventoryTransaction, getAvailableQuantity } = await import("@/modules/inventory/inventory.service");
const { DispatchRepository } = await import("./dispatch.repository");
const { createDispatch, markPacked, confirmDispatch, transitionDispatchStatus } = await import("./dispatch.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

function orderItem(id: string, dispatchedQuantity: number, orderedQuantities: number[]) {
  return {
    id,
    productId: `prod-${id}`,
    dispatchedQuantity,
    breakdown: orderedQuantities.map((q) => ({ orderedQuantity: q })),
  };
}

function makeFakeTx(overrides: { updateManyCount?: number; dispatchUpdateManyCount?: number } = {}) {
  const { updateManyCount = 1, dispatchUpdateManyCount = 1 } = overrides;
  return {
    salesOrderItem: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ dispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] }),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
      findMany: vi.fn().mockResolvedValue([{ dispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] }]),
    },
    salesOrder: { update: vi.fn().mockResolvedValue({}) },
    dispatch: { updateMany: vi.fn().mockResolvedValue({ count: dispatchUpdateManyCount }) },
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue(undefined);
  vi.mocked(getAvailableQuantity).mockReset().mockResolvedValue(1000);
  vi.mocked(DispatchRepository.findAnyById).mockReset();
  vi.mocked(DispatchRepository.findByIdWithDetails).mockReset();
  vi.mocked(DispatchRepository.createWithItems).mockReset();
  vi.mocked(DispatchRepository.updateStatusConditional).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createDispatch — order eligibility and remaining-quantity guard", () => {
  it.each(["DRAFT", "DISPATCHED", "CLOSED", "CANCELLED"])("rejects an order in %s status", async (status) => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({ id: "so-1", status, items: [] } as never);

    await expect(
      createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [],
      } as never)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it.each(["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED"])("accepts an order in %s status", async (status) => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status,
      customerId: "cust-1",
      items: [orderItem("item-1", 0, [50])],
    } as never);
    vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

    await expect(
      createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 20 }],
      } as never)
    ).resolves.toBeDefined();
  });

  it("rejects a quantity exceeding what remains to be dispatched", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      items: [orderItem("item-1", 30, [50])], // 20 remaining
    } as never);

    await expect(
      createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 21 }],
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("markPacked — every line's packed quantity must exactly match", () => {
  const baseDispatch = {
    id: "disp-1",
    status: "DRAFT",
    items: [{ id: "di-1", dispatchedQuantity: 30, product: { styleName: "Round Neck T-Shirt" } }],
    cartons: [],
  };

  it("rejects when nothing has been packed", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(baseDispatch as never);

    await expect(markPacked(actor, "disp-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a partial pack (under-count)", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({
      ...baseDispatch,
      cartons: [{ items: [{ dispatchItem: { id: "di-1" }, quantity: 20 }] }],
    } as never);

    await expect(markPacked(actor, "disp-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts an exact match across multiple cartons", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        ...baseDispatch,
        cartons: [
          { items: [{ dispatchItem: { id: "di-1" }, quantity: 20 }] },
          { items: [{ dispatchItem: { id: "di-1" }, quantity: 10 }] },
        ],
      } as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "PACKED" } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await expect(markPacked(actor, "disp-1")).resolves.toBeDefined();
  });
});

describe("confirmDispatch — self-approval, stock guard, guarded increment, status recompute", () => {
  const packedDispatch = {
    id: "disp-1",
    status: "PACKED",
    salesOrderId: "so-1",
    warehouseId: "wh-1",
    requestedByUserId: "user-1",
    items: [
      {
        id: "di-1",
        productId: "prod-1",
        dispatchedQuantity: 100,
        product: { styleName: "Round Neck T-Shirt" },
        salesOrderItem: { id: "soi-1" },
      },
    ],
  };

  it("asserts the self-approval-guarded 'post' action", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce(packedDispatch as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "dispatch", "post", { createdBy: "user-1" });
  });

  it("throws INSUFFICIENT_FG_STOCK when requested exceeds real FG stock, never touching the transaction", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(packedDispatch as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(50); // only 50 available, 100 requested

    await expect(confirmDispatch(actor, "disp-1")).rejects.toMatchObject({ code: "INSUFFICIENT_FG_STOCK" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("regression: the guarded-increment cap rejects if the order's remaining quantity changed underneath it", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(packedDispatch as never);
    const fakeTx = makeFakeTx({ updateManyCount: 0 }); // guard fails
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await expect(confirmDispatch(actor, "disp-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("posts a negative DISPATCH inventory transaction and recomputes SalesOrder.status to PARTIALLY_DISPATCHED when not everything is dispatched yet", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce(packedDispatch as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
    const fakeTx = makeFakeTx();
    fakeTx.salesOrderItem.findMany.mockResolvedValue([{ dispatchedQuantity: 100, breakdown: [{ orderedQuantity: 250 }] }]);
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-1");

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      fakeTx,
      actor,
      expect.objectContaining({ transactionType: "DISPATCH", quantity: -100 })
    );
    expect(fakeTx.salesOrder.update).toHaveBeenCalledWith({
      where: { id: "so-1" },
      data: { status: "PARTIALLY_DISPATCHED" },
    });
  });

  it("recomputes SalesOrder.status to DISPATCHED once every item is fully dispatched", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce(packedDispatch as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
    const fakeTx = makeFakeTx();
    fakeTx.salesOrderItem.findMany.mockResolvedValue([{ dispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] }]);
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-1");

    expect(fakeTx.salesOrder.update).toHaveBeenCalledWith({ where: { id: "so-1" }, data: { status: "DISPATCHED" } });
  });

  it("rejects confirming a non-PACKED dispatch, never touching the transaction", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({ ...packedDispatch, status: "DRAFT" } as never);

    await expect(confirmDispatch(actor, "disp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("transitionDispatchStatus — the dispatchedAt-based cancel guard (two-layer defense)", () => {
  it("blocks cancel directly once dispatchedAt is set", async () => {
    vi.mocked(DispatchRepository.findAnyById).mockResolvedValue({
      id: "disp-1",
      status: "DISPATCHED",
      dispatchedAt: new Date("2026-08-24"),
    } as never);

    await expect(transitionDispatchStatus(actor, "disp-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("regression: blocks cancel via an ON_HOLD round trip too — dispatchedAt is checked unconditionally, not the status label", async () => {
    // A dispatch that was somehow held (e.g. a future feature) while
    // dispatchedAt is already set must still be uncancellable — the guard
    // must not be fooled by the ON_HOLD label the way Sampling's and
    // Purchasing's own Hold/Resume bugs were.
    vi.mocked(DispatchRepository.findAnyById).mockResolvedValue({
      id: "disp-1",
      status: "ON_HOLD",
      statusBeforeHold: "DISPATCHED",
      dispatchedAt: new Date("2026-08-24"),
    } as never);

    await expect(transitionDispatchStatus(actor, "disp-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("allows cancel from DRAFT when dispatchedAt was never set", async () => {
    vi.mocked(DispatchRepository.findAnyById)
      .mockResolvedValueOnce({ id: "disp-1", status: "DRAFT", dispatchedAt: null } as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "CANCELLED" } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await expect(transitionDispatchStatus(actor, "disp-1", "CANCELLED")).resolves.toBeDefined();
  });
});

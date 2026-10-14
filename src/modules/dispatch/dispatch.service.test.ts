import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
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
    setPickLines: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
// Finished Goods Inventory module (FGI-040/041).
vi.mock("@/modules/products/product.repository", () => ({
  ProductVariantRepository: { findManyActiveByProductId: vi.fn(), findManyByIds: vi.fn() },
}));
vi.mock("@/modules/warehouses/warehouse.repository", () => ({
  WarehouseLocationRepository: { findByIdWithWarehouse: vi.fn() },
}));
vi.mock("@/modules/finished-goods-inventory/finished-goods-reservation.service", () => ({
  getFinishedGoodsAvailableQuantity: vi.fn(),
  consumeReservationForDispatchInTx: vi.fn(),
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    dispatchItem: { aggregate: vi.fn() },
    product: { findFirst: vi.fn() },
    productionOrder: { findMany: vi.fn() },
  },
}));
vi.mock("@/core/barcode/barcode.service", () => ({ replaceCartonBarcodes: vi.fn() }));
vi.mock("@/core/dispatch-settings/DispatchSettingsService", async () => {
  const actual = await vi.importActual<typeof import("@/core/dispatch-settings/DispatchSettingsService")>(
    "@/core/dispatch-settings/DispatchSettingsService"
  );
  return { ...actual, getDispatchSettings: vi.fn() };
});

const { prisma } = await import("@/core/db/client");
const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SalesOrderRepository } = await import("@/modules/sales-orders/sales-order.repository");
const { recordInventoryTransaction, getAvailableQuantity } = await import("@/modules/inventory/inventory.service");
const { DispatchRepository } = await import("./dispatch.repository");
const { replaceCartonBarcodes } = await import("@/core/barcode/barcode.service");
const { getDispatchSettings } = await import("@/core/dispatch-settings/DispatchSettingsService");
const { ProductVariantRepository } = await import("@/modules/products/product.repository");
const { WarehouseLocationRepository } = await import("@/modules/warehouses/warehouse.repository");
const { getFinishedGoodsAvailableQuantity, consumeReservationForDispatchInTx } = await import(
  "@/modules/finished-goods-inventory/finished-goods-reservation.service"
);

const DEFAULT_SETTINGS = {
  allowExtraDispatch: true,
  extraDispatchApprovalRequired: false,
  extraDispatchApprovalThresholdQty: null,
  extraDispatchApprovalThresholdPercent: null,
};
const {
  createDispatch,
  setCartons,
  setPickLines,
  markPacked,
  confirmDispatch,
  markDelivered,
  transitionDispatchStatus,
  resumeDispatchFromHold,
  listDispatches,
  getDispatchById,
} = await import("./dispatch.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

function orderItem(id: string, regularDispatchedQuantity: number, orderedQuantities: number[]) {
  return {
    id,
    productId: `prod-${id}`,
    dispatchedQuantity: regularDispatchedQuantity, // pre-feature fixtures: total === regular, no extra existed yet
    regularDispatchedQuantity,
    breakdown: orderedQuantities.map((q) => ({ orderedQuantity: q })),
  };
}

function makeFakeTx(overrides: { updateManyCount?: number; dispatchUpdateManyCount?: number } = {}) {
  const { updateManyCount = 1, dispatchUpdateManyCount = 1 } = overrides;
  return {
    salesOrderItem: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ regularDispatchedQuantity: 0, breakdown: [{ orderedQuantity: 100 }] }),
      updateMany: vi.fn().mockResolvedValue({ count: updateManyCount }),
      findMany: vi.fn().mockResolvedValue([{ regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] }]),
    },
    salesOrder: { update: vi.fn().mockResolvedValue({}) },
    dispatch: { updateMany: vi.fn().mockResolvedValue({ count: dispatchUpdateManyCount }) },
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(SalesOrderRepository.findByIdWithDetails).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue({ id: "txn-1" } as never);
  vi.mocked(getAvailableQuantity).mockReset().mockResolvedValue(1000);
  vi.mocked(getDispatchSettings).mockReset().mockResolvedValue(DEFAULT_SETTINGS as never);
  vi.mocked(DispatchRepository.findAnyById).mockReset();
  vi.mocked(DispatchRepository.findByIdWithDetails).mockReset();
  vi.mocked(DispatchRepository.createWithItems).mockReset();
  vi.mocked(DispatchRepository.updateStatusConditional).mockReset();
  vi.mocked(DispatchRepository.setCartons).mockReset();
  vi.mocked(DispatchRepository.setPickLines).mockReset();
  vi.mocked(ProductVariantRepository.findManyActiveByProductId).mockReset().mockResolvedValue([]);
  vi.mocked(ProductVariantRepository.findManyByIds).mockReset().mockResolvedValue([]);
  vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockReset();
  vi.mocked(getFinishedGoodsAvailableQuantity).mockReset().mockResolvedValue(1000);
  vi.mocked(consumeReservationForDispatchInTx).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(prisma.dispatchItem.aggregate).mockReset().mockResolvedValue({ _sum: { dispatchedQuantity: 0 } } as never);
  vi.mocked(prisma.product.findFirst).mockReset().mockResolvedValue({ styleName: "Gym Lowers" } as never);
  vi.mocked(replaceCartonBarcodes).mockReset();
  // Release-to-Dispatch gate (2026-10-10) — default to "no unreleased
  // Production Orders found" so every pre-existing test (none of which know
  // about this gate) keeps passing unmodified; the gate's own dedicated
  // tests override this per-case.
  vi.mocked(prisma.productionOrder.findMany).mockReset().mockResolvedValue([]);
});

describe("createDispatch — order eligibility and remaining-quantity guard", () => {
  it.each(["DRAFT", "CLOSED", "CANCELLED"])("rejects an order in %s status", async (status) => {
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

  // DISPATCHED is included (2026-09-30, Extra Dispatch Quantity) — an order
  // the Regular fulfillment logic already considers fully shipped can still
  // legitimately receive a further shipment, entirely as Extra.
  it.each(["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED", "DISPATCHED"])("accepts an order in %s status", async (status) => {
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

  it("rejects a Draft dispatch for more pieces than the warehouse holds", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      items: [orderItem("item-1", 0, [100])],
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(6);

    await expect(
      createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 85 }],
      } as never)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FG_STOCK", details: { available: 6, requested: 85 } });
    expect(DispatchRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("does not let other open Draft/Packed dispatches block real on-hand stock", async () => {
    vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      items: [orderItem("item-1", 0, [100])],
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(6);
    vi.mocked(prisma.dispatchItem.aggregate).mockResolvedValue({ _sum: { dispatchedQuantity: 255 } } as never);
    vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

    await expect(
      createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 6 }],
      } as never)
    ).resolves.toBeDefined();
  });

  // Extra Dispatch Quantity (2026-09-30) — a request beyond what remains
  // is no longer a hard rejection; it splits into Regular (capped at what's
  // remaining) + Extra (the rest), per the spec's own invariant.
  describe("Extra Dispatch Quantity split", () => {
    it("splits into regular + extra when the requested quantity exceeds what remains", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        id: "so-1",
        status: "CONFIRMED",
        customerId: "cust-1",
        items: [orderItem("item-1", 30, [50])], // 20 remaining
      } as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 21, extraDispatchReason: "CUSTOMER_REQUEST" }],
      } as never);

      expect(DispatchRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({
            salesOrderItemId: "item-1",
            dispatchedQuantity: 21,
            regularDispatchQuantity: 20,
            extraDispatchQuantity: 1,
            extraDispatchReason: "CUSTOMER_REQUEST",
          }),
        ]
      );
    });

    it("reproduces the spec's own two-dispatch worked example: DSP-001=60 (all regular), DSP-002=50 (40 regular + 10 extra)", async () => {
      // DSP-001 already regular-dispatched 60 of 100 ordered.
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        id: "so-1",
        status: "PARTIALLY_DISPATCHED",
        customerId: "cust-1",
        items: [orderItem("item-1", 60, [100])], // 40 remaining
      } as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-2" } as never);

      await createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 50, extraDispatchReason: "CUSTOMER_REQUEST" }],
      } as never);

      expect(DispatchRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ regularDispatchQuantity: 40, extraDispatchQuantity: 10 })]
      );
    });

    it("rejects extra quantity with no reason supplied", async () => {
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

    it("rejects extra quantity entirely when DispatchSettings.allowExtraDispatch is false", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        id: "so-1",
        status: "CONFIRMED",
        customerId: "cust-1",
        items: [orderItem("item-1", 30, [50])], // 20 remaining
      } as never);
      vi.mocked(getDispatchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, allowExtraDispatch: false } as never);

      await expect(
        createDispatch(actor, {
          salesOrderId: "so-1",
          warehouseId: "wh-1",
          dispatchDate: "2026-08-24",
          deliveryAddress: "123 Street",
          items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 21, extraDispatchReason: "CUSTOMER_REQUEST" }],
        } as never)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("allows a dispatch quantity at or below what remains with zero extra, no reason needed", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        id: "so-1",
        status: "CONFIRMED",
        customerId: "cust-1",
        items: [orderItem("item-1", 30, [50])], // 20 remaining
      } as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, {
        salesOrderId: "so-1",
        warehouseId: "wh-1",
        dispatchDate: "2026-08-24",
        deliveryAddress: "123 Street",
        items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 20 }],
      } as never);

      expect(DispatchRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ regularDispatchQuantity: 20, extraDispatchQuantity: 0, extraDispatchReason: null })]
      );
    });
  });

  describe("Release-to-Dispatch gate (2026-10-10)", () => {
    const baseOrder = {
      id: "so-1",
      status: "CONFIRMED",
      customerId: "cust-1",
      items: [orderItem("item-1", 0, [50])],
    };
    const baseInput = {
      salesOrderId: "so-1",
      warehouseId: "wh-1",
      dispatchDate: "2026-08-24",
      deliveryAddress: "123 Street",
      items: [{ salesOrderItemId: "item-1", dispatchedQuantity: 10 }],
    };

    it("is silently skipped when the line has no Production Order at all (Make-to-Stock / untracked)", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(baseOrder as never);
      vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([]);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, baseInput as never);

      expect(DispatchRepository.createWithItems).toHaveBeenCalled();
    });

    it("blocks creation when a non-cancelled Production Order for the line hasn't been released, naming it", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(baseOrder as never);
      vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
        { id: "po-1", orderNumber: "PROD-2026-00001", product: { styleName: "Kurta" } },
      ] as never);

      await expect(createDispatch(actor, baseInput as never)).rejects.toMatchObject({
        code: "PRODUCTION_NOT_RELEASED_TO_DISPATCH",
      });
      expect(DispatchRepository.createWithItems).not.toHaveBeenCalled();
    });

    it("never queries for a line whose dispatchedQuantity is 0 (nothing being shipped on it)", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue({
        ...baseOrder,
        items: [orderItem("item-1", 0, [50]), orderItem("item-2", 0, [30])],
      } as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, {
        ...baseInput,
        items: [
          { salesOrderItemId: "item-1", dispatchedQuantity: 10 },
          { salesOrderItemId: "item-2", dispatchedQuantity: 0 },
        ],
      } as never);

      expect(prisma.productionOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ salesOrderItemId: { in: ["item-1"] } }) })
      );
    });

    it("treats a CLOSED Production Order as implicitly released (closing already requires full completion)", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(baseOrder as never);
      // The real repository query already excludes CLOSED/CANCELLED — this
      // test proves the exclusion is actually wired into the where clause.
      vi.mocked(prisma.productionOrder.findMany).mockImplementation((async (args: { where: { status: { notIn: string[] } } }) => {
        expect(args.where.status.notIn).toEqual(["CANCELLED", "CLOSED"]);
        return [];
      }) as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, baseInput as never);

      expect(DispatchRepository.createWithItems).toHaveBeenCalled();
    });

    it("proceeds with an override reason, asserting production/approve, and audits the override", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(baseOrder as never);
      vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
        { id: "po-1", orderNumber: "PROD-2026-00001", product: { styleName: "Kurta" } },
      ] as never);
      vi.mocked(DispatchRepository.createWithItems).mockResolvedValue({ id: "disp-1" } as never);

      await createDispatch(actor, {
        ...baseInput,
        overrideProductionReleaseReason: "Buyer confirmed shipment on a sample basis before full QC sign-off.",
      } as never);

      expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "production", "approve");
      expect(DispatchRepository.createWithItems).toHaveBeenCalled();
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          recordId: "disp-1",
          newValues: expect.objectContaining({ overriddenProductionOrderIds: ["po-1"] }),
        })
      );
    });

    it("still blocks when an override reason is supplied but the actor lacks production/approve", async () => {
      vi.mocked(SalesOrderRepository.findByIdWithDetails).mockResolvedValue(baseOrder as never);
      vi.mocked(prisma.productionOrder.findMany).mockResolvedValue([
        { id: "po-1", orderNumber: "PROD-2026-00001", product: { styleName: "Kurta" } },
      ] as never);
      vi.mocked(PermissionService.assert).mockRejectedValue(
        Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" })
      );

      await expect(
        createDispatch(actor, { ...baseInput, overrideProductionReleaseReason: "Reason." } as never)
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      expect(DispatchRepository.createWithItems).not.toHaveBeenCalled();
    });
  });
});

describe("setCartons — replaces Carton barcodes to match the freshly recreated carton ids (2026-09-29)", () => {
  it("cleans up the previous cartons' barcodes and registers one per new carton using the dispatch number", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({
      id: "disp-1",
      status: "DRAFT",
      dispatchNumber: "DSP-2026-00007",
      items: [{ id: "di-1", productId: "prod-1" }],
      cartons: [{ id: "old-carton-1" }],
    } as never);
    vi.mocked(DispatchRepository.setCartons).mockResolvedValue({
      id: "disp-1",
      cartons: [{ id: "new-carton-1", cartonNumber: 1 }],
    } as never);

    await setCartons(actor, "disp-1", { cartons: [{ items: [{ dispatchItemId: "di-1", quantity: 5 }] }] } as never);

    expect(replaceCartonBarcodes).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1" },
      {
        previousCartonIds: ["old-carton-1"],
        dispatchNumber: "DSP-2026-00007",
        newCartons: [{ id: "new-carton-1", cartonNumber: 1 }],
      }
    );
  });

  it("never fails the real carton write even if barcode registration throws", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({
      id: "disp-1",
      status: "DRAFT",
      dispatchNumber: "DSP-2026-00007",
      items: [{ id: "di-1", productId: "prod-1" }],
      cartons: [],
    } as never);
    vi.mocked(DispatchRepository.setCartons).mockResolvedValue({ id: "disp-1", cartons: [] } as never);
    vi.mocked(replaceCartonBarcodes).mockRejectedValue(new Error("boom"));

    await expect(
      setCartons(actor, "disp-1", { cartons: [{ items: [{ dispatchItemId: "di-1", quantity: 5 }] }] } as never)
    ).resolves.toMatchObject({ id: "disp-1" });
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

  it("race-guard rejection: someone else changed this dispatch's status between the read and the conditional update", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({
      ...baseDispatch,
      cartons: [{ items: [{ dispatchItem: { id: "di-1" }, quantity: 30 }] }],
    } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(markPacked(actor, "disp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  // Barcode Management & Scanning System, Phase 1 (2026-09-29) — scanning
  // cartons is optional; omitting scannedCartonIds behaves exactly as every
  // test above already proves. These cover the new cross-check itself.
  describe("optional scannedCartonIds cross-check", () => {
    const dispatchWithCartons = {
      ...baseDispatch,
      cartons: [
        { id: "carton-1", cartonNumber: 1, items: [{ dispatchItem: { id: "di-1" }, quantity: 20 }] },
        { id: "carton-2", cartonNumber: 2, items: [{ dispatchItem: { id: "di-1" }, quantity: 10 }] },
      ],
    };

    it("rejects when a real carton was never scanned", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchWithCartons as never);

      await expect(markPacked(actor, "disp-1", ["carton-1"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(DispatchRepository.updateStatusConditional).not.toHaveBeenCalled();
    });

    it("rejects a scanned id that doesn't belong to this dispatch", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchWithCartons as never);

      await expect(markPacked(actor, "disp-1", ["carton-1", "carton-2", "someone-elses-carton"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects the same carton scanned twice", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue(dispatchWithCartons as never);

      await expect(markPacked(actor, "disp-1", ["carton-1", "carton-1"])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("succeeds once every real carton has been scanned exactly once", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithCartons as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "PACKED" } as never);
      vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

      await expect(markPacked(actor, "disp-1", ["carton-1", "carton-2"])).resolves.toBeDefined();
    });
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
        regularDispatchQuantity: 100,
        extraDispatchQuantity: 0,
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
    fakeTx.salesOrderItem.findMany.mockResolvedValue([{ regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 250 }] }]);
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
    fakeTx.salesOrderItem.findMany.mockResolvedValue([{ regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] }]);
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-1");

    expect(fakeTx.salesOrder.update).toHaveBeenCalledWith({ where: { id: "so-1" }, data: { status: "DISPATCHED" } });
  });

  // Extra Dispatch Quantity (2026-09-30)
  describe("Extra Dispatch Quantity — approval gate and Regular-only fulfillment", () => {
    const dispatchWithExtra = {
      ...packedDispatch,
      items: [
        {
          id: "di-1",
          productId: "prod-1",
          dispatchedQuantity: 110,
          regularDispatchQuantity: 100,
          extraDispatchQuantity: 10,
          product: { styleName: "Round Neck T-Shirt" },
          salesOrderItem: { id: "soi-1" },
        },
      ],
    };

    it("does NOT assert 'approve' when the dispatch has zero extra quantity, regardless of settings", async () => {
      vi.mocked(getDispatchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, extraDispatchApprovalRequired: true } as never);
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(packedDispatch as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "dispatch", "approve", expect.anything());
    });

    it("asserts the self-approval-guarded 'approve' action when extraDispatchApprovalRequired is true and extra > 0", async () => {
      vi.mocked(getDispatchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, extraDispatchApprovalRequired: true } as never);
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithExtra as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "dispatch", "approve", { createdBy: "user-1" });
    });

    it("blocks confirm (never reaching the transaction) when approval is required but the actor lacks it", async () => {
      vi.mocked(getDispatchSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, extraDispatchApprovalRequired: true } as never);
      vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(dispatchWithExtra as never);
      vi.mocked(PermissionService.assert).mockImplementation(async (_u, _m, action) => {
        if (action === "approve") throw new Error("PERMISSION_DENIED");
      });

      await expect(confirmDispatch(actor, "disp-1")).rejects.toThrow();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("triggers approval purely from the quantity threshold, even when extraDispatchApprovalRequired is false", async () => {
      vi.mocked(getDispatchSettings).mockResolvedValue({
        ...DEFAULT_SETTINGS,
        extraDispatchApprovalThresholdQty: 5, // extra=10 exceeds this
      } as never);
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithExtra as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "dispatch", "approve", { createdBy: "user-1" });
    });

    it("never requires approval when both allowExtraDispatch defaults and no threshold is configured", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithExtra as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "dispatch", "approve", expect.anything());
    });

    it("increments regularDispatchedQuantity by ONLY the regular portion, and dispatchedQuantity (total) by regular+extra", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithExtra as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      expect(fakeTx.salesOrderItem.updateMany).toHaveBeenCalledWith({
        where: { id: "soi-1", regularDispatchedQuantity: { lte: expect.any(Number) } },
        data: { regularDispatchedQuantity: { increment: 100 }, dispatchedQuantity: { increment: 110 } },
      });
      expect(recordInventoryTransaction).toHaveBeenCalledWith(
        fakeTx,
        actor,
        expect.objectContaining({ transactionType: "DISPATCH", quantity: -110 })
      );
    });

    it("Sale Order fulfillment (DISPATCHED status) is based on Regular only — a large Extra never inflates it", async () => {
      vi.mocked(DispatchRepository.findByIdWithDetails)
        .mockResolvedValueOnce(dispatchWithExtra as never)
        .mockResolvedValueOnce({ id: "disp-1", status: "PARTIALLY_DISPATCHED" } as never);
      const fakeTx = makeFakeTx();
      // Order qty 100, regular-so-far only 100 (this item's own regular=100) — fully regular-fulfilled...
      fakeTx.salesOrderItem.findMany.mockResolvedValue([{ regularDispatchedQuantity: 100, breakdown: [{ orderedQuantity: 100 }] }]);
      vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

      await confirmDispatch(actor, "disp-1");

      // ...so status is DISPATCHED, unaffected by the extra 10 pieces that also shipped.
      expect(fakeTx.salesOrder.update).toHaveBeenCalledWith({ where: { id: "so-1" }, data: { status: "DISPATCHED" } });
    });
  });

  it("rejects confirming a non-PACKED dispatch, never touching the transaction", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({ ...packedDispatch, status: "DRAFT" } as never);

    await expect(confirmDispatch(actor, "disp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("race-guard rejection: the dispatch's own status changed underneath the transaction (second guard, after the increment succeeds)", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(packedDispatch as never);
    const fakeTx = makeFakeTx({ dispatchUpdateManyCount: 0 }); // increment succeeds, dispatch-level guard fails
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await expect(confirmDispatch(actor, "disp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("markDelivered — race-guard rejection", () => {
  it("rejects when the dispatch is no longer DISPATCHED by the time the conditional update runs", async () => {
    vi.mocked(DispatchRepository.findAnyById).mockResolvedValue({ id: "disp-1", status: "DELIVERED" } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(markDelivered(actor, "disp-1", "Warehouse Clerk")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("succeeds when the dispatch is genuinely DISPATCHED", async () => {
    vi.mocked(DispatchRepository.findAnyById)
      .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "DELIVERED" } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await expect(markDelivered(actor, "disp-1", "Warehouse Clerk")).resolves.toBeDefined();
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

  it("race-guard rejection: the transition is legal on paper, but the status changed between the read and the conditional update", async () => {
    vi.mocked(DispatchRepository.findAnyById).mockResolvedValue({ id: "disp-1", status: "DRAFT", dispatchedAt: null } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(transitionDispatchStatus(actor, "disp-1", "CANCELLED")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });
});

describe("resumeDispatchFromHold — race-guard rejection", () => {
  it("rejects when the dispatch is no longer ON_HOLD by the time the conditional update runs", async () => {
    vi.mocked(DispatchRepository.findAnyById).mockResolvedValue({
      id: "disp-1",
      status: "ON_HOLD",
      statusBeforeHold: "PACKED",
    } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(resumeDispatchFromHold(actor, "disp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("restores the exact prior status when genuinely on hold", async () => {
    vi.mocked(DispatchRepository.findAnyById)
      .mockResolvedValueOnce({ id: "disp-1", status: "ON_HOLD", statusBeforeHold: "PACKED" } as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "PACKED" } as never);
    vi.mocked(DispatchRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    await expect(resumeDispatchFromHold(actor, "disp-1")).resolves.toBeDefined();
    expect(DispatchRepository.updateStatusConditional).toHaveBeenCalledWith("disp-1", "ON_HOLD", {
      status: "PACKED",
      statusBeforeHold: null,
    });
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(DispatchRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(DispatchRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listDispatches adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listDispatches(actor, listQuery);

    const whereArg = vi.mocked(DispatchRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listDispatches adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listDispatches(actor, listQuery);

    expect(DispatchRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getDispatchById succeeds for a dispatch inside the user's allowed branches", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({ id: "disp-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const dispatch = await getDispatchById(actor, "disp-1");
    expect(dispatch.id).toBe("disp-1");
  });

  it("getDispatchById throws NOT_FOUND for a dispatch outside the user's allowed branches", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({ id: "disp-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getDispatchById(actor, "disp-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setPickLines — multi-location picking (FGI-040)", () => {
  const draftDispatch = {
    id: "disp-3",
    status: "DRAFT",
    warehouseId: "wh-1",
    items: [{ id: "di-3", productId: "prod-3", product: { styleName: "Printed Kurti" } }],
  };

  beforeEach(() => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockReset().mockResolvedValue(draftDispatch as never);
    vi.mocked(ProductVariantRepository.findManyByIds).mockReset().mockResolvedValue([{ id: "var-A", productId: "prod-3" }] as never);
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse)
      .mockReset()
      .mockResolvedValue({ id: "loc-A", warehouseId: "wh-1", warehouse: { companyId: "co-1" } } as never);
    vi.mocked(DispatchRepository.setPickLines).mockReset().mockResolvedValue({ id: "disp-3" } as never);
  });

  it("rejects editing picking for a dispatch outside DRAFT/PACKED", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValue({ ...draftDispatch, status: "DISPATCHED" } as never);

    await expect(
      setPickLines(actor, "disp-3", { pickLines: [{ dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(DispatchRepository.setPickLines).not.toHaveBeenCalled();
  });

  it("rejects a pick line whose dispatchItemId does not belong to this dispatch", async () => {
    await expect(
      setPickLines(actor, "disp-3", {
        pickLines: [{ dispatchItemId: "not-a-real-item", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a pick line whose variant belongs to a different style", async () => {
    vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([{ id: "var-A", productId: "some-other-style" }] as never);

    await expect(
      setPickLines(actor, "disp-3", {
        pickLines: [{ dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a location belonging to a different company", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue({
      id: "loc-A",
      warehouseId: "wh-1",
      warehouse: { companyId: "some-other-company" },
    } as never);

    await expect(
      setPickLines(actor, "disp-3", {
        pickLines: [{ dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a location belonging to a different warehouse than the dispatch's own", async () => {
    vi.mocked(WarehouseLocationRepository.findByIdWithWarehouse).mockResolvedValue({
      id: "loc-A",
      warehouseId: "wh-999",
      warehouse: { companyId: "co-1" },
    } as never);

    await expect(
      setPickLines(actor, "disp-3", {
        pickLines: [{ dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("succeeds with a well-formed pick line, stamping companyId and pickedByUserId, and audit-logs the change", async () => {
    await setPickLines(actor, "disp-3", {
      pickLines: [{ dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5 }],
    });

    expect(DispatchRepository.setPickLines).toHaveBeenCalledWith("disp-3", [
      { dispatchItemId: "di-3", productVariantId: "var-A", warehouseLocationId: "loc-A", quantity: 5, companyId: "co-1", pickedByUserId: "user-1" },
    ]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: { pickLineCount: 1 } }));
  });

  it("allows an empty pick-line list (clearing every pick) — a real, supported state, never rejected as 'nothing supplied'", async () => {
    await expect(setPickLines(actor, "disp-3", { pickLines: [] })).resolves.toBeDefined();
    expect(DispatchRepository.setPickLines).toHaveBeenCalledWith("disp-3", []);
  });
});

describe("confirmDispatch — FGI-040/041 multi-location picking & variant-level oversell check", () => {
  const variantBearingDispatch = {
    id: "disp-4",
    status: "PACKED",
    salesOrderId: "so-4",
    warehouseId: "wh-1",
    requestedByUserId: "user-1",
    items: [
      {
        id: "di-4",
        productId: "prod-variant-style",
        dispatchedQuantity: 30,
        regularDispatchQuantity: 30,
        extraDispatchQuantity: 0,
        product: { styleName: "Printed Kurti" },
        salesOrderItem: { id: "soi-4", salesOrderLineId: "line-4" },
        pickLines: [
          {
            productVariantId: "var-A",
            warehouseLocationId: "loc-A",
            quantity: 20,
            productVariant: { color: { name: "Red" }, size: { name: "M" } },
          },
          {
            productVariantId: "var-B",
            warehouseLocationId: "loc-B",
            quantity: 10,
            productVariant: { color: { name: "Blue" }, size: { name: "L" } },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.mocked(ProductVariantRepository.findManyActiveByProductId).mockImplementation((async (productId: string) =>
      productId === "prod-variant-style" ? [{ id: "var-A" }, { id: "var-B" }] : []) as never);
  });

  it("a zero-variant style's flat posting is completely unchanged — still one plain recordInventoryTransaction call, no productVariantId/warehouseLocationId/stockStatus, and the new helpers are never consulted", async () => {
    const flatDispatch = {
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
          regularDispatchQuantity: 100,
          extraDispatchQuantity: 0,
          product: { styleName: "Round Neck T-Shirt" },
          salesOrderItem: { id: "soi-1", salesOrderLineId: "line-1" },
          pickLines: [],
        },
      ],
    };
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce(flatDispatch as never)
      .mockResolvedValueOnce({ id: "disp-1", status: "DISPATCHED" } as never);
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-1");

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(fakeTx, actor, {
      productId: "prod-1",
      warehouseId: "wh-1",
      transactionType: "DISPATCH",
      quantity: -100,
      referenceModule: "DISPATCH",
      referenceRecordId: "di-1",
    });
    expect(getFinishedGoodsAvailableQuantity).not.toHaveBeenCalled();
    expect(consumeReservationForDispatchInTx).not.toHaveBeenCalled();
  });

  it("rejects confirm when a variant-bearing item's pick lines don't sum exactly to its dispatchedQuantity, never touching the transaction", async () => {
    const underPicked = {
      ...variantBearingDispatch,
      items: [{ ...variantBearingDispatch.items[0], pickLines: [variantBearingDispatch.items[0].pickLines[0]] }], // only 20 of 30 picked
    };
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(underPicked as never);

    await expect(confirmDispatch(actor, "disp-4")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("posts one recordInventoryTransaction call PER PICK LINE for a variant-bearing item, correctly populating productVariantId/warehouseLocationId/stockStatus, and consumes reservations per line", async () => {
    vi.mocked(DispatchRepository.findByIdWithDetails)
      .mockResolvedValueOnce(variantBearingDispatch as never)
      .mockResolvedValueOnce({ id: "disp-4", status: "DISPATCHED" } as never);
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await confirmDispatch(actor, "disp-4");

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(1, fakeTx, actor, {
      productId: "prod-variant-style",
      warehouseId: "wh-1",
      transactionType: "DISPATCH",
      quantity: -20,
      referenceModule: "DISPATCH",
      referenceRecordId: "di-4",
      productVariantId: "var-A",
      warehouseLocationId: "loc-A",
      stockStatus: "SALEABLE",
    });
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(2, fakeTx, actor, {
      productId: "prod-variant-style",
      warehouseId: "wh-1",
      transactionType: "DISPATCH",
      quantity: -10,
      referenceModule: "DISPATCH",
      referenceRecordId: "di-4",
      productVariantId: "var-B",
      warehouseLocationId: "loc-B",
      stockStatus: "SALEABLE",
    });
    expect(consumeReservationForDispatchInTx).toHaveBeenCalledWith(fakeTx, "co-1", "line-4", "var-A", 20);
    expect(consumeReservationForDispatchInTx).toHaveBeenCalledWith(fakeTx, "co-1", "line-4", "var-B", 10);
  });

  it("rejects confirm when a variant's AGGREGATED picked quantity exceeds its own variant-level Available figure — even though the existing style-level aggregate check alone would have passed it (the acceptance criterion's own additive-not-replacement proof)", async () => {
    // getAvailableQuantity (style-level) defaults to 1000 in the outer
    // beforeEach — this dispatch's 30-unit total would sail through that
    // check alone. getFinishedGoodsAvailableQuantity (the NEW, variant-level
    // check) is deliberately starved for var-A specifically (15 available,
    // 20 picked) — a case the old style-level check alone could never catch.
    vi.mocked(getFinishedGoodsAvailableQuantity).mockImplementation(async (_companyId: string, _productId: string, productVariantId: string) =>
      productVariantId === "var-A" ? 15 : 1000
    );
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(variantBearingDispatch as never);

    await expect(confirmDispatch(actor, "disp-4")).rejects.toMatchObject({
      code: "INSUFFICIENT_FG_STOCK",
      details: expect.objectContaining({ productVariantId: "var-A", available: 15, requested: 20 }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("aggregates picked quantity for the SAME variant across two different dispatch items before checking Available", async () => {
    const twoItemsSameVariant = {
      ...variantBearingDispatch,
      items: [
        { ...variantBearingDispatch.items[0], id: "di-4a", dispatchedQuantity: 20, pickLines: [variantBearingDispatch.items[0].pickLines[0]] },
        {
          ...variantBearingDispatch.items[0],
          id: "di-4b",
          dispatchedQuantity: 20,
          pickLines: [{ ...variantBearingDispatch.items[0].pickLines[0], warehouseLocationId: "loc-C", quantity: 20 }],
        },
      ],
    };
    vi.mocked(getFinishedGoodsAvailableQuantity).mockResolvedValue(35); // 20 + 20 = 40 picked > 35 available
    vi.mocked(DispatchRepository.findByIdWithDetails).mockResolvedValueOnce(twoItemsSameVariant as never);

    await expect(confirmDispatch(actor, "disp-4")).rejects.toMatchObject({
      code: "INSUFFICIENT_FG_STOCK",
      details: expect.objectContaining({ productVariantId: "var-A", available: 35, requested: 40 }),
    });
  });
});

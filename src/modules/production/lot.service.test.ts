import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));

const mockTx = { productionOrder: { update: vi.fn() } };
const mockPrismaClient = vi.hoisted(() => ({
  productVariant: { count: vi.fn(), findMany: vi.fn() },
  lotVariantBreakdown: { groupBy: vi.fn() },
  salesOrderItem: { findFirst: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: { ...mockPrismaClient, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)) },
}));
vi.mock("./production.repository", () => ({
  LotRepository: {
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    countOpenJobOrders: vi.fn(),
    createInTx: vi.fn(),
    updateInTx: vi.fn(),
  },
  LotRelationRepository: { createManyInTx: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn(), incrementLotSequenceInTx: vi.fn() },
}));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getAllowedBranchIds: vi.fn(), getAllowedProductionStageIds: vi.fn() },
}));
vi.mock("./lot-readiness.service", () => ({ assertLotMaterialReady: vi.fn() }));
vi.mock("./job-order.service", () => ({
  assertStageAccess: vi.fn(),
  findFirstActiveStage: vi.fn(),
  prepareLotStartAssignments: vi.fn(),
  startLotAtStageInTx: vi.fn(),
  writeLotStartAuditLogs: vi.fn(),
}));
vi.mock("@/core/barcode/barcode.service", () => ({ registerProductionLotBarcode: vi.fn() }));

const { LotRepository, ProductionOrderRepository } = await import("./production.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { assertLotMaterialReady } = await import("./lot-readiness.service");
const { registerProductionLotBarcode } = await import("@/core/barcode/barcode.service");
const JobOrderService = await import("./job-order.service");
const { splitLot, mergeLots, getLotById, createLot, getVariantBreakdownSuggestions } = await import("./lot.service");

const actor = { companyId: "co-1", userId: "user-1" };

function lot(overrides: Record<string, unknown> = {}) {
  return {
    id: "lot-1",
    companyId: "co-1",
    productionOrderId: "po-1",
    lotNumber: "PROD-1-L01",
    quantity: "1000",
    uomId: "uom-1",
    status: "PLANNED",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(LotRepository.findAnyById).mockReset();
  vi.mocked(LotRepository.countOpenJobOrders).mockReset().mockResolvedValue(0);
  vi.mocked(LotRepository.findByIdWithDetails).mockReset();
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(PermissionService.getAllowedProductionStageIds).mockReset().mockResolvedValue(null);
  vi.mocked(LotRepository.createInTx).mockReset();
  vi.mocked(ProductionOrderRepository.findAnyById)
    .mockReset()
    .mockResolvedValue({ id: "po-1", orderNumber: "PROD-2026-00001", productId: "prod-1", status: "PLANNED", salesOrderItemId: null } as never);
  vi.mocked(ProductionOrderRepository.incrementLotSequenceInTx).mockReset().mockResolvedValue({ nextLotSequence: 2 } as never);
  mockPrismaClient.productVariant.count.mockReset();
  mockPrismaClient.productVariant.findMany.mockReset();
  vi.mocked(assertLotMaterialReady).mockReset().mockResolvedValue({ ready: true } as never);
  vi.mocked(JobOrderService.assertStageAccess).mockReset().mockResolvedValue(undefined);
  vi.mocked(JobOrderService.findFirstActiveStage)
    .mockReset()
    .mockResolvedValue({ id: "stage-cut", code: "CUTTING", name: "Cutting", sequence: 1, isFinal: false } as never);
  vi.mocked(JobOrderService.prepareLotStartAssignments)
    .mockReset()
    .mockResolvedValue([{ employeeName: "Ravi", data: { employeeId: "emp-1", assignedQuantity: 100 } }] as never);
  vi.mocked(JobOrderService.startLotAtStageInTx)
    .mockReset()
    .mockResolvedValue({ jobOrder: { id: "jo-cut" }, assignments: [{ id: "as-1", jobOrderId: "jo-cut" }] } as never);
  vi.mocked(JobOrderService.writeLotStartAuditLogs).mockReset().mockResolvedValue(undefined);
  vi.mocked(registerProductionLotBarcode).mockReset().mockResolvedValue({} as never);
  mockPrismaClient.lotVariantBreakdown.groupBy.mockReset().mockResolvedValue([]);
  mockPrismaClient.salesOrderItem.findFirst.mockReset();
  mockTx.productionOrder.update.mockReset();
});

describe("splitLot", () => {
  it("rejects when child quantities don't sum to exactly the parent's quantity", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ quantity: "1000" }) as never);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 300 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });

  it("rejects splitting a lot that already has an open job order", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ quantity: "1000", status: "IN_PROGRESS" }) as never);
    vi.mocked(LotRepository.countOpenJobOrders).mockResolvedValue(1);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 400 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });

  it("rejects splitting an already-terminal lot", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValue(lot({ status: "SPLIT" }) as never);

    await expect(splitLot(actor, "lot-1", { children: [{ quantity: 600 }, { quantity: 400 }] })).rejects.toMatchObject({
      code: "LOT_GENEALOGY_INVALID",
    });
  });
});

describe("mergeLots", () => {
  it("rejects merging lots from different production orders", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a", productionOrderId: "po-1" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b", productionOrderId: "po-2" }) as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects merging lots with different units of measure", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a", uomId: "uom-1" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b", uomId: "uom-2" }) as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects merging a lot that has an open job order", async () => {
    vi.mocked(LotRepository.findAnyById)
      .mockResolvedValueOnce(lot({ id: "lot-a" }) as never)
      .mockResolvedValueOnce(lot({ id: "lot-b" }) as never);
    vi.mocked(LotRepository.countOpenJobOrders).mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-b"] })).rejects.toMatchObject({ code: "LOT_GENEALOGY_INVALID" });
  });

  it("rejects when a referenced lot doesn't exist", async () => {
    vi.mocked(LotRepository.findAnyById).mockResolvedValueOnce(lot({ id: "lot-a" }) as never).mockResolvedValueOnce(null as never);

    await expect(mergeLots(actor, { parentLotIds: ["lot-a", "lot-missing"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getLotById — branch access enforcement (2026-09-15)", () => {
  it("succeeds for a lot inside the user's allowed branches", async () => {
    vi.mocked(LotRepository.findByIdWithDetails).mockResolvedValue({ id: "lot-1", branchId: "branch-1", jobOrders: [] } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getLotById("co-1", "lot-1", "user-1");
    expect(result.id).toBe("lot-1");
  });

  it("throws NOT_FOUND for a lot outside the user's allowed branches", async () => {
    vi.mocked(LotRepository.findByIdWithDetails).mockResolvedValue({ id: "lot-1", branchId: "branch-2", jobOrders: [] } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getLotById("co-1", "lot-1", "user-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a lot with no branchId when the user is branch-restricted", async () => {
    vi.mocked(LotRepository.findByIdWithDetails).mockResolvedValue({ id: "lot-1", branchId: null, jobOrders: [] } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getLotById("co-1", "lot-1", "user-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("createLot", () => {
  it("rejects when the size/color breakdown doesn't sum to the lot quantity", async () => {
    await expect(
      createLot(actor, "po-1", {
        quantity: 100,
        uomId: "uom-1",
        cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }],
        variantBreakdown: [{ productVariantId: "pv-1", quantity: 40 }, { productVariantId: "pv-2", quantity: 50 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(LotRepository.createInTx).not.toHaveBeenCalled();
  });

  it("rejects a variant that doesn't belong to this order's own style", async () => {
    mockPrismaClient.productVariant.count.mockResolvedValue(1); // only 1 of the 2 requested ids matched

    await expect(
      createLot(actor, "po-1", {
        quantity: 100,
        uomId: "uom-1",
        cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }],
        variantBreakdown: [{ productVariantId: "pv-1", quantity: 40 }, { productVariantId: "pv-other-style", quantity: 60 }],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(LotRepository.createInTx).not.toHaveBeenCalled();
  });

  it("creates the lot with a nested variant breakdown when the sum matches", async () => {
    mockPrismaClient.productVariant.count.mockResolvedValue(2);
    vi.mocked(LotRepository.createInTx).mockResolvedValue({ id: "lot-new", lotNumber: "PROD-2026-00001-L01" } as never);

    await createLot(actor, "po-1", {
      quantity: 100,
      uomId: "uom-1",
      cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }],
      variantBreakdown: [{ productVariantId: "pv-1", quantity: 40 }, { productVariantId: "pv-2", quantity: 60 }],
    });

    expect(LotRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        quantity: 100,
        variantBreakdown: {
          create: [
            { productVariantId: "pv-1", quantity: 40 },
            { productVariantId: "pv-2", quantity: 60 },
          ],
        },
      })
    );
  });

  it("creates the lot with no breakdown at all when none is supplied", async () => {
    vi.mocked(LotRepository.createInTx).mockResolvedValue({ id: "lot-new", lotNumber: "PROD-2026-00001-L01" } as never);

    await createLot(actor, "po-1", { quantity: 100, uomId: "uom-1", cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }], });

    expect(mockPrismaClient.productVariant.count).not.toHaveBeenCalled();
    expect(LotRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ variantBreakdown: expect.anything() })
    );
  });

  // Barcode Management & Scanning System, Phase 1 (2026-09-29) — a best-effort
  // post-commit step; never allowed to fail lot creation itself.
  it("registers the new lot's own PRODUCTION_LOT barcode, reusing its lotNumber verbatim", async () => {
    vi.mocked(LotRepository.createInTx).mockResolvedValue({ id: "lot-new", lotNumber: "PROD-2026-00001-L01" } as never);

    await createLot(actor, "po-1", { quantity: 100, uomId: "uom-1", cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }] });

    expect(registerProductionLotBarcode).toHaveBeenCalledWith(
      { companyId: "co-1", userId: "user-1" },
      "lot-new",
      "PROD-2026-00001-L01"
    );
  });

  it("never fails lot creation when barcode registration throws", async () => {
    vi.mocked(LotRepository.createInTx).mockResolvedValue({ id: "lot-new", lotNumber: "PROD-2026-00001-L01" } as never);
    vi.mocked(registerProductionLotBarcode).mockRejectedValue(new Error("boom"));

    await expect(
      createLot(actor, "po-1", { quantity: 100, uomId: "uom-1", cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 100, expectedEndAt: "2099-01-01T10:00:00.000Z" }] })
    ).resolves.toMatchObject({ id: "lot-new" });
  });
});

describe("createLot — lot gate (worker + material request + material issue)", () => {
  const input = { quantity: 5, uomId: "uom-1", cuttingAssignments: [{ employeeId: "emp-1", assignedQuantity: 5, expectedEndAt: "2099-01-01T10:00:00.000Z" }] };

  it("blocks the lot when issued material doesn't cover the pieces, before anything is written", async () => {
    vi.mocked(assertLotMaterialReady).mockRejectedValue(
      Object.assign(new Error("Insufficient material quantity. Required quantity is 7.5 MTR of Cotton for 5 PCS"), {
        code: "INSUFFICIENT_RAW_MATERIAL_STOCK",
      })
    );

    await expect(createLot(actor, "po-1", input)).rejects.toMatchObject({ code: "INSUFFICIENT_RAW_MATERIAL_STOCK" });
    expect(assertLotMaterialReady).toHaveBeenCalledWith("co-1", "po-1", { newLotPieces: 5 });
    expect(LotRepository.createInTx).not.toHaveBeenCalled();
    expect(JobOrderService.startLotAtStageInTx).not.toHaveBeenCalled();
  });

  it("blocks the lot when the worker rows are invalid, before anything is written", async () => {
    vi.mocked(JobOrderService.prepareLotStartAssignments).mockRejectedValue(
      Object.assign(new Error("Assign at least one cutting worker."), { code: "VALIDATION_ERROR" })
    );

    await expect(createLot(actor, "po-1", input)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(LotRepository.createInTx).not.toHaveBeenCalled();
  });

  it("creates the lot, starts it at the first stage and assigns the cutting worker in one transaction", async () => {
    vi.mocked(LotRepository.createInTx).mockResolvedValue({ id: "lot-new", lotNumber: "PROD-2026-00001-L01", quantity: 5 } as never);

    const result = await createLot(actor, "po-1", input);

    expect(JobOrderService.prepareLotStartAssignments).toHaveBeenCalledWith(
      actor,
      { productId: "prod-1", lotQuantity: 5 },
      input.cuttingAssignments
    );
    expect(JobOrderService.startLotAtStageInTx).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ productionOrderId: "po-1", stage: expect.objectContaining({ id: "stage-cut" }) })
    );
    expect(result).toMatchObject({ id: "lot-new", status: "IN_PROGRESS", firstJobOrderId: "jo-cut" });
  });
});

describe("getVariantBreakdownSuggestions", () => {
  it("suggests from the linked Sales Order line's own real breakdown, net of what other lots already claimed", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({
      id: "po-1",
      productId: "prod-1",
      salesOrderItemId: "soi-1",
    } as never);
    mockPrismaClient.lotVariantBreakdown.groupBy.mockResolvedValue([{ productVariantId: "pv-1", _sum: { quantity: 15 } }] as never);
    mockPrismaClient.salesOrderItem.findFirst.mockResolvedValue({
      id: "soi-1",
      breakdown: [
        {
          productVariantId: "pv-1",
          orderedQuantity: 50,
          productVariant: { skuCode: "SKU-1", color: { name: "Navy" }, size: { name: "S" } },
        },
        {
          productVariantId: "pv-2",
          orderedQuantity: 30,
          productVariant: { skuCode: "SKU-2", color: { name: "Navy" }, size: { name: "M" } },
        },
      ],
    } as never);

    const rows = await getVariantBreakdownSuggestions("co-1", "po-1");

    expect(rows).toEqual([
      { productVariantId: "pv-1", colorName: "Navy", sizeName: "S", skuCode: "SKU-1", orderedQuantity: 50, alreadyInLots: 15, remaining: 35 },
      { productVariantId: "pv-2", colorName: "Navy", sizeName: "M", skuCode: "SKU-2", orderedQuantity: 30, alreadyInLots: 0, remaining: 30 },
    ]);
  });

  it("lists the style's own active variants for manual entry, with no suggested quantity, for a Make-to-Stock order", async () => {
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1", salesOrderItemId: null } as never);
    mockPrismaClient.productVariant.findMany.mockResolvedValue([
      { id: "pv-1", skuCode: "SKU-1", color: { name: "Black" }, size: { name: "L" } },
    ] as never);

    const rows = await getVariantBreakdownSuggestions("co-1", "po-1");

    expect(mockPrismaClient.salesOrderItem.findFirst).not.toHaveBeenCalled();
    expect(rows).toEqual([
      { productVariantId: "pv-1", colorName: "Black", sizeName: "L", skuCode: "SKU-1", orderedQuantity: null, alreadyInLots: 0, remaining: null },
    ]);
  });
});

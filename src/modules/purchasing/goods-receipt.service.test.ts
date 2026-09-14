import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn() }));
vi.mock("@/modules/inventory/material-request.repository", () => ({
  MaterialRequestItemRepository: {
    findForReceiptRollupInTx: vi.fn(),
    guardedIncrementPurchaseReceived: vi.fn(),
    decrementPurchaseReceived: vi.fn(),
  },
}));
vi.mock("./fabric-roll.repository", () => ({
  FabricRollRepository: {
    guardedDecrementRemaining: vi.fn(),
    findRemainingInTx: vi.fn(),
    updateStatusInTx: vi.fn(),
  },
}));
vi.mock("./goods-receipt.repository", () => ({
  GoodsReceiptRepository: {
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    createWithItemsAndRolls: vi.fn(),
    updateStatusInTx: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  GoodsReceiptItemRepository: {
    findByIdWithContext: vi.fn(),
    guardedIncrementReversed: vi.fn(),
    findManyByReceiptIdInTx: vi.fn(),
  },
}));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { getAllowedBranchIds: vi.fn() } }));
vi.mock("./purchase-order.repository", () => ({
  PurchaseOrderRepository: { findByIdWithDetails: vi.fn(), updateStatusInTx: vi.fn() },
  PurchaseOrderItemRepository: {
    incrementReceived: vi.fn(),
    guardedDecrementReceived: vi.fn(),
    findManyForStatusRecompute: vi.fn(),
  },
}));

const { recordInventoryTransaction } = await import("@/modules/inventory/inventory.service");
const { MaterialRequestItemRepository } = await import("@/modules/inventory/material-request.repository");
const { FabricRollRepository } = await import("./fabric-roll.repository");
const { GoodsReceiptRepository, GoodsReceiptItemRepository } = await import("./goods-receipt.repository");
const { PurchaseOrderRepository, PurchaseOrderItemRepository } = await import("./purchase-order.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { createGoodsReceipt, reverseGoodsReceiptLine, listGoodsReceipts, getGoodsReceiptById } = await import("./goods-receipt.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };
const BASE_UOM = { id: "uom-1", name: "MTR", baseUnitId: null, conversionFactor: 1 };

function poWithOneItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    status: "SENT_TO_SUPPLIER",
    items: [
      {
        id: "poi-1",
        productId: "mat-1",
        uomId: "uom-1",
        orderedQuantity: 100,
        materialRequestItemId: null,
        product: { styleName: "Cotton Fabric", materialCategory: "FABRIC", baseUom: BASE_UOM },
        uom: BASE_UOM,
      },
    ],
    ...overrides,
  };
}

const oneRollItem = (overrides: Record<string, unknown> = {}) => ({
  purchaseOrderItemId: "poi-1",
  receivedQuantity: 50,
  warehouseId: "wh-1",
  warehouseLocationId: "",
  notes: "",
  rolls: [{ rollNumber: "R1", rollQuantity: 50, batchNo: "", gsmId: "", dyeId: "", weaveTypeId: "", widthId: "", compositionId: "", warehouseLocationId: "", notes: "" }],
  ...overrides,
});

beforeEach(() => {
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(MaterialRequestItemRepository.findForReceiptRollupInTx).mockReset();
  vi.mocked(MaterialRequestItemRepository.guardedIncrementPurchaseReceived).mockReset();
  vi.mocked(MaterialRequestItemRepository.decrementPurchaseReceived).mockReset();
  vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(FabricRollRepository.findRemainingInTx).mockReset().mockResolvedValue({ remainingQuantity: 0 } as never);
  vi.mocked(FabricRollRepository.updateStatusInTx).mockReset();
  vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockReset();
  vi.mocked(GoodsReceiptRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockReset();
  vi.mocked(GoodsReceiptRepository.updateStatusInTx).mockReset();
  vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockReset();
  vi.mocked(GoodsReceiptItemRepository.guardedIncrementReversed).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(GoodsReceiptItemRepository.findManyByReceiptIdInTx).mockReset().mockResolvedValue([]);
  vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockReset().mockResolvedValue(poWithOneItem() as never);
  vi.mocked(PurchaseOrderRepository.updateStatusInTx).mockReset();
  vi.mocked(PurchaseOrderItemRepository.incrementReceived).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(PurchaseOrderItemRepository.guardedDecrementReceived).mockReset().mockResolvedValue(1 as never);
  vi.mocked(PurchaseOrderItemRepository.findManyForStatusRecompute).mockReset().mockResolvedValue([{ orderedQuantity: 100, receivedQuantity: 50 }] as never);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
});

describe("createGoodsReceipt", () => {
  it("rejects when the purchase order doesn't exist", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(createGoodsReceipt(actor, "po-x", { receivedDate: "2026-08-24", items: [oneRollItem()] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects receiving against a purchase order that isn't SENT_TO_SUPPLIER/PARTIALLY_RECEIVED", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue(poWithOneItem({ status: "DRAFT" }) as never);
    await expect(createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects when roll quantities don't sum to the line's received quantity", async () => {
    await expect(
      createGoodsReceipt(actor, "po-1", {
        receivedDate: "2026-08-24",
        items: [oneRollItem({ receivedQuantity: 50, rolls: [{ ...oneRollItem().rolls[0], rollQuantity: 30 }] })],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a FABRIC line received with zero rolls", async () => {
    await expect(
      createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem({ rolls: [] })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects when the material has no base unit configured", async () => {
    vi.mocked(PurchaseOrderRepository.findByIdWithDetails).mockResolvedValue(
      poWithOneItem({ items: [{ ...poWithOneItem().items[0], product: { styleName: "Cotton Fabric", materialCategory: "FABRIC", baseUom: null } }] }) as never
    );
    await expect(createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] })).rejects.toMatchObject({
      code: "UOM_CONVERSION_UNAVAILABLE",
    });
  });

  it("allows receiving more than the ordered quantity — no over-receipt block", async () => {
    // A real, common warehouse scenario (supplier shipped extra), not a
    // mistake to reject — incrementReceived is deliberately uncapped now.
    vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
      id: "gr-1",
      receiptNumber: "REC-2026-00001",
      items: [{ id: "gri-1", purchaseOrderItemId: "poi-1", productId: "mat-1", warehouseId: "wh-1", warehouseLocationId: null, receivedQuantity: 500, rolls: [] }],
    } as never);

    await createGoodsReceipt(actor, "po-1", {
      receivedDate: "2026-08-24",
      items: [
        oneRollItem({
          receivedQuantity: 500,
          rolls: [{ rollNumber: "R1", rollQuantity: 500, batchNo: "", gsmId: "", dyeId: "", weaveTypeId: "", widthId: "", compositionId: "", warehouseLocationId: "", notes: "" }],
        }),
      ],
    });

    expect(PurchaseOrderItemRepository.incrementReceived).toHaveBeenCalledWith(expect.anything(), "poi-1", 500);
    expect(GoodsReceiptRepository.createWithItemsAndRolls).toHaveBeenCalled();
  });

  it("rejects only when the purchase order line itself no longer exists", async () => {
    vi.mocked(PurchaseOrderItemRepository.incrementReceived).mockResolvedValue({ count: 0 } as never);

    await expect(createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(GoodsReceiptRepository.createWithItemsAndRolls).not.toHaveBeenCalled();
  });

  it("posts one ledger entry per roll (not one aggregate row per line) and recomputes PO status", async () => {
    vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
      id: "gr-1",
      receiptNumber: "REC-2026-00001",
      items: [
        {
          id: "gri-1",
          purchaseOrderItemId: "poi-1",
          productId: "mat-1",
          warehouseId: "wh-1",
          warehouseLocationId: null,
          receivedQuantity: 50,
          rolls: [{ id: "roll-1", rollQuantity: 50 }],
        },
      ],
    } as never);

    await createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] });

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ transactionType: "GOODS_RECEIPT", quantity: 50, fabricRollId: "roll-1" })
    );
    expect(PurchaseOrderRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "po-1", { status: "PARTIALLY_RECEIVED" });
  });

  it("flips the purchase order to FULLY_RECEIVED once every line is fully received", async () => {
    vi.mocked(PurchaseOrderItemRepository.findManyForStatusRecompute).mockResolvedValue([{ orderedQuantity: 100, receivedQuantity: 100 }] as never);
    vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
      id: "gr-1",
      receiptNumber: "REC-2026-00001",
      items: [{ id: "gri-1", purchaseOrderItemId: "poi-1", productId: "mat-1", warehouseId: "wh-1", warehouseLocationId: null, receivedQuantity: 100, rolls: [{ id: "roll-1", rollQuantity: 100 }] }],
    } as never);

    await createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem({ receivedQuantity: 100, rolls: [{ ...oneRollItem().rolls[0], rollQuantity: 100 }] })] });

    expect(PurchaseOrderRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "po-1", { status: "FULLY_RECEIVED" });
  });

  describe("idempotency (CF-5)", () => {
    const existingReceipt = { id: "gr-existing", receiptNumber: "REC-2026-00001", items: [] };

    it("returns the original receipt unchanged when the same idempotencyKey is replayed, without touching the PO at all", async () => {
      vi.mocked(GoodsReceiptRepository.findByIdempotencyKey).mockResolvedValue(existingReceipt as never);

      const result = await createGoodsReceipt(actor, "po-1", {
        receivedDate: "2026-08-24",
        items: [oneRollItem()],
        idempotencyKey: "retry-key-1",
      });

      expect(result).toBe(existingReceipt);
      expect(PurchaseOrderRepository.findByIdWithDetails).not.toHaveBeenCalled();
      expect(GoodsReceiptRepository.createWithItemsAndRolls).not.toHaveBeenCalled();
    });

    it("proceeds normally the first time a key is used (no existing receipt for it yet)", async () => {
      vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
        id: "gr-1",
        receiptNumber: "REC-2026-00002",
        items: [{ id: "gri-1", purchaseOrderItemId: "poi-1", productId: "mat-1", warehouseId: "wh-1", warehouseLocationId: null, receivedQuantity: 50, rolls: [{ id: "roll-1", rollQuantity: 50 }] }],
      } as never);

      const result = await createGoodsReceipt(actor, "po-1", {
        receivedDate: "2026-08-24",
        items: [oneRollItem()],
        idempotencyKey: "fresh-key-1",
      });

      expect(GoodsReceiptRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
      expect(GoodsReceiptRepository.createWithItemsAndRolls).toHaveBeenCalled();
      expect((result as { id: string }).id).toBe("gr-1");
    });

    it("stores the caller-supplied idempotencyKey on the created row", async () => {
      vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
        id: "gr-1",
        receiptNumber: "REC-2026-00002",
        items: [],
      } as never);

      await createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()], idempotencyKey: "fresh-key-1" });

      expect(GoodsReceiptRepository.createWithItemsAndRolls).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "fresh-key-1" })
      );
    });

    it("does not perform an idempotency check at all when no key is supplied — unprotected but unaffected", async () => {
      vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockResolvedValue({
        id: "gr-1",
        receiptNumber: "REC-2026-00002",
        items: [],
      } as never);

      await createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] });

      expect(GoodsReceiptRepository.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(GoodsReceiptRepository.createWithItemsAndRolls).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: null })
      );
    });

    it("regression: a genuine concurrent replay (both requests pass the pre-check, the DB's unique constraint catches the loser) transparently returns the winner's receipt instead of throwing", async () => {
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockRejectedValue(p2002);
      vi.mocked(GoodsReceiptRepository.findByIdempotencyKey)
        .mockResolvedValueOnce(null) // the pre-check, before the race is lost
        .mockResolvedValueOnce(existingReceipt as never); // the post-catch re-fetch, after losing the race

      const result = await createGoodsReceipt(actor, "po-1", {
        receivedDate: "2026-08-24",
        items: [oneRollItem()],
        idempotencyKey: "racing-key",
      });

      expect(result).toBe(existingReceipt);
    });

    it("still throws a genuine P2002 from an unrelated constraint when no idempotencyKey was ever supplied to fall back on", async () => {
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(GoodsReceiptRepository.createWithItemsAndRolls).mockRejectedValue(p2002);

      await expect(
        createGoodsReceipt(actor, "po-1", { receivedDate: "2026-08-24", items: [oneRollItem()] })
      ).rejects.toBe(p2002);
    });
  });
});

function reversibleItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "gri-1",
    goodsReceiptId: "gr-1",
    goodsReceipt: { status: "COMPLETED" },
    purchaseOrderItemId: "poi-1",
    purchaseOrderItem: { purchaseOrderId: "po-1", invoicedQuantity: 0, materialRequestItemId: null, materialRequestItem: null },
    productId: "mat-1",
    warehouseId: "wh-1",
    warehouseLocationId: null,
    receivedQuantity: 50,
    reversedQuantity: 0,
    uom: BASE_UOM,
    product: { styleName: "Cotton Fabric", baseUom: BASE_UOM },
    rolls: [] as { id: string }[],
    ...overrides,
  };
}

describe("reverseGoodsReceiptLine", () => {
  it("rejects when the line doesn't exist", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(null);
    await expect(reverseGoodsReceiptLine(actor, "gri-x", { quantity: 10, reason: "r" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects reversing against an already-fully-reversed (CANCELLED) receipt", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem({ goodsReceipt: { status: "CANCELLED" } }) as never);
    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "r" })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects reversing a roll-tracked line without specifying which roll", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem({ rolls: [{ id: "roll-1" }] }) as never);
    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "r" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects specifying a fabricRollId for a line that has no rolls", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem({ rolls: [] }) as never);
    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "r", fabricRollId: "roll-1" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a roll id that doesn't belong to this line", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem({ rolls: [{ id: "roll-1" }] }) as never);
    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "r", fabricRollId: "roll-2" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects reversing more than a roll's own remaining quantity", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem({ rolls: [{ id: "roll-1" }] }) as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 0 } as never);

    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 999, reason: "r", fabricRollId: "roll-1" })).rejects.toMatchObject({
      code: "OVER_REVERSAL_NOT_ALLOWED",
    });
  });

  it("rejects reversing more than the line's remaining un-reversed quantity", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem() as never);
    vi.mocked(GoodsReceiptItemRepository.guardedIncrementReversed).mockResolvedValue({ count: 0 } as never);

    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 999, reason: "r" })).rejects.toMatchObject({ code: "OVER_REVERSAL_NOT_ALLOWED" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects reversing below what's already been invoiced on the linked purchase order item", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem() as never);
    vi.mocked(PurchaseOrderItemRepository.guardedDecrementReceived).mockResolvedValue(0 as never);

    await expect(reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "r" })).rejects.toMatchObject({ code: "OVER_REVERSAL_NOT_ALLOWED" });
  });

  it("posts a negative GOODS_RECEIPT_REVERSAL ledger entry and recomputes both PO and receipt status on success", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem() as never);
    vi.mocked(PurchaseOrderItemRepository.findManyForStatusRecompute).mockResolvedValue([{ orderedQuantity: 100, receivedQuantity: 40 }] as never);
    vi.mocked(GoodsReceiptItemRepository.findManyByReceiptIdInTx).mockResolvedValue([{ receivedQuantity: 50, reversedQuantity: 10 }] as never);
    vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockResolvedValue({ id: "gr-1" } as never);

    await reverseGoodsReceiptLine(actor, "gri-1", { quantity: 10, reason: "Wrong quantity recorded" });

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ transactionType: "GOODS_RECEIPT_REVERSAL", quantity: -10 })
    );
    expect(PurchaseOrderRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "po-1", { status: "PARTIALLY_RECEIVED" });
    expect(GoodsReceiptRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "gr-1", "PARTIALLY_REVERSED");
  });

  it("flips the goods receipt to CANCELLED once every line is fully reversed", async () => {
    vi.mocked(GoodsReceiptItemRepository.findByIdWithContext).mockResolvedValue(reversibleItem() as never);
    vi.mocked(PurchaseOrderItemRepository.findManyForStatusRecompute).mockResolvedValue([{ orderedQuantity: 100, receivedQuantity: 0 }] as never);
    vi.mocked(GoodsReceiptItemRepository.findManyByReceiptIdInTx).mockResolvedValue([{ receivedQuantity: 50, reversedQuantity: 50 }] as never);
    vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockResolvedValue({ id: "gr-1" } as never);

    await reverseGoodsReceiptLine(actor, "gri-1", { quantity: 50, reason: "Full reversal" });

    expect(PurchaseOrderRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "po-1", { status: "SENT_TO_SUPPLIER" });
    expect(GoodsReceiptRepository.updateStatusInTx).toHaveBeenCalledWith(expect.anything(), "gr-1", "CANCELLED");
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(GoodsReceiptRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(GoodsReceiptRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listGoodsReceipts adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listGoodsReceipts(actor, listQuery);

    const whereArg = vi.mocked(GoodsReceiptRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listGoodsReceipts adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listGoodsReceipts(actor, listQuery);

    expect(GoodsReceiptRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getGoodsReceiptById succeeds for a receipt inside the user's allowed branches", async () => {
    vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockResolvedValue({ id: "gr-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getGoodsReceiptById(actor, "gr-1");
    expect(result.id).toBe("gr-1");
  });

  it("getGoodsReceiptById throws NOT_FOUND for a receipt outside the user's allowed branches", async () => {
    vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockResolvedValue({ id: "gr-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getGoodsReceiptById(actor, "gr-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getGoodsReceiptById throws NOT_FOUND for a receipt with no branchId when the user is restricted", async () => {
    vi.mocked(GoodsReceiptRepository.findByIdWithDetails).mockResolvedValue({ id: "gr-1", branchId: null } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getGoodsReceiptById(actor, "gr-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

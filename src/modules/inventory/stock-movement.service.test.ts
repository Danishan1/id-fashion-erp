import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
const txMock = vi.hoisted(() => ({
  stockMovement: { updateMany: vi.fn() },
  stockMovementItem: { update: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txMock)),
    warehouseLocation: { findMany: vi.fn() },
  },
}));
vi.mock("./inventory.service", () => ({
  getAvailableQuantity: vi.fn(),
  getFinishedGoodsSaleableQuantity: vi.fn(),
  getRawMaterialStockByLocation: vi.fn(),
  recordInventoryTransaction: vi.fn(),
}));
vi.mock("./stock-movement.repository", () => ({
  StockMovementRepository: {
    createWithItems: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findByIdWithDetails: vi.fn(),
  },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn(), findManyItemTypesByIds: vi.fn() },
  ProductVariantRepository: { findManyByIds: vi.fn() },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() } },
}));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { getAllowedBranchIds: vi.fn(), assert: vi.fn() } }));
// Finished Goods Inventory module (FGI-032) -- keeps the REAL adjustmentNeedsApproval()
// pure function (same vi.importActual pattern dispatch.service.test.ts's own
// extraDispatchNeedsApproval mock already uses), mocking only the I/O half
// (getFgInventorySettings).
vi.mock("@/core/fg-inventory-settings/FgInventorySettingsService", async () => {
  const actual = await vi.importActual<typeof import("@/core/fg-inventory-settings/FgInventorySettingsService")>(
    "@/core/fg-inventory-settings/FgInventorySettingsService"
  );
  return { ...actual, getFgInventorySettings: vi.fn() };
});

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { getAvailableQuantity, getFinishedGoodsSaleableQuantity, getRawMaterialStockByLocation, recordInventoryTransaction } = await import(
  "./inventory.service"
);
const { prisma } = await import("@/core/db/client");
const { StockMovementRepository } = await import("./stock-movement.repository");
const { ProductRepository, ProductVariantRepository } = await import("@/modules/products/product.repository");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { getFgInventorySettings } = await import("@/core/fg-inventory-settings/FgInventorySettingsService");
const { createStockMovement, listStockMovements, getStockMovementById, receiveStockMovement } = await import("./stock-movement.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

// Every test's items use uomId "uom-1", which is set here to match the
// material's own base UOM — the "no conversion needed" branch — so these
// pre-existing tests keep asserting the same as-entered quantities. UOM
// conversion itself is covered by its own dedicated test below.
const BASE_UOM = { id: "uom-1", baseUnitId: null, conversionFactor: 1 };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("STK-2026-00001");
  vi.mocked(getAvailableQuantity).mockReset();
  vi.mocked(getFinishedGoodsSaleableQuantity).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset();
  vi.mocked(StockMovementRepository.createWithItems).mockReset().mockResolvedValue({ id: "sm-1" } as never);
  vi.mocked(StockMovementRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Test Material", baseUom: BASE_UOM } as never);
  // Finished Goods Inventory module (FGI-014) — every pre-existing test's
  // one material ("mat-1") is a real raw material, matching the implicit
  // RAW_MATERIAL default every one of those tests relies on (none of them
  // sets itemFamily at all).
  vi.mocked(ProductRepository.findManyItemTypesByIds).mockReset().mockResolvedValue([{ id: "mat-1", itemType: "RAW_MATERIAL" }] as never);
  vi.mocked(ProductVariantRepository.findManyByIds).mockReset().mockResolvedValue([]);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getFgInventorySettings)
    .mockReset()
    .mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: null,
    });
});

describe("createStockMovement", () => {
  // Send/receive (2026-10-21): a raw-material Transfer posts only the source
  // side on Send and stays IN_TRANSIT; receiveStockMovement() posts the rest.
  it("sends a raw-material TRANSFER — only the source side is posted, and it stays IN_TRANSIT", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);

    await createStockMovement(actor, {
      movementType: "TRANSFER",
      warehouseId: "wh-a",
      toWarehouseId: "wh-b",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "" }],
    } as never);

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: -10, transactionType: "STOCK_TRANSFER" })
    );
    expect(StockMovementRepository.createWithItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "IN_TRANSIT", toWarehouseId: "wh-b" }),
      expect.anything()
    );
  });

  it("never takes a destination location on Send for a raw-material Transfer — the receiver picks it", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);

    await createStockMovement(actor, {
      movementType: "TRANSFER",
      warehouseId: "wh-a",
      toWarehouseId: "wh-b",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "", toWarehouseLocationId: "loc-ignored" }],
    } as never);

    expect(StockMovementRepository.createWithItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [expect.objectContaining({ toWarehouseLocationId: null })]
    );
  });

  it("rejects sending more than the chosen source location holds", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);
    vi.mocked(getRawMaterialStockByLocation).mockResolvedValue({
      onHand: 50,
      unassignedQuantity: 44,
      locations: [{ warehouseLocationId: "loc-a", code: "A", label: "A", quantity: 6 }],
    });

    await expect(
      createStockMovement(actor, {
        movementType: "TRANSFER",
        warehouseId: "wh-a",
        toWarehouseId: "wh-b",
        items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "", warehouseLocationId: "loc-a" }],
      } as never)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("posts the source location on Send when that location holds enough", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);
    vi.mocked(getRawMaterialStockByLocation).mockResolvedValue({
      onHand: 50,
      unassignedQuantity: 30,
      locations: [{ warehouseLocationId: "loc-a", code: "A", label: "A", quantity: 20 }],
    });

    await createStockMovement(actor, {
      movementType: "TRANSFER",
      warehouseId: "wh-a",
      toWarehouseId: "wh-b",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "", warehouseLocationId: "loc-a" }],
    } as never);

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: -10, warehouseLocationId: "loc-a" })
    );
  });

  it("rejects a TRANSFER when the source warehouse doesn't have enough stock", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(5);

    await expect(
      createStockMovement(actor, {
        movementType: "TRANSFER",
        warehouseId: "wh-a",
        toWarehouseId: "wh-b",
        items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "" }],
      } as never)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
    expect(StockMovementRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("posts one negative ledger entry for a RETURN_TO_SUPPLIER", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(20);

    await createStockMovement(actor, {
      movementType: "RETURN_TO_SUPPLIER",
      warehouseId: "wh-a",
      supplierId: "sup-1",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 5, remarks: "" }],
    } as never);

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: -5, transactionType: "RETURN_TO_SUPPLIER" })
    );
  });

  it("posts a positive ADJUSTMENT (stock found) without checking available stock", async () => {
    await createStockMovement(actor, {
      movementType: "ADJUSTMENT",
      warehouseId: "wh-a",
      reason: "Physical count found extra stock",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 8, remarks: "" }],
    } as never);

    expect(getAvailableQuantity).not.toHaveBeenCalled();
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: 8, transactionType: "ADJUSTMENT" })
    );
  });

  it("rejects a negative ADJUSTMENT (write-off) that exceeds what's actually available", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(3);

    await expect(
      createStockMovement(actor, {
        movementType: "ADJUSTMENT",
        warehouseId: "wh-a",
        reason: "Shrinkage",
        items: [{ productId: "mat-1", uomId: "uom-1", quantity: -8, remarks: "" }],
      } as never)
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("allows a negative ADJUSTMENT that's within what's available", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(10);

    await createStockMovement(actor, {
      movementType: "ADJUSTMENT",
      warehouseId: "wh-a",
      reason: "Shrinkage",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: -8, remarks: "" }],
    } as never);

    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: -8, transactionType: "ADJUSTMENT" })
    );
  });

  it("converts a line's quantity into the material's base UOM before checking availability and posting to the ledger", async () => {
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({
      id: "uom-dzn",
      name: "Dozen",
      baseUnitId: "uom-1",
      conversionFactor: 12,
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);

    await createStockMovement(actor, {
      movementType: "RETURN_TO_SUPPLIER",
      warehouseId: "wh-a",
      supplierId: "sup-1",
      items: [{ productId: "mat-1", uomId: "uom-dzn", quantity: 2, remarks: "" }],
    } as never);

    // 2 DZN -> 24 PCS (the material's base unit) — both the availability
    // check and the ledger post must see the converted quantity, not 2.
    expect(getAvailableQuantity).toHaveBeenCalledWith("co-1", "mat-1", "wh-a");
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      expect.objectContaining({ quantity: -24, transactionType: "RETURN_TO_SUPPLIER" })
    );
  });

  it("rejects a line whose material has no base UOM configured", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "mat-1",
      styleName: "Test Material",
      baseUom: null,
    } as never);

    await expect(
      createStockMovement(actor, {
        movementType: "RETURN_TO_SUPPLIER",
        warehouseId: "wh-a",
        supplierId: "sup-1",
        items: [{ productId: "mat-1", uomId: "uom-1", quantity: 5, remarks: "" }],
      } as never)
    ).rejects.toMatchObject({ code: "UOM_CONVERSION_UNAVAILABLE" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a line whose chosen unit has no fixed conversion path to the material's base unit", async () => {
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({
      id: "uom-other",
      name: "Roll",
      baseUnitId: null,
      conversionFactor: 1,
    } as never);

    await expect(
      createStockMovement(actor, {
        movementType: "RETURN_TO_SUPPLIER",
        warehouseId: "wh-a",
        supplierId: "sup-1",
        items: [{ productId: "mat-1", uomId: "uom-other", quantity: 5, remarks: "" }],
      } as never)
    ).rejects.toMatchObject({ code: "UOM_CONVERSION_UNAVAILABLE" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  describe("idempotency (CF-5)", () => {
    const existingMovement = { id: "sm-existing", movementNumber: "STK-2026-00001" };
    const adjustmentInput = {
      movementType: "ADJUSTMENT",
      warehouseId: "wh-a",
      reason: "stock count",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 5, remarks: "" }],
    };

    it("returns the original movement unchanged when the same idempotencyKey is replayed, without touching stock at all", async () => {
      vi.mocked(StockMovementRepository.findByIdempotencyKey).mockResolvedValue(existingMovement as never);

      const result = await createStockMovement(actor, { ...adjustmentInput, idempotencyKey: "retry-key-1" } as never);

      expect(result).toBe(existingMovement);
      expect(getAvailableQuantity).not.toHaveBeenCalled();
      expect(StockMovementRepository.createWithItems).not.toHaveBeenCalled();
    });

    it("proceeds normally the first time a key is used", async () => {
      vi.mocked(getAvailableQuantity).mockResolvedValue(50);

      const result = await createStockMovement(actor, { ...adjustmentInput, idempotencyKey: "fresh-key-1" } as never);

      expect(StockMovementRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
      expect(StockMovementRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: "fresh-key-1" }),
        expect.anything()
      );
      expect((result as { id: string }).id).toBe("sm-1");
    });

    it("does not check idempotency at all when no key is supplied — unprotected but unaffected", async () => {
      vi.mocked(getAvailableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, adjustmentInput as never);

      expect(StockMovementRepository.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(StockMovementRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: null }),
        expect.anything()
      );
    });

    it("regression: a genuine concurrent replay (both pass the pre-check, the DB's unique constraint catches the loser) transparently returns the winner's movement instead of throwing", async () => {
      vi.mocked(getAvailableQuantity).mockResolvedValue(50);
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(StockMovementRepository.createWithItems).mockRejectedValue(p2002);
      vi.mocked(StockMovementRepository.findByIdempotencyKey)
        .mockResolvedValueOnce(null) // pre-check, before the race is lost
        .mockResolvedValueOnce(existingMovement as never); // post-catch re-fetch, after losing the race

      const result = await createStockMovement(actor, { ...adjustmentInput, idempotencyKey: "racing-key" } as never);

      expect(result).toBe(existingMovement);
    });

    it("still throws a genuine P2002 with no idempotencyKey supplied to fall back on", async () => {
      vi.mocked(getAvailableQuantity).mockResolvedValue(50);
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(StockMovementRepository.createWithItems).mockRejectedValue(p2002);

      await expect(createStockMovement(actor, adjustmentInput as never)).rejects.toBe(p2002);
    });
  });

  describe("item-type-family validation (FGI-014, Decision 2/§4.4) — the real, DB-backed service-layer half", () => {
    it("rejects a document whose claimed itemFamily doesn't match the real item's itemType in the database — the Zod-level check alone can't catch a forged/wrong value", async () => {
      // The caller claims RAW_MATERIAL (the default), but this productId is
      // genuinely a STYLE in the database — the exact "mixing"/"forged
      // family" scenario only a real DB lookup can catch.
      vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([{ id: "style-1", itemType: "STYLE" }] as never);

      await expect(
        createStockMovement(actor, {
          movementType: "ADJUSTMENT",
          warehouseId: "wh-a",
          reason: "test",
          items: [{ productId: "style-1", uomId: "uom-1", quantity: 5, remarks: "" }],
        } as never)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(recordInventoryTransaction).not.toHaveBeenCalled();
      expect(StockMovementRepository.createWithItems).not.toHaveBeenCalled();
    });

    it("rejects a document that genuinely mixes both families — one line raw material, one line a style, both under the same claimed itemFamily", async () => {
      vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([
        { id: "mat-1", itemType: "RAW_MATERIAL" },
        { id: "style-1", itemType: "STYLE" },
      ] as never);

      await expect(
        createStockMovement(actor, {
          movementType: "ADJUSTMENT",
          warehouseId: "wh-a",
          reason: "test",
          items: [
            { productId: "mat-1", uomId: "uom-1", quantity: 5, remarks: "" },
            { productId: "style-1", uomId: "uom-1", quantity: 3, remarks: "" },
          ],
        } as never)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects a Finished Goods document whose productVariantId doesn't actually belong to that line's style", async () => {
      vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([{ id: "style-1", itemType: "STYLE" }] as never);
      vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([{ id: "var-1", productId: "a-different-style" }] as never);

      await expect(
        createStockMovement(actor, {
          movementType: "ADJUSTMENT",
          warehouseId: "wh-a",
          reason: "test",
          itemFamily: "FINISHED_GOODS",
          items: [{ productId: "style-1", uomId: "uom-1", quantity: 5, remarks: "", productVariantId: "var-1" }],
        } as never)
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(recordInventoryTransaction).not.toHaveBeenCalled();
    });

    it("rejects a line whose productId doesn't exist at all", async () => {
      vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([]);

      await expect(
        createStockMovement(actor, {
          movementType: "ADJUSTMENT",
          warehouseId: "wh-a",
          reason: "test",
          items: [{ productId: "ghost-1", uomId: "uom-1", quantity: 5, remarks: "" }],
        } as never)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("Finished Goods stock movements (FGI-014) — the new, parallel path", () => {
    const variantStyleId = "style-1";
    const variantId = "var-1";

    beforeEach(() => {
      vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([{ id: variantStyleId, itemType: "STYLE" }] as never);
      vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([{ id: variantId, productId: variantStyleId }] as never);
    });

    it("never calls convertItemsToBaseUom's own dependencies (findMaterialById) for a Finished Goods document — no UOM conversion attempted", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "ADJUSTMENT",
        warehouseId: "wh-a",
        reason: "Physical count",
        itemFamily: "FINISHED_GOODS",
        items: [{ productId: variantStyleId, uomId: "uom-1", quantity: 8, remarks: "", productVariantId: variantId }],
      } as never);

      expect(ProductRepository.findMaterialById).not.toHaveBeenCalled();
    });

    it("uses getFinishedGoodsSaleableQuantity (not the flat getAvailableQuantity) for the Finished Goods pre-check", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(3);

      await expect(
        createStockMovement(actor, {
          movementType: "ADJUSTMENT",
          warehouseId: "wh-a",
          reason: "Shrinkage",
          itemFamily: "FINISHED_GOODS",
          items: [{ productId: variantStyleId, uomId: "uom-1", quantity: -8, remarks: "", productVariantId: variantId }],
        } as never)
      ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK_FOR_MOVEMENT" });

      expect(getFinishedGoodsSaleableQuantity).toHaveBeenCalledWith("co-1", variantStyleId, variantId, "wh-a", null);
      expect(getAvailableQuantity).not.toHaveBeenCalled();
      expect(recordInventoryTransaction).not.toHaveBeenCalled();
    });

    it("posts every ledger call with productVariantId + stockStatus SALEABLE for an Adjustment — the exact fields FGI-010's own guarded-decrement race protection keys on", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "ADJUSTMENT",
        warehouseId: "wh-a",
        reason: "Physical count",
        itemFamily: "FINISHED_GOODS",
        items: [{ productId: variantStyleId, uomId: "uom-1", quantity: -8, remarks: "", productVariantId: variantId }],
      } as never);

      expect(recordInventoryTransaction).toHaveBeenCalledWith(
        expect.anything(),
        actor,
        expect.objectContaining({
          productId: variantStyleId,
          quantity: -8,
          productVariantId: variantId,
          stockStatus: "SALEABLE",
        })
      );
    });

    it("posts both Transfer ledger entries with productVariantId + stockStatus SALEABLE, and wires the destination's own toWarehouseLocationId (new for Finished Goods — raw material still has none)", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "TRANSFER",
        warehouseId: "wh-a",
        toWarehouseId: "wh-b",
        itemFamily: "FINISHED_GOODS",
        items: [
          {
            productId: variantStyleId,
            uomId: "uom-1",
            quantity: 10,
            remarks: "",
            productVariantId: variantId,
            toWarehouseLocationId: "loc-dest-1",
          },
        ],
      } as never);

      expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        actor,
        expect.objectContaining({ warehouseId: "wh-a", quantity: -10, productVariantId: variantId, stockStatus: "SALEABLE" })
      );
      expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        actor,
        expect.objectContaining({
          warehouseId: "wh-b",
          quantity: 10,
          productVariantId: variantId,
          stockStatus: "SALEABLE",
          warehouseLocationId: "loc-dest-1",
        })
      );
    });

    it("stores productVariantId/toWarehouseLocationId on the created StockMovementItem rows", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "ADJUSTMENT",
        warehouseId: "wh-a",
        reason: "Physical count",
        itemFamily: "FINISHED_GOODS",
        items: [{ productId: variantStyleId, uomId: "uom-1", quantity: 8, remarks: "", productVariantId: variantId }],
      } as never);

      expect(StockMovementRepository.createWithItems).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        [expect.objectContaining({ productVariantId: variantId })]
      );
    });

    it("includes itemFamily in the audit log", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "ADJUSTMENT",
        warehouseId: "wh-a",
        reason: "Physical count",
        itemFamily: "FINISHED_GOODS",
        items: [{ productId: variantStyleId, uomId: "uom-1", quantity: 8, remarks: "", productVariantId: variantId }],
      } as never);

      const { writeAuditLog } = await import("@/core/audit/AuditLogger");
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: expect.objectContaining({ itemFamily: "FINISHED_GOODS" }) }));
    });

    it("posts both Transfer ledger entries at the SAME warehouse but different locations for a same-warehouse Finished Goods Transfer (FGI-031) — previously impossible to reach, Zod always blocked toWarehouseId === warehouseId before this task", async () => {
      vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(50);

      await createStockMovement(actor, {
        movementType: "TRANSFER",
        warehouseId: "wh-a",
        toWarehouseId: "wh-a",
        itemFamily: "FINISHED_GOODS",
        items: [
          {
            productId: variantStyleId,
            uomId: "uom-1",
            quantity: 10,
            remarks: "",
            productVariantId: variantId,
            warehouseLocationId: "loc-source",
            toWarehouseLocationId: "loc-dest",
          },
        ],
      } as never);

      expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        actor,
        expect.objectContaining({ warehouseId: "wh-a", warehouseLocationId: "loc-source", quantity: -10 })
      );
      expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        actor,
        expect.objectContaining({ warehouseId: "wh-a", warehouseLocationId: "loc-dest", quantity: 10 })
      );
    });
  });
});

describe("createStockMovement — Finished Goods Stock Adjustment approval gate (FGI-032)", () => {
  const styleId = "style-fg032";
  const variantId = "var-fg032";

  beforeEach(() => {
    vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([{ id: styleId, itemType: "STYLE" }] as never);
    vi.mocked(ProductVariantRepository.findManyByIds).mockResolvedValue([{ id: variantId, productId: styleId }] as never);
    vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(100);
  });

  function adjustmentInput(quantity: number) {
    return {
      movementType: "ADJUSTMENT" as const,
      warehouseId: "wh-a",
      reason: "test",
      itemFamily: "FINISHED_GOODS" as const,
      items: [{ productId: styleId, uomId: "uom-1", quantity, remarks: "", productVariantId: variantId }],
    };
  }

  it("never asserts 'approve' when no threshold is configured and the flag is off", async () => {
    await createStockMovement(actor, adjustmentInput(-5) as never);
    expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "fg_inventory", "approve");
  });

  it("never gates a RAW_MATERIAL Adjustment at all, even when adjustmentApprovalRequired is true — the existing raw-material flow is completely untouched", async () => {
    vi.mocked(ProductRepository.findManyItemTypesByIds).mockResolvedValue([{ id: "mat-1", itemType: "RAW_MATERIAL" }] as never);
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: true,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: null,
    });
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);

    await createStockMovement(actor, {
      movementType: "ADJUSTMENT",
      warehouseId: "wh-a",
      reason: "test",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: -5, remarks: "" }],
    } as never);

    expect(getFgInventorySettings).not.toHaveBeenCalled();
    expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "fg_inventory", "approve");
  });

  it("asserts 'approve' (not self-approval-guarded) when adjustmentApprovalRequired is true", async () => {
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: true,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: null,
    });

    await createStockMovement(actor, adjustmentInput(-5) as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "fg_inventory", "approve");
  });

  it("triggers approval purely from the absolute quantity threshold, even when adjustmentApprovalRequired is false", async () => {
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: 10,
      adjustmentApprovalThresholdPercent: null,
    });

    await createStockMovement(actor, adjustmentInput(-15) as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "fg_inventory", "approve");
  });

  it("never triggers when the quantity is within the absolute threshold", async () => {
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: 10,
      adjustmentApprovalThresholdPercent: null,
    });

    await createStockMovement(actor, adjustmentInput(-5) as never);

    expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "fg_inventory", "approve");
  });

  it("triggers approval from the percent-of-current-balance threshold (100 available, adjusting 60 = 60%, threshold 50%)", async () => {
    vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(100);
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: 50,
    });

    await createStockMovement(actor, adjustmentInput(-60) as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "fg_inventory", "approve");
  });

  it("also fetches availability and checks the threshold for a POSITIVE ('stock found') line, which the ordinary availability pre-check alone never needed to touch", async () => {
    vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(10);
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: 50,
    });

    // Found 20 units against a recorded balance of only 10 -- 200%, over the
    // 50% threshold, even though a positive adjustment never removes stock
    // and the ordinary pre-check would never have fetched availability for it.
    await createStockMovement(actor, adjustmentInput(20) as never);

    expect(getFinishedGoodsSaleableQuantity).toHaveBeenCalled();
    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "fg_inventory", "approve");
  });

  it("checks EVERY line, not just the first — a later line crossing the threshold still triggers approval", async () => {
    vi.mocked(getFinishedGoodsSaleableQuantity).mockResolvedValue(100);
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: false,
      adjustmentApprovalThresholdQty: 10,
      adjustmentApprovalThresholdPercent: null,
    });

    await createStockMovement(actor, {
      movementType: "ADJUSTMENT",
      warehouseId: "wh-a",
      reason: "test",
      itemFamily: "FINISHED_GOODS",
      items: [
        { productId: styleId, uomId: "uom-1", quantity: -3, remarks: "", productVariantId: variantId },
        { productId: styleId, uomId: "uom-1", quantity: -15, remarks: "", productVariantId: variantId },
      ],
    } as never);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "fg_inventory", "approve");
  });

  it("blocks the whole create (never reaches the ledger/repository write) when approval is required but the actor lacks it", async () => {
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: true,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: null,
    });
    vi.mocked(PermissionService.assert).mockImplementation(async () => {
      throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    });

    await expect(createStockMovement(actor, adjustmentInput(-5) as never)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
    expect(StockMovementRepository.createWithItems).not.toHaveBeenCalled();
  });

  it("never gates a Finished Goods TRANSFER or RETURN_TO_SUPPLIER — only ADJUSTMENT", async () => {
    vi.mocked(getFgInventorySettings).mockResolvedValue({
      adjustmentApprovalRequired: true,
      adjustmentApprovalThresholdQty: null,
      adjustmentApprovalThresholdPercent: null,
    });

    await createStockMovement(actor, {
      movementType: "TRANSFER",
      warehouseId: "wh-a",
      toWarehouseId: "wh-b",
      itemFamily: "FINISHED_GOODS",
      items: [{ productId: styleId, uomId: "uom-1", quantity: 10, remarks: "", productVariantId: variantId }],
    } as never);

    expect(getFgInventorySettings).not.toHaveBeenCalled();
    expect(PermissionService.assert).not.toHaveBeenCalledWith(expect.anything(), "fg_inventory", "approve");
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(StockMovementRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(StockMovementRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listStockMovements adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listStockMovements(actor, listQuery);

    const whereArg = vi.mocked(StockMovementRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listStockMovements adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listStockMovements(actor, listQuery);

    expect(StockMovementRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getStockMovementById succeeds for a movement inside the user's allowed branches", async () => {
    vi.mocked(StockMovementRepository.findByIdWithDetails).mockResolvedValue({ id: "sm-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getStockMovementById(actor, "sm-1");
    expect(result.id).toBe("sm-1");
  });

  it("getStockMovementById throws NOT_FOUND for a movement outside the user's allowed branches", async () => {
    vi.mocked(StockMovementRepository.findByIdWithDetails).mockResolvedValue({ id: "sm-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getStockMovementById(actor, "sm-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("receiveStockMovement", () => {
  const inTransit = {
    id: "sm-1",
    companyId: "co-1",
    branchId: "br-1",
    movementType: "TRANSFER",
    status: "IN_TRANSIT",
    warehouseId: "wh-a",
    toWarehouseId: "wh-b",
    toWarehouse: { id: "wh-b", name: "Warehouse B" },
    items: [
      { id: "item-1", productId: "mat-1", uomId: "uom-1", quantity: "10", product: { styleName: "Cotton" } },
      { id: "item-2", productId: "mat-1", uomId: "uom-1", quantity: "4", product: { styleName: "Cotton" } },
    ],
  };

  beforeEach(() => {
    vi.mocked(StockMovementRepository.findByIdWithDetails).mockReset().mockResolvedValue(inTransit as never);
    vi.mocked(prisma.warehouseLocation.findMany).mockReset().mockResolvedValue([{ id: "loc-b1" }, { id: "loc-b2" }] as never);
    txMock.stockMovement.updateMany.mockReset().mockResolvedValue({ count: 1 });
    txMock.stockMovementItem.update.mockReset();
  });

  const allPicked = { items: [{ itemId: "item-1", toWarehouseLocationId: "loc-b1" }, { itemId: "item-2", toWarehouseLocationId: "loc-b2" }] };

  it("posts the destination side at each chosen location and marks it RECEIVED", async () => {
    await receiveStockMovement(actor, "sm-1", allPicked);

    expect(txMock.stockMovement.updateMany).toHaveBeenCalledWith({
      where: { id: "sm-1", companyId: "co-1", status: "IN_TRANSIT" },
      data: expect.objectContaining({ status: "RECEIVED", receivedByUserId: "user-1" }),
    });
    expect(recordInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      txMock,
      actor,
      expect.objectContaining({ warehouseId: "wh-b", quantity: 10, warehouseLocationId: "loc-b1", transactionType: "STOCK_TRANSFER" })
    );
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      txMock,
      actor,
      expect.objectContaining({ warehouseId: "wh-b", quantity: 4, warehouseLocationId: "loc-b2" })
    );
    expect(txMock.stockMovementItem.update).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { toWarehouseLocationId: "loc-b1" } });
  });

  it("requires a destination location for every line", async () => {
    await expect(
      receiveStockMovement(actor, "sm-1", { items: [{ itemId: "item-1", toWarehouseLocationId: "loc-b1" }] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects a location that isn't an active location of the destination warehouse", async () => {
    vi.mocked(prisma.warehouseLocation.findMany).mockResolvedValue([{ id: "loc-b1" }] as never);

    await expect(receiveStockMovement(actor, "sm-1", allPicked)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prisma.warehouseLocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ warehouseId: "wh-b", isActive: true, warehouse: { companyId: "co-1" } }) })
    );
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("refuses a transfer that is already received", async () => {
    vi.mocked(StockMovementRepository.findByIdWithDetails).mockResolvedValue({ ...inTransit, status: "RECEIVED" } as never);

    await expect(receiveStockMovement(actor, "sm-1", allPicked)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("posts nothing when another receiver got there first", async () => {
    txMock.stockMovement.updateMany.mockResolvedValue({ count: 0 });

    await expect(receiveStockMovement(actor, "sm-1", allPicked)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });
});

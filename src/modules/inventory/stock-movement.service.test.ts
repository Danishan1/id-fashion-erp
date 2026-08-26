import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("./inventory.service", () => ({ getAvailableQuantity: vi.fn(), recordInventoryTransaction: vi.fn() }));
vi.mock("./stock-movement.repository", () => ({
  StockMovementRepository: { createWithItems: vi.fn(), findByIdempotencyKey: vi.fn() },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() } },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { getAvailableQuantity, recordInventoryTransaction } = await import("./inventory.service");
const { StockMovementRepository } = await import("./stock-movement.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { createStockMovement } = await import("./stock-movement.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

// Every test's items use uomId "uom-1", which is set here to match the
// material's own base UOM — the "no conversion needed" branch — so these
// pre-existing tests keep asserting the same as-entered quantities. UOM
// conversion itself is covered by its own dedicated test below.
const BASE_UOM = { id: "uom-1", baseUnitId: null, conversionFactor: 1 };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("STK-2026-00001");
  vi.mocked(getAvailableQuantity).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset();
  vi.mocked(StockMovementRepository.createWithItems).mockReset().mockResolvedValue({ id: "sm-1" } as never);
  vi.mocked(StockMovementRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Test Material", baseUom: BASE_UOM } as never);
});

describe("createStockMovement", () => {
  it("posts two ledger entries for a TRANSFER — negative at source, positive at destination", async () => {
    vi.mocked(getAvailableQuantity).mockResolvedValue(50);

    await createStockMovement(actor, {
      movementType: "TRANSFER",
      warehouseId: "wh-a",
      toWarehouseId: "wh-b",
      items: [{ productId: "mat-1", uomId: "uom-1", quantity: 10, remarks: "" }],
    } as never);

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-a", quantity: -10, transactionType: "STOCK_TRANSFER" })
    );
    expect(recordInventoryTransaction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      actor,
      expect.objectContaining({ warehouseId: "wh-b", quantity: 10, transactionType: "STOCK_TRANSFER" })
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
});

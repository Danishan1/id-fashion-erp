import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) } }));
vi.mock("./inventory.service", () => ({ getAvailableQuantity: vi.fn(), recordInventoryTransaction: vi.fn() }));
vi.mock("./stock-movement.repository", () => ({
  StockMovementRepository: { createWithItems: vi.fn() },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { getAvailableQuantity, recordInventoryTransaction } = await import("./inventory.service");
const { StockMovementRepository } = await import("./stock-movement.repository");
const { createStockMovement } = await import("./stock-movement.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: "br-1" };

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("STK-2026-00001");
  vi.mocked(getAvailableQuantity).mockReset();
  vi.mocked(recordInventoryTransaction).mockReset();
  vi.mocked(StockMovementRepository.createWithItems).mockReset().mockResolvedValue({ id: "sm-1" } as never);
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
});

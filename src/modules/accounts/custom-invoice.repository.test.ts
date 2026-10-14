import { describe, expect, it, vi } from "vitest";
import { CustomInvoiceRepository } from "./custom-invoice.repository";

vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    customInvoiceItem: { findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), createMany: vi.fn() },
    customInvoiceCreditNoteItem: { findMany: vi.fn() },
    customInvoiceNote: { deleteMany: vi.fn() },
    customInvoice: { update: vi.fn(), findFirstOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");

describe("CustomInvoiceRepository.replaceItemsAndNotes (H-02 semantic identity)", () => {
  it("preserves historical item identity and zeroes amount instead of deleting or overwriting when an item is removed", async () => {
    // Existing items on invoice:
    // 1. item-1: "Silk Fabric" (referenced by cancelled credit note)
    // 2. item-2: "Buttons" (unreferenced)
    const existingItems = [
      { id: "item-1", customInvoiceId: "inv-1", productId: null, itemName: "Silk Fabric", hsnCode: "5007", quantity: 10, unitPrice: 100 },
      { id: "item-2", customInvoiceId: "inv-1", productId: null, itemName: "Buttons", hsnCode: "9606", quantity: 50, unitPrice: 2 },
    ];

    // Credit note references item-1
    const referencedLines = [{ customInvoiceItemId: "item-1" }];

    // Updated invoice has 1 item: "Leather Belt" (completely new product!)
    const newItems = [
      { productId: null, itemName: "Leather Belt", hsnCode: "4203", quantity: 5, unitPrice: 500, gstPercentage: 18, lineAmount: 2500, lineTaxAmount: 450, lineTotal: 2950 },
    ];

    const mockTx = {
      customInvoiceItem: {
        findMany: vi.fn().mockResolvedValue(existingItems),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      customInvoiceCreditNoteItem: {
        findMany: vi.fn().mockResolvedValue(referencedLines),
      },
      customInvoiceNote: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customInvoice: {
        update: vi.fn().mockResolvedValue({}),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "inv-1" }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(mockTx));

    await CustomInvoiceRepository.replaceItemsAndNotes("inv-1", {} as never, newItems, []);

    // 1. Referenced item-1 ("Silk Fabric") was NOT matched to "Leather Belt".
    // It must NOT be deleted (preventing FK constraint violation 23503).
    expect(mockTx.customInvoiceItem.delete).not.toHaveBeenCalledWith({ where: { id: "item-1" } });

    // 2. Referenced item-1 must NOT be overwritten with "Leather Belt".
    // Its quantity and active amounts are zeroed, but its historical identity is preserved!
    expect(mockTx.customInvoiceItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: {
        quantity: 0,
        lineAmount: 0,
        lineTaxAmount: 0,
        lineTotal: 0,
      },
    });

    // 3. Unreferenced item-2 ("Buttons") was safely deleted
    expect(mockTx.customInvoiceItem.delete).toHaveBeenCalledWith({ where: { id: "item-2" } });

    // 4. "Leather Belt" was created as a distinct new item
    expect(mockTx.customInvoiceItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ itemName: "Leather Belt", customInvoiceId: "inv-1" })],
    });
  });

  it("updates existing referenced item in-place when product matches semantically", async () => {
    const existingItems = [
      { id: "item-1", customInvoiceId: "inv-1", productId: "prod-1", itemName: "Silk Fabric", quantity: 10, unitPrice: 100 },
    ];
    const referencedLines = [{ customInvoiceItemId: "item-1" }];

    // Updated invoice still has "Silk Fabric" (same productId), but updated quantity & price
    const newItems = [
      { productId: "prod-1", itemName: "Silk Fabric", hsnCode: "5007", quantity: 8, unitPrice: 120, gstPercentage: 18, lineAmount: 960, lineTaxAmount: 172.8, lineTotal: 1132.8 },
    ];

    const mockTx = {
      customInvoiceItem: {
        findMany: vi.fn().mockResolvedValue(existingItems),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customInvoiceCreditNoteItem: {
        findMany: vi.fn().mockResolvedValue(referencedLines),
      },
      customInvoiceNote: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      customInvoice: {
        update: vi.fn().mockResolvedValue({}),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: "inv-1" }),
      },
    };

    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(mockTx));

    await CustomInvoiceRepository.replaceItemsAndNotes("inv-1", {} as never, newItems, []);

    // Matches semantically -> updated in-place with new data
    expect(mockTx.customInvoiceItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: newItems[0],
    });
    // Nothing created afresh
    expect(mockTx.customInvoiceItem.createMany).not.toHaveBeenCalled();
    expect(mockTx.customInvoiceItem.delete).not.toHaveBeenCalled();
  });
});

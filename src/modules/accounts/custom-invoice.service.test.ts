import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomInvoiceInput } from "./custom-invoice.schema";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./invoice-series.repository", () => ({
  InvoiceSeriesRepository: { findById: vi.fn() },
}));
vi.mock("./custom-invoice.repository", () => ({
  CustomInvoiceRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    replaceItemsAndNotes: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
}));
vi.mock("./custom-invoice-credit-note.repository", () => ({
  CustomInvoiceCreditNoteRepository: { countByInvoiceId: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { InvoiceSeriesRepository } = await import("./invoice-series.repository");
const { CustomInvoiceRepository } = await import("./custom-invoice.repository");
const { CustomInvoiceCreditNoteRepository } = await import("./custom-invoice-credit-note.repository");
const { createCustomInvoice, updateCustomInvoice, cancelCustomInvoice } = await import("./custom-invoice.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

const series = { id: "series-1", companyId: "co-1", name: "Retail Series", prefix: "RET", fiscalYearLabel: "2025-2026", nextNumber: 5, isActive: true };

function baseInput(overrides: Partial<CustomInvoiceInput> = {}): CustomInvoiceInput {
  return {
    invoiceDate: "2026-08-27",
    invoiceType: "TAX_INVOICE",
    hasDueDate: false,
    dueDate: "",
    invoiceSeriesId: "series-1",
    invoiceNumber: "RET/2025-2026/5",
    customerId: "cust-1",
    discountPercentage: 0,
    isReverseCharge: false,
    items: [{ productId: "", itemName: "Item A", hsnCode: "", quantity: 10, unitPrice: 100, gstPercentage: 18 }],
    notes: [],
    advancePaymentTitle: "",
    payableAmountTitle: "",
    termsAndConditions: "",
    ...overrides,
  };
}

// $transaction receives a callback; run it against a minimal tx mock whose
// invoiceSeries.update is a no-op and customInvoice.create returns whatever
// the test wants, mirroring the exact shape real code writes. Returns the
// customInvoice.create spy so a test can inspect exactly what data it was
// called with (the real computed totals).
function mockTransaction(createResult: unknown) {
  const txCreate = vi.fn().mockResolvedValue(createResult);
  const mockTx = { invoiceSeries: { update: vi.fn() }, customInvoice: { create: txCreate } };
  vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(mockTx));
  return txCreate;
}

beforeEach(() => {
  vi.mocked(InvoiceSeriesRepository.findById).mockReset().mockResolvedValue(series as never);
  vi.mocked(CustomInvoiceRepository.findAnyById).mockReset();
  vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mockReset();
  vi.mocked(CustomInvoiceRepository.updateStatusConditional).mockReset();
  vi.mocked(CustomInvoiceCreditNoteRepository.countByInvoiceId).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createCustomInvoice", () => {
  it("rejects when the invoice series doesn't exist", async () => {
    vi.mocked(InvoiceSeriesRepository.findById).mockResolvedValue(null);
    await expect(createCustomInvoice(actor, baseInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an inactive invoice series", async () => {
    vi.mocked(InvoiceSeriesRepository.findById).mockResolvedValue({ ...series, isActive: false } as never);
    await expect(createCustomInvoice(actor, baseInput())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("applies discount% per line before GST, matching the reference tool's own calculation", async () => {
    const txCreate = mockTransaction({ id: "inv-1", items: [], notes: [] });
    await createCustomInvoice(
      actor,
      baseInput({
        discountPercentage: 10,
        items: [
          { productId: "", itemName: "Cotton Fabric", hsnCode: "", quantity: 10, unitPrice: 2, gstPercentage: 5 },
          { productId: "", itemName: "Consulting", hsnCode: "998313", quantity: 1, unitPrice: 1000, gstPercentage: 18 },
        ],
      })
    );

    const data = txCreate.mock.calls[0][0].data;
    // Item 1: qty 10 * (2 * 0.9) = 18, tax 18*5% = 0.9
    // Item 2: qty 1 * (1000 * 0.9) = 900, tax 900*18% = 162
    expect(data.subtotalAmount).toBeCloseTo(918);
    expect(data.discountAmount).toBeCloseTo(102); // (10*2 + 1*1000) - 918
    expect(data.taxAmount).toBeCloseTo(162.9);
    expect(data.grandTotal).toBeCloseTo(1080.9);
  });

  it("zeroes GST on every line when isReverseCharge is true", async () => {
    const txCreate = mockTransaction({ id: "inv-2", items: [], notes: [] });
    await createCustomInvoice(actor, baseInput({ isReverseCharge: true }));

    const data = txCreate.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(0);
    expect(data.grandTotal).toBe(data.subtotalAmount);
  });

  it("rejects an advance payment greater than the grand total", async () => {
    await expect(
      createCustomInvoice(actor, baseInput({ advancePaymentTitle: "Booking", advancePaymentAmount: 999999 }))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("computes balanceDue as grandTotal minus advance minus payable", async () => {
    const txCreate = mockTransaction({ id: "inv-3", items: [], notes: [] });
    await createCustomInvoice(
      actor,
      baseInput({
        items: [{ productId: "", itemName: "Item A", hsnCode: "", quantity: 1, unitPrice: 1000, gstPercentage: 0 }],
        advancePaymentTitle: "Booking",
        advancePaymentAmount: 300,
        payableAmountTitle: "Balance",
        payableAmountValue: 200,
      })
    );

    expect(txCreate.mock.calls[0][0].data.balanceDue).toBe(500); // 1000 - 300 - 200
  });

  it("translates a duplicate invoice_number constraint violation into DUPLICATE_DOC_NUMBER", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("unique constraint"), {
        code: "P2002",
        meta: { driverAdapterError: { cause: { constraint: { fields: ["company_id", "invoice_number"] } } } },
      })
    );
    await expect(createCustomInvoice(actor, baseInput())).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
  });
});

describe("updateCustomInvoice", () => {
  it("rejects editing an invoice that isn't DRAFT", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "CANCELLED" } as never);
    await expect(updateCustomInvoice(actor, "inv-1", baseInput())).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CustomInvoiceRepository.replaceItemsAndNotes).not.toHaveBeenCalled();
  });

  it("recomputes totals and replaces items/notes for a DRAFT invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT" } as never);
    vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mockResolvedValue({ id: "inv-1" } as never);

    await updateCustomInvoice(actor, "inv-1", baseInput({ items: [{ productId: "", itemName: "New Item", hsnCode: "", quantity: 2, unitPrice: 50, gstPercentage: 0 }] }));

    const [, headerData] = vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mock.calls[0];
    expect(headerData.grandTotal).toBe(100);
  });

  // Regression test — caught live: replaceItemsAndNotes deletes every
  // CustomInvoiceItem row, but a CANCELLED credit note's own
  // CustomInvoiceCreditNoteItem rows still reference the original item (a
  // cancelled credit note is never deleted, only status-flipped), so the
  // delete previously hit a real FK constraint and 500'd even though
  // paidAmount/creditedAmount had both been fully reversed back to 0.
  it("rejects editing once any credit note has ever existed, even a fully-reversed cancelled one", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT", paidAmount: 0, creditedAmount: 0 } as never);
    vi.mocked(CustomInvoiceCreditNoteRepository.countByInvoiceId).mockResolvedValue(1);

    await expect(updateCustomInvoice(actor, "inv-1", baseInput())).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CustomInvoiceRepository.replaceItemsAndNotes).not.toHaveBeenCalled();
  });
});

describe("cancelCustomInvoice", () => {
  it("rejects cancelling an already-cancelled invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "CANCELLED" } as never);
    await expect(cancelCustomInvoice(actor, "inv-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("throws on a lost race (guarded update matches zero rows)", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT" } as never);
    vi.mocked(CustomInvoiceRepository.updateStatusConditional).mockResolvedValue({ count: 0 });
    await expect(cancelCustomInvoice(actor, "inv-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("cancels a DRAFT invoice successfully", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT" } as never);
    vi.mocked(CustomInvoiceRepository.updateStatusConditional).mockResolvedValue({ count: 1 });
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue({ id: "inv-1", status: "CANCELLED" } as never);

    const result = await cancelCustomInvoice(actor, "inv-1");
    expect(result).toMatchObject({ status: "CANCELLED" });
  });
});

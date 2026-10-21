import { beforeEach, describe, expect, it, vi } from "vitest";
import { round2 } from "@/lib/money";
import { customInvoiceSchema, type CustomInvoiceInput } from "./custom-invoice.schema";

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
  CustomInvoiceCreditNoteRepository: { countByInvoiceId: vi.fn(), countActiveByInvoiceId: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(),
    company: { findUnique: vi.fn() },
    customer: { findFirst: vi.fn() },
  },
}));

const { prisma } = await import("@/core/db/client");
const { InvoiceSeriesRepository } = await import("./invoice-series.repository");
const { CustomInvoiceRepository } = await import("./custom-invoice.repository");
const { CustomInvoiceCreditNoteRepository } = await import("./custom-invoice-credit-note.repository");
const { createCustomInvoice, updateCustomInvoice, cancelCustomInvoice, listCustomInvoices } = await import("./custom-invoice.service");

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
  vi.mocked(CustomInvoiceCreditNoteRepository.countActiveByInvoiceId).mockReset().mockResolvedValue(0);
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(prisma.company.findUnique).mockReset().mockResolvedValue({
    id: "co-1",
    taxRegistrationNo: "07AAAAA0000A1Z5", // Delhi (07)
  } as never);
  vi.mocked(prisma.customer.findFirst).mockReset().mockResolvedValue({
    id: "cust-1",
    taxRegistrationNo: "07BBBBB0000B1Z6", // Delhi (07) -> Intra-state default
  } as never);
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

  // FERP-QA-001 regression: a customer from another company must be rejected,
  // and the lookup must be scoped to the actor's own company.
  it("rejects a customer that doesn't belong to the actor's company", async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    await expect(createCustomInvoice(actor, baseInput({ customerId: "other-co-customer" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "other-co-customer", companyId: "co-1", deletedAt: null } })
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

  it("calculates intra-state GST with exact 50/50 split and odd-paisa reconciliation", async () => {
    const txCreate = mockTransaction({ id: "inv-gst-1", items: [], notes: [] });
    // 1 item @ 555.83 with 18% GST -> taxAmount = round2(555.83 * 0.18) = 100.05 (odd paisa)
    await createCustomInvoice(
      actor,
      baseInput({
        items: [{ productId: "", itemName: "Fabric Roll", hsnCode: "5208", quantity: 1, unitPrice: 555.83, gstPercentage: 18 }],
      })
    );

    const data = txCreate.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(100.05);
    expect(data.isInterState).toBe(false);
    expect(data.placeOfSupplyStateCode).toBe("07");
    expect(data.cgstAmount).toBe(50.03);
    expect(data.sgstAmount).toBe(50.02);
    expect(data.igstAmount).toBe(0);
    // Strict reconciliation: CGST + SGST must exactly equal taxAmount
    expect(round2(data.cgstAmount + data.sgstAmount)).toBe(data.taxAmount);
  });

  it("calculates inter-state GST with IGST equal to total tax and zero CGST/SGST", async () => {
    // Customer from Maharashtra (State Code 27), Supplier in Delhi (07)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: "cust-mh",
      taxRegistrationNo: "27AAAAA1111A1Z5",
    } as never);

    const txCreate = mockTransaction({ id: "inv-gst-2", items: [], notes: [] });
    await createCustomInvoice(
      actor,
      baseInput({
        items: [{ productId: "", itemName: "Apparel Batch", hsnCode: "6109", quantity: 10, unitPrice: 100, gstPercentage: 18 }],
      })
    );

    const data = txCreate.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(180);
    expect(data.isInterState).toBe(true);
    expect(data.placeOfSupplyStateCode).toBe("27");
    expect(data.cgstAmount).toBe(0);
    expect(data.sgstAmount).toBe(0);
    expect(data.igstAmount).toBe(180);
  });

  it("respects explicit placeOfSupplyStateCode in input overriding customer GSTIN", async () => {
    const txCreate = mockTransaction({ id: "inv-gst-3", items: [], notes: [] });
    // Customer default is Delhi (07), but placeOfSupplyStateCode explicitly given as "24" (Gujarat)
    await createCustomInvoice(
      actor,
      baseInput({
        placeOfSupplyStateCode: "24",
        items: [{ productId: "", itemName: "Apparel Batch", hsnCode: "6109", quantity: 10, unitPrice: 100, gstPercentage: 18 }],
      })
    );

    const data = txCreate.mock.calls[0][0].data;
    expect(data.isInterState).toBe(true);
    expect(data.placeOfSupplyStateCode).toBe("24");
    expect(data.igstAmount).toBe(180);
    expect(data.cgstAmount).toBe(0);
    expect(data.sgstAmount).toBe(0);
  });

  it("rejects non-empty invalid explicit place of supply with VALIDATION_ERROR and never falls back to customer GSTIN (H-01)", async () => {
    // Customer has valid Delhi GSTIN, but explicit POS is '99' or 'XX'
    await expect(createCustomInvoice(actor, baseInput({ placeOfSupplyStateCode: "99" }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining('Invalid Place of Supply state code "99"'),
    });

    await expect(createCustomInvoice(actor, baseInput({ placeOfSupplyStateCode: "XX" }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining('Invalid Place of Supply state code "XX"'),
    });
  });

  it("trims whitespace-only explicit place of supply and falls back to customer GSTIN", async () => {
    const txCreate = mockTransaction({ id: "inv-gst-ws", items: [], notes: [] });
    await createCustomInvoice(actor, baseInput({ placeOfSupplyStateCode: "   " }));

    const data = txCreate.mock.calls[0][0].data;
    // Customer has Delhi (07) GSTIN, so falls back to 07
    expect(data.placeOfSupplyStateCode).toBe("07");
    expect(data.isInterState).toBe(false);
  });

  it("rejects invalid place of supply state code at Zod boundary (L-01)", () => {
    const validUuid = "11111111-1111-4111-a111-111111111111";
    const schemaInput = (pos: string) =>
      baseInput({ invoiceSeriesId: validUuid, customerId: validUuid, placeOfSupplyStateCode: pos });

    const invalid99 = customInvoiceSchema.safeParse(schemaInput("99"));
    expect(invalid99.success).toBe(false);

    const invalidXX = customInvoiceSchema.safeParse(schemaInput("XX"));
    expect(invalidXX.success).toBe(false);

    const valid07 = customInvoiceSchema.safeParse(schemaInput("07"));
    expect(valid07.success).toBe(true);

    const whitespace = customInvoiceSchema.safeParse(schemaInput("   "));
    expect(whitespace.success).toBe(true);
  });

  it("rejects invoice creation with VALIDATION_ERROR when GST > 0 but supplier GSTIN is missing", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      id: "co-1",
      taxRegistrationNo: null,
    } as never);

    await expect(createCustomInvoice(actor, baseInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Supplier GSTIN is missing or invalid"),
    });
  });

  it("rejects invoice creation with VALIDATION_ERROR when GST > 0 but customer state cannot be determined", async () => {
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: "cust-1",
      taxRegistrationNo: null,
    } as never);

    await expect(createCustomInvoice(actor, baseInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Customer GSTIN or Place of Supply state code is missing"),
    });
  });

  it("allows zero tax without requiring GSTIN and zeroes all tax components", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: "co-1", taxRegistrationNo: null } as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: "cust-1", taxRegistrationNo: null } as never);

    const txCreate = mockTransaction({ id: "inv-zero-tax", items: [], notes: [] });
    await createCustomInvoice(
      actor,
      baseInput({
        items: [{ productId: "", itemName: "Exempt Goods", hsnCode: "", quantity: 5, unitPrice: 100, gstPercentage: 0 }],
      })
    );

    const data = txCreate.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(0);
    expect(data.cgstAmount).toBe(0);
    expect(data.sgstAmount).toBe(0);
    expect(data.igstAmount).toBe(0);
  });

  it("allows reverse charge (RCM) without requiring GSTIN and zeroes all tax components", async () => {
    vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: "co-1", taxRegistrationNo: null } as never);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({ id: "cust-1", taxRegistrationNo: null } as never);

    const txCreate = mockTransaction({ id: "inv-rcm", items: [], notes: [] });
    await createCustomInvoice(actor, baseInput({ isReverseCharge: true }));

    const data = txCreate.mock.calls[0][0].data;
    expect(data.taxAmount).toBe(0);
    expect(data.cgstAmount).toBe(0);
    expect(data.sgstAmount).toBe(0);
    expect(data.igstAmount).toBe(0);
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

  it("rejects switching a DRAFT invoice to another company's customer (FERP-QA-001)", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT", paidAmount: 0, creditedAmount: 0 } as never);
    vi.mocked(CustomInvoiceCreditNoteRepository.countActiveByInvoiceId).mockResolvedValue(0);
    vi.mocked(prisma.customer.findFirst).mockResolvedValue(null);
    await expect(updateCustomInvoice(actor, "inv-1", baseInput({ customerId: "other-co-customer" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
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
  it("rejects editing once an active (ISSUED) credit note exists", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT", paidAmount: 0, creditedAmount: 0 } as never);
    vi.mocked(CustomInvoiceCreditNoteRepository.countActiveByInvoiceId).mockResolvedValue(1);

    await expect(updateCustomInvoice(actor, "inv-1", baseInput())).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(CustomInvoiceRepository.replaceItemsAndNotes).not.toHaveBeenCalled();
  });

  it("permits editing when only CANCELLED credit notes exist and paid/credited balances are zero", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT", paidAmount: 0, creditedAmount: 0 } as never);
    vi.mocked(CustomInvoiceCreditNoteRepository.countActiveByInvoiceId).mockResolvedValue(0);
    vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mockResolvedValue({ id: "inv-1" } as never);

    await expect(
      updateCustomInvoice(
        actor,
        "inv-1",
        baseInput({ items: [{ productId: "", itemName: "Updated Item", hsnCode: "", quantity: 1, unitPrice: 200, gstPercentage: 0 }] })
      )
    ).resolves.toBeDefined();
    expect(CustomInvoiceRepository.replaceItemsAndNotes).toHaveBeenCalled();
  });

  it("recomputes GST breakdown with inter-state handling when updating a DRAFT invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue({ id: "inv-1", status: "DRAFT", paidAmount: 0, creditedAmount: 0 } as never);
    vi.mocked(CustomInvoiceCreditNoteRepository.countActiveByInvoiceId).mockResolvedValue(0);
    vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mockResolvedValue({ id: "inv-1" } as never);
    // Customer in Karnataka (29), Supplier in Delhi (07)
    vi.mocked(prisma.customer.findFirst).mockResolvedValue({
      id: "cust-ka",
      taxRegistrationNo: "29CCCCC2222C1Z8",
    } as never);

    await updateCustomInvoice(
      actor,
      "inv-1",
      baseInput({
        items: [{ productId: "", itemName: "Denim Fabric", hsnCode: "5209", quantity: 2, unitPrice: 500, gstPercentage: 12 }],
      })
    );

    const [, headerData] = vi.mocked(CustomInvoiceRepository.replaceItemsAndNotes).mock.calls[0];
    expect(headerData.taxAmount).toBe(120);
    expect(headerData.isInterState).toBe(true);
    expect(headerData.placeOfSupplyStateCode).toBe("29");
    expect(headerData.igstAmount).toBe(120);
    expect(headerData.cgstAmount).toBe(0);
    expect(headerData.sgstAmount).toBe(0);
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

describe("listCustomInvoices status filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters by PAID correctly using balanceDue <= 0 and not CANCELLED", async () => {
    vi.mocked(CustomInvoiceRepository.findMany).mockResolvedValue([] as never);
    vi.mocked(CustomInvoiceRepository.count).mockResolvedValue(0);

    await listCustomInvoices("co-1", {
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
      sortBy: "invoiceDate",
      sortOrder: "desc",
      status: "PAID",
    });

    const [where] = vi.mocked(CustomInvoiceRepository.findMany).mock.calls[0];
    expect(where.companyId).toBe("co-1");
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.balanceDue).toEqual({ lte: 0 });
  });

  it("filters by PARTIALLY_PAID correctly using balanceDue > 0 and activity", async () => {
    vi.mocked(CustomInvoiceRepository.findMany).mockResolvedValue([] as never);
    vi.mocked(CustomInvoiceRepository.count).mockResolvedValue(0);

    await listCustomInvoices("co-1", {
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
      sortBy: "invoiceDate",
      sortOrder: "desc",
      status: "PARTIALLY_PAID",
    });

    const [where] = vi.mocked(CustomInvoiceRepository.findMany).mock.calls[0];
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.balanceDue).toEqual({ gt: 0 });
    expect(where.OR).toEqual([{ paidAmount: { gt: 0 } }, { creditedAmount: { gt: 0 } }]);
  });

  it("filters by ISSUED / DRAFT correctly for clean active invoices", async () => {
    vi.mocked(CustomInvoiceRepository.findMany).mockResolvedValue([] as never);
    vi.mocked(CustomInvoiceRepository.count).mockResolvedValue(0);

    await listCustomInvoices("co-1", {
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
      sortBy: "invoiceDate",
      sortOrder: "desc",
      status: "ISSUED",
    });

    const [where] = vi.mocked(CustomInvoiceRepository.findMany).mock.calls[0];
    expect(where.status).toBe("DRAFT");
    expect(where.paidAmount).toBe(0);
    expect(where.creditedAmount).toBe(0);
    expect(where.balanceDue).toEqual({ gt: 0 });
  });

  it("filters by CANCELLED correctly", async () => {
    vi.mocked(CustomInvoiceRepository.findMany).mockResolvedValue([] as never);
    vi.mocked(CustomInvoiceRepository.count).mockResolvedValue(0);

    await listCustomInvoices("co-1", {
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
      sortBy: "invoiceDate",
      sortOrder: "desc",
      status: "CANCELLED",
    });

    const [where] = vi.mocked(CustomInvoiceRepository.findMany).mock.calls[0];
    expect(where.status).toBe("CANCELLED");
  });
});

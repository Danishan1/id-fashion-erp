import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("./custom-invoice.repository", () => ({
  CustomInvoiceRepository: { findByIdWithDetails: vi.fn() },
}));
vi.mock("./custom-invoice-credit-note.repository", () => ({
  CustomInvoiceCreditNoteRepository: { findAnyById: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { CustomInvoiceRepository } = await import("./custom-invoice.repository");
const { CustomInvoiceCreditNoteRepository } = await import("./custom-invoice-credit-note.repository");
const { issueCustomInvoiceCreditNote, cancelCustomInvoiceCreditNote } = await import("./custom-invoice-credit-note.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

const item1 = { id: "item-1", quantity: 10, lineTotal: 1000, creditedAmount: 0 };
const item2 = { id: "item-2", quantity: 5, lineTotal: 500, creditedAmount: 0 };

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    status: "DRAFT",
    grandTotal: 1500,
    creditedAmount: 0,
    items: [item1, item2],
    ...overrides,
  };
}

function mockTx(refreshedInvoice: Record<string, unknown>, creditNoteResult: unknown) {
  const itemUpdate = vi.fn();
  vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
    (cb as (tx: unknown) => Promise<unknown>)({
      customInvoice: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(refreshedInvoice),
        update: vi.fn(),
      },
      customInvoiceItem: { update: itemUpdate },
      customInvoiceCreditNote: { create: vi.fn().mockResolvedValue(creditNoteResult), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    })
  );
  return itemUpdate;
}

beforeEach(() => {
  vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockReset();
  vi.mocked(CustomInvoiceCreditNoteRepository.findAnyById).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("CN-2026-00001");
});

describe("issueCustomInvoiceCreditNote — OVERALL_DISCOUNT", () => {
  it("rejects when the invoice doesn't exist", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(null);
    await expect(
      issueCustomInvoiceCreditNote(actor, "inv-1", { creditNoteDate: "2026-08-27", type: "OVERALL_DISCOUNT", amount: 100, items: [] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects issuing against a cancelled invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture({ status: "CANCELLED" }) as never);
    await expect(
      issueCustomInvoiceCreditNote(actor, "inv-1", { creditNoteDate: "2026-08-27", type: "OVERALL_DISCOUNT", amount: 100, items: [] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects an amount exceeding what's left to credit on the invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture({ grandTotal: 1500, creditedAmount: 1400 }) as never);
    await expect(
      issueCustomInvoiceCreditNote(actor, "inv-1", { creditNoteDate: "2026-08-27", type: "OVERALL_DISCOUNT", amount: 200, items: [] })
    ).rejects.toMatchObject({ code: "OVER_CREDIT_NOTE_NOT_ALLOWED" });
  });

  it("issues a valid overall-discount credit note with no item lines", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture() as never);
    const itemUpdate = mockTx(invoiceFixture({ creditedAmount: 100 }), { id: "cn-1", totalAmount: 100 });

    const result = await issueCustomInvoiceCreditNote(actor, "inv-1", {
      creditNoteDate: "2026-08-27",
      type: "OVERALL_DISCOUNT",
      amount: 100,
      items: [],
    });

    expect(result).toMatchObject({ id: "cn-1" });
    expect(itemUpdate).not.toHaveBeenCalled();
  });
});

describe("issueCustomInvoiceCreditNote — PRODUCT_RETURN", () => {
  it("derives the amount from the line's own effective per-unit rate", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture() as never);
    let capturedCreateData: unknown;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        customInvoice: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(invoiceFixture({ creditedAmount: 300 })),
          update: vi.fn(),
        },
        customInvoiceItem: { update: vi.fn() },
        customInvoiceCreditNote: {
          create: vi.fn().mockImplementation((args) => {
            capturedCreateData = args.data;
            return { id: "cn-1", ...args.data };
          }),
        },
      })
    );

    // item-1: lineTotal 1000 / quantity 10 = 100/unit; returning 3 units = 300.
    await issueCustomInvoiceCreditNote(actor, "inv-1", {
      creditNoteDate: "2026-08-27",
      type: "PRODUCT_RETURN",
      items: [{ customInvoiceItemId: "item-1", quantity: 3 }],
    });

    const created = capturedCreateData as { totalAmount: number; items: { create: { amount: number; quantity: number }[] } };
    expect(created.totalAmount).toBe(300);
    expect(created.items.create[0]).toMatchObject({ amount: 300, quantity: 3 });
  });

  it("rejects a line whose amount exceeds what's left to credit on that specific item", async () => {
    // item-1 has 200 already credited out of 1000 lineTotal -> 800 remaining;
    // returning 9 units at 100/unit = 900, over the 800 remaining.
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(
      invoiceFixture({ items: [{ ...item1, creditedAmount: 200 }, item2] }) as never
    );
    await expect(
      issueCustomInvoiceCreditNote(actor, "inv-1", {
        creditNoteDate: "2026-08-27",
        type: "PRODUCT_RETURN",
        items: [{ customInvoiceItemId: "item-1", quantity: 9 }],
      })
    ).rejects.toMatchObject({ code: "OVER_CREDIT_NOTE_NOT_ALLOWED" });
  });

  it("rejects a line targeting an item that doesn't belong to this invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture() as never);
    await expect(
      issueCustomInvoiceCreditNote(actor, "inv-1", {
        creditNoteDate: "2026-08-27",
        type: "PRODUCT_RETURN",
        items: [{ customInvoiceItemId: "item-does-not-exist", quantity: 1 }],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("issueCustomInvoiceCreditNote — PRODUCT_WISE", () => {
  it("takes the caller's amount at face value, bounds-checked against the line's remaining", async () => {
    vi.mocked(CustomInvoiceRepository.findByIdWithDetails).mockResolvedValue(invoiceFixture() as never);
    const itemUpdate = mockTx(invoiceFixture({ creditedAmount: 150 }), { id: "cn-2", totalAmount: 150 });

    await issueCustomInvoiceCreditNote(actor, "inv-1", {
      creditNoteDate: "2026-08-27",
      type: "PRODUCT_WISE",
      items: [{ customInvoiceItemId: "item-2", amount: 150 }],
    });

    expect(itemUpdate).toHaveBeenCalledWith({ where: { id: "item-2" }, data: { creditedAmount: { increment: 150 } } });
  });
});

describe("cancelCustomInvoiceCreditNote", () => {
  it("rejects when the credit note doesn't exist", async () => {
    vi.mocked(CustomInvoiceCreditNoteRepository.findAnyById).mockResolvedValue(null);
    await expect(cancelCustomInvoiceCreditNote(actor, "cn-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects cancelling an already-cancelled credit note", async () => {
    vi.mocked(CustomInvoiceCreditNoteRepository.findAnyById).mockResolvedValue({ id: "cn-1", status: "CANCELLED" } as never);
    await expect(cancelCustomInvoiceCreditNote(actor, "cn-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("reverses both the invoice-level and item-level accumulators", async () => {
    vi.mocked(CustomInvoiceCreditNoteRepository.findAnyById).mockResolvedValue({
      id: "cn-1",
      status: "ISSUED",
      customInvoiceId: "inv-1",
      totalAmount: 300,
      items: [{ customInvoiceItemId: "item-1", amount: 300 }],
    } as never);

    const itemUpdate = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        customInvoice: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValueOnce(invoiceFixture({ creditedAmount: 300 }))
            .mockResolvedValueOnce(invoiceFixture({ creditedAmount: 0 })),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
        },
        customInvoiceItem: { update: itemUpdate },
        customInvoiceCreditNote: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })
    );

    await cancelCustomInvoiceCreditNote(actor, "cn-1");
    expect(itemUpdate).toHaveBeenCalledWith({ where: { id: "item-1" }, data: { creditedAmount: { decrement: 300 } } });
  });
});

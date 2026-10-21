import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./custom-invoice.repository", () => ({
  CustomInvoiceRepository: { findAnyById: vi.fn() },
}));
vi.mock("./custom-invoice-payment.repository", () => ({
  CustomInvoicePaymentRepository: { findAnyById: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { CustomInvoiceRepository } = await import("./custom-invoice.repository");
const { CustomInvoicePaymentRepository } = await import("./custom-invoice-payment.repository");
const { recordCustomInvoicePayment, cancelCustomInvoicePayment } = await import("./custom-invoice-payment.service");

const actor = { companyId: "co-1", userId: "user-1" };

function invoiceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    status: "DRAFT",
    grandTotal: 1000,
    advancePaymentAmount: null,
    payableAmountValue: null,
    paidAmount: 0,
    creditedAmount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(CustomInvoiceRepository.findAnyById).mockReset();
  vi.mocked(CustomInvoicePaymentRepository.findAnyById).mockReset();
  vi.mocked(prisma.$transaction).mockReset();
});

describe("recordCustomInvoicePayment", () => {
  it("rejects when the invoice doesn't exist", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(null);
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 100 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects recording a payment against a cancelled invoice", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(invoiceFixture({ status: "CANCELLED" }) as never);
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 100 })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects a payment exceeding what's still owed", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(invoiceFixture({ grandTotal: 1000, paidAmount: 900 }) as never);
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 200 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
    });
  });

  it("caps the payable amount against grandTotal minus creditedAmount minus paidAmount", async () => {
    // 1000 grandTotal - 300 credited - 500 already paid = 200 available.
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(
      invoiceFixture({ grandTotal: 1000, creditedAmount: 300, paidAmount: 500 }) as never
    );
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 201 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
    });
  });

  // S-08 regression: an advance already shown on the invoice counts as
  // received, so 1000 total - 400 advance leaves only 600 to pay.
  it("caps the payment at the balance due, net of the advance and payable amounts", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(
      invoiceFixture({ grandTotal: 1000, advancePaymentAmount: 400, paidAmount: 0 }) as never
    );
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 601 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
      details: { available: 600 },
    });

    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(
      invoiceFixture({ grandTotal: 1000, payableAmountValue: 250, paidAmount: 0 }) as never
    );
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 751 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
      details: { available: 750 },
    });
  });

  // S-09 regression: the guard checks creditedAmount too, so a credit note
  // that lands at the same moment makes this payment lose the race.
  it("guards on both paidAmount and creditedAmount, and rejects when a concurrent change wins", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(invoiceFixture({ grandTotal: 1000, paidAmount: 0, creditedAmount: 0 }) as never);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({ customInvoice: { updateMany }, customInvoicePayment: { create: vi.fn() } })
    );
    await expect(recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 800 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv-1", paidAmount: 0, creditedAmount: 0 } })
    );
  });

  it("records a valid payment and recomputes balanceDue inside the transaction", async () => {
    vi.mocked(CustomInvoiceRepository.findAnyById).mockResolvedValue(invoiceFixture({ grandTotal: 1000, paidAmount: 0 }) as never);
    let capturedUpdateData: unknown;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        customInvoice: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(invoiceFixture({ grandTotal: 1000, paidAmount: 300 })),
          update: vi.fn().mockImplementation((args) => {
            capturedUpdateData = args.data;
          }),
        },
        customInvoicePayment: { create: vi.fn().mockResolvedValue({ id: "pay-1", amount: 300 }) },
      })
    );

    await recordCustomInvoicePayment(actor, "inv-1", { paymentDate: "2026-08-27", amount: 300 });
    expect((capturedUpdateData as { balanceDue: number }).balanceDue).toBe(700); // 1000 - 300 paid
  });
});

describe("cancelCustomInvoicePayment", () => {
  it("rejects when the payment doesn't exist", async () => {
    vi.mocked(CustomInvoicePaymentRepository.findAnyById).mockResolvedValue(null);
    await expect(cancelCustomInvoicePayment(actor, "pay-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects cancelling an already-cancelled payment", async () => {
    vi.mocked(CustomInvoicePaymentRepository.findAnyById).mockResolvedValue({ id: "pay-1", status: "CANCELLED" } as never);
    await expect(cancelCustomInvoicePayment(actor, "pay-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("reverses the accumulator and recomputes balanceDue", async () => {
    vi.mocked(CustomInvoicePaymentRepository.findAnyById).mockResolvedValue({
      id: "pay-1",
      status: "RECORDED",
      amount: 300,
      customInvoiceId: "inv-1",
    } as never);

    let capturedUpdateData: unknown;
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({
        customInvoice: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValueOnce(invoiceFixture({ grandTotal: 1000, paidAmount: 300 }))
            .mockResolvedValueOnce(invoiceFixture({ grandTotal: 1000, paidAmount: 0 })),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockImplementation((args) => {
            capturedUpdateData = args.data;
          }),
        },
        customInvoicePayment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })
    );

    await cancelCustomInvoicePayment(actor, "pay-1");
    expect((capturedUpdateData as { balanceDue: number }).balanceDue).toBe(1000); // fully reversed
  });
});

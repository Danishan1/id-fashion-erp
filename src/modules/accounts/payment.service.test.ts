import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/customers/customer.repository", () => ({
  CustomerRepository: { findByIdWithBuyers: vi.fn() },
}));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: {
    paymentType: { findFirst: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
  },
}));
vi.mock("./payment.repository", () => ({
  PaymentRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    createWithAllocations: vi.fn(),
    updateStatusConditional: vi.fn(),
  },
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
}));
vi.mock("./sales-invoice.repository", () => ({
  SalesInvoiceRepository: { findAnyById: vi.fn(), findOutstandingByCustomer: vi.fn() },
}));
vi.mock("./purchase-invoice.repository", () => ({
  PurchaseInvoiceRepository: { findAnyById: vi.fn(), findOutstandingBySupplier: vi.fn() },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findByCode: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { CustomerRepository } = await import("@/modules/customers/customer.repository");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { PaymentRepository, CompanyRepository } = await import("./payment.repository");
const { SalesInvoiceRepository } = await import("./sales-invoice.repository");
const { PurchaseInvoiceRepository } = await import("./purchase-invoice.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { postJournalCore } = await import("./journal.service");
const { createPayment, postPayment, cancelPayment, allocatePayment } = await import("./payment.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

function makeFakeTx(
  overrides: {
    salesInvoiceUpdateManyCount?: number;
    salesInvoiceFresh?: { paidAmount: number; totalAmount: number };
    purchaseInvoiceUpdateManyCount?: number;
    purchaseInvoiceFresh?: { paidAmount: number; totalAmount: number };
    paymentUpdateManyCount?: number;
  } = {}
) {
  const {
    salesInvoiceUpdateManyCount = 1,
    salesInvoiceFresh = { paidAmount: 1000, totalAmount: 1000 },
    purchaseInvoiceUpdateManyCount = 1,
    purchaseInvoiceFresh = { paidAmount: 1000, totalAmount: 1000 },
    paymentUpdateManyCount = 1,
  } = overrides;
  return {
    salesInvoice: {
      updateMany: vi.fn().mockResolvedValue({ count: salesInvoiceUpdateManyCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(salesInvoiceFresh),
      update: vi.fn().mockResolvedValue({}),
    },
    purchaseInvoice: {
      updateMany: vi.fn().mockResolvedValue({ count: purchaseInvoiceUpdateManyCount }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(purchaseInvoiceFresh),
      update: vi.fn().mockResolvedValue({}),
    },
    journal: { create: vi.fn().mockResolvedValue({ id: "jrn-1" }) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: paymentUpdateManyCount }) },
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(CustomerRepository.findByIdWithBuyers).mockReset();
  vi.mocked(SupplierRepository.findById).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset();
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset();
  vi.mocked(PaymentRepository.findAnyById).mockReset();
  vi.mocked(PaymentRepository.findByIdWithDetails).mockReset();
  vi.mocked(PaymentRepository.createWithAllocations).mockReset();
  vi.mocked(PaymentRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(PaymentRepository.updateStatusConditional).mockReset();
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset().mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(SalesInvoiceRepository.findAnyById).mockReset();
  vi.mocked(PurchaseInvoiceRepository.findAnyById).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
});

describe("createPayment — allocation validation", () => {
  const customer = { id: "cust-1" };
  const paymentType = { id: "pt-1", type: "CASH" };

  beforeEach(() => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(customer as never);
    vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue(paymentType as never);
  });

  // Sum(allocations) < amount is now a legitimate "On Account" creation —
  // the remainder sits unallocated until a later allocatePayment() call.
  // Only sum(allocations) > amount is still a real error (see the next
  // test).
  it("allows creating a payment with allocations that total less than the amount ('On Account')", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);
    vi.mocked(PaymentRepository.createWithAllocations).mockResolvedValue({ id: "pay-1" } as never);

    const result = await createPayment(actor, {
      direction: "RECEIPT",
      customerId: "cust-1",
      paymentDate: "2026-08-24",
      paymentTypeId: "pt-1",
      amount: 200,
      allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
    } as never);

    expect(result).toMatchObject({ id: "pay-1" });
    const [, allocationRows] = vi.mocked(PaymentRepository.createWithAllocations).mock.calls[0];
    expect(allocationRows).toMatchObject([{ salesInvoiceId: "inv-1", purchaseInvoiceId: null, allocatedAmount: 100 }]);
  });

  // Regression: ValidatedAllocation carries an extra invoiceTotalAmount field
  // (used only by applyAllocationInTx's own in-memory guard, not a real
  // PaymentAllocation column) — createPayment() must strip it before handing
  // the array to the repository, or Prisma's create call 500s. toEqual (not
  // toMatchObject) is deliberate here: toMatchObject would pass even with
  // the extra field present, which is exactly why this bug went undetected
  // until a live end-to-end test caught it.
  it("strips invoiceTotalAmount (an in-memory-only validation field) before calling the repository", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);
    vi.mocked(PaymentRepository.createWithAllocations).mockResolvedValue({ id: "pay-1" } as never);

    await createPayment(actor, {
      direction: "RECEIPT",
      customerId: "cust-1",
      paymentDate: "2026-08-24",
      paymentTypeId: "pt-1",
      amount: 100,
      allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
    } as never);

    const [, allocationRows] = vi.mocked(PaymentRepository.createWithAllocations).mock.calls[0];
    expect(allocationRows).toEqual([{ salesInvoiceId: "inv-1", purchaseInvoiceId: null, allocatedAmount: 100 }]);
  });

  it("rejects when allocations exceed the payment amount", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);

    await expect(
      createPayment(actor, {
        direction: "RECEIPT",
        customerId: "cust-1",
        paymentDate: "2026-08-24",
        paymentTypeId: "pt-1",
        amount: 50,
        allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects allocating more than an invoice's outstanding balance", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "PARTIALLY_PAID",
      totalAmount: "500",
      paidAmount: "450",
    } as never); // only 50 outstanding

    await expect(
      createPayment(actor, {
        direction: "RECEIPT",
        customerId: "cust-1",
        paymentDate: "2026-08-24",
        paymentTypeId: "pt-1",
        amount: 100,
        allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an invoice that doesn't belong to the selected customer", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-OTHER",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);

    await expect(
      createPayment(actor, {
        direction: "RECEIPT",
        customerId: "cust-1",
        paymentDate: "2026-08-24",
        paymentTypeId: "pt-1",
        amount: 100,
        allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
      } as never)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates the payment with the company's base currency, not any per-party currency", async () => {
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);
    vi.mocked(PaymentRepository.createWithAllocations).mockResolvedValue({ id: "pay-1" } as never);

    await createPayment(actor, {
      direction: "RECEIPT",
      customerId: "cust-1",
      paymentDate: "2026-08-24",
      paymentTypeId: "pt-1",
      amount: 100,
      allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
    } as never);

    const [headerData] = vi.mocked(PaymentRepository.createWithAllocations).mock.calls[0];
    expect(headerData.currencyCode).toBe("INR");
  });
});

describe("createPayment — idempotency (CF-5)", () => {
  const customer = { id: "cust-1" };
  const paymentType = { id: "pt-1", type: "CASH" };
  const existingPayment = { id: "pay-existing", paymentNumber: "PAY-2026-00001" };
  const validInput = {
    direction: "RECEIPT",
    customerId: "cust-1",
    paymentDate: "2026-08-24",
    paymentTypeId: "pt-1",
    amount: 100,
    allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 100 }],
  };

  beforeEach(() => {
    vi.mocked(CustomerRepository.findByIdWithBuyers).mockResolvedValue(customer as never);
    vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue(paymentType as never);
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "500",
      paidAmount: "0",
    } as never);
  });

  it("returns the original payment unchanged when the same idempotencyKey is replayed, without validating allocations at all", async () => {
    vi.mocked(PaymentRepository.findByIdempotencyKey).mockResolvedValue(existingPayment as never);

    const result = await createPayment(actor, { ...validInput, idempotencyKey: "retry-key-1" } as never);

    expect(result).toBe(existingPayment);
    expect(CustomerRepository.findByIdWithBuyers).not.toHaveBeenCalled();
    expect(PaymentRepository.createWithAllocations).not.toHaveBeenCalled();
  });

  it("proceeds normally the first time a key is used", async () => {
    vi.mocked(PaymentRepository.createWithAllocations).mockResolvedValue({ id: "pay-1" } as never);

    const result = await createPayment(actor, { ...validInput, idempotencyKey: "fresh-key-1" } as never);

    expect(PaymentRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
    expect(PaymentRepository.createWithAllocations).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "fresh-key-1" }),
      expect.anything()
    );
    expect((result as { id: string }).id).toBe("pay-1");
  });

  it("does not check idempotency at all when no key is supplied", async () => {
    vi.mocked(PaymentRepository.createWithAllocations).mockResolvedValue({ id: "pay-1" } as never);

    await createPayment(actor, validInput as never);

    expect(PaymentRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(PaymentRepository.createWithAllocations).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: null }),
      expect.anything()
    );
  });

  it("regression: a genuine concurrent replay transparently returns the winner's payment instead of throwing", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(PaymentRepository.createWithAllocations).mockRejectedValue(p2002);
    vi.mocked(PaymentRepository.findByIdempotencyKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingPayment as never);

    const result = await createPayment(actor, { ...validInput, idempotencyKey: "racing-key" } as never);

    expect(result).toBe(existingPayment);
  });

  it("still throws a genuine P2002 with no idempotencyKey supplied", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(PaymentRepository.createWithAllocations).mockRejectedValue(p2002);

    await expect(createPayment(actor, validInput as never)).rejects.toBe(p2002);
  });
});

describe("postPayment — self-approval, guarded increment, fresh-read status recompute", () => {
  const draftPayment = {
    id: "pay-1",
    status: "DRAFT",
    direction: "RECEIPT" as const,
    createdByUserId: "user-1",
    paymentNumber: "PAY-2026-00001",
    paymentDate: new Date("2026-08-24"),
    amount: "300",
    paymentType: { type: "CASH" },
    allocations: [
      { salesInvoiceId: "inv-1", purchaseInvoiceId: null, allocatedAmount: "300", salesInvoice: { totalAmount: "1000" } },
    ],
  };

  it("asserts the self-approval-guarded 'approve' action", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftPayment as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "payments", "approve", { createdBy: "user-1" });
  });

  it("recomputes PARTIALLY_PAID via a fresh read (not a guarded conditional transition) when paidAmount < totalAmount", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftPayment as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    // draftPayment allocates 300 against a 1000 invoice — fresh paidAmount (300) < totalAmount (1000).
    const fakeTx = makeFakeTx({ salesInvoiceFresh: { paidAmount: 300, totalAmount: 1000 } });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    // Unconditional write (no `where: { status: ... }` guard) — the status recompute idiom.
    expect(fakeTx.salesInvoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "PARTIALLY_PAID" } });
  });

  it("recomputes PAID via the same fresh read when paidAmount reaches totalAmount", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce({
        ...draftPayment,
        allocations: [
          { salesInvoiceId: "inv-1", purchaseInvoiceId: null, allocatedAmount: "1000", salesInvoice: { totalAmount: "1000" } },
        ],
      } as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx({ salesInvoiceFresh: { paidAmount: 1000, totalAmount: 1000 } });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    expect(fakeTx.salesInvoice.update).toHaveBeenCalledWith({ where: { id: "inv-1" }, data: { status: "PAID" } });
  });

  it("throws OVER_PAYMENT_NOT_ALLOWED when the guarded increment fails, and never creates a journal", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails).mockResolvedValueOnce(draftPayment as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx({ salesInvoiceUpdateManyCount: 0 }); // guard fails
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await expect(postPayment(actor, "pay-1")).rejects.toMatchObject({ code: "OVER_PAYMENT_NOT_ALLOWED" });
    expect(fakeTx.journal.create).not.toHaveBeenCalled();
  });

  it("resolves Cash/Bank by PaymentType.type, not PaymentType.code — a CHEQUE-typed payment resolves to the BANK account", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce({ ...draftPayment, paymentType: { type: "CHEQUE" } } as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    expect(ChartOfAccountRepository.findByCode).toHaveBeenCalledWith("co-1", "BANK");
    expect(ChartOfAccountRepository.findByCode).not.toHaveBeenCalledWith("co-1", "CASH");
  });

  it("posts Dr Cash/Bank / Cr AR for a RECEIPT", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftPayment as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.sourceModule).toBe("PAYMENT");
    expect(createArgs.data.lines.create).toEqual([
      { accountId: "acct-CASH", lineNumber: 1, debitAmount: 300, creditAmount: 0, description: "Payment PAY-2026-00001" },
      { accountId: "acct-AR", lineNumber: 2, debitAmount: 0, creditAmount: 300, description: "Payment PAY-2026-00001" },
    ]);
    expect(postJournalCore).toHaveBeenCalledWith(fakeTx, "jrn-1", "DRAFT", "user-1");
  });

  it("posts Dr AP / Cr Cash/Bank for a PAYMENT_OUT", async () => {
    const outPayment = {
      ...draftPayment,
      direction: "PAYMENT_OUT" as const,
      allocations: [
        { salesInvoiceId: null, purchaseInvoiceId: "pinv-1", allocatedAmount: "300", purchaseInvoice: { totalAmount: "1000" } },
      ],
    };
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce(outPayment as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx({ purchaseInvoiceFresh: { paidAmount: 300, totalAmount: 1000 } });
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postPayment(actor, "pay-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.lines.create).toEqual([
      { accountId: "acct-AP", lineNumber: 1, debitAmount: 300, creditAmount: 0, description: "Payment PAY-2026-00001" },
      { accountId: "acct-CASH", lineNumber: 2, debitAmount: 0, creditAmount: 300, description: "Payment PAY-2026-00001" },
    ]);
    expect(fakeTx.purchaseInvoice.update).toHaveBeenCalledWith({ where: { id: "pinv-1" }, data: { status: "PARTIALLY_PAID" } });
  });

  it("rejects posting a non-DRAFT payment, never touching the transaction", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails).mockResolvedValue({
      id: "pay-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postPayment(actor, "pay-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("cancelPayment", () => {
  it("cancels a DRAFT payment", async () => {
    vi.mocked(PaymentRepository.findAnyById)
      .mockResolvedValueOnce({ id: "pay-1", status: "DRAFT" } as never)
      .mockResolvedValueOnce({ id: "pay-1", status: "CANCELLED" } as never);
    vi.mocked(PaymentRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);

    const result = await cancelPayment(actor, "pay-1");
    expect(result.status).toBe("CANCELLED");
  });

  it("blocks cancelling a non-DRAFT payment", async () => {
    vi.mocked(PaymentRepository.findAnyById).mockResolvedValue({ id: "pay-1", status: "POSTED" } as never);
    vi.mocked(PaymentRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelPayment(actor, "pay-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("allocatePayment — applying an already-POSTED payment's unallocated remainder", () => {
  const postedOnAccountPayment = {
    id: "pay-1",
    status: "POSTED",
    direction: "RECEIPT" as const,
    customerId: "cust-1",
    supplierId: null,
    amount: "200",
    createdByUserId: "user-1",
    allocations: [{ salesInvoiceId: "inv-existing", purchaseInvoiceId: null, allocatedAmount: "50" }],
  };

  it("rejects allocating against a payment that isn't POSTED", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails).mockResolvedValue({ ...postedOnAccountPayment, status: "DRAFT" } as never);

    await expect(
      allocatePayment(actor, "pay-1", { allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 50 }] })
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects a new allocation exceeding the payment's own unallocated remainder", async () => {
    // amount 200, already allocated 50 -> 150 unallocated; requesting 151 must fail
    // even though 151 is within the target invoice's own outstanding balance.
    vi.mocked(PaymentRepository.findByIdWithDetails).mockResolvedValue(postedOnAccountPayment as never);
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "1000",
      paidAmount: "0",
    } as never);

    await expect(
      allocatePayment(actor, "pay-1", { allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 151 }] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("applies a valid allocation and does not create a new Journal (the cash movement already happened)", async () => {
    vi.mocked(PaymentRepository.findByIdWithDetails)
      .mockResolvedValueOnce(postedOnAccountPayment as never)
      .mockResolvedValueOnce({ ...postedOnAccountPayment, allocations: [...postedOnAccountPayment.allocations, { salesInvoiceId: "inv-1", allocatedAmount: "150" }] } as never);
    vi.mocked(SalesInvoiceRepository.findAnyById).mockResolvedValue({
      id: "inv-1",
      customerId: "cust-1",
      status: "POSTED",
      totalAmount: "1000",
      paidAmount: "0",
    } as never);

    const fakeTx = makeFakeTx();
    const createSpy = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) =>
      (cb as (tx: unknown) => Promise<unknown>)({ ...fakeTx, paymentAllocation: { create: createSpy } })
    );

    const result = await allocatePayment(actor, "pay-1", { allocations: [{ salesInvoiceId: "inv-1", allocatedAmount: 150 }] });

    expect(result).toMatchObject({ id: "pay-1" });
    expect(createSpy).toHaveBeenCalledWith({ data: { paymentId: "pay-1", salesInvoiceId: "inv-1", purchaseInvoiceId: null, allocatedAmount: 150 } });
    expect(fakeTx.journal.create).not.toHaveBeenCalled();
  });
});

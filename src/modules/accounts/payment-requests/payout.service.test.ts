import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  paymentRequest: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  chartOfAccount: { upsert: vi.fn(), findFirst: vi.fn() },
  journal: { create: vi.fn() },
  payment: { create: vi.fn(), update: vi.fn() },
  internalTransfer: { create: vi.fn(), update: vi.fn() },
  paymentType: { findFirst: vi.fn() },
  paymentRequestPayout: { create: vi.fn() },
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    paymentRequestPayout: { findFirst: vi.fn() },
    paymentType: { findFirst: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
    chartOfAccount: { findFirst: vi.fn() },
  },
}));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("../journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("../money-account", () => ({ resolveMoneyAccount: vi.fn().mockResolvedValue({ id: "acct-bank", code: "BANK" }) }));
vi.mock("./payment-request.service", () => ({ getPaymentRequestById: vi.fn() }));
vi.mock("./approval-matrix.service", () => ({ getApproverIdentity: vi.fn().mockResolvedValue({ roleIds: [], isSuperAdmin: false }) }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { postJournalCore } = await import("../journal.service");
const { getPaymentRequestById } = await import("./payment-request.service");
const { recordPaymentRequestPayout, canBePaidYet } = await import("./payout.service");

const actor = { companyId: "co-1", userId: "accountant" };
const BANK_TYPE = { id: "pt-bank", type: "BANK", name: "Bank Transfer", isActive: true };
const CASH_TYPE = { id: "pt-cash", type: "CASH", name: "Cash", isActive: true };

function request(o: Record<string, unknown> = {}) {
  return {
    id: "pr-1",
    branchId: null,
    requestNumber: "PRQ-2026-00001",
    requestType: "INVESTMENT",
    status: "APPROVED",
    amount: "1000.00",
    paidAmount: "0",
    payToName: "Mutual Fund",
    supplierId: null,
    currencyCode: "INR",
    createdByUserId: "raiser",
    approverMayPay: false,
    approvals: [],
    ...o,
  };
}

const bankInput = {
  paymentDate: "2026-10-27",
  amount: 1000,
  paymentTypeId: "pt-bank",
  bankAccountId: "ba-1",
  referenceNumber: "UTR123",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPaymentRequestById).mockResolvedValue(request() as never);
  vi.mocked(PermissionService.assert).mockResolvedValue(undefined);
  vi.mocked(generateDocumentNumber).mockResolvedValue("DOC-1");
  vi.mocked(prisma.paymentRequestPayout.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.paymentType.findFirst).mockResolvedValue(BANK_TYPE as never);
  vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: "ba-1" } as never);
  vi.mocked(prisma.chartOfAccount.findFirst).mockResolvedValue({ id: "acct-bank" } as never);
  tx.paymentRequest.updateMany.mockResolvedValue({ count: 1 });
  tx.paymentRequest.findUniqueOrThrow.mockResolvedValue({ amount: "1000.00", paidAmount: "1000.00" });
  tx.chartOfAccount.upsert.mockImplementation(async ({ create }: { create: { code: string } }) => ({ id: `acct-${create.code}` }));
  tx.chartOfAccount.findFirst.mockResolvedValue({ id: "acct-CASH" });
  tx.journal.create.mockResolvedValue({ id: "jrn-1" });
  tx.payment.create.mockResolvedValue({ id: "pay-1", paymentNumber: "PAY-1" });
  tx.internalTransfer.create.mockResolvedValue({ id: "trf-1", transferNumber: "TRF-1" });
  tx.paymentRequestPayout.create.mockResolvedValue({ id: "po-1" });
});

describe("recordPaymentRequestPayout — guards", () => {
  it("only pays approved / part-paid requests", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ status: "PENDING_APPROVAL" }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", bankInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("asserts post with the raiser as createdBy (raiser can't pay their own request)", async () => {
    await recordPaymentRequestPayout(actor, "pr-1", bankInput);
    expect(PermissionService.assert).toHaveBeenCalledWith("accountant", "payment_requests", "post", { createdBy: "raiser" });
  });

  it("refuses an approver as payer unless the matrix rule allows it", async () => {
    const approvals = [{ userId: "accountant", decision: "APPROVED" }];
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ approvals }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", bankInput)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ approvals, approverMayPay: true }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", bankInput)).resolves.toBeDefined();
  });

  it("refuses types without a payout handler yet", async () => {
    expect(canBePaidYet("TAX_INVOICE")).toBe(false);
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ requestType: "TAX_INVOICE" }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", bankInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never pays more than what is left", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ paidAmount: "400" }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, amount: 600.01 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
    });
  });

  it("a cash withdrawal must be paid in full", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ requestType: "CASH_WITHDRAWAL" }) as never);
    await expect(recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, amount: 500, toPaymentTypeId: "pt-cash" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("needs a bank account and a reference when paid from a bank", async () => {
    await expect(recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, bankAccountId: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, referenceNumber: "" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses when another payout won the race (guarded increment matched nothing)", async () => {
    tx.paymentRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(recordPaymentRequestPayout(actor, "pr-1", bankInput)).rejects.toMatchObject({ code: "OVER_PAYMENT_NOT_ALLOWED" });
    expect(tx.journal.create).not.toHaveBeenCalled();
  });

  it("replaying the same idempotency key does not pay again", async () => {
    vi.mocked(prisma.paymentRequestPayout.findFirst).mockResolvedValueOnce({ paymentRequestId: "pr-1" } as never);
    await recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, idempotencyKey: "k1" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("recordPaymentRequestPayout — postings", () => {
  it("investment: Dr Investments / Cr Bank, request PAID, payout row linked to the journal", async () => {
    await recordPaymentRequestPayout(actor, "pr-1", bankInput);

    expect(tx.paymentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "pr-1", status: { in: ["APPROVED", "PARTIALLY_PAID"] }, paidAmount: { lte: 0 } },
      data: { paidAmount: { increment: 1000 } },
    });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({ where: { id: "pr-1" }, data: { status: "PAID" } });
    const journal = tx.journal.create.mock.calls[0][0].data;
    expect(journal.sourceModule).toBe("PAYMENT_REQUEST");
    expect(journal.lines.create).toEqual([
      expect.objectContaining({ accountId: "acct-INVESTMENTS", debitAmount: 1000, creditAmount: 0, lineNumber: 1 }),
      expect.objectContaining({ accountId: "acct-bank", debitAmount: 0, creditAmount: 1000, lineNumber: 2 }),
    ]);
    expect(postJournalCore).toHaveBeenCalledWith(tx, "jrn-1", "DRAFT", "accountant");
    expect(tx.paymentRequestPayout.create.mock.calls[0][0].data).toMatchObject({ amount: 1000, journalId: "jrn-1", referenceNumber: "UTR123" });
  });

  it("a part payment leaves the request PARTIALLY_PAID", async () => {
    tx.paymentRequest.findUniqueOrThrow.mockResolvedValueOnce({ amount: "1000.00", paidAmount: "400.00" });
    await recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, amount: 400 });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({ where: { id: "pr-1" }, data: { status: "PARTIALLY_PAID" } });
  });

  it("supplier on account: a posted advance Payment, Dr Advance to Suppliers / Cr Bank", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ requestType: "SUPPLIER_ON_ACCOUNT", supplierId: "sup-1" }) as never);
    await recordPaymentRequestPayout(actor, "pr-1", bankInput);

    expect(tx.payment.create.mock.calls[0][0].data).toMatchObject({
      direction: "PAYMENT_OUT",
      supplierId: "sup-1",
      amount: 1000,
      isAdvance: true,
      status: "POSTED",
      paymentNumber: "DOC-1",
    });
    const journal = tx.journal.create.mock.calls[0][0].data;
    expect(journal).toMatchObject({ sourceModule: "PAYMENT", sourceRecordId: "pay-1" });
    expect(journal.lines.create[0]).toMatchObject({ accountId: "acct-SUP-ADV", debitAmount: 1000 });
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { journalId: "jrn-1" } });
    expect(tx.paymentRequestPayout.create.mock.calls[0][0].data).toMatchObject({ paymentId: "pay-1" });
  });

  it("cash withdrawal: a posted InternalTransfer bank -> cash, Dr Cash / Cr Bank", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ requestType: "CASH_WITHDRAWAL" }) as never);
    tx.paymentType.findFirst.mockResolvedValue(CASH_TYPE);
    await recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, toPaymentTypeId: "pt-cash" });

    expect(tx.internalTransfer.create.mock.calls[0][0].data).toMatchObject({
      fromPaymentTypeId: "pt-bank",
      toPaymentTypeId: "pt-cash",
      amount: 1000,
      status: "POSTED",
    });
    expect(tx.journal.create.mock.calls[0][0].data.lines.create).toEqual([
      expect.objectContaining({ accountId: "acct-CASH", debitAmount: 1000 }),
      expect.objectContaining({ accountId: "acct-bank", creditAmount: 1000 }),
    ]);
  });

  it("cash withdrawal refuses paying from cash or into a non-cash account", async () => {
    vi.mocked(getPaymentRequestById).mockResolvedValue(request({ requestType: "CASH_WITHDRAWAL" }) as never);
    vi.mocked(prisma.paymentType.findFirst).mockResolvedValueOnce(CASH_TYPE as never);
    await expect(
      recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, paymentTypeId: "pt-cash", toPaymentTypeId: "pt-cash" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    tx.paymentType.findFirst.mockResolvedValue(BANK_TYPE);
    await expect(recordPaymentRequestPayout(actor, "pr-1", { ...bankInput, toPaymentTypeId: "pt-bank" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

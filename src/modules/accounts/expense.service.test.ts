import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseInput } from "./expense.schema";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn(), getAllowedBranchIds: vi.fn() } }));
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: {
    paymentType: { findFirst: vi.fn() },
    bankAccount: { findFirst: vi.fn() },
  },
}));
vi.mock("./expense.repository", () => ({
  ExpenseRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    findByIdWithDetails: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatusConditional: vi.fn(),
    updateStatusConditionalIn: vi.fn(),
  },
  ExpensePaymentRepository: { findByIdempotencyKey: vi.fn() },
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findAnyById: vi.fn(), findByCode: vi.fn() },
}));
vi.mock("./tax-config.repository", () => ({
  TaxRateRepository: { findAnyById: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(), chartOfAccount: { upsert: vi.fn() } } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { ExpenseRepository, ExpensePaymentRepository, CompanyRepository } = await import("./expense.repository");
const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { TaxRateRepository } = await import("./tax-config.repository");
const { postJournalCore } = await import("./journal.service");
const {
  createExpense,
  updateExpense,
  approveExpense,
  rejectExpense,
  recordExpensePayment,
  createBillUploadExpense,
  cancelExpense,
  listExpenses,
  getExpenseById,
} = await import(
  "./expense.service"
);

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

const expenseAccount = { id: "acct-rent", companyId: "co-1", code: "EXP-RENT", name: "Factory Rent", accountType: "EXPENSE", isActive: true };
const cogsAccount = { id: "acct-cogs", companyId: "co-1", code: "COGS", name: "Purchases / COGS", accountType: "EXPENSE", isActive: true };
const paymentType = { id: "pt-1", companyId: "co-1", type: "BANK" };

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(SupplierRepository.findById).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset().mockResolvedValue(paymentType as never);
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset();
  vi.mocked(ExpenseRepository.findAnyById).mockReset();
  vi.mocked(ExpenseRepository.findByIdWithDetails).mockReset();
  vi.mocked(ExpenseRepository.create).mockReset();
  vi.mocked(ExpenseRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(ExpenseRepository.update).mockReset();
  vi.mocked(ExpenseRepository.updateStatusConditional).mockReset();
  vi.mocked(ExpenseRepository.updateStatusConditionalIn).mockReset();
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset().mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(ChartOfAccountRepository.findAnyById).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(TaxRateRepository.findAnyById).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
  vi.mocked(prisma.chartOfAccount.upsert).mockReset().mockResolvedValue({ id: "acct-exp-pay" } as never);
  vi.mocked(ExpensePaymentRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("DOC-1");
});

const baseInput: ExpenseInput = {
  expenseDate: "2026-08-24",
  accountId: "acct-rent",
  description: "Office Internet Bill",
  amount: 1000,
};

describe("createExpense — account validation (COGS exclusion, accountType, isActive)", () => {
  it("rejects COGS even though its accountType is EXPENSE", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue(cogsAccount as never);

    await expect(createExpense(actor, { ...baseInput, accountId: "acct-cogs" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects an account whose accountType is not EXPENSE", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({ ...expenseAccount, accountType: "ASSET" } as never);

    await expect(createExpense(actor, baseInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a deactivated account", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue({ ...expenseAccount, isActive: false } as never);

    await expect(createExpense(actor, baseInput)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts a valid, active, non-COGS EXPENSE account, computes totals, and lands in PENDING_APPROVAL", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue(expenseAccount as never);
    vi.mocked(TaxRateRepository.findAnyById).mockResolvedValue({ id: "tax-18", ratePercentage: "18.00" } as never);
    vi.mocked(ExpenseRepository.create).mockResolvedValue({ id: "exp-1" } as never);

    await createExpense(actor, { ...baseInput, taxRateId: "tax-18" });

    const [data] = vi.mocked(ExpenseRepository.create).mock.calls[0];
    expect(data.amount).toBe(1000);
    expect(data.taxAmount).toBe(180);
    expect(data.totalAmount).toBe(1180);
    expect(data.status).toBe("PENDING_APPROVAL");
  });

  it("validates supplierId belongs to the company when supplied", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue(expenseAccount as never);
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);

    await expect(createExpense(actor, { ...baseInput, supplierId: "sup-other-company" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("createExpense — idempotency (CF-5)", () => {
  const existingExpense = { id: "exp-existing", expenseNumber: "EXP-2026-00001" };

  beforeEach(() => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue(expenseAccount as never);
  });

  it("returns the original expense unchanged when the same idempotencyKey is replayed, without validating anything", async () => {
    vi.mocked(ExpenseRepository.findByIdempotencyKey).mockResolvedValue(existingExpense as never);

    const result = await createExpense(actor, { ...baseInput, idempotencyKey: "retry-key-1" });

    expect(result).toBe(existingExpense);
    expect(ChartOfAccountRepository.findAnyById).not.toHaveBeenCalled();
    expect(ExpenseRepository.create).not.toHaveBeenCalled();
  });

  it("proceeds normally the first time a key is used", async () => {
    vi.mocked(ExpenseRepository.create).mockResolvedValue({ id: "exp-1", expenseNumber: "EXP-2026-00002" } as never);

    const result = await createExpense(actor, { ...baseInput, idempotencyKey: "fresh-key-1" });

    expect(ExpenseRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
    expect(ExpenseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "fresh-key-1" }));
    expect((result as { id: string }).id).toBe("exp-1");
  });

  it("does not check idempotency at all when no key is supplied", async () => {
    vi.mocked(ExpenseRepository.create).mockResolvedValue({ id: "exp-1" } as never);

    await createExpense(actor, baseInput);

    expect(ExpenseRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    expect(ExpenseRepository.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: null }));
  });

  it("regression: a genuine concurrent replay transparently returns the winner's expense instead of throwing", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(ExpenseRepository.create).mockRejectedValue(p2002);
    vi.mocked(ExpenseRepository.findByIdempotencyKey)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingExpense as never);

    const result = await createExpense(actor, { ...baseInput, idempotencyKey: "racing-key" });

    expect(result).toBe(existingExpense);
  });

  it("still throws a genuine P2002 with no idempotencyKey supplied", async () => {
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    vi.mocked(ExpenseRepository.create).mockRejectedValue(p2002);

    await expect(createExpense(actor, baseInput)).rejects.toBe(p2002);
  });
});

describe("updateExpense — PENDING_APPROVAL-only guard", () => {
  it("blocks editing a non-PENDING_APPROVAL expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "APPROVED" } as never);

    await expect(updateExpense(actor, "exp-1", baseInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("approveExpense — Admin decision, no cash movement", () => {
  it("asserts the self-approval-guarded 'approve' action", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "PENDING_APPROVAL", createdByUserId: "user-2", accountId: "acct-rent" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue({ id: "exp-1", status: "APPROVED" } as never);

    await approveExpense(actor, "exp-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "expenses", "approve", { createdBy: "user-2" });
    expect(ExpenseRepository.updateStatusConditional).toHaveBeenCalledWith(
      "exp-1",
      "PENDING_APPROVAL",
      expect.objectContaining({ status: "APPROVED", approvedByUserId: "user-1" })
    );
    // No Journal/ledger call anywhere in this path.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects approving a non-PENDING_APPROVAL expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "APPROVED", createdByUserId: "user-2", accountId: "acct-rent" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(approveExpense(actor, "exp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("rejectExpense — requires a reason, terminal, not self-approval-guarded", () => {
  it("stores the rejection reason and is gated on 'reject' (not 'approve')", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "PENDING_APPROVAL", createdByUserId: "user-1" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditional).mockResolvedValue({ count: 1 } as never);
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue({ id: "exp-1", status: "REJECTED" } as never);

    await rejectExpense(actor, "exp-1", "Missing receipt");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "expenses", "reject");
    expect(ExpenseRepository.updateStatusConditional).toHaveBeenCalledWith(
      "exp-1",
      "PENDING_APPROVAL",
      expect.objectContaining({ status: "REJECTED", rejectionReason: "Missing receipt", rejectedByUserId: "user-1" })
    );
  });

  it("rejects rejecting an already-decided expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "REJECTED" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(rejectExpense(actor, "exp-1", "again")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("cancelExpense — cancellable from PENDING_APPROVAL or APPROVED, blocked once PAID", () => {
  it("cancels from PENDING_APPROVAL", async () => {
    vi.mocked(ExpenseRepository.findAnyById)
      .mockResolvedValueOnce({ id: "exp-1", status: "PENDING_APPROVAL" } as never)
      .mockResolvedValueOnce({ id: "exp-1", status: "CANCELLED" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditionalIn).mockResolvedValue({ count: 1 } as never);

    const result = await cancelExpense(actor, "exp-1");

    expect(ExpenseRepository.updateStatusConditionalIn).toHaveBeenCalledWith("exp-1", ["PENDING_APPROVAL", "APPROVED"], { status: "CANCELLED" });
    expect(result.status).toBe("CANCELLED");
  });

  it("cancels from APPROVED (before payment)", async () => {
    vi.mocked(ExpenseRepository.findAnyById)
      .mockResolvedValueOnce({ id: "exp-1", status: "APPROVED" } as never)
      .mockResolvedValueOnce({ id: "exp-1", status: "CANCELLED" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditionalIn).mockResolvedValue({ count: 1 } as never);

    const result = await cancelExpense(actor, "exp-1");
    expect(result.status).toBe("CANCELLED");
  });

  it("blocks cancelling a PAID expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "PAID" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditionalIn).mockResolvedValue({ count: 0 } as never);

    await expect(cancelExpense(actor, "exp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("recordExpensePayment — full and part payments", () => {
  const approvedExpense = {
    id: "exp-1",
    branchId: null,
    status: "APPROVED",
    createdByUserId: "user-1",
    expenseNumber: "EXP-2026-00001",
    expenseDate: new Date("2026-08-24"),
    accountId: "acct-rent",
    account: expenseAccount,
    amount: "1000",
    taxAmount: "180",
    totalAmount: "1180",
    tdsAmount: "0",
    paidAmount: "0",
    journalId: null,
  };
  const payInput = { paymentDate: "2026-08-25", amount: 500, paymentTypeId: "pt-1" };

  function makePayTx(paidAfter: number, guardCount = 1) {
    let journalSeq = 0;
    return {
      journal: { create: vi.fn().mockImplementation(() => Promise.resolve({ id: `jrn-${++journalSeq}` })) },
      expense: {
        updateMany: vi.fn().mockResolvedValue({ count: guardCount }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ paidAmount: String(paidAfter) }),
        update: vi.fn().mockResolvedValue({}),
      },
      expensePayment: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  function wireCommon(expense: object, tx: ReturnType<typeof makePayTx>) {
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue(expense as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (t: unknown) => Promise<unknown>)(tx));
  }

  it("asserts the self-guarded 'post' action", async () => {
    const tx = makePayTx(500);
    wireCommon(approvedExpense, tx);

    await recordExpensePayment(actor, "exp-1", payInput);

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "expenses", "post", { createdBy: "user-1" });
  });

  it("first payment posts the accrual journal (Dr expense, Dr GST-ITC, Cr EXP-PAY) with distinct line numbers", async () => {
    const tx = makePayTx(500);
    wireCommon(approvedExpense, tx);

    await recordExpensePayment(actor, "exp-1", payInput);

    const accrual = tx.journal.create.mock.calls[0][0].data;
    expect(accrual.sourceModule).toBe("EXPENSE");
    expect(accrual.lines.create).toEqual([
      { accountId: "acct-rent", lineNumber: 1, debitAmount: 1000, creditAmount: 0, description: "Expense EXP-2026-00001" },
      { accountId: "acct-GST-ITC", lineNumber: 2, debitAmount: 180, creditAmount: 0, description: "Expense EXP-2026-00001 — GST Input" },
      { accountId: "acct-exp-pay", lineNumber: 3, debitAmount: 0, creditAmount: 1180, description: "Expense EXP-2026-00001 — payable" },
    ]);
    expect(tx.expense.updateMany).toHaveBeenCalledWith({ where: { id: "exp-1", journalId: null }, data: { journalId: "jrn-1" } });
  });

  it("each payment posts Dr EXP-PAY / Cr BANK for its own amount", async () => {
    const tx = makePayTx(500);
    wireCommon(approvedExpense, tx);

    await recordExpensePayment(actor, "exp-1", payInput);

    const payment = tx.journal.create.mock.calls[1][0].data;
    expect(payment.sourceModule).toBe("EXPENSE_PAYMENT");
    expect(payment.lines.create).toEqual([
      expect.objectContaining({ accountId: "acct-exp-pay", debitAmount: 500, creditAmount: 0 }),
      expect.objectContaining({ accountId: "acct-BANK", debitAmount: 0, creditAmount: 500 }),
    ]);
    expect(tx.expensePayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expenseId: "exp-1", amount: 500, journalId: "jrn-2", paymentTypeId: "pt-1" }),
    });
  });

  it("a part payment leaves the expense PARTIALLY_PAID", async () => {
    const tx = makePayTx(500);
    wireCommon(approvedExpense, tx);

    await recordExpensePayment(actor, "exp-1", payInput);

    expect(tx.expense.update).toHaveBeenCalledWith({ where: { id: "exp-1" }, data: { status: "PARTIALLY_PAID" } });
  });

  it("a second payment on a PARTIALLY_PAID expense skips the accrual and completes it as PAID", async () => {
    const tx = makePayTx(1180);
    wireCommon({ ...approvedExpense, status: "PARTIALLY_PAID", paidAmount: "500", journalId: "jrn-accrual" }, tx);

    await recordExpensePayment(actor, "exp-1", { ...payInput, amount: 680 });

    expect(tx.journal.create).toHaveBeenCalledTimes(1);
    expect(tx.journal.create.mock.calls[0][0].data.sourceModule).toBe("EXPENSE_PAYMENT");
    expect(tx.expense.update).toHaveBeenCalledWith({
      where: { id: "exp-1" },
      data: expect.objectContaining({ status: "PAID", postedByUserId: "user-1" }),
    });
  });

  it("TDS reduces what is payable: accrual credits TDS-PAY and EXP-PAY gets only the net", async () => {
    const tx = makePayTx(1080);
    wireCommon({ ...approvedExpense, tdsAmount: "100" }, tx);

    await recordExpensePayment(actor, "exp-1", { ...payInput, amount: 1080 });

    const lines = tx.journal.create.mock.calls[0][0].data.lines.create;
    expect(lines).toContainEqual(expect.objectContaining({ accountId: "acct-TDS-PAY", creditAmount: 100 }));
    expect(lines).toContainEqual(expect.objectContaining({ accountId: "acct-exp-pay", creditAmount: 1080 }));
  });

  it("refuses to pay more than the remaining balance", async () => {
    wireCommon({ ...approvedExpense, status: "PARTIALLY_PAID", paidAmount: "1000", journalId: "j" }, makePayTx(0));

    await expect(recordExpensePayment(actor, "exp-1", { ...payInput, amount: 500 })).rejects.toMatchObject({
      code: "OVER_PAYMENT_NOT_ALLOWED",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when the guarded accumulator loses a race", async () => {
    const tx = makePayTx(0, 0);
    wireCommon({ ...approvedExpense, journalId: "j" }, tx);

    await expect(recordExpensePayment(actor, "exp-1", payInput)).rejects.toMatchObject({ code: "OVER_PAYMENT_NOT_ALLOWED" });
  });

  it("refuses to pay an expense that isn't approved yet", async () => {
    wireCommon({ ...approvedExpense, status: "PENDING_APPROVAL" }, makePayTx(0));

    await expect(recordExpensePayment(actor, "exp-1", payInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to pay an already-Paid expense", async () => {
    wireCommon({ ...approvedExpense, status: "PAID" }, makePayTx(0));

    await expect(recordExpensePayment(actor, "exp-1", payInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("replays an idempotency key without paying twice", async () => {
    vi.mocked(ExpensePaymentRepository.findByIdempotencyKey).mockResolvedValue({ expenseId: "exp-1" } as never);
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue(approvedExpense as never);

    await recordExpensePayment(actor, "exp-1", { ...payInput, idempotencyKey: "k-1" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("approveExpense — needs an expense account", () => {
  it("refuses to approve an uploaded bill that has no account yet", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({
      id: "exp-1",
      status: "PENDING_APPROVAL",
      createdByUserId: "user-2",
      accountId: null,
    } as never);

    await expect(approveExpense(actor, "exp-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(ExpenseRepository.updateStatusConditional).not.toHaveBeenCalled();
  });
});

describe("createBillUploadExpense", () => {
  it("creates a PENDING_APPROVAL BILL_UPLOAD expense with no account and no tax", async () => {
    vi.mocked(ExpenseRepository.create).mockResolvedValue({ id: "exp-9", expenseNumber: "EXP-9", totalAmount: 250 } as never);

    await createBillUploadExpense(actor, { expenseDate: "2026-10-23", amount: 250, description: "Courier" });

    const [data] = vi.mocked(ExpenseRepository.create).mock.calls[0];
    expect(data).toMatchObject({
      source: "BILL_UPLOAD",
      status: "PENDING_APPROVAL",
      amount: 250,
      taxAmount: 0,
      totalAmount: 250,
      tdsAmount: 0,
    });
    expect(data.accountId).toBeUndefined();
  });
});

describe("branch access enforcement (2026-09-15)", () => {
  const listQuery = { search: "", sortBy: "createdAt", sortOrder: "desc" as const, page: 1, pageSize: 20, skip: 0, take: 20 };

  beforeEach(() => {
    vi.mocked(ExpenseRepository.findMany).mockReset().mockResolvedValue([]);
    vi.mocked(ExpenseRepository.count).mockReset().mockResolvedValue(0);
  });

  it("listExpenses adds no branch filter for an unrestricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(null);

    await listExpenses(actor, listQuery);

    const whereArg = vi.mocked(ExpenseRepository.findMany).mock.calls[0][0];
    expect(whereArg).not.toHaveProperty("branchId");
  });

  it("listExpenses adds a branchId IN filter for a branch-restricted user", async () => {
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await listExpenses(actor, listQuery);

    expect(ExpenseRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: { in: ["branch-1"] } }),
      expect.anything()
    );
  });

  it("getExpenseById succeeds for an expense inside the user's allowed branches", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue({ id: "exp-1", branchId: "branch-1" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const expense = await getExpenseById(actor, "exp-1");
    expect(expense.id).toBe("exp-1");
  });

  it("getExpenseById throws NOT_FOUND for an expense outside the user's allowed branches", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue({ id: "exp-1", branchId: "branch-2" } as never);
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getExpenseById(actor, "exp-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseInput } from "./expense.schema";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
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
  },
  CompanyRepository: { findBaseCurrencyCode: vi.fn() },
}));
vi.mock("./chart-of-account.repository", () => ({
  ChartOfAccountRepository: { findAnyById: vi.fn(), findByCode: vi.fn() },
}));
vi.mock("./tax-config.repository", () => ({
  TaxRateRepository: { findAnyById: vi.fn() },
}));
vi.mock("./journal.service", () => ({ postJournalCore: vi.fn() }));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { ExpenseRepository, CompanyRepository } = await import("./expense.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { TaxRateRepository } = await import("./tax-config.repository");
const { postJournalCore } = await import("./journal.service");
const { createExpense, updateExpense, postExpense, cancelExpense } = await import("./expense.service");

const actor = { companyId: "co-1", userId: "user-1", branchId: null };

const expenseAccount = { id: "acct-rent", companyId: "co-1", code: "EXP-RENT", name: "Factory Rent", accountType: "EXPENSE", isActive: true };
const cogsAccount = { id: "acct-cogs", companyId: "co-1", code: "COGS", name: "Purchases / COGS", accountType: "EXPENSE", isActive: true };
const paymentType = { id: "pt-1", companyId: "co-1", type: "BANK" };

function makeFakeTx(overrides: { expenseUpdateManyCount?: number } = {}) {
  const { expenseUpdateManyCount = 1 } = overrides;
  return {
    journal: { create: vi.fn().mockResolvedValue({ id: "jrn-1" }) },
    expense: { updateMany: vi.fn().mockResolvedValue({ count: expenseUpdateManyCount }) },
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(SupplierRepository.findById).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset().mockResolvedValue(paymentType as never);
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset();
  vi.mocked(ExpenseRepository.findAnyById).mockReset();
  vi.mocked(ExpenseRepository.findByIdWithDetails).mockReset();
  vi.mocked(ExpenseRepository.create).mockReset();
  vi.mocked(ExpenseRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(ExpenseRepository.update).mockReset();
  vi.mocked(ExpenseRepository.updateStatusConditional).mockReset();
  vi.mocked(CompanyRepository.findBaseCurrencyCode).mockReset().mockResolvedValue({ baseCurrencyCode: "INR" } as never);
  vi.mocked(ChartOfAccountRepository.findAnyById).mockReset();
  vi.mocked(ChartOfAccountRepository.findByCode).mockReset();
  vi.mocked(TaxRateRepository.findAnyById).mockReset();
  vi.mocked(postJournalCore).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.$transaction).mockReset();
});

const baseInput: ExpenseInput = {
  expenseDate: "2026-08-24",
  accountId: "acct-rent",
  description: "Office Internet Bill",
  amount: 1000,
  paymentTypeId: "pt-1",
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

  it("accepts a valid, active, non-COGS EXPENSE account and computes totals", async () => {
    vi.mocked(ChartOfAccountRepository.findAnyById).mockResolvedValue(expenseAccount as never);
    vi.mocked(TaxRateRepository.findAnyById).mockResolvedValue({ id: "tax-18", ratePercentage: "18.00" } as never);
    vi.mocked(ExpenseRepository.create).mockResolvedValue({ id: "exp-1" } as never);

    await createExpense(actor, { ...baseInput, taxRateId: "tax-18" });

    const [data] = vi.mocked(ExpenseRepository.create).mock.calls[0];
    expect(data.amount).toBe(1000);
    expect(data.taxAmount).toBe(180);
    expect(data.totalAmount).toBe(1180);
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

describe("updateExpense / cancelExpense — DRAFT-only guards", () => {
  it("blocks editing a non-DRAFT expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "POSTED" } as never);

    await expect(updateExpense(actor, "exp-1", baseInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("blocks cancelling a non-DRAFT expense", async () => {
    vi.mocked(ExpenseRepository.findAnyById).mockResolvedValue({ id: "exp-1", status: "POSTED" } as never);
    vi.mocked(ExpenseRepository.updateStatusConditional).mockResolvedValue({ count: 0 } as never);

    await expect(cancelExpense(actor, "exp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("postExpense — self-approval, dynamic line numbering, journal shape", () => {
  const draftExpense = {
    id: "exp-1",
    status: "DRAFT",
    createdByUserId: "user-1",
    expenseNumber: "EXP-2026-00001",
    expenseDate: new Date("2026-08-24"),
    accountId: "acct-rent",
    account: expenseAccount,
    amount: "1000",
    taxAmount: "180",
    totalAmount: "1180",
    paymentType: { type: "BANK" },
  };

  it("asserts the self-approval-guarded 'approve' action", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftExpense as never)
      .mockResolvedValueOnce({ id: "exp-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postExpense(actor, "exp-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "expenses", "approve", { createdBy: "user-1" });
  });

  it("regression: a tax-bearing expense gets 3 distinctly-numbered lines — no lineNumber collision (fix #5)", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails)
      .mockResolvedValueOnce(draftExpense as never)
      .mockResolvedValueOnce({ id: "exp-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postExpense(actor, "exp-1");

    const createArgs = fakeTx.journal.create.mock.calls[0][0];
    expect(createArgs.data.sourceModule).toBe("EXPENSE");
    const lines = createArgs.data.lines.create;
    expect(lines).toEqual([
      { accountId: "acct-rent", lineNumber: 1, debitAmount: 1000, creditAmount: 0, description: "Expense EXP-2026-00001" },
      { accountId: "acct-GST-ITC", lineNumber: 2, debitAmount: 180, creditAmount: 0, description: "Expense EXP-2026-00001 — GST Input" },
      { accountId: "acct-BANK", lineNumber: 3, debitAmount: 0, creditAmount: 1180, description: "Expense EXP-2026-00001" },
    ]);
    // The exact bug fix #5 guards against: no two lines share a lineNumber.
    const lineNumbers = lines.map((l: { lineNumber: number }) => l.lineNumber);
    expect(new Set(lineNumbers).size).toBe(lineNumbers.length);
    expect(postJournalCore).toHaveBeenCalledWith(fakeTx, "jrn-1", "DRAFT", "user-1");
  });

  it("a non-tax expense gets a clean 2-line journal (Dr account / Cr cash-or-bank)", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails)
      .mockResolvedValueOnce({ ...draftExpense, taxAmount: "0", totalAmount: "1000", paymentType: { type: "CASH" } } as never)
      .mockResolvedValueOnce({ id: "exp-1", status: "POSTED" } as never);
    vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation(
      ((_c: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) as never
    );
    const fakeTx = makeFakeTx();
    vi.mocked(prisma.$transaction).mockImplementation((cb: unknown) => (cb as (tx: unknown) => Promise<unknown>)(fakeTx));

    await postExpense(actor, "exp-1");

    expect(ChartOfAccountRepository.findByCode).toHaveBeenCalledWith("co-1", "CASH");
    const lines = fakeTx.journal.create.mock.calls[0][0].data.lines.create;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ lineNumber: 2, accountId: "acct-CASH", creditAmount: 1000 });
  });

  it("rejects posting a non-DRAFT expense, never touching the transaction", async () => {
    vi.mocked(ExpenseRepository.findByIdWithDetails).mockResolvedValue({
      id: "exp-1",
      status: "POSTED",
      createdByUserId: "user-1",
    } as never);

    await expect(postExpense(actor, "exp-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

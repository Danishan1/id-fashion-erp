import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
const tx = vi.hoisted(() => ({
  bankAccount: { create: vi.fn(), update: vi.fn() },
  chartOfAccount: { update: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({ prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) } }));
vi.mock("@/modules/accounts/money-account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/accounts/money-account")>()),
  createLedgerAccountForFinancialAccount: vi.fn().mockResolvedValue({ id: "led-1" }),
}));
vi.mock("./finance-config.repository", () => ({
  FinanceConfigRepository: {
    paymentType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    bankAccount: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { FinanceConfigRepository } = await import("./finance-config.repository");
const { createLedgerAccountForFinancialAccount } = await import("@/modules/accounts/money-account");
const { bankAccountSchema } = await import("./finance-config.schema");
const {
  listPaymentTypes,
  createPaymentType,
  updatePaymentType,
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
} = await import("./finance-config.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FinanceConfigRepository.paymentType.create).mockReset();
  vi.mocked(FinanceConfigRepository.paymentType.update).mockReset();

  vi.mocked(FinanceConfigRepository.bankAccount.findMany).mockReset().mockResolvedValue([]);
  vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(FinanceConfigRepository.bankAccount.create).mockReset();
  vi.mocked(FinanceConfigRepository.bankAccount.update).mockReset();
});

describe("Finance Config Service (Unit Tests)", () => {
  describe("Payment Types", () => {
    it("lists payment types for company ordered by name asc", async () => {
      const records = [{ id: "pt-1", code: "CASH", name: "Cash", type: "CASH", companyId: "co-1" }];
      vi.mocked(FinanceConfigRepository.paymentType.findMany).mockResolvedValue(records as never);

      const result = await listPaymentTypes("co-1");
      expect(result).toEqual(records);
      expect(FinanceConfigRepository.paymentType.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { name: "asc" },
      });
    });

    it("creates payment type and writes audit log", async () => {
      const created = { id: "pt-1", code: "UPI", name: "UPI Transfer", type: "BANK", isActive: true, companyId: "co-1" };
      vi.mocked(FinanceConfigRepository.paymentType.create).mockResolvedValue(created as never);

      const result = await createPaymentType(actor, { code: "UPI", name: "UPI Transfer", type: "BANK", isActive: true });
      expect(result).toEqual(created);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "payment_types",
          recordId: "pt-1",
          action: "CREATE",
        })
      );
    });

    it("rejects duplicate payment type code in the same company", async () => {
      vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue({ id: "pt-old", code: "UPI" } as never);

      await expect(
        createPaymentType(actor, { code: "UPI", name: "UPI Transfer", type: "BANK", isActive: true })
      ).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'Payment type code "UPI" is already in use.',
      });
    });

    it("updates payment type and writes audit log", async () => {
      const existing = { id: "pt-1", code: "UPI", name: "Old", type: "BANK", isActive: true, companyId: "co-1" };
      const updated = { ...existing, name: "UPI Instant" };
      vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue(existing as never);
      vi.mocked(FinanceConfigRepository.paymentType.update).mockResolvedValue(updated as never);

      const result = await updatePaymentType(actor, "pt-1", { code: "UPI", name: "UPI Instant", type: "BANK", isActive: true });
      expect(result).toEqual(updated);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "payment_types",
          action: "UPDATE",
        })
      );
    });

    it("throws NOT_FOUND when updating out-of-company payment type", async () => {
      vi.mocked(FinanceConfigRepository.paymentType.findFirst).mockResolvedValue(null);

      await expect(
        updatePaymentType(actor, "pt-other", { code: "UPI", name: "UPI", type: "BANK", isActive: true })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Payment type not found.",
      });
    });
  });

  describe("Bank / financial accounts", () => {
    const icici = {
      code: "ICICI-01",
      name: "ICICI Current",
      accountKind: "CURRENT" as const,
      bankName: "ICICI Bank",
      accountNumber: "1234567890",
    };

    beforeEach(() => {
      tx.bankAccount.create.mockReset();
      tx.bankAccount.update.mockReset();
      tx.chartOfAccount.update.mockReset();
      vi.mocked(createLedgerAccountForFinancialAccount).mockClear();
    });

    it("lists accounts with their ledger account, ordered by name", async () => {
      const accounts = [{ id: "ba-1", code: "HDFC-01", name: "HDFC Current", companyId: "co-1" }];
      vi.mocked(FinanceConfigRepository.bankAccount.findMany).mockResolvedValue(accounts as never);

      const result = await listBankAccounts("co-1");
      expect(result).toEqual(accounts);
      expect(FinanceConfigRepository.bankAccount.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { name: "asc" },
        include: { ledgerAccount: { select: { id: true, code: true, name: true } } },
      });
    });

    it("creates the account together with its own ledger account and writes an audit log", async () => {
      const created = { id: "ba-1", ...icici, ledgerAccountId: "led-1", isActive: true, companyId: "co-1" };
      tx.bankAccount.create.mockResolvedValue(created);

      const result = await createBankAccount(actor, icici);

      expect(result).toEqual(created);
      expect(createLedgerAccountForFinancialAccount).toHaveBeenCalledWith(tx, "co-1", icici);
      expect(tx.bankAccount.create.mock.calls[0][0].data).toMatchObject({
        companyId: "co-1",
        accountKind: "CURRENT",
        ledgerAccountId: "led-1",
        isActive: true,
      });
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "bank_accounts", recordId: "ba-1", action: "CREATE" }));
    });

    it("rejects a duplicate code in the company", async () => {
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue({ id: "ba-old", code: "ICICI-01" } as never);

      await expect(createBankAccount(actor, icici)).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'Bank account code "ICICI-01" is already in use.',
      });
      expect(createLedgerAccountForFinancialAccount).not.toHaveBeenCalled();
    });

    it("updates the account, renames its ledger account and keeps isActive when not sent", async () => {
      const existing = { id: "ba-1", code: "ICICI-01", name: "ICICI", accountKind: "CURRENT", ledgerAccountId: "led-1", companyId: "co-1", isActive: false };
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValueOnce(existing as never).mockResolvedValueOnce(null);
      tx.bankAccount.update.mockResolvedValue({ ...existing, name: "ICICI Prime", code: "ICICI-02" });

      await updateBankAccount(actor, "ba-1", { ...icici, code: "ICICI-02", name: "ICICI Prime" });

      expect(tx.chartOfAccount.update).toHaveBeenCalledWith({ where: { id: "led-1" }, data: { name: "ICICI Prime", code: "BANK-ICICI-02" } });
      expect(tx.bankAccount.update.mock.calls[0][0].data).not.toHaveProperty("isActive");
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "bank_accounts", action: "UPDATE" }));
    });

    it("refuses changing the kind of an existing account", async () => {
      const existing = { id: "ba-1", code: "ICICI-01", name: "ICICI", accountKind: "CURRENT", ledgerAccountId: "led-1", companyId: "co-1" };
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValueOnce(existing as never);

      await expect(updateBankAccount(actor, "ba-1", { ...icici, accountKind: "FIXED_DEPOSIT" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(tx.bankAccount.update).not.toHaveBeenCalled();
    });

    it("throws NOT_FOUND when updating another company's account", async () => {
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue(null);
      await expect(updateBankAccount(actor, "ba-foreign", icici)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Bank account not found." });
    });
  });

  describe("bankAccountSchema", () => {
    it("needs bank name and number for bank-held kinds, not for cash / investment", () => {
      expect(bankAccountSchema.safeParse({ code: "FD1", name: "FD", accountKind: "FIXED_DEPOSIT" }).success).toBe(false);
      expect(bankAccountSchema.safeParse({ code: "CB", name: "Cash box", accountKind: "CASH" }).success).toBe(true);
      expect(bankAccountSchema.safeParse({ code: "MF", name: "Mutual fund", accountKind: "INVESTMENT" }).success).toBe(true);
    });

    it("treats an empty interest rate / credit limit as not set", () => {
      const parsed = bankAccountSchema.parse({ code: "CC", name: "Card", accountKind: "CREDIT_CARD", bankName: "HDFC", accountNumber: "4321", interestRate: "", creditLimit: "" });
      expect(parsed.interestRate).toBeUndefined();
      expect(parsed.creditLimit).toBeUndefined();
    });
  });
});

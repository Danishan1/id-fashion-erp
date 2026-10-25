import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("./finance-config.repository", () => ({
  FinanceConfigRepository: {
    paymentType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    bankAccount: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { FinanceConfigRepository } = await import("./finance-config.repository");
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

  describe("Bank Accounts", () => {
    it("lists bank accounts for company ordered by name asc", async () => {
      const accounts = [{ id: "ba-1", code: "HDFC-01", name: "HDFC Current", companyId: "co-1" }];
      vi.mocked(FinanceConfigRepository.bankAccount.findMany).mockResolvedValue(accounts as never);

      const result = await listBankAccounts("co-1");
      expect(result).toEqual(accounts);
      expect(FinanceConfigRepository.bankAccount.findMany).toHaveBeenCalledWith({
        where: { companyId: "co-1" },
        orderBy: { name: "asc" },
      });
    });

    it("creates bank account and writes audit log", async () => {
      const created = {
        id: "ba-1",
        code: "ICICI-01",
        name: "ICICI Current",
        bankName: "ICICI Bank",
        accountNumber: "1234567890",
        isActive: true,
        companyId: "co-1",
      };
      vi.mocked(FinanceConfigRepository.bankAccount.create).mockResolvedValue(created as never);

      const result = await createBankAccount(actor, {
        code: "ICICI-01",
        name: "ICICI Current",
        bankName: "ICICI Bank",
        accountNumber: "1234567890",
        isActive: true,
      });

      expect(result).toEqual(created);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "bank_accounts",
          recordId: "ba-1",
          action: "CREATE",
        })
      );
    });

    it("rejects duplicate bank account code in company", async () => {
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue({ id: "ba-old", code: "ICICI-01" } as never);

      await expect(
        createBankAccount(actor, {
          code: "ICICI-01",
          name: "ICICI Current",
          bankName: "ICICI Bank",
          accountNumber: "1234567890",
          isActive: true,
        })
      ).rejects.toMatchObject({
        code: "DUPLICATE_DOC_NUMBER",
        message: 'Bank account code "ICICI-01" is already in use.',
      });
    });

    it("updates bank account and writes audit log", async () => {
      const existing = { id: "ba-1", code: "ICICI-01", name: "ICICI", companyId: "co-1", isActive: true };
      const updated = { ...existing, name: "ICICI Prime" };
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue(existing as never);
      vi.mocked(FinanceConfigRepository.bankAccount.update).mockResolvedValue(updated as never);

      const result = await updateBankAccount(actor, "ba-1", {
        code: "ICICI-01",
        name: "ICICI Prime",
        bankName: "ICICI Bank",
        accountNumber: "1234567890",
        isActive: true,
      });

      expect(result).toEqual(updated);
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "co-1",
          tableName: "bank_accounts",
          action: "UPDATE",
        })
      );
    });

    it("throws NOT_FOUND when updating out-of-company bank account", async () => {
      vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue(null);

      await expect(
        updateBankAccount(actor, "ba-foreign", {
          code: "ICICI-01",
          name: "ICICI",
          bankName: "ICICI",
          accountNumber: "1234",
          isActive: true,
        })
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Bank account not found.",
      });
    });
  });
});

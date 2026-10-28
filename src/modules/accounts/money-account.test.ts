import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/finance-config/finance-config.repository", () => ({
  FinanceConfigRepository: { bankAccount: { findFirst: vi.fn() } },
}));
vi.mock("./chart-of-account.repository", () => ({ ChartOfAccountRepository: { findByCode: vi.fn() } }));
vi.mock("@/core/db/client", () => ({ prisma: {} }));

const { FinanceConfigRepository } = await import("@/modules/finance-config/finance-config.repository");
const { ChartOfAccountRepository } = await import("./chart-of-account.repository");
const { resolveMoneyAccount, createLedgerAccountForFinancialAccount } = await import("./money-account");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ChartOfAccountRepository.findByCode).mockImplementation((async (_c: string, code: string) => ({ id: `acct-${code}`, code })) as never);
});

describe("resolveMoneyAccount", () => {
  it("uses the chosen bank's own ledger account", async () => {
    vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue({ ledgerAccount: { id: "led-sbi", code: "BANK-SBI", isActive: true } } as never);
    await expect(resolveMoneyAccount("co-1", "BANK", "ba-sbi")).resolves.toMatchObject({ id: "led-sbi" });
    expect(FinanceConfigRepository.bankAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ba-sbi", companyId: "co-1" } }));
  });

  it("falls back to the CASH / BANK control account by payment-type kind", async () => {
    vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue({ ledgerAccount: null } as never);
    await expect(resolveMoneyAccount("co-1", "UPI", "ba-old")).resolves.toMatchObject({ id: "acct-BANK" });
    await expect(resolveMoneyAccount("co-1", "CASH", null)).resolves.toMatchObject({ id: "acct-CASH" });
  });

  it("ignores an inactive ledger account", async () => {
    vi.mocked(FinanceConfigRepository.bankAccount.findFirst).mockResolvedValue({ ledgerAccount: { id: "led-x", code: "BANK-X", isActive: false } } as never);
    await expect(resolveMoneyAccount("co-1", "BANK", "ba-x")).resolves.toMatchObject({ id: "acct-BANK" });
  });

  it("explains a missing control account", async () => {
    vi.mocked(ChartOfAccountRepository.findByCode).mockResolvedValue(null);
    await expect(resolveMoneyAccount("co-1", "CASH")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("createLedgerAccountForFinancialAccount", () => {
  const db = {
    chartOfAccount: {
      upsert: vi.fn(async ({ create }: { create: { code: string } }) => ({ id: `parent-${create.code}` })),
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: "led-new", ...data })),
    },
  };

  it("creates the ledger account under the kind's parent, e.g. a credit card under Credit Cards Payable (liability)", async () => {
    db.chartOfAccount.findFirst.mockResolvedValue(null);
    const ledger = await createLedgerAccountForFinancialAccount(db as never, "co-1", { code: "HDFC-CC", name: "HDFC Card", accountKind: "CREDIT_CARD" });
    expect(db.chartOfAccount.upsert.mock.calls[0][0]).toMatchObject({
      where: { companyId_code: { companyId: "co-1", code: "CC-PAY" } },
      create: { accountType: "LIABILITY", isSystemAccount: true },
    });
    expect(ledger).toMatchObject({ code: "CC-PAY-HDFC-CC", name: "HDFC Card", accountType: "LIABILITY", parentAccountId: "parent-CC-PAY" });
  });

  it("refuses when that ledger code already exists", async () => {
    db.chartOfAccount.findFirst.mockResolvedValue({ id: "taken" });
    await expect(
      createLedgerAccountForFinancialAccount(db as never, "co-1", { code: "SBI", name: "SBI", accountKind: "CURRENT" })
    ).rejects.toMatchObject({ code: "DUPLICATE_DOC_NUMBER" });
  });
});

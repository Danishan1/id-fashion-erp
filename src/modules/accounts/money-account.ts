import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { FinancialAccountKind, PaymentTypeKind, Prisma } from "@prisma/client";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";

/**
 * Financial accounts (2026-10-28). Every BankAccount row — a real bank, a cash
 * box, an FD / RD, a credit card, a loan given or an investment — has its own
 * ledger account in the Chart of Accounts, a child of the parent below. Money
 * moves post to that ledger account; the parent keeps whatever was posted to
 * it before this change.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const FINANCIAL_ACCOUNT_PARENTS: Record<FinancialAccountKind, { code: string; name: string; accountType: "ASSET" | "LIABILITY" }> = {
  CURRENT: { code: "BANK", name: "Bank", accountType: "ASSET" },
  SAVINGS: { code: "BANK", name: "Bank", accountType: "ASSET" },
  CASH: { code: "CASH", name: "Cash", accountType: "ASSET" },
  FIXED_DEPOSIT: { code: "FD", name: "Fixed Deposits", accountType: "ASSET" },
  RECURRING_DEPOSIT: { code: "RD", name: "Recurring Deposits", accountType: "ASSET" },
  CREDIT_CARD: { code: "CC-PAY", name: "Credit Cards Payable", accountType: "LIABILITY" },
  LOAN_GIVEN: { code: "LOAN-GIVEN", name: "Loans Given", accountType: "ASSET" },
  INVESTMENT: { code: "INVESTMENTS", name: "Investments", accountType: "ASSET" },
};

/**
 * Creates the ledger account for a financial account (and its parent control
 * account if the company doesn't have it yet). Code: `<PARENT>-<bank code>`.
 */
export async function createLedgerAccountForFinancialAccount(
  db: Db,
  companyId: string,
  bank: { code: string; name: string; accountKind: FinancialAccountKind }
) {
  const parentDef = FINANCIAL_ACCOUNT_PARENTS[bank.accountKind];
  const parent = await db.chartOfAccount.upsert({
    where: { companyId_code: { companyId, code: parentDef.code } },
    update: {},
    create: { companyId, code: parentDef.code, name: parentDef.name, accountType: parentDef.accountType, isSystemAccount: true },
  });
  const code = `${parentDef.code}-${bank.code}`;
  const taken = await db.chartOfAccount.findFirst({ where: { companyId, code }, select: { id: true } });
  if (taken) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `A ledger account with code "${code}" already exists. Use a different code.`, { code });
  }
  return db.chartOfAccount.create({
    data: {
      companyId,
      code,
      name: bank.name,
      accountType: parentDef.accountType,
      parentAccountId: parent.id,
      isSystemAccount: true,
    },
  });
}

/**
 * The ledger account money moves through: the chosen financial account's own
 * ledger when it has one, otherwise the CASH / BANK control account by the
 * payment type's kind (never its code — see payment.service.ts).
 */
export async function resolveMoneyAccount(companyId: string, paymentTypeKind: PaymentTypeKind, bankAccountId?: string | null) {
  if (bankAccountId) {
    const bank = await FinanceConfigRepository.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      select: { ledgerAccount: { select: { id: true, code: true, isActive: true } } },
    });
    if (bank?.ledgerAccount?.isActive) return bank.ledgerAccount;
  }
  const code = paymentTypeKind === "CASH" ? "CASH" : "BANK";
  const control = await ChartOfAccountRepository.findByCode(companyId, code);
  if (!control) {
    throw new BusinessRuleError("NOT_FOUND", `The ${code === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`);
  }
  return control;
}

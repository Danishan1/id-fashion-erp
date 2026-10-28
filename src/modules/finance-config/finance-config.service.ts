import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { BankAccountInput, PaymentTypeInput } from "./finance-config.schema";
import { FinanceConfigRepository } from "./finance-config.repository";
import { prisma } from "@/core/db/client";
import { FINANCIAL_ACCOUNT_PARENTS, createLedgerAccountForFinancialAccount } from "@/modules/accounts/money-account";

interface ActorContext {
  companyId: string;
  userId: string;
}

// ── Payment Types ─────────────────────────────────────────────────────────

export async function listPaymentTypes(companyId: string) {
  return FinanceConfigRepository.paymentType.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createPaymentType(actor: ActorContext, input: PaymentTypeInput) {
  const existing = await FinanceConfigRepository.paymentType.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Payment type code "${input.code}" is already in use.`);

  const paymentType = await FinanceConfigRepository.paymentType.create({
    data: { companyId: actor.companyId, code: input.code, name: input.name, type: input.type, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_types",
    recordId: paymentType.id,
    action: "CREATE",
    newValues: paymentType,
  });

  return paymentType;
}

export async function updatePaymentType(actor: ActorContext, id: string, input: PaymentTypeInput) {
  const existing = await FinanceConfigRepository.paymentType.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Payment type not found.", { id });

  const updated = await FinanceConfigRepository.paymentType.update({
    where: { id },
    data: { code: input.code, name: input.name, type: input.type, isActive: input.isActive },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_types",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

// ── Bank Accounts ─────────────────────────────────────────────────────────

export async function listBankAccounts(companyId: string) {
  return FinanceConfigRepository.bankAccount.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    include: { ledgerAccount: { select: { id: true, code: true, name: true } } },
  });
}

function bankAccountData(input: BankAccountInput) {
  return {
    code: input.code,
    name: input.name,
    bankName: input.bankName || null,
    accountNumber: input.accountNumber || null,
    ifscCode: input.ifscCode || null,
    branch: input.branch || null,
    accountHolderName: input.accountHolderName || null,
    upiId: input.upiId || null,
    maturityDate: input.maturityDate ? new Date(input.maturityDate) : null,
    interestRate: input.interestRate ?? null,
    creditLimit: input.creditLimit ?? null,
  };
}

/**
 * Creates the financial account and, in the same transaction, its own ledger
 * account in the Chart of Accounts (see accounts/money-account.ts).
 */
export async function createBankAccount(actor: ActorContext, input: BankAccountInput) {
  const existing = await FinanceConfigRepository.bankAccount.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Bank account code "${input.code}" is already in use.`);

  const bankAccount = await prisma.$transaction(async (tx) => {
    const ledger = await createLedgerAccountForFinancialAccount(tx, actor.companyId, input);
    return tx.bankAccount.create({
      data: {
        companyId: actor.companyId,
        ...bankAccountData(input),
        accountKind: input.accountKind,
        ledgerAccountId: ledger.id,
        isActive: input.isActive ?? true,
      },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "bank_accounts",
    recordId: bankAccount.id,
    action: "CREATE",
    newValues: bankAccount,
  });

  return bankAccount;
}

/**
 * The kind can't change once created: the ledger account sits under that
 * kind's parent (Bank, FD, Credit Cards...). A new code or name is copied to
 * the ledger account. isActive changes only when sent (the toggle), so a plain
 * edit never re-activates a deactivated account.
 */
export async function updateBankAccount(actor: ActorContext, id: string, input: BankAccountInput) {
  const existing = await FinanceConfigRepository.bankAccount.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Bank account not found.", { id });
  if (input.accountKind !== existing.accountKind) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "The kind of an account can't be changed after it is created. Deactivate it and create a new one instead.",
      { field: "accountKind" }
    );
  }
  if (input.code !== existing.code) {
    const clash = await FinanceConfigRepository.bankAccount.findFirst({
      where: { companyId: actor.companyId, code: input.code, id: { not: id } },
    });
    if (clash) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Bank account code "${input.code}" is already in use.`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (existing.ledgerAccountId) {
      const parentCode = FINANCIAL_ACCOUNT_PARENTS[existing.accountKind].code;
      await tx.chartOfAccount.update({
        where: { id: existing.ledgerAccountId },
        data: { name: input.name, ...(input.code !== existing.code ? { code: `${parentCode}-${input.code}` } : {}) },
      });
    }
    return tx.bankAccount.update({
      where: { id },
      data: { ...bankAccountData(input), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "bank_accounts",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });

  return updated;
}

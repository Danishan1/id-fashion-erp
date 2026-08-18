import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { BankAccountInput, PaymentTypeInput } from "./finance-config.schema";
import { FinanceConfigRepository } from "./finance-config.repository";

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
  return FinanceConfigRepository.bankAccount.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

export async function createBankAccount(actor: ActorContext, input: BankAccountInput) {
  const existing = await FinanceConfigRepository.bankAccount.findFirst({ where: { companyId: actor.companyId, code: input.code } });
  if (existing) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Bank account code "${input.code}" is already in use.`);

  const bankAccount = await FinanceConfigRepository.bankAccount.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode || null,
      branch: input.branch || null,
      accountHolderName: input.accountHolderName || null,
      upiId: input.upiId || null,
      isActive: input.isActive,
    },
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

export async function updateBankAccount(actor: ActorContext, id: string, input: BankAccountInput) {
  const updated = await FinanceConfigRepository.bankAccount.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode || null,
      branch: input.branch || null,
      accountHolderName: input.accountHolderName || null,
      upiId: input.upiId || null,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "bank_accounts",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

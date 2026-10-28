import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { extractStateCodeFromGstin, isValidStateCode } from "@/lib/gst";
import { assertValidExpenseAccount } from "@/modules/accounts/chart-of-account.service";
import { FinanceConfigRepository } from "./finance-config.repository";
import type { ExpensePurposeInput, PayeeInput } from "./finance-config.schema";

/**
 * Payee and Purpose masters (Payments Request, 2026-10-28). Finance masters
 * (masters_finance permission), company-scoped like every other master.
 */

interface ActorContext {
  companyId: string;
  userId: string;
}

// ── Payees ───────────────────────────────────────────────────────────────

export async function listPayees(companyId: string) {
  return FinanceConfigRepository.payee.findMany({ where: { companyId }, orderBy: { name: "asc" } });
}

/** GSTIN must be well-formed; its first two digits become the GST state. Without a GSTIN a state may be entered. */
function payeeData(input: PayeeInput) {
  const gstin = input.gstin ? input.gstin.toUpperCase() : null;
  let stateCode = input.stateCode || null;
  if (gstin) {
    stateCode = extractStateCodeFromGstin(gstin);
    if (!stateCode) throw new BusinessRuleError("VALIDATION_ERROR", "GSTIN looks wrong (15 characters, e.g. 07ABCDE1234F1Z5).", { field: "gstin" });
  } else if (stateCode && !isValidStateCode(stateCode)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Unknown GST state code.", { field: "stateCode" });
  }
  return {
    code: input.code,
    name: input.name,
    payeeType: input.payeeType,
    gstin,
    stateCode,
    pan: input.pan || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    bankAccountName: input.bankAccountName || null,
    bankAccountNo: input.bankAccountNo || null,
    ifscCode: input.ifscCode || null,
    upiId: input.upiId || null,
  };
}

async function assertPayeeUnique(companyId: string, input: PayeeInput, excludeId?: string) {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  if (await FinanceConfigRepository.payee.findFirst({ where: { companyId, code: input.code, ...notSelf } })) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Payee code "${input.code}" is already in use.`);
  }
  const sameName = await FinanceConfigRepository.payee.findFirst({
    where: { companyId, name: { equals: input.name, mode: "insensitive" }, ...notSelf },
  });
  if (sameName) throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `A payee named "${sameName.name}" already exists.`);
}

export async function createPayee(actor: ActorContext, input: PayeeInput) {
  await assertPayeeUnique(actor.companyId, input);
  const payee = await FinanceConfigRepository.payee.create({
    data: { companyId: actor.companyId, ...payeeData(input), isActive: input.isActive ?? true },
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "payees", recordId: payee.id, action: "CREATE", newValues: payee });
  return payee;
}

export async function updatePayee(actor: ActorContext, id: string, input: PayeeInput) {
  const existing = await FinanceConfigRepository.payee.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Payee not found.", { id });
  await assertPayeeUnique(actor.companyId, input, id);
  const updated = await FinanceConfigRepository.payee.update({
    where: { id },
    data: { ...payeeData(input), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payees",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });
  return updated;
}

// ── Purposes ─────────────────────────────────────────────────────────────

export async function listExpensePurposes(companyId: string) {
  return FinanceConfigRepository.expensePurpose.findMany({
    where: { companyId },
    orderBy: [{ purposeGroup: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { id: true, name: true } },
      expenseAccount: { select: { id: true, code: true, name: true } },
    },
  });
}

async function purposeData(companyId: string, input: ExpensePurposeInput, selfId?: string) {
  const parentId = input.parentId || null;
  if (parentId) {
    if (parentId === selfId) throw new BusinessRuleError("VALIDATION_ERROR", "A purpose can't be its own sub-category.", { field: "parentId" });
    const parent = await FinanceConfigRepository.expensePurpose.findFirst({ where: { id: parentId, companyId } });
    if (!parent) throw new BusinessRuleError("NOT_FOUND", "Parent purpose not found.", { id: parentId });
    if (parent.purposeGroup !== input.purposeGroup) {
      throw new BusinessRuleError("VALIDATION_ERROR", "A sub-category must be in the same group as its parent.", { field: "parentId" });
    }
    if (parent.parentId) throw new BusinessRuleError("VALIDATION_ERROR", "Only one level of sub-categories is allowed.", { field: "parentId" });
  }
  const expenseAccountId = input.expenseAccountId || null;
  if (expenseAccountId) await assertValidExpenseAccount(companyId, expenseAccountId);
  return { code: input.code, name: input.name, purposeGroup: input.purposeGroup, parentId, expenseAccountId };
}

export async function createExpensePurpose(actor: ActorContext, input: ExpensePurposeInput) {
  if (await FinanceConfigRepository.expensePurpose.findFirst({ where: { companyId: actor.companyId, code: input.code } })) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Purpose code "${input.code}" is already in use.`);
  }
  const purpose = await FinanceConfigRepository.expensePurpose.create({
    data: { companyId: actor.companyId, ...(await purposeData(actor.companyId, input)), isActive: input.isActive ?? true },
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "expense_purposes", recordId: purpose.id, action: "CREATE", newValues: purpose });
  return purpose;
}

export async function updateExpensePurpose(actor: ActorContext, id: string, input: ExpensePurposeInput) {
  const existing = await FinanceConfigRepository.expensePurpose.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Purpose not found.", { id });
  if (input.code !== existing.code) {
    if (await FinanceConfigRepository.expensePurpose.findFirst({ where: { companyId: actor.companyId, code: input.code, id: { not: id } } })) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Purpose code "${input.code}" is already in use.`);
    }
  }
  if (input.purposeGroup !== existing.purposeGroup) {
    const children = await FinanceConfigRepository.expensePurpose.count({ where: { parentId: id } });
    if (children > 0) throw new BusinessRuleError("VALIDATION_ERROR", "Move or change its sub-categories before changing this purpose's group.");
  }
  const updated = await FinanceConfigRepository.expensePurpose.update({
    where: { id },
    data: { ...(await purposeData(actor.companyId, input, id)), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expense_purposes",
    recordId: id,
    action: "UPDATE",
    oldValues: existing,
    newValues: updated,
  });
  return updated;
}

/** Active, non-COGS expense accounts for the purpose form's account picker ({id, name} for the lookup manager). */
export async function listExpenseAccountOptions(companyId: string) {
  const accounts = await FinanceConfigRepository.chartOfAccount.findMany({
    where: { companyId, accountType: "EXPENSE", isActive: true, code: { not: "COGS" } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });
  return accounts.map((a) => ({ id: a.id, name: `${a.code} — ${a.name}` }));
}

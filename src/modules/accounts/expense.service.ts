import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { ExpenseInput } from "./expense.schema";
import { ExpenseRepository, CompanyRepository } from "./expense.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { TaxRateRepository } from "./tax-config.repository";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * COGS is seeded with accountType EXPENSE but is a Purchase-Invoice-only
 * control account (postPurchaseInvoice debits it via a hardcoded
 * findByCode lookup, never user-selectable) — excluded explicitly here, not
 * just implicitly via isSystemAccount (COGS is deliberately NOT flagged
 * isSystemAccount, so that check alone would let it through). Letting a
 * user post an ad hoc Expense into the same account Purchase Invoice drives
 * automatically would pollute any COGS-based margin reporting with manual,
 * PO-disconnected debits.
 */
async function assertValidExpenseAccount(companyId: string, accountId: string) {
  const account = await ChartOfAccountRepository.findAnyById(companyId, accountId);
  if (!account) throw new BusinessRuleError("NOT_FOUND", "Expense account not found.", { id: accountId });
  if (account.accountType !== "EXPENSE" || account.code === "COGS") {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `"${account.name}" cannot be used as an Expense account.`,
      { accountId, accountType: account.accountType, code: account.code }
    );
  }
  if (!account.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${account.name}" is not active.`, { accountId });
  }
  return account;
}

interface BuiltExpenseFields {
  accountId: string;
  supplierId: string | null;
  amount: number;
  taxRateId: string | null;
  taxPercentage: number | null;
  taxAmount: number;
  totalAmount: number;
  paymentTypeId: string;
  bankAccountId: string | null;
}

async function buildExpenseFields(companyId: string, input: ExpenseInput): Promise<BuiltExpenseFields> {
  await assertValidExpenseAccount(companyId, input.accountId);

  if (input.supplierId) {
    const supplier = await SupplierRepository.findById(companyId, input.supplierId);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });
  }

  const paymentType = await FinanceConfigRepository.paymentType.findFirst({
    where: { id: input.paymentTypeId, companyId },
  });
  if (!paymentType) throw new BusinessRuleError("NOT_FOUND", "Payment type not found.", { id: input.paymentTypeId });

  if (input.bankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId },
    });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "Bank account not found.", { id: input.bankAccountId });
  }

  let taxPercentage: number | null = null;
  if (input.taxRateId) {
    const taxRate = await TaxRateRepository.findAnyById(companyId, input.taxRateId);
    if (!taxRate) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id: input.taxRateId });
    taxPercentage = Number(taxRate.ratePercentage);
  }
  const amount = round2(input.amount);
  const taxAmount = taxPercentage ? round2((amount * taxPercentage) / 100) : 0;

  return {
    accountId: input.accountId,
    supplierId: input.supplierId || null,
    amount,
    taxRateId: input.taxRateId || null,
    taxPercentage,
    taxAmount,
    totalAmount: round2(amount + taxAmount),
    paymentTypeId: input.paymentTypeId,
    bankAccountId: input.bankAccountId || null,
  };
}

export async function listExpenses(companyId: string, query: ListQuery) {
  const where: Prisma.ExpenseWhereInput = {
    companyId,
    ...(query.search ? { expenseNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    ExpenseRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ExpenseRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getExpenseById(companyId: string, id: string) {
  const expense = await ExpenseRepository.findByIdWithDetails(companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });
  return expense;
}

export async function createExpense(actor: ActorContext, input: ExpenseInput) {
  const fields = await buildExpenseFields(actor.companyId, input);

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  const expenseNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "EXPENSE",
  });

  const expense = await ExpenseRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    expenseNumber,
    expenseDate: new Date(input.expenseDate),
    description: input.description,
    referenceNumber: input.referenceNumber || null,
    currencyCode: company.baseCurrencyCode,
    status: "DRAFT",
    createdByUserId: actor.userId,
    ...fields,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: expense.id,
    action: "CREATE",
    newValues: { expenseNumber: expense.expenseNumber, totalAmount: expense.totalAmount },
  });

  return expense;
}

/** Editable only while DRAFT — a plain header update, no item-replacement
 * complexity (Expense is single-row, per the locked scope decision). */
export async function updateExpense(actor: ActorContext, id: string, input: ExpenseInput) {
  const existing = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  if (existing.status !== "DRAFT") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit an expense in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const fields = await buildExpenseFields(actor.companyId, input);

  const updated = await ExpenseRepository.update(id, {
    expenseDate: new Date(input.expenseDate),
    description: input.description,
    referenceNumber: input.referenceNumber || null,
    ...fields,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "UPDATE",
    oldValues: { totalAmount: existing.totalAmount },
    newValues: { totalAmount: updated.totalAmount },
  });

  return updated;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded via "approve" (mirroring Payment's
 * own post gate, not Invoice's "post" verb — Management's approval power in
 * this codebase is specifically scoped to "approve"). One transaction:
 * resolves Cash/Bank by paymentType.type (never PaymentType.code — same
 * anti-trap as Payment), resolves GST Input Tax Credit by code if
 * taxAmount > 0, builds journal lines with a DYNAMIC incrementing line
 * number (Purchase Invoice's pattern — NOT Payment's hardcoded literals,
 * which would collide once a tax line is inserted between the expense
 * account line and the cash/bank line), creates+auto-posts a Journal via
 * postJournalCore, then a guarded conditional flip of this Expense.
 *
 * No reversal/correction path exists this slice (journal.service.ts's
 * reverseJournal() blocks EXPENSE-sourced journals) — a posting mistake
 * requires a manual adjusting journal entry, not a "reverse the linked
 * journal" workaround.
 */
export async function postExpense(actor: ActorContext, id: string) {
  const expense = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "approve", { createdBy: expense.createdByUserId });

  if (expense.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot post an expense in "${expense.status}" status.`, {
      currentStatus: expense.status,
    });
  }

  if (!expense.account.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${expense.account.name}" is no longer active.`, {});
  }

  const cashOrBankAccountCode = expense.paymentType.type === "CASH" ? "CASH" : "BANK";
  const taxAmountNum = Number(expense.taxAmount);
  const [cashOrBankAccount, gstInputAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, cashOrBankAccountCode),
    taxAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC") : null,
  ]);
  if (!cashOrBankAccount) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      `The ${cashOrBankAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`,
      {}
    );
  }
  if (taxAmountNum > 0 && !gstInputAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The GST Input Tax Credit control account is missing from the Chart of Accounts.", {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  await prisma.$transaction(async (tx) => {
    const lines = [
      {
        accountId: expense.accountId,
        lineNumber: 1,
        debitAmount: Number(expense.amount),
        creditAmount: 0,
        description: `Expense ${expense.expenseNumber}`,
      },
    ];
    let nextLineNumber = 2;
    if (taxAmountNum > 0 && gstInputAccount) {
      lines.push({
        accountId: gstInputAccount.id,
        lineNumber: nextLineNumber++,
        debitAmount: taxAmountNum,
        creditAmount: 0,
        description: `Expense ${expense.expenseNumber} — GST Input`,
      });
    }
    lines.push({
      accountId: cashOrBankAccount.id,
      lineNumber: nextLineNumber++,
      debitAmount: 0,
      creditAmount: Number(expense.totalAmount),
      description: `Expense ${expense.expenseNumber}`,
    });

    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: expense.expenseDate,
        status: "DRAFT",
        narration: `Auto-posted for Expense ${expense.expenseNumber}`,
        sourceModule: "EXPENSE",
        sourceRecordId: expense.id,
        createdByUserId: actor.userId,
        lines: { create: lines },
      },
    });

    // Internal auto-post — no second PermissionService call (see
    // postJournalCore's doc comment): the outer "approve" assertion above
    // already authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.expense.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This expense is no longer in Draft status.", {});
    }
  });

  const updated = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", journalId: updated.journalId },
  });

  return updated;
}

/** Only from DRAFT — no compensating entry needed, since DRAFT never touched
 * the ledger at all (only POST does). */
export async function cancelExpense(actor: ActorContext, id: string) {
  const existing = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  const { count } = await ExpenseRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel an expense in "${existing.status}" status.`, {
      currentStatus: existing.status,
    });
  }

  const updated = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

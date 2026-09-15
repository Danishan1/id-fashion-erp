import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import type { Prisma } from "@prisma/client";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { ExpenseInput } from "./expense.schema";
import type { ExpenseApprovalStatus } from "@prisma/client";
import { ExpenseRepository, CompanyRepository } from "./expense.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { assertValidExpenseAccount } from "./chart-of-account.service";
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

interface BuiltExpenseFields {
  accountId: string;
  supplierId: string | null;
  amount: number;
  taxRateId: string | null;
  taxPercentage: number | null;
  taxAmount: number;
  totalAmount: number;
  tdsPercentage: number | null;
  tdsAmount: number;
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
  // TDS on the base amount, not the GST-inclusive total — matches standard
  // Indian TDS practice (confirmed against the reference tool's own live
  // calc, not guessed).
  const tdsPercentage = input.tdsPercentage || null;
  const tdsAmount = tdsPercentage ? round2((amount * tdsPercentage) / 100) : 0;

  return {
    accountId: input.accountId,
    supplierId: input.supplierId || null,
    amount,
    taxRateId: input.taxRateId || null,
    taxPercentage,
    taxAmount,
    totalAmount: round2(amount + taxAmount),
    tdsPercentage,
    tdsAmount,
    paymentTypeId: input.paymentTypeId,
    bankAccountId: input.bankAccountId || null,
  };
}

export async function listExpenses(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.ExpenseWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
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

/** A branch-restricted user gets NOT_FOUND for an expense outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getExpenseById(actor: { companyId: string; userId: string }, id: string) {
  const expense = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!expense.branchId || !allowedBranchIds.has(expense.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });
  }

  return expense;
}

export async function createExpense(actor: ActorContext, input: ExpenseInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await ExpenseRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const fields = await buildExpenseFields(actor.companyId, input);

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  const expenseNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "EXPENSE",
  });

  let expense;
  try {
    expense = await ExpenseRepository.create({
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      expenseNumber,
      expenseDate: new Date(input.expenseDate),
      description: input.description,
      referenceNumber: input.referenceNumber || null,
      currencyCode: company.baseCurrencyCode,
      status: "PENDING_APPROVAL",
      createdByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
      ...fields,
    });
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await ExpenseRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

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

/** Editable only while PENDING_APPROVAL — a plain header update, no
 * item-replacement complexity (Expense is single-row, per the locked scope
 * decision). */
export async function updateExpense(actor: ActorContext, id: string, input: ExpenseInput) {
  const existing = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  if (existing.status !== "PENDING_APPROVAL") {
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
 * PENDING_APPROVAL -> APPROVED. The Admin decision step — no cash movement,
 * no Journal, just a status flip + approvedAt/approvedByUserId. Self-
 * approval-guarded via "approve" (a creator can't approve their own
 * expense) — the same checkpoint every other Approve action in this app
 * uses. Paying is a separate, later action (postExpense, gated on "post").
 */
export async function approveExpense(actor: ActorContext, id: string) {
  const expense = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "approve", { createdBy: expense.createdByUserId });

  const { count } = await ExpenseRepository.updateStatusConditional(id, "PENDING_APPROVAL", {
    status: "APPROVED",
    approvedAt: new Date(),
    approvedByUserId: actor.userId,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve an expense in "${expense.status}" status.`, {
      currentStatus: expense.status,
    });
  }

  const updated = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "PENDING_APPROVAL" },
    newValues: { status: "APPROVED" },
  });

  return updated;
}

/**
 * PENDING_APPROVAL -> REJECTED. Requires a reason. Terminal — matches every
 * other rejection in this app (Sample, Sales Order, Purchase Order, ...):
 * rejected stays rejected, a correction is a new Expense, not a reversal
 * (confirmed with the user, a deliberate deviation from the reference
 * tool's own "Admin can flip Declined back to Approved" behavior). Gated on
 * "reject", deliberately NOT self-approval-guarded — matches Sampling's own
 * decision route, where only the Approve branch carries that guard.
 */
export async function rejectExpense(actor: ActorContext, id: string, rejectionReason: string) {
  const expense = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "reject");

  const { count } = await ExpenseRepository.updateStatusConditional(id, "PENDING_APPROVAL", {
    status: "REJECTED",
    rejectedAt: new Date(),
    rejectedByUserId: actor.userId,
    rejectionReason,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot reject an expense in "${expense.status}" status.`, {
      currentStatus: expense.status,
    });
  }

  const updated = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "REJECT",
    oldValues: { status: "PENDING_APPROVAL" },
    newValues: { status: "REJECTED", rejectionReason },
  });

  return updated;
}

/**
 * APPROVED -> PAID. The Accountant-pays step — self-approval-guarded via
 * "post" (a distinct verb from the Admin's "approve" above, so the two
 * checkpoints are independently guarded: the creator can't approve their
 * own expense, and separately can't pay it either unless they're
 * SUPER_ADMIN). One transaction: resolves Cash/Bank by paymentType.type
 * (never PaymentType.code — same anti-trap as Payment), resolves GST Input
 * Tax Credit by code if taxAmount > 0, builds journal lines with a DYNAMIC
 * incrementing line number (Purchase Invoice's pattern — NOT Payment's
 * hardcoded literals, which would collide once a tax line is inserted
 * between the expense account line and the cash/bank line), creates+auto-
 * posts a Journal via postJournalCore, then a guarded conditional flip of
 * this Expense.
 *
 * No reversal/correction path exists this slice (journal.service.ts's
 * reverseJournal() blocks EXPENSE-sourced journals) — a posting mistake
 * requires a manual adjusting journal entry, not a "reverse the linked
 * journal" workaround.
 */
export async function postExpense(actor: ActorContext, id: string) {
  const expense = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "post", { createdBy: expense.createdByUserId });

  if (expense.status !== "APPROVED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot pay an expense in "${expense.status}" status — it must be Approved first.`, {
      currentStatus: expense.status,
    });
  }

  if (!expense.account.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${expense.account.name}" is no longer active.`, {});
  }

  const cashOrBankAccountCode = expense.paymentType.type === "CASH" ? "CASH" : "BANK";
  const taxAmountNum = Number(expense.taxAmount);
  const tdsAmountNum = Number(expense.tdsAmount);
  const [cashOrBankAccount, gstInputAccount, tdsPayableAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, cashOrBankAccountCode),
    taxAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC") : null,
    tdsAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "TDS-PAY") : null,
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
  if (tdsAmountNum > 0 && !tdsPayableAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The TDS Payable control account is missing from the Chart of Accounts.", {});
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
    if (tdsAmountNum > 0 && tdsPayableAccount) {
      lines.push({
        accountId: tdsPayableAccount.id,
        lineNumber: nextLineNumber++,
        debitAmount: 0,
        creditAmount: tdsAmountNum,
        description: `Expense ${expense.expenseNumber} — TDS Withheld`,
      });
    }
    // Net cash/bank outflow is totalAmount minus whatever TDS was withheld
    // at source — the vendor/payee only actually receives the net amount.
    lines.push({
      accountId: cashOrBankAccount.id,
      lineNumber: nextLineNumber++,
      debitAmount: 0,
      creditAmount: round2(Number(expense.totalAmount) - tdsAmountNum),
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
    // postJournalCore's doc comment): the outer "post" assertion above
    // already authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.expense.updateMany({
      where: { id, status: "APPROVED" },
      data: { status: "PAID", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This expense is no longer in Approved status.", {});
    }
  });

  const updated = await ExpenseRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expenses",
    recordId: id,
    action: "POST",
    oldValues: { status: "APPROVED" },
    newValues: { status: "PAID", journalId: updated.journalId },
  });

  return updated;
}

/** Only from PENDING_APPROVAL or APPROVED — both pre-payment states, no
 * compensating entry needed since neither has touched the ledger yet (only
 * PAID/postExpense does). Blocked once PAID (immutable, matching every
 * other posted-document precedent in this project) or already
 * REJECTED/CANCELLED. */
export async function cancelExpense(actor: ActorContext, id: string) {
  const existing = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  const cancellableFrom: ExpenseApprovalStatus[] = ["PENDING_APPROVAL", "APPROVED"];
  const { count } = await ExpenseRepository.updateStatusConditionalIn(id, cancellableFrom, { status: "CANCELLED" });
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
    oldValues: { status: existing.status },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

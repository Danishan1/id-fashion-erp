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
import { randomUUID } from "node:crypto";
import type { BillUploadExpenseInput, ExpenseInput, ExpensePaymentInput } from "./expense.schema";
import { ExpenseApprovalStatus } from "@prisma/client";
import { ExpenseRepository, ExpensePaymentRepository, CompanyRepository } from "./expense.repository";
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
}

async function buildExpenseFields(companyId: string, input: ExpenseInput): Promise<BuiltExpenseFields> {
  await assertValidExpenseAccount(companyId, input.accountId);

  if (input.supplierId) {
    const supplier = await SupplierRepository.findById(companyId, input.supplierId);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });
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
  };
}

const VALID_EXPENSE_APPROVAL_STATUSES = new Set<string>(Object.values(ExpenseApprovalStatus));

export async function listExpenses(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.ExpenseWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { expenseNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_EXPENSE_APPROVAL_STATUSES.has(query.status)
      ? { status: query.status as ExpenseApprovalStatus }
      : {}),
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
 * uses. Paying is a separate, later action (recordExpensePayment, gated on "post").
 */
export async function approveExpense(actor: ActorContext, id: string) {
  const expense = await ExpenseRepository.findAnyById(actor.companyId, id);
  if (!expense) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "approve", { createdBy: expense.createdByUserId });

  if (!expense.accountId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Set the expense account (Edit the expense) before approving it.",
      { field: "accountId" }
    );
  }

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

const AMOUNT_EPSILON = 0.005;
const PAYABLE_STATUSES: ExpenseApprovalStatus[] = ["APPROVED", "PARTIALLY_PAID"];

/** What is still owed on an expense: totalAmount - TDS withheld - already paid. */
export function expenseRemainingAmount(expense: { totalAmount: unknown; tdsAmount: unknown; paidAmount: unknown }) {
  const payable = round2(Number(expense.totalAmount) - Number(expense.tdsAmount));
  return round2(payable - Number(expense.paidAmount));
}

/** Expenses Payable — the liability an expense sits in between approval and
 * full payment. Created on first use for companies seeded before it existed. */
async function ensureExpensesPayableAccount(companyId: string) {
  return prisma.chartOfAccount.upsert({
    where: { companyId_code: { companyId, code: "EXP-PAY" } },
    update: {},
    create: { companyId, code: "EXP-PAY", name: "Expenses Payable", accountType: "LIABILITY", isSystemAccount: true },
  });
}

/**
 * Pays an APPROVED / PARTIALLY_PAID expense, fully or in part (2026-10-23).
 * Repeat payments sit on the same expense number, each with its own
 * ExpensePayment row, number (EXPP-...) and journal.
 *
 * Accounting: the first payment also posts the expense's accrual journal
 * (Dr expense account [+ Dr GST-ITC] / Cr TDS-PAY / Cr EXP-PAY for the net
 * payable). Every payment posts Dr EXP-PAY / Cr CASH-or-BANK. Cash vs Bank
 * follows paymentType.type, never its code — same rule as Payment.
 *
 * Gated on "post" with the creator self-guard — the same checkpoint the old
 * one-shot "Pay" used. Neither journal can be reversed (journal.service's
 * reverseJournal() blocks EXPENSE and EXPENSE_PAYMENT sources).
 */
export async function recordExpensePayment(actor: ActorContext, id: string, input: ExpensePaymentInput) {
  if (input.idempotencyKey) {
    const existing = await ExpensePaymentRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) {
      if (existing.expenseId !== id) {
        throw new BusinessRuleError("VALIDATION_ERROR", "This payment key was already used for a different expense.", {});
      }
      return getExpenseById(actor, id);
    }
  }

  const expense = await getExpenseById(actor, id);

  await PermissionService.assert(actor.userId, "expenses", "post", { createdBy: expense.createdByUserId });

  if (!PAYABLE_STATUSES.includes(expense.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot pay an expense in "${expense.status}" status — it must be Approved first.`,
      { currentStatus: expense.status }
    );
  }
  const expenseAccount = expense.account;
  if (!expenseAccount) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Set the expense account (Edit the expense) before paying it.", {
      field: "accountId",
    });
  }
  if (!expense.journalId && !expenseAccount.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${expenseAccount.name}" is no longer active.`, {});
  }

  const amount = round2(input.amount);
  const remaining = expenseRemainingAmount(expense);
  if (amount > remaining + AMOUNT_EPSILON) {
    throw new BusinessRuleError(
      "OVER_PAYMENT_NOT_ALLOWED",
      `Payment of ${amount.toFixed(2)} is more than the ${remaining.toFixed(2)} still to pay on ${expense.expenseNumber}.`,
      { remaining, requested: amount }
    );
  }

  const paymentType = await FinanceConfigRepository.paymentType.findFirst({
    where: { id: input.paymentTypeId, companyId: actor.companyId },
  });
  if (!paymentType) throw new BusinessRuleError("NOT_FOUND", "Payment type not found.", { id: input.paymentTypeId });
  if (input.bankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId: actor.companyId },
    });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "Bank account not found.", { id: input.bankAccountId });
  }

  const needsAccrual = !expense.journalId;
  const taxAmountNum = Number(expense.taxAmount);
  const tdsAmountNum = Number(expense.tdsAmount);
  const cashOrBankAccountCode = paymentType.type === "CASH" ? "CASH" : "BANK";
  const [cashOrBankAccount, payableAccount, gstInputAccount, tdsPayableAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, cashOrBankAccountCode),
    ensureExpensesPayableAccount(actor.companyId),
    needsAccrual && taxAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC") : null,
    needsAccrual && tdsAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "TDS-PAY") : null,
  ]);
  if (!cashOrBankAccount) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      `The ${cashOrBankAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`,
      {}
    );
  }
  if (needsAccrual && taxAmountNum > 0 && !gstInputAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The GST Input Tax Credit control account is missing from the Chart of Accounts.", {});
  }
  if (needsAccrual && tdsAmountNum > 0 && !tdsPayableAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The TDS Payable control account is missing from the Chart of Accounts.", {});
  }

  // Numbers come from the expense's own branch series (an actor without a
  // branch would otherwise draw from a separate counter).
  const branchId = expense.branchId ?? null;
  const [paymentNumber, accrualJournalNumber, paymentJournalNumber] = await Promise.all([
    generateDocumentNumber({ companyId: actor.companyId, branchId, documentType: "EXPENSE_PAYMENT" }),
    needsAccrual ? generateDocumentNumber({ companyId: actor.companyId, branchId, documentType: "JOURNAL" }) : null,
    generateDocumentNumber({ companyId: actor.companyId, branchId, documentType: "JOURNAL" }),
  ]);
  const payable = round2(Number(expense.totalAmount) - tdsAmountNum);
  const paymentId = randomUUID();
  const paymentDate = new Date(input.paymentDate);

  try {
    await prisma.$transaction(async (tx) => {
      if (needsAccrual && accrualJournalNumber) {
        const lines = [
          {
            accountId: expenseAccount.id,
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
        lines.push({
          accountId: payableAccount.id,
          lineNumber: nextLineNumber++,
          debitAmount: 0,
          creditAmount: payable,
          description: `Expense ${expense.expenseNumber} — payable`,
        });

        const accrual = await tx.journal.create({
          data: {
            companyId: actor.companyId,
            branchId,
            journalNumber: accrualJournalNumber,
            journalDate: expense.expenseDate,
            status: "DRAFT",
            narration: `Auto-posted for Expense ${expense.expenseNumber}`,
            sourceModule: "EXPENSE",
            sourceRecordId: expense.id,
            createdByUserId: actor.userId,
            lines: { create: lines },
          },
        });
        await postJournalCore(tx, accrual.id, "DRAFT", actor.userId);

        const linked = await tx.expense.updateMany({ where: { id, journalId: null }, data: { journalId: accrual.id } });
        if (linked.count === 0) {
          throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Another payment was recorded at the same time — please retry.", {});
        }
      }

      const paymentJournal = await tx.journal.create({
        data: {
          companyId: actor.companyId,
          branchId,
          journalNumber: paymentJournalNumber,
          journalDate: paymentDate,
          status: "DRAFT",
          narration: `Payment ${paymentNumber} for Expense ${expense.expenseNumber}`,
          sourceModule: "EXPENSE_PAYMENT",
          sourceRecordId: paymentId,
          createdByUserId: actor.userId,
          lines: {
            create: [
              { accountId: payableAccount.id, lineNumber: 1, debitAmount: amount, creditAmount: 0, description: `Expense ${expense.expenseNumber}` },
              { accountId: cashOrBankAccount.id, lineNumber: 2, debitAmount: 0, creditAmount: amount, description: `Payment ${paymentNumber}` },
            ],
          },
        },
      });
      await postJournalCore(tx, paymentJournal.id, "DRAFT", actor.userId);

      // Guarded accumulator: never pays more than the net payable, even under a race.
      const { count } = await tx.expense.updateMany({
        where: { id, status: { in: PAYABLE_STATUSES }, paidAmount: { lte: round2(payable - amount + AMOUNT_EPSILON) } },
        data: { paidAmount: { increment: amount } },
      });
      if (count === 0) {
        throw new BusinessRuleError("OVER_PAYMENT_NOT_ALLOWED", "This payment would pay more than is still owed on the expense.", {});
      }

      const after = await tx.expense.findUniqueOrThrow({ where: { id }, select: { paidAmount: true } });
      const fullyPaid = Number(after.paidAmount) >= payable - AMOUNT_EPSILON;
      await tx.expense.update({
        where: { id },
        data: fullyPaid
          ? { status: "PAID", postedAt: new Date(), postedByUserId: actor.userId }
          : { status: "PARTIALLY_PAID" },
      });

      await tx.expensePayment.create({
        data: {
          id: paymentId,
          companyId: actor.companyId,
          branchId,
          expenseId: id,
          paymentNumber,
          paymentDate,
          amount,
          paymentTypeId: paymentType.id,
          bankAccountId: input.bankAccountId || null,
          referenceNumber: input.referenceNumber || null,
          notes: input.notes || null,
          journalId: paymentJournal.id,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    });
  } catch (err) {
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await ExpensePaymentRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return getExpenseById(actor, id);
    }
    throw err;
  }

  const updated = await getExpenseById(actor, id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "expense_payments",
    recordId: paymentId,
    action: "POST",
    newValues: { expenseNumber: expense.expenseNumber, paymentNumber, amount, status: updated.status },
  });

  return { ...updated, recordedPaymentId: paymentId };
}

/** Only from PENDING_APPROVAL or APPROVED — both pre-payment states, no
 * compensating entry needed since neither has touched the ledger yet (the
 * first payment does, and flips the status to PARTIALLY_PAID or PAID). Blocked once PAID (immutable, matching every
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

/**
 * "Upload Bill" (2026-10-23): the user uploads the bill and states its amount;
 * nothing else is required. The expense lands in PENDING_APPROVAL with no
 * expense account and no tax — the accountant fills those in via Edit before
 * approving (approveExpense refuses an expense with no account). The bill
 * files themselves are attached by the caller.
 */
export async function createBillUploadExpense(actor: ActorContext, input: BillUploadExpenseInput) {
  if (input.idempotencyKey) {
    const existing = await ExpenseRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  if (input.supplierId) {
    const supplier = await SupplierRepository.findById(actor.companyId, input.supplierId);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });
  }

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  const expenseNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "EXPENSE",
  });
  const amount = round2(input.amount);

  let expense;
  try {
    expense = await ExpenseRepository.create({
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      expenseNumber,
      expenseDate: new Date(input.expenseDate),
      description: input.description,
      supplierId: input.supplierId || null,
      referenceNumber: input.referenceNumber || null,
      amount,
      taxAmount: 0,
      totalAmount: amount,
      tdsAmount: 0,
      currencyCode: company.baseCurrencyCode,
      status: "PENDING_APPROVAL",
      source: "BILL_UPLOAD",
      createdByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (err) {
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
    newValues: { expenseNumber: expense.expenseNumber, totalAmount: expense.totalAmount, source: "BILL_UPLOAD" },
  });

  return expense;
}

/** Removes a bill-upload expense created moments ago when its files could not
 * be stored, so a half-made record is never left behind. Only ever called by
 * the upload-bill route right after createBillUploadExpense. */
export async function discardFailedBillUpload(companyId: string, id: string) {
  await prisma.expense.deleteMany({
    where: { id, companyId, source: "BILL_UPLOAD", status: "PENDING_APPROVAL", paidAmount: 0 },
  });
}

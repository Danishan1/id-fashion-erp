import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { EmployeeRepository } from "@/modules/employees/employee.repository";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { EmployeeAdvanceInput, EmployeeAdvanceSettlementInput } from "./employee-advance.schema";
import { EmployeeAdvanceRepository, EmployeeAdvanceSettlementRepository } from "./employee-advance.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { assertValidExpenseAccount } from "./chart-of-account.service";
import { TaxRateRepository } from "./tax-config.repository";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const AMOUNT_EPSILON = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listEmployeeAdvances(companyId: string, query: ListQuery) {
  const where: Prisma.EmployeeAdvanceWhereInput = {
    companyId,
    ...(query.search ? { advanceNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    EmployeeAdvanceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    EmployeeAdvanceRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getEmployeeAdvanceById(companyId: string, id: string) {
  const advance = await EmployeeAdvanceRepository.findByIdWithDetails(companyId, id);
  if (!advance) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { id });
  return advance;
}

export async function createEmployeeAdvance(actor: ActorContext, input: EmployeeAdvanceInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await EmployeeAdvanceRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const employee = await EmployeeRepository.findById(actor.companyId, input.employeeId);
  if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found.", { id: input.employeeId });

  const paymentType = await FinanceConfigRepository.paymentType.findFirst({ where: { id: input.paymentTypeId, companyId: actor.companyId } });
  if (!paymentType) throw new BusinessRuleError("NOT_FOUND", "Payment type not found.", { id: input.paymentTypeId });

  if (input.bankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: actor.companyId } });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "Bank account not found.", { id: input.bankAccountId });
  }

  const advanceNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "EMPLOYEE_ADVANCE",
  });

  let advance;
  try {
    advance = await EmployeeAdvanceRepository.create({
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      advanceNumber,
      advanceDate: new Date(input.advanceDate),
      employeeId: input.employeeId,
      amount: round2(input.amount),
      paymentTypeId: input.paymentTypeId,
      bankAccountId: input.bankAccountId || null,
      purpose: input.purpose || null,
      status: "DRAFT",
      createdByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await EmployeeAdvanceRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advances",
    recordId: advance.id,
    action: "CREATE",
    newValues: { advanceNumber: advance.advanceNumber, amount: advance.amount },
  });

  return advance;
}

/**
 * DRAFT -> ISSUED. Self-approval-guarded via "approve" on "expenses" (same
 * verb/module Expense's own postExpense uses — an advance is the same
 * class of cash-outflow decision). Dr Employee Advances (asset — money the
 * employee now owes back) / Cr Cash-or-Bank.
 */
export async function issueEmployeeAdvance(actor: ActorContext, id: string) {
  const advance = await EmployeeAdvanceRepository.findByIdWithDetails(actor.companyId, id);
  if (!advance) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { id });

  await PermissionService.assert(actor.userId, "expenses", "approve", { createdBy: advance.createdByUserId });

  if (advance.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot issue an advance in "${advance.status}" status.`, {
      currentStatus: advance.status,
    });
  }

  const cashOrBankAccountCode = advance.paymentType.type === "CASH" ? "CASH" : "BANK";
  const [cashOrBankAccount, empAdvanceAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, cashOrBankAccountCode),
    ChartOfAccountRepository.findByCode(actor.companyId, "EMP-ADV"),
  ]);
  if (!cashOrBankAccount) {
    throw new BusinessRuleError("NOT_FOUND", `The ${cashOrBankAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`, {});
  }
  if (!empAdvanceAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Employee Advances control account is missing from the Chart of Accounts.", {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  const amount = Number(advance.amount);

  await prisma.$transaction(async (tx) => {
    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: advance.advanceDate,
        status: "DRAFT",
        narration: `Auto-posted for Employee Advance ${advance.advanceNumber} (${advance.employee.fullName})`,
        sourceModule: null,
        createdByUserId: actor.userId,
        lines: {
          create: [
            { accountId: empAdvanceAccount.id, lineNumber: 1, debitAmount: amount, creditAmount: 0, description: `Advance ${advance.advanceNumber}` },
            { accountId: cashOrBankAccount.id, lineNumber: 2, debitAmount: 0, creditAmount: amount, description: `Advance ${advance.advanceNumber}` },
          ],
        },
      },
    });

    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.employeeAdvance.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "ISSUED", journalId: journal.id, postedAt: new Date() },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This advance is no longer in Draft status.", {});
    }
  });

  const updated = await EmployeeAdvanceRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advances",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "ISSUED", journalId: updated.journalId },
  });

  return updated;
}

/** Only from DRAFT — no compensating entry needed, since DRAFT never
 * touched the ledger at all (only issue does). */
export async function cancelEmployeeAdvance(actor: ActorContext, id: string) {
  const existing = await EmployeeAdvanceRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { id });

  const { count } = await EmployeeAdvanceRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel an advance in "${existing.status}" status.`, {
      currentStatus: existing.status,
    });
  }

  const updated = await EmployeeAdvanceRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advances",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

/**
 * Creates a DRAFT settlement line against an ISSUED/PARTIALLY_SETTLED
 * advance — validates the settlement amount doesn't exceed what's still
 * unsettled (amount - settledAmount), same as every other "remaining
 * balance" cap in this project.
 */
export async function createEmployeeAdvanceSettlement(actor: ActorContext, advanceId: string, input: EmployeeAdvanceSettlementInput) {
  const advance = await EmployeeAdvanceRepository.findAnyById(actor.companyId, advanceId);
  if (!advance) throw new BusinessRuleError("NOT_FOUND", "Employee advance not found.", { advanceId });

  if (advance.status !== "ISSUED" && advance.status !== "PARTIALLY_SETTLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot settle an advance in "${advance.status}" status.`, {
      currentStatus: advance.status,
    });
  }

  await assertValidExpenseAccount(actor.companyId, input.expenseAccountId);

  let taxPercentage: number | null = null;
  if (input.taxRateId) {
    const taxRate = await TaxRateRepository.findAnyById(actor.companyId, input.taxRateId);
    if (!taxRate) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id: input.taxRateId });
    taxPercentage = Number(taxRate.ratePercentage);
  }
  const amount = round2(input.amount);
  const taxAmount = taxPercentage ? round2((amount * taxPercentage) / 100) : 0;
  const totalAmount = round2(amount + taxAmount);

  const remaining = round2(Number(advance.amount) - Number(advance.settledAmount));
  if (totalAmount > remaining + AMOUNT_EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `This settlement (${totalAmount}) exceeds what's left to settle on this advance. Remaining: ${remaining}.`,
      { totalAmount, remaining }
    );
  }

  const settlementNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "EMPLOYEE_ADVANCE_SETTLEMENT",
  });

  const settlement = await EmployeeAdvanceSettlementRepository.create({
    companyId: actor.companyId,
    employeeAdvanceId: advanceId,
    settlementNumber,
    settlementDate: new Date(input.settlementDate),
    expenseAccountId: input.expenseAccountId,
    description: input.description,
    amount,
    taxRateId: input.taxRateId || null,
    taxPercentage,
    taxAmount,
    totalAmount,
    status: "DRAFT",
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advance_settlements",
    recordId: settlement.id,
    action: "CREATE",
    newValues: { settlementNumber: settlement.settlementNumber, totalAmount: settlement.totalAmount },
  });

  return settlement;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded via "approve" on "expenses" — the
 * same checkpoint as issuing the advance itself. Dr the chosen Expense
 * account (+ Dr GST-ITC if any) / Cr Employee Advances (reducing what the
 * employee owes back). Then a guarded increment of the parent advance's
 * settledAmount and a real-state (not just status-label) recompute of its
 * own status.
 */
export async function postEmployeeAdvanceSettlement(actor: ActorContext, settlementId: string) {
  const settlement = await prisma.employeeAdvanceSettlement.findFirst({
    where: { id: settlementId, companyId: actor.companyId },
    include: { expenseAccount: true, employeeAdvance: { include: { paymentType: true } } },
  });
  if (!settlement) throw new BusinessRuleError("NOT_FOUND", "Settlement not found.", { settlementId });

  await PermissionService.assert(actor.userId, "expenses", "approve", { createdBy: settlement.createdByUserId });

  if (settlement.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot post a settlement in "${settlement.status}" status.`, {
      currentStatus: settlement.status,
    });
  }
  if (settlement.employeeAdvance.status !== "ISSUED" && settlement.employeeAdvance.status !== "PARTIALLY_SETTLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The parent advance is no longer open for settlement.", {});
  }
  if (!settlement.expenseAccount.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${settlement.expenseAccount.name}" is no longer active.`, {});
  }

  const taxAmountNum = Number(settlement.taxAmount);
  const [empAdvanceAccount, gstInputAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, "EMP-ADV"),
    taxAmountNum > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC") : null,
  ]);
  if (!empAdvanceAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Employee Advances control account is missing from the Chart of Accounts.", {});
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
      { accountId: settlement.expenseAccountId, lineNumber: 1, debitAmount: Number(settlement.amount), creditAmount: 0, description: `Settlement ${settlement.settlementNumber}` },
    ];
    let nextLineNumber = 2;
    if (taxAmountNum > 0 && gstInputAccount) {
      lines.push({ accountId: gstInputAccount.id, lineNumber: nextLineNumber++, debitAmount: taxAmountNum, creditAmount: 0, description: `Settlement ${settlement.settlementNumber} — GST Input` });
    }
    lines.push({ accountId: empAdvanceAccount.id, lineNumber: nextLineNumber++, debitAmount: 0, creditAmount: Number(settlement.totalAmount), description: `Settlement ${settlement.settlementNumber}` });

    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        journalNumber,
        journalDate: settlement.settlementDate,
        status: "DRAFT",
        narration: `Auto-posted for Advance Settlement ${settlement.settlementNumber}`,
        sourceModule: null,
        createdByUserId: actor.userId,
        lines: { create: lines },
      },
    });

    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const settlementGuard = await tx.employeeAdvanceSettlement.updateMany({
      where: { id: settlementId, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date() },
    });
    if (settlementGuard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This settlement is no longer in Draft status.", {});
    }

    // Guarded on the exact settledAmount already read above — same
    // compare-and-swap idiom every other accumulator in this project uses.
    const advanceGuard = await tx.employeeAdvance.updateMany({
      where: { id: settlement.employeeAdvanceId, settledAmount: settlement.employeeAdvance.settledAmount },
      data: { settledAmount: { increment: Number(settlement.totalAmount) } },
    });
    if (advanceGuard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This advance was just updated by someone else — reload and try again.", {});
    }

    const refreshed = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: settlement.employeeAdvanceId } });
    const newSettledAmount = Number(refreshed.settledAmount);
    const advanceAmount = Number(refreshed.amount);
    await tx.employeeAdvance.update({
      where: { id: settlement.employeeAdvanceId },
      data: { status: newSettledAmount >= advanceAmount - AMOUNT_EPSILON ? "SETTLED" : "PARTIALLY_SETTLED" },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advance_settlements",
    recordId: settlementId,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED" },
  });

  return EmployeeAdvanceSettlementRepository.findAnyById(actor.companyId, settlementId);
}

/** Only from DRAFT — no ledger effect yet at that point. */
export async function cancelEmployeeAdvanceSettlement(actor: ActorContext, settlementId: string) {
  const existing = await EmployeeAdvanceSettlementRepository.findAnyById(actor.companyId, settlementId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Settlement not found.", { settlementId });

  const { count } = await EmployeeAdvanceSettlementRepository.updateStatusConditional(settlementId, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a settlement in "${existing.status}" status.`, {
      currentStatus: existing.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "employee_advance_settlements",
    recordId: settlementId,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return EmployeeAdvanceSettlementRepository.findAnyById(actor.companyId, settlementId);
}

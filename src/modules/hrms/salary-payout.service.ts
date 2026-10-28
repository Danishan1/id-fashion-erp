import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postJournalCore } from "@/modules/accounts/journal.service";
import { createPaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";
import { round2 } from "./attendance-calculator";
import type { SalaryAmounts } from "./salary-calculator";

/**
 * Salary Management slice 6 (2026-10-28, docs/hrms/SALARY_MANAGEMENT_PLAN.md):
 * "Send to Accounts" for a FINALISED salary run.
 *  1. One accrual journal for the month:
 *       Dr Salaries & Wages (balancing) + Dr Employer PF/ESIC
 *       Cr Salaries Payable (net) / PF Payable / ESIC Payable / TDS Payable
 *          / Salary Advance (installments recovered) / Salary Deductions Payable
 *  2. One SALARY payment request per employee with net > 0 (direct to the
 *     accountant; paying it posts Dr Salaries Payable / Cr Cash-Bank).
 * Step 2 is idempotent per employee, so sending again only raises what's missing.
 * Reopening the run first refuses if any salary was paid, then cancels the
 * requests and posts a reversing journal.
 */

export const SALARY_LINE_SOURCE = "SALARY_RUN_LINE";

export interface SalaryPayoutActor {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

type AccountKey = "EXPENSE" | "EMPLOYER_EXPENSE" | "SALARY_PAY" | "PF_PAY" | "ESIC_PAY" | "TDS_PAY" | "SAL_ADV" | "DED_PAY";

const ACCOUNTS: Record<AccountKey, { code: string; name: string; accountType: "ASSET" | "LIABILITY" | "EXPENSE" }> = {
  EXPENSE: { code: "EXP-SALARY", name: "Salaries & Wages", accountType: "EXPENSE" },
  EMPLOYER_EXPENSE: { code: "EXP-PF-ESIC", name: "Employer PF & ESIC Contribution", accountType: "EXPENSE" },
  SALARY_PAY: { code: "SALARY-PAY", name: "Salaries Payable", accountType: "LIABILITY" },
  PF_PAY: { code: "PF-PAY", name: "PF Payable", accountType: "LIABILITY" },
  ESIC_PAY: { code: "ESIC-PAY", name: "ESIC Payable", accountType: "LIABILITY" },
  TDS_PAY: { code: "TDS-PAY", name: "TDS Payable", accountType: "LIABILITY" },
  SAL_ADV: { code: "SAL-ADV", name: "Salary Advance to Employees", accountType: "ASSET" },
  DED_PAY: { code: "SAL-DED-PAY", name: "Salary Deductions Payable", accountType: "LIABILITY" },
};

export interface AccrualLine {
  key: AccountKey;
  debit: number;
  credit: number;
  description: string;
}

/**
 * The month's accrual from the stored line amounts. Salaries & Wages is the
 * balancing figure, so rupee rounding on earned gross / net never unbalances it.
 */
export function buildSalaryAccrualLines(amounts: SalaryAmounts[]): AccrualLine[] {
  const sum = (f: (a: SalaryAmounts) => number) => round2(amounts.reduce((s, a) => s + f(a), 0));
  const net = sum((a) => a.net);
  const pfEmployee = sum((a) => a.pf);
  const pfEmployer = sum((a) => a.pfEmployer ?? 0);
  const esicEmployee = sum((a) => a.esic);
  const esicEmployer = sum((a) => a.esicEmployer ?? 0);
  const taxes = sum((a) => a.tds + a.surcharge + a.educationCess + a.lateFeeInterest);
  const installments = sum((a) => a.installment);
  const otherDeductions = sum((a) => a.otherDeductions);

  const credits: AccrualLine[] = [
    { key: "SALARY_PAY", debit: 0, credit: net, description: "Net salary payable" },
    { key: "PF_PAY", debit: 0, credit: round2(pfEmployee + pfEmployer), description: "PF (employee + employer)" },
    { key: "ESIC_PAY", debit: 0, credit: round2(esicEmployee + esicEmployer), description: "ESIC (employee + employer)" },
    { key: "TDS_PAY", debit: 0, credit: taxes, description: "TDS, surcharge, cess and late-fee interest" },
    { key: "SAL_ADV", debit: 0, credit: installments, description: "Advance salary recovered" },
    { key: "DED_PAY", debit: 0, credit: otherDeductions, description: "Other salary deductions" },
  ];
  const employer = round2(pfEmployer + esicEmployer);
  const totalCredit = round2(credits.reduce((s, l) => s + l.credit, 0));
  const lines: AccrualLine[] = [
    { key: "EXPENSE", debit: round2(totalCredit - employer), credit: 0, description: "Salaries & wages for the month" },
    { key: "EMPLOYER_EXPENSE", debit: employer, credit: 0, description: "Employer PF & ESIC" },
    ...credits,
  ];
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}

async function ensureAccounts(tx: Prisma.TransactionClient, companyId: string) {
  const ids = {} as Record<AccountKey, string>;
  for (const [key, a] of Object.entries(ACCOUNTS) as [AccountKey, (typeof ACCOUNTS)[AccountKey]][]) {
    const row = await tx.chartOfAccount.upsert({
      where: { companyId_code: { companyId, code: a.code } },
      update: {},
      create: { companyId, code: a.code, name: a.name, accountType: a.accountType, isSystemAccount: true },
      select: { id: true },
    });
    ids[key] = row.id;
  }
  return ids;
}

async function postJournal(
  tx: Prisma.TransactionClient,
  actor: SalaryPayoutActor,
  run: { id: string },
  journalNumber: string,
  journalDate: Date,
  narration: string,
  lines: { accountId: string; debitAmount: number; creditAmount: number; description: string }[]
) {
  const journal = await tx.journal.create({
    data: {
      companyId: actor.companyId,
      branchId: actor.branchId ?? null,
      journalNumber,
      journalDate,
      status: "DRAFT",
      narration,
      sourceModule: "SALARY_RUN",
      sourceRecordId: run.id,
      createdByUserId: actor.userId,
      lines: { create: lines.map((l, i) => ({ ...l, lineNumber: i + 1 })) },
    },
  });
  await postJournalCore(tx, journal.id, "DRAFT", actor.userId);
  return journal.id;
}

const monthLabel = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Salary is due on the 7th of the following month. */
function dueDate(year: number, month: number) {
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 7)).toISOString().slice(0, 10);
}

export async function sendSalaryRunToAccounts(actor: SalaryPayoutActor, runId: string) {
  await PermissionService.assert(actor.userId, "hrms_salary_generate", "post");
  const run = await prisma.salaryRun.findFirst({
    where: { id: runId, companyId: actor.companyId },
    include: { lines: { select: { id: true, employeeId: true, employeeName: true, netAmount: true, amountsJson: true } } },
  });
  if (!run) throw new BusinessRuleError("NOT_FOUND", "Salary run not found.", { id: runId });
  if (run.status !== "FINALISED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a finalised salary can be sent to Accounts.");

  // 1. Accrual journal, once.
  if (!run.sentToAccountsAt) {
    const accrual = buildSalaryAccrualLines(run.lines.map((l) => l.amountsJson as unknown as SalaryAmounts));
    const journalNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: actor.branchId ?? null, documentType: "JOURNAL" });
    const lastDay = new Date(Date.UTC(run.year, run.month, 0));
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.salaryRun.updateMany({
        where: { id: run.id, status: "FINALISED", sentToAccountsAt: null },
        data: { sentToAccountsAt: new Date(), sentToAccountsByUserId: actor.userId },
      });
      if (claimed.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This salary was just sent by someone else — reload.");
      const ids = await ensureAccounts(tx, actor.companyId);
      const journalId = accrual.length
        ? await postJournal(
            tx,
            actor,
            run,
            journalNumber,
            lastDay,
            `Salary for ${monthLabel(run.year, run.month)}`,
            accrual.map((l) => ({ accountId: ids[l.key], debitAmount: l.debit, creditAmount: l.credit, description: l.description }))
          )
        : null;
      await tx.salaryRun.update({ where: { id: run.id }, data: { accrualJournalId: journalId } });
      await tx.salaryRunEvent.create({ data: { runId: run.id, action: "SENT_TO_ACCOUNTS", userId: actor.userId } });
    });
  }

  // 2. One payment request per employee (idempotent: a re-send only raises what's missing).
  const failed: { employeeName: string; error: string }[] = [];
  let created = 0;
  // Part of the idempotency key, so a run reopened and sent again raises fresh requests (the old ones were cancelled).
  const { sentToAccountsAt } = await prisma.salaryRun.findUniqueOrThrow({ where: { id: run.id }, select: { sentToAccountsAt: true } });
  const sendKey = sentToAccountsAt?.getTime() ?? 0;
  const raised = new Set((await salaryRequestsForRun(actor.companyId, run.lines.map((l) => l.id))).filter((r) => r.status !== "CANCELLED").map((r) => r.sourceRecordId));
  for (const line of run.lines) {
    const net = Number(line.netAmount);
    if (net <= 0 || raised.has(line.id)) continue;
    try {
      await createPaymentRequest(
        { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
        {
          requestType: "SALARY",
          amount: net,
          employeeId: line.employeeId,
          paymentDueDate: dueDate(run.year, run.month),
          remark: `Salary for ${monthLabel(run.year, run.month)}`,
          idempotencyKey: `salary:${run.id}:${line.employeeId}:${sendKey}`,
        },
        { fromSource: true, source: { module: SALARY_LINE_SOURCE, recordId: line.id } }
      );
      created++;
    } catch (err) {
      failed.push({ employeeName: line.employeeName, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_runs", recordId: run.id, action: "POST", newValues: { sentToAccounts: true, requests: created, failed: failed.length } });
  return { requests: created, failed };
}

/** The run's salary payment requests, by status (for the Generate Salary page). */
export async function salaryRequestsForRun(companyId: string, lineIds: string[]) {
  if (lineIds.length === 0) return [];
  return prisma.paymentRequest.findMany({
    where: { companyId, sourceModule: SALARY_LINE_SOURCE, sourceRecordId: { in: lineIds } },
    select: { id: true, requestNumber: true, status: true, amount: true, paidAmount: true, sourceRecordId: true },
  });
}

/**
 * Reopen support (called inside reopen's transaction): refuses once any
 * salary was paid; otherwise cancels the open salary requests and posts a
 * journal reversing the accrual.
 */
export async function undoSendToAccountsInTx(
  tx: Prisma.TransactionClient,
  actor: SalaryPayoutActor,
  run: { id: string; year: number; month: number; accrualJournalId: string | null },
  lineIds: string[],
  reversalNumber: string | null
) {
  const requests = await tx.paymentRequest.findMany({
    where: { companyId: actor.companyId, sourceModule: SALARY_LINE_SOURCE, sourceRecordId: { in: lineIds } },
    select: { id: true, requestNumber: true, status: true, paidAmount: true },
  });
  const paid = requests.filter((r) => Number(r.paidAmount) > 0 || r.status === "PAID" || r.status === "PARTIALLY_PAID");
  if (paid.length > 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Salary has already been paid (${paid.map((r) => r.requestNumber).slice(0, 3).join(", ")}${paid.length > 3 ? "…" : ""}) — it can't be reopened.`);
  }
  await tx.paymentRequest.updateMany({
    where: { id: { in: requests.map((r) => r.id) }, status: { in: ["PENDING_APPROVAL", "APPROVED"] }, paidAmount: 0 },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: actor.userId },
  });
  if (run.accrualJournalId && reversalNumber) {
    const original = await tx.journalLine.findMany({ where: { journalId: run.accrualJournalId }, orderBy: { lineNumber: "asc" } });
    await postJournal(
      tx,
      actor,
      run,
      reversalNumber,
      new Date(),
      `Reversal — salary for ${monthLabel(run.year, run.month)} reopened`,
      original.map((l) => ({ accountId: l.accountId, debitAmount: Number(l.creditAmount), creditAmount: Number(l.debitAmount), description: `Reversal: ${l.description ?? ""}` }))
    );
  }
  await tx.salaryRun.update({ where: { id: run.id }, data: { sentToAccountsAt: null, sentToAccountsByUserId: null, accrualJournalId: null } });
}

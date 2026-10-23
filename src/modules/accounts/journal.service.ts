import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { round2 } from "@/lib/money";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import type { JournalInput, ReverseJournalInput } from "./journal.schema";
import { JournalRepository } from "./journal.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { JournalStatus, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

type LineInput = { accountId: string; debitAmount: number; creditAmount: number; description?: string | null };

function toLineRows(lines: LineInput[]) {
  return lines.map((line, index) => ({
    accountId: line.accountId,
    debitAmount: line.debitAmount || 0,
    creditAmount: line.creditAmount || 0,
    description: line.description || null,
    lineNumber: index + 1,
  }));
}

async function assertAccountsBelongToCompany(companyId: string, lines: LineInput[]) {
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await Promise.all(accountIds.map((id) => ChartOfAccountRepository.findAnyById(companyId, id)));
  const missing = accountIds.filter((_, i) => !accounts[i]);
  if (missing.length > 0) {
    throw new BusinessRuleError("NOT_FOUND", "One or more accounts were not found.", { accountIds: missing });
  }
}

const VALID_JOURNAL_STATUSES = new Set<string>(Object.values(JournalStatus));

export async function listJournals(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.JournalWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { journalNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_JOURNAL_STATUSES.has(query.status) ? { status: query.status as JournalStatus } : {}),
  };

  const [data, totalCount] = await Promise.all([
    JournalRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    JournalRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a journal outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getJournalById(actor: { companyId: string; userId: string }, id: string) {
  const journal = await JournalRepository.findByIdWithDetails(actor.companyId, id);
  if (!journal) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!journal.branchId || !allowedBranchIds.has(journal.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });
  }

  return journal;
}

export async function createJournal(actor: ActorContext, input: JournalInput) {
  await assertAccountsBelongToCompany(actor.companyId, input.lines);

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  const journal = await JournalRepository.createWithLines(
    {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      journalNumber,
      journalDate: new Date(input.journalDate),
      status: "DRAFT",
      narration: input.narration || null,
      createdByUserId: actor.userId,
    },
    toLineRows(input.lines)
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: journal.id,
    action: "CREATE",
    newValues: { journalNumber: journal.journalNumber, lineCount: input.lines.length },
  });

  return journal;
}

/** Editable only while DRAFT — once POSTED, a journal is an immutable historical fact; corrections are reversals. */
export async function updateJournal(actor: ActorContext, id: string, input: JournalInput) {
  const existing = await JournalRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  if (existing.status !== "DRAFT") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot edit a journal in "${existing.status}" status — post a reversing journal instead.`,
      { currentStatus: existing.status }
    );
  }

  await assertAccountsBelongToCompany(actor.companyId, input.lines);

  const updated = await JournalRepository.replaceLines(
    id,
    { journalDate: new Date(input.journalDate), narration: input.narration || null },
    toLineRows(input.lines)
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: id,
    action: "UPDATE",
    newValues: { lineCount: input.lines.length },
  });

  return updated;
}

/**
 * The shared "recompute balance from a fresh read + guarded status flip"
 * core, run inside the caller's own transaction. Never trusts a
 * client-submitted total. No permission check here — callers decide whether
 * (and how) to gate this: postJournal() gates it with the public,
 * self-approval-guarded "post" action; reverseJournal()'s internal auto-post
 * of its own newly-created reversal deliberately does NOT call this wrapped
 * in a permission check, since the outer reverseJournal() call already
 * authorized the whole operation via the "cancel" action, and the reversal's
 * createdByUserId is unavoidably always the actor — routing it back through
 * the self-approval-guarded public path would make reversal unusable for
 * anyone but SUPER_ADMIN.
 *
 * Exported for reuse by other modules that auto-generate-and-post a Journal
 * as a trusted side effect of their own already-authorized action (e.g.
 * Sales Invoice posting) — same reasoning as reverseJournal()'s own use.
 */
export async function postJournalCore(
  tx: Prisma.TransactionClient,
  journalId: string,
  expectedStatus: JournalStatus,
  postedByUserId: string
) {
  const sums = await tx.journalLine.aggregate({
    where: { journalId },
    _sum: { debitAmount: true, creditAmount: true },
  });
  const totalDebit = Number(sums._sum.debitAmount ?? 0);
  const totalCredit = Number(sums._sum.creditAmount ?? 0);

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new BusinessRuleError(
      "UNBALANCED_JOURNAL",
      `Total debit (${totalDebit.toFixed(2)}) does not equal total credit (${totalCredit.toFixed(2)}).`,
      { totalDebit, totalCredit }
    );
  }

  const { count } = await tx.journal.updateMany({
    where: { id: journalId, status: expectedStatus },
    data: { status: "POSTED", totalDebit, totalCredit, postedAt: new Date(), postedByUserId },
  });

  if (count === 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot post a journal that is no longer in "${expectedStatus}" status.`,
      {}
    );
  }
}

/**
 * DRAFT -> POSTED. Deliberately self-approval-guarded (via the "post" action,
 * already in PermissionService's SELF_APPROVAL_GUARDED_ACTIONS list) — a
 * journal moving real ledger balances deserves the same maker/checker rigor
 * as a Payment approval, even though it means a solo ACCOUNTS_MANAGER cannot
 * post their own manually-created journal (only SUPER_ADMIN or a second
 * ACCOUNTS_MANAGER can).
 */
export async function postJournal(actor: ActorContext, id: string) {
  const journal = await JournalRepository.findAnyById(actor.companyId, id);
  if (!journal) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  await PermissionService.assert(actor.userId, "accounts", "post", { createdBy: journal.createdByUserId });

  if (journal.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot post a journal in "${journal.status}" status.`, {
      currentStatus: journal.status,
    });
  }

  await prisma.$transaction((tx) => postJournalCore(tx, id, "DRAFT", actor.userId));
  const updated = await JournalRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: id,
    action: "POST",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", totalDebit: updated.totalDebit, totalCredit: updated.totalCredit },
  });

  return updated;
}

/** Only from DRAFT — once POSTED, cancellation isn't offered at all (reverse instead). */
export async function cancelJournal(actor: ActorContext, id: string) {
  const journal = await JournalRepository.findAnyById(actor.companyId, id);
  if (!journal) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  const { count } = await JournalRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a journal in "${journal.status}" status.`, {
      currentStatus: journal.status,
    });
  }

  const updated = await JournalRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

/**
 * Creates a new journal with every line's debit/credit flipped, auto-posts
 * it, and links it back via reversalOfJournalId. The ORIGINAL journal's own
 * status never changes — it stays POSTED forever, since a posted journal is
 * an immutable historical accounting fact, not something that "un-happens."
 * Gated on the existing "cancel" action (there is no "reverse" action in the
 * closed ACTIONS union, and cancel already matches "gated to Accounts
 * Manager+" per CLAUDE.md, since ACCOUNTS_EXECUTIVE lacks it).
 */
export async function reverseJournal(actor: ActorContext, id: string, input: ReverseJournalInput) {
  await PermissionService.assert(actor.userId, "accounts", "cancel");

  const original = await JournalRepository.findByIdWithDetails(actor.companyId, id);
  if (!original) throw new BusinessRuleError("NOT_FOUND", "Journal not found.", { id });

  if (original.status !== "POSTED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot reverse a journal in "${original.status}" status — only a POSTED journal can be reversed.`,
      { currentStatus: original.status }
    );
  }

  // Payment's paidAmount (and, by extension, its invoice's PAID/
  // PARTIALLY_PAID status) is load-bearing — it's derived from the ledger
  // and directly gates the next payment via OVER_PAYMENT_NOT_ALLOWED, so a
  // generic ledger-only reversal would desync it. But that's not the whole
  // rule: every auto-posting document type (Sales/Purchase Invoice,
  // Expense) is blocked too, even where there's no accumulator to desync,
  // because the real invariant this guard protects is simpler and applies
  // uniformly — an auto-posting document's own status/journalId must never
  // silently disagree with its actual ledger impact. "Document-sourced
  // journals aren't reversible; manual journals are" is the whole rule, not
  // "only block it where something would break" — carving out an exception
  // per document type would just make the next reader re-derive this each
  // time. Correcting a mistake in any of these documents requires a manual
  // adjusting journal entry until a future Credit-Note/reversal-workflow
  // slice exists.
  if (
    original.sourceModule === "PAYMENT" ||
    original.sourceModule === "SALES_INVOICE" ||
    original.sourceModule === "PURCHASE_INVOICE" ||
    original.sourceModule === "EXPENSE" ||
    original.sourceModule === "EXPENSE_PAYMENT"
  ) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot reverse a journal auto-posted by ${original.sourceModule.replaceAll("_", " ").toLowerCase()} — no correction path exists yet for this document type.`,
      { sourceModule: original.sourceModule }
    );
  }

  // Previously relied solely on the DB's own `@unique` constraint on
  // reversalOfJournalId to prevent a second reversal — correct for data
  // integrity (confirmed: never more than one reversal exists), but the
  // resulting P2002 propagated as a raw 500 instead of a clean business
  // error, including under a genuine two-concurrent-reversal race. This
  // explicit pre-check gives the common (non-racing) case a proper 409; the
  // DB constraint remains the real, race-safe backstop.
  if (original.reversedByJournal) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `This journal has already been reversed by ${original.reversedByJournal.journalNumber}.`,
      { reversedByJournalId: original.reversedByJournal.id }
    );
  }

  const reversalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  const reversal = await prisma.$transaction(async (tx) => {
    const created = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber: reversalNumber,
        journalDate: new Date(),
        status: "DRAFT",
        narration: input.narration || `Reversal of ${original.journalNumber}`,
        sourceModule: original.sourceModule,
        sourceRecordId: original.sourceRecordId,
        createdByUserId: actor.userId,
        reversalOfJournalId: original.id,
        lines: {
          create: original.lines.map((line, index) => ({
            accountId: line.accountId,
            debitAmount: line.creditAmount,
            creditAmount: line.debitAmount,
            description: line.description,
            lineNumber: index + 1,
          })),
        },
      },
    });

    // Internal auto-post — no PermissionService call here (see postJournalCore's
    // doc comment): the outer reverseJournal() call already authorized this
    // whole operation via the "cancel" action above.
    await postJournalCore(tx, created.id, "DRAFT", actor.userId);

    return tx.journal.findFirstOrThrow({ where: { id: created.id } });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: reversal.id,
    action: "CREATE",
    newValues: { journalNumber: reversal.journalNumber, reversalOfJournalId: original.id },
  });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: reversal.id,
    action: "POST",
    newValues: { status: "POSTED" },
  });
  // Informational row against the original — no column on it actually
  // changed (its status stays POSTED forever), but this anchors the
  // reversal event on the original's own audit trail too.
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "journals",
    recordId: original.id,
    action: "UPDATE",
    newValues: { reversedByJournalId: reversal.id },
  });

  const updatedOriginal = await JournalRepository.findByIdWithDetails(actor.companyId, id);
  return { original: updatedOriginal, reversal: await JournalRepository.findByIdWithDetails(actor.companyId, reversal.id) };
}

/**
 * Per-account debit/credit totals across every POSTED journal line, as of an
 * optional date. A reversed journal's lines are the exact debit/credit swap
 * of the original, so summing all POSTED lines nets them to zero
 * automatically — no "exclude reversed journals" filter needed.
 */
export async function getTrialBalance(companyId: string, asOfDate?: string) {
  const sums = await ChartOfAccountRepository.sumPostedLinesByAccount(companyId, asOfDate ? new Date(asOfDate) : undefined);
  const sumsByAccountId = new Map(sums.map((s) => [s.accountId, s]));

  const accounts = await ChartOfAccountRepository.findMany({ companyId }, { orderBy: { code: "asc" } });

  const rows = accounts.map((account) => {
    const sum = sumsByAccountId.get(account.id);
    const totalDebit = round2(Number(sum?._sum.debitAmount ?? 0));
    const totalCredit = round2(Number(sum?._sum.creditAmount ?? 0));
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      accountType: account.accountType,
      totalDebit,
      totalCredit,
      netBalance: round2(totalDebit - totalCredit),
    };
  });

  const grandTotalDebit = round2(rows.reduce((sum, r) => sum + r.totalDebit, 0));
  const grandTotalCredit = round2(rows.reduce((sum, r) => sum + r.totalCredit, 0));

  return { rows, grandTotalDebit, grandTotalCredit };
}

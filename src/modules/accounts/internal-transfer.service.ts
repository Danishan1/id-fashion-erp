import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import type { Prisma } from "@prisma/client";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { InternalTransferInput } from "./internal-transfer.schema";
import { InternalTransferRepository } from "./internal-transfer.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listInternalTransfers(companyId: string, query: ListQuery) {
  const where: Prisma.InternalTransferWhereInput = {
    companyId,
    ...(query.search ? { transferNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    InternalTransferRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    InternalTransferRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getInternalTransferById(companyId: string, id: string) {
  const transfer = await InternalTransferRepository.findByIdWithDetails(companyId, id);
  if (!transfer) throw new BusinessRuleError("NOT_FOUND", "Internal transfer not found.", { id });
  return transfer;
}

export async function createInternalTransfer(actor: ActorContext, input: InternalTransferInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await InternalTransferRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const [fromPaymentType, toPaymentType] = await Promise.all([
    FinanceConfigRepository.paymentType.findFirst({ where: { id: input.fromPaymentTypeId, companyId: actor.companyId } }),
    FinanceConfigRepository.paymentType.findFirst({ where: { id: input.toPaymentTypeId, companyId: actor.companyId } }),
  ]);
  if (!fromPaymentType) throw new BusinessRuleError("NOT_FOUND", "From account not found.", { id: input.fromPaymentTypeId });
  if (!toPaymentType) throw new BusinessRuleError("NOT_FOUND", "To account not found.", { id: input.toPaymentTypeId });

  // This Chart of Accounts has exactly one CASH and one BANK control
  // account (not one per physical bank account — see the schema's own
  // comment on this model). A transfer between two same-typed payment
  // types would resolve to the identical GL account on both sides, making
  // the journal a Dr X / Cr X no-op — rejected here rather than silently
  // posting a meaningless entry.
  if (fromPaymentType.type === toPaymentType.type) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Cannot transfer between two "${fromPaymentType.type}"-type accounts — this Chart of Accounts has one control account per type (Cash or Bank), so both sides would resolve to the same account. Transfer between a Cash-type and a Bank-type account instead.`,
      { fromType: fromPaymentType.type, toType: toPaymentType.type }
    );
  }

  if (input.fromBankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({ where: { id: input.fromBankAccountId, companyId: actor.companyId } });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "From bank account not found.", { id: input.fromBankAccountId });
  }
  if (input.toBankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({ where: { id: input.toBankAccountId, companyId: actor.companyId } });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "To bank account not found.", { id: input.toBankAccountId });
  }

  const transferNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "INTERNAL_TRANSFER",
  });

  let transfer;
  try {
    transfer = await InternalTransferRepository.create({
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      transferNumber,
      transferDate: new Date(input.transferDate),
      fromPaymentTypeId: input.fromPaymentTypeId,
      fromBankAccountId: input.fromBankAccountId || null,
      toPaymentTypeId: input.toPaymentTypeId,
      toBankAccountId: input.toBankAccountId || null,
      amount: round2(input.amount),
      narration: input.narration || null,
      status: "DRAFT",
      createdByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await InternalTransferRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "internal_transfers",
    recordId: transfer.id,
    action: "CREATE",
    newValues: { transferNumber: transfer.transferNumber, amount: transfer.amount },
  });

  return transfer;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded via "post" on the "accounts"
 * module — same verb Journal's own postJournal() uses, since this is a
 * manual balance-sheet-only journal in every respect except that its two
 * lines are derived from the from/to accounts instead of user-entered.
 */
export async function postInternalTransfer(actor: ActorContext, id: string) {
  const transfer = await InternalTransferRepository.findByIdWithDetails(actor.companyId, id);
  if (!transfer) throw new BusinessRuleError("NOT_FOUND", "Internal transfer not found.", { id });

  await PermissionService.assert(actor.userId, "accounts", "post", { createdBy: transfer.createdByUserId });

  if (transfer.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot post a transfer in "${transfer.status}" status.`, {
      currentStatus: transfer.status,
    });
  }

  const fromAccountCode = transfer.fromPaymentType.type === "CASH" ? "CASH" : "BANK";
  const toAccountCode = transfer.toPaymentType.type === "CASH" ? "CASH" : "BANK";
  const [fromAccount, toAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, fromAccountCode),
    ChartOfAccountRepository.findByCode(actor.companyId, toAccountCode),
  ]);
  if (!fromAccount) {
    throw new BusinessRuleError("NOT_FOUND", `The ${fromAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`, {});
  }
  if (!toAccount) {
    throw new BusinessRuleError("NOT_FOUND", `The ${toAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`, {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  const amount = Number(transfer.amount);

  await prisma.$transaction(async (tx) => {
    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: transfer.transferDate,
        status: "DRAFT",
        narration: `Auto-posted for Internal Transfer ${transfer.transferNumber}`,
        sourceModule: null,
        createdByUserId: actor.userId,
        lines: {
          create: [
            { accountId: toAccount.id, lineNumber: 1, debitAmount: amount, creditAmount: 0, description: `Transfer ${transfer.transferNumber}` },
            { accountId: fromAccount.id, lineNumber: 2, debitAmount: 0, creditAmount: amount, description: `Transfer ${transfer.transferNumber}` },
          ],
        },
      },
    });

    // Internal auto-post — no second PermissionService call (see
    // postJournalCore's doc comment): the outer "post" assertion above
    // already authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.internalTransfer.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This transfer is no longer in Draft status.", {});
    }
  });

  const updated = await InternalTransferRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Internal transfer not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "internal_transfers",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", journalId: updated.journalId },
  });

  return updated;
}

/** Only from DRAFT — no compensating entry needed, since DRAFT never touched
 * the ledger at all (only POST does). */
export async function cancelInternalTransfer(actor: ActorContext, id: string) {
  const existing = await InternalTransferRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Internal transfer not found.", { id });

  const { count } = await InternalTransferRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a transfer in "${existing.status}" status.`, {
      currentStatus: existing.status,
    });
  }

  const updated = await InternalTransferRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Internal transfer not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "internal_transfers",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

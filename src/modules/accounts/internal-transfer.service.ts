import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { InternalTransferStatus, type Prisma } from "@prisma/client";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { InternalTransferInput } from "./internal-transfer.schema";
import { InternalTransferRepository } from "./internal-transfer.repository";
import { resolveMoneyAccount } from "./money-account";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const VALID_INTERNAL_TRANSFER_STATUSES = new Set<string>(Object.values(InternalTransferStatus));

export async function listInternalTransfers(companyId: string, query: ListQuery) {
  const where: Prisma.InternalTransferWhereInput = {
    companyId,
    ...(query.search ? { transferNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_INTERNAL_TRANSFER_STATUSES.has(query.status)
      ? { status: query.status as InternalTransferStatus }
      : {}),
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

  if (input.fromBankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({ where: { id: input.fromBankAccountId, companyId: actor.companyId } });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "From bank account not found.", { id: input.fromBankAccountId });
  }
  if (input.toBankAccountId) {
    const bankAccount = await FinanceConfigRepository.bankAccount.findFirst({ where: { id: input.toBankAccountId, companyId: actor.companyId } });
    if (!bankAccount) throw new BusinessRuleError("NOT_FOUND", "To bank account not found.", { id: input.toBankAccountId });
  }

  // Each financial account has its own ledger account (money-account.ts), so a
  // bank -> bank transfer is fine. Only a transfer whose two sides land on the
  // same ledger account (a Dr X / Cr X no-op) is refused.
  const [fromLedger, toLedger] = await Promise.all([
    resolveMoneyAccount(actor.companyId, fromPaymentType.type, input.fromBankAccountId || null),
    resolveMoneyAccount(actor.companyId, toPaymentType.type, input.toBankAccountId || null),
  ]);
  if (fromLedger.id === toLedger.id) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Both sides of this transfer post to the same ledger account (${fromLedger.code}). Pick a different bank / cash account on one side.`,
      { ledgerAccountCode: fromLedger.code }
    );
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

  const [fromAccount, toAccount] = await Promise.all([
    resolveMoneyAccount(actor.companyId, transfer.fromPaymentType.type, transfer.fromBankAccountId),
    resolveMoneyAccount(actor.companyId, transfer.toPaymentType.type, transfer.toBankAccountId),
  ]);
  if (fromAccount.id === toAccount.id) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Both sides of this transfer post to the same ledger account (${fromAccount.code}).`);
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

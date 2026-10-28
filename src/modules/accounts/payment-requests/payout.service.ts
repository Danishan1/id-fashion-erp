import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { round2 } from "@/lib/money";
import type { PaymentType, Prisma, RelatedModule } from "@prisma/client";
import { postJournalCore } from "../journal.service";
import { resolveMoneyAccount } from "../money-account";
import type { PaymentRequestPayoutInput } from "./payout.schema";
import { getPaymentRequestById } from "./payment-request.service";
import { getApproverIdentity } from "./approval-matrix.service";
import { PAYMENT_REQUEST_TYPE_DEFS, type PaymentRequestTypeKey } from "./request-type-registry";

/**
 * Accountant payout (2026-10-27): pays an APPROVED / PARTIALLY_PAID payment
 * request, fully or in part. Everything happens in ONE transaction: a guarded
 * paidAmount increment on the request (never more than the amount), the real
 * document for the request type, its journal (auto-posted through
 * postJournalCore) and the payout row. A lost race or any failure writes
 * nothing.
 *
 * Built for the types that can be raised today; every other type refuses
 * until its own skill adds a handler (see PAYOUT_HANDLERS).
 *
 * Who may pay: payment_requests.post, never the raiser (self-approval guard
 * on "post"), and — unless the request's Approval Matrix rule allows it —
 * never someone who approved one of its levels.
 */

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/** Types that are paid in one go (one transfer / deposit), never in parts. */
const FULL_PAYOUT_ONLY: ReadonlySet<PaymentRequestTypeKey> = new Set([
  "CASH_WITHDRAWAL",
  "FIXED_DEPOSIT",
  "RECURRING_DEPOSIT",
  "BANK_TRANSFER",
  "LOAN",
  "IMPREST",
]);

type Request = Awaited<ReturnType<typeof getPaymentRequestById>>;

interface PayoutContext {
  tx: Prisma.TransactionClient;
  actor: ActorContext;
  request: Request;
  input: PaymentRequestPayoutInput;
  amount: number;
  paymentType: PaymentType;
  /** The Cash or Bank control account the money leaves from. */
  moneyAccountId: string;
}

interface PayoutResult {
  journalId: string;
  paymentId?: string;
  internalTransferId?: string;
}

/** Find a control account by code, creating it on first use (for companies seeded before it existed). */
async function ensureControlAccount(
  tx: Prisma.TransactionClient,
  companyId: string,
  code: string,
  name: string,
  accountType: "ASSET" | "LIABILITY"
) {
  return tx.chartOfAccount.upsert({
    where: { companyId_code: { companyId, code } },
    update: {},
    create: { companyId, code, name, accountType, isSystemAccount: true },
  });
}

/** Creates a two-or-more-line journal and auto-posts it (the outer permission check already authorized this). */
async function postAutoJournalInTx(
  ctx: PayoutContext,
  journalNumber: string,
  narration: string,
  source: { module: RelatedModule; recordId: string },
  lines: { accountId: string; debitAmount: number; creditAmount: number; description: string }[]
) {
  const journal = await ctx.tx.journal.create({
    data: {
      companyId: ctx.actor.companyId,
      branchId: ctx.request.branchId ?? null,
      journalNumber,
      journalDate: new Date(ctx.input.paymentDate),
      status: "DRAFT",
      narration,
      sourceModule: source.module,
      sourceRecordId: source.recordId,
      createdByUserId: ctx.actor.userId,
      lines: { create: lines.map((l, i) => ({ ...l, lineNumber: i + 1 })) },
    },
  });
  await postJournalCore(ctx.tx, journal.id, "DRAFT", ctx.actor.userId);
  return journal.id;
}

type Handler = (ctx: PayoutContext, numbers: { journalNumber: string; documentNumber?: string }) => Promise<PayoutResult>;

/** Supplier advance: a real posted Payment (isAdvance) — Dr Advance to Suppliers / Cr Cash-Bank. */
const payToSupplierOnAccount: Handler = async (ctx, numbers) => {
  const { tx, actor, request, input, amount } = ctx;
  if (!request.supplierId) throw new BusinessRuleError("VALIDATION_ERROR", "This request has no supplier.");
  const supAdv = await ensureControlAccount(tx, actor.companyId, "SUP-ADV", "Advance to Suppliers", "ASSET");

  const payment = await tx.payment.create({
    data: {
      companyId: actor.companyId,
      branchId: request.branchId ?? null,
      paymentNumber: numbers.documentNumber!,
      direction: "PAYMENT_OUT",
      supplierId: request.supplierId,
      paymentDate: new Date(input.paymentDate),
      paymentTypeId: input.paymentTypeId,
      bankAccountId: input.bankAccountId || null,
      referenceNumber: input.referenceNumber || null,
      amount,
      isAdvance: true,
      status: "POSTED",
      currencyCode: request.currencyCode,
      postedAt: new Date(),
      postedByUserId: actor.userId,
      createdByUserId: actor.userId,
    },
  });
  const journalId = await postAutoJournalInTx(
    ctx,
    numbers.journalNumber,
    `Supplier advance ${payment.paymentNumber} for ${request.requestNumber}`,
    { module: "PAYMENT", recordId: payment.id },
    [
      { accountId: supAdv.id, debitAmount: amount, creditAmount: 0, description: `Advance to ${request.payToName}` },
      { accountId: ctx.moneyAccountId, debitAmount: 0, creditAmount: amount, description: `Payment ${payment.paymentNumber}` },
    ]
  );
  await tx.payment.update({ where: { id: payment.id }, data: { journalId } });
  return { journalId, paymentId: payment.id };
};

/** Cash withdrawal: a real posted InternalTransfer bank -> cash — Dr Cash / Cr Bank. */
const payCashWithdrawal: Handler = async (ctx, numbers) => {
  const { tx, actor, request, input, amount, paymentType } = ctx;
  if (paymentType.type === "CASH") {
    throw new BusinessRuleError("VALIDATION_ERROR", "A cash withdrawal is paid from a bank, not from cash.", { field: "paymentTypeId" });
  }
  if (!input.toPaymentTypeId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose the cash account the money goes into.", { field: "toPaymentTypeId" });
  }
  const toType = await tx.paymentType.findFirst({ where: { id: input.toPaymentTypeId, companyId: actor.companyId, isActive: true } });
  if (!toType || toType.type !== "CASH") {
    throw new BusinessRuleError("VALIDATION_ERROR", "The money must go into a Cash payment type.", { field: "toPaymentTypeId" });
  }
  const cash = await tx.chartOfAccount.findFirst({ where: { companyId: actor.companyId, code: "CASH" } });
  if (!cash) throw new BusinessRuleError("NOT_FOUND", "The Cash control account is missing from the Chart of Accounts.");

  const transfer = await tx.internalTransfer.create({
    data: {
      companyId: actor.companyId,
      branchId: request.branchId ?? null,
      transferNumber: numbers.documentNumber!,
      transferDate: new Date(input.paymentDate),
      fromPaymentTypeId: paymentType.id,
      fromBankAccountId: input.bankAccountId || null,
      toPaymentTypeId: toType.id,
      amount,
      narration: `Cash withdrawal for ${request.requestNumber} — ${request.payToName}`,
      status: "POSTED",
      postedAt: new Date(),
      postedByUserId: actor.userId,
      createdByUserId: actor.userId,
    },
  });
  const journalId = await postAutoJournalInTx(
    ctx,
    numbers.journalNumber,
    `Cash withdrawal ${transfer.transferNumber} for ${request.requestNumber}`,
    { module: "PAYMENT_REQUEST", recordId: request.id },
    [
      { accountId: cash.id, debitAmount: amount, creditAmount: 0, description: `Transfer ${transfer.transferNumber}` },
      { accountId: ctx.moneyAccountId, debitAmount: 0, creditAmount: amount, description: `Transfer ${transfer.transferNumber}` },
    ]
  );
  await tx.internalTransfer.update({ where: { id: transfer.id }, data: { journalId } });
  return { journalId, internalTransferId: transfer.id };
};

/**
 * Investment: Dr Investments / Cr Cash-Bank. One Investments control account
 * for now; per-investment accounts come with payment-request-financial-accounts.
 */
const payInvestment: Handler = async (ctx, numbers) => {
  const investments = await ensureControlAccount(ctx.tx, ctx.actor.companyId, "INVESTMENTS", "Investments", "ASSET");
  const journalId = await postAutoJournalInTx(
    ctx,
    numbers.journalNumber,
    `Investment payment for ${ctx.request.requestNumber} — ${ctx.request.payToName}`,
    { module: "PAYMENT_REQUEST", recordId: ctx.request.id },
    [
      { accountId: investments.id, debitAmount: ctx.amount, creditAmount: 0, description: `Investment — ${ctx.request.payToName}` },
      { accountId: ctx.moneyAccountId, debitAmount: 0, creditAmount: ctx.amount, description: `Payment ${ctx.request.requestNumber}` },
    ]
  );
  return { journalId };
};

/** Which document number a type's payout needs besides the journal number. */
const PAYOUT_HANDLERS: Partial<Record<PaymentRequestTypeKey, { handler: Handler; documentType?: "PAYMENT" | "INTERNAL_TRANSFER" }>> = {
  SUPPLIER_ON_ACCOUNT: { handler: payToSupplierOnAccount, documentType: "PAYMENT" },
  CASH_WITHDRAWAL: { handler: payCashWithdrawal, documentType: "INTERNAL_TRANSFER" },
  INVESTMENT: { handler: payInvestment },
};

/**
 * An approver may pay the same request only if its Approval Matrix rule says
 * so. Super Admin is exempt, the same override it has for self-approval and
 * for deciding any level (a one-person company must still be able to pay).
 */
export async function mayPayAfterApproving(
  userId: string,
  request: { approverMayPay: boolean; approvals: { userId: string; decision: string }[] }
) {
  if (request.approverMayPay) return true;
  if (!request.approvals.some((a) => a.userId === userId && a.decision === "APPROVED")) return true;
  return (await getApproverIdentity(userId)).isSuperAdmin;
}

export function canBePaidYet(requestType: PaymentRequestTypeKey) {
  return Boolean(PAYOUT_HANDLERS[requestType]);
}

export function remainingToPay(request: { amount: unknown; paidAmount: unknown }) {
  return round2(Number(request.amount) - Number(request.paidAmount));
}

export async function recordPaymentRequestPayout(actor: ActorContext, id: string, input: PaymentRequestPayoutInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.paymentRequestPayout.findFirst({
      where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (existing.paymentRequestId !== id) {
        throw new BusinessRuleError("VALIDATION_ERROR", "This payment key was already used for a different request.");
      }
      return getPaymentRequestById(actor, id);
    }
  }

  const request = await getPaymentRequestById(actor, id);
  await PermissionService.assert(actor.userId, "payment_requests", "post", { createdBy: request.createdByUserId });

  if (request.status !== "APPROVED" && request.status !== "PARTIALLY_PAID") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Only an approved request can be paid (this one is "${request.status}").`, {
      currentStatus: request.status,
    });
  }
  if (!(await mayPayAfterApproving(actor.userId, request))) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You approved this request, so someone else must pay it (Approval Matrix rule).");
  }

  const def = PAYMENT_REQUEST_TYPE_DEFS[request.requestType];
  const entry = PAYOUT_HANDLERS[request.requestType];
  if (!entry) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Paying a "${def.label}" is not available yet.`, { requestType: request.requestType });
  }

  const amount = round2(input.amount);
  const remaining = remainingToPay(request);
  if (amount - remaining > 0.005) {
    throw new BusinessRuleError("OVER_PAYMENT_NOT_ALLOWED", `Only ₹${remaining.toFixed(2)} is left to pay on this request.`, { remaining });
  }
  if (FULL_PAYOUT_ONLY.has(request.requestType) && Math.abs(amount - remaining) > 0.005) {
    throw new BusinessRuleError("VALIDATION_ERROR", `A "${def.label}" is paid in full — pay ₹${remaining.toFixed(2)}.`, { remaining });
  }

  const paymentType = await prisma.paymentType.findFirst({ where: { id: input.paymentTypeId, companyId: actor.companyId, isActive: true } });
  if (!paymentType) throw new BusinessRuleError("NOT_FOUND", "Payment type not found.", { id: input.paymentTypeId });
  const fromCash = paymentType.type === "CASH";
  if (!fromCash) {
    if (!input.bankAccountId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the bank account the money is paid from.", { field: "bankAccountId" });
    if (!input.referenceNumber) throw new BusinessRuleError("VALIDATION_ERROR", "Enter the UTR / cheque / reference number.", { field: "referenceNumber" });
    const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, companyId: actor.companyId, isActive: true } });
    if (!bank) throw new BusinessRuleError("NOT_FOUND", "Bank account not found.", { id: input.bankAccountId });
  }
  // The chosen bank's own ledger account, else Cash/Bank by the payment type's kind (money-account.ts).
  const moneyAccount = await resolveMoneyAccount(actor.companyId, paymentType.type, fromCash ? null : input.bankAccountId);

  const [journalNumber, documentNumber] = await Promise.all([
    generateDocumentNumber({ companyId: actor.companyId, branchId: request.branchId ?? null, documentType: "JOURNAL" }),
    entry.documentType
      ? generateDocumentNumber({ companyId: actor.companyId, branchId: request.branchId ?? null, documentType: entry.documentType })
      : Promise.resolve(undefined),
  ]);

  let payoutId: string;
  try {
    payoutId = await prisma.$transaction(async (tx) => {
      // Guarded increment: never pay more than the request's amount, even under a race.
      const { count } = await tx.paymentRequest.updateMany({
        where: { id, status: { in: ["APPROVED", "PARTIALLY_PAID"] }, paidAmount: { lte: round2(Number(request.amount) - amount) } },
        data: { paidAmount: { increment: amount } },
      });
      if (count === 0) {
        throw new BusinessRuleError("OVER_PAYMENT_NOT_ALLOWED", "This request was paid by someone else meanwhile. Reload it.");
      }
      const fresh = await tx.paymentRequest.findUniqueOrThrow({ where: { id }, select: { amount: true, paidAmount: true } });
      await tx.paymentRequest.update({
        where: { id },
        data: { status: Number(fresh.paidAmount) + 0.005 >= Number(fresh.amount) ? "PAID" : "PARTIALLY_PAID" },
      });

      const result = await entry.handler(
        { tx, actor, request, input, amount, paymentType, moneyAccountId: moneyAccount.id },
        { journalNumber, documentNumber }
      );

      const payout = await tx.paymentRequestPayout.create({
        data: {
          companyId: actor.companyId,
          paymentRequestId: id,
          paymentDate: new Date(input.paymentDate),
          amount,
          paymentTypeId: paymentType.id,
          bankAccountId: input.bankAccountId || null,
          referenceNumber: input.referenceNumber || null,
          notes: input.notes || null,
          journalId: result.journalId,
          paymentId: result.paymentId ?? null,
          internalTransferId: result.internalTransferId ?? null,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      return payout.id;
    });
  } catch (err) {
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await prisma.paymentRequestPayout.findFirst({
        where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return getPaymentRequestById(actor, id);
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "POST",
    oldValues: { status: request.status, paidAmount: request.paidAmount },
    newValues: { payoutId, amount, paymentTypeId: paymentType.id, referenceNumber: input.referenceNumber || null },
  });

  return getPaymentRequestById(actor, id);
}

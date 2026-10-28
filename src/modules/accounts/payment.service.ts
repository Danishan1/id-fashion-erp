import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { PaymentStatus, type Prisma } from "@prisma/client";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { FinanceConfigRepository } from "@/modules/finance-config/finance-config.repository";
import type { PaymentInput, PaymentAllocateInput } from "./payment.schema";
import { PaymentRepository, CompanyRepository } from "./payment.repository";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { PurchaseInvoiceRepository } from "./purchase-invoice.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { resolveMoneyAccount } from "./money-account";
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

const VALID_PAYMENT_STATUSES = new Set<string>(Object.values(PaymentStatus));

export async function listPayments(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.PaymentWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { paymentNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_PAYMENT_STATUSES.has(query.status) ? { status: query.status as PaymentStatus } : {}),
  };

  const [data, totalCount] = await Promise.all([
    PaymentRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    PaymentRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for a payment outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getPaymentById(actor: { companyId: string; userId: string }, id: string) {
  const payment = await PaymentRepository.findByIdWithDetails(actor.companyId, id);
  if (!payment) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!payment.branchId || !allowedBranchIds.has(payment.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });
  }

  return payment;
}

/**
 * Invoices with a real outstanding balance for the party a Receipt/Payment
 * Out would be allocated against — feeds the create-form's allocation
 * picker. RECEIPT looks at Sales Invoices for a Customer; PAYMENT_OUT looks
 * at Purchase Invoices for a Supplier.
 */
export async function listOutstandingInvoicesForParty(
  companyId: string,
  direction: "RECEIPT" | "PAYMENT_OUT",
  partyId: string
) {
  return direction === "RECEIPT"
    ? SalesInvoiceRepository.findOutstandingByCustomer(companyId, partyId)
    : PurchaseInvoiceRepository.findOutstandingBySupplier(companyId, partyId);
}

interface ValidatedAllocation {
  salesInvoiceId: string | null;
  purchaseInvoiceId: string | null;
  allocatedAmount: number;
  invoiceTotalAmount: number;
}

async function validateOneAllocation(
  companyId: string,
  direction: "RECEIPT" | "PAYMENT_OUT",
  partyId: string,
  allocation: PaymentInput["allocations"][number]
): Promise<ValidatedAllocation> {
  const invoiceId = direction === "RECEIPT" ? allocation.salesInvoiceId! : allocation.purchaseInvoiceId!;
  const invoice =
    direction === "RECEIPT"
      ? await SalesInvoiceRepository.findAnyById(companyId, invoiceId)
      : await PurchaseInvoiceRepository.findAnyById(companyId, invoiceId);

  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Invoice not found.", { id: invoiceId });

  const invoicePartyId = direction === "RECEIPT" ? (invoice as { customerId: string }).customerId : (invoice as { supplierId: string }).supplierId;
  if (invoicePartyId !== partyId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Invoice does not belong to the selected ${direction === "RECEIPT" ? "customer" : "supplier"}.`,
      { invoiceId }
    );
  }

  if (invoice.status !== "POSTED" && invoice.status !== "PARTIALLY_PAID") {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Cannot allocate a payment to an invoice in "${invoice.status}" status.`,
      { invoiceId, currentStatus: invoice.status }
    );
  }

  const outstanding = round2(Number(invoice.totalAmount) - Number(invoice.paidAmount));
  if (allocation.allocatedAmount > outstanding + AMOUNT_EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Cannot allocate ${allocation.allocatedAmount} to invoice — only ${outstanding} is outstanding.`,
      { invoiceId, requestedAmount: allocation.allocatedAmount, outstanding }
    );
  }

  return {
    salesInvoiceId: direction === "RECEIPT" ? invoiceId : null,
    purchaseInvoiceId: direction === "PAYMENT_OUT" ? invoiceId : null,
    allocatedAmount: round2(allocation.allocatedAmount),
    invoiceTotalAmount: Number(invoice.totalAmount),
  };
}

// Sum(allocations) may now be LESS than amount — the remainder sits
// unallocated ("On Account") until a later allocatePayment() call assigns
// it to real invoices as they arrive. Still never MORE than amount.
async function buildAndValidateAllocations(
  companyId: string,
  direction: "RECEIPT" | "PAYMENT_OUT",
  partyId: string,
  amount: number,
  allocations: PaymentInput["allocations"]
): Promise<ValidatedAllocation[]> {
  const rows: ValidatedAllocation[] = [];
  for (const allocation of allocations) {
    rows.push(await validateOneAllocation(companyId, direction, partyId, allocation));
  }

  const allocatedTotal = round2(rows.reduce((sum, r) => sum + r.allocatedAmount, 0));
  if (allocatedTotal > round2(amount) + AMOUNT_EPSILON) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Allocations (${allocatedTotal}) cannot exceed the payment amount (${round2(amount)}).`,
      { allocatedTotal, amount: round2(amount) }
    );
  }

  return rows;
}

/**
 * Applies one validated allocation's effect to its target invoice — the
 * exact logic postPayment() already ran per-allocation, extracted so
 * allocatePayment() (applying a payment's unallocated remainder to an
 * invoice AFTER the original post) can reuse it unchanged. No Journal entry
 * here in either case: postPayment's own transaction posts the settlement
 * Journal once, covering the payment's full amount — a later allocation is
 * pure bookkeeping (which invoice this already-moved cash counts against),
 * not a new cash movement.
 */
async function applyAllocationInTx(tx: Prisma.TransactionClient, allocation: ValidatedAllocation) {
  const allocatedAmount = allocation.allocatedAmount;

  if (allocation.salesInvoiceId) {
    const { count } = await tx.salesInvoice.updateMany({
      where: { id: allocation.salesInvoiceId, paidAmount: { lte: allocation.invoiceTotalAmount - allocatedAmount + AMOUNT_EPSILON } },
      data: { paidAmount: { increment: allocatedAmount } },
    });
    if (count === 0) {
      throw new BusinessRuleError(
        "OVER_PAYMENT_NOT_ALLOWED",
        "This invoice's outstanding balance changed and no longer covers this allocation.",
        { salesInvoiceId: allocation.salesInvoiceId }
      );
    }

    const fresh = await tx.salesInvoice.findUniqueOrThrow({
      where: { id: allocation.salesInvoiceId },
      select: { paidAmount: true, totalAmount: true },
    });
    await tx.salesInvoice.update({
      where: { id: allocation.salesInvoiceId },
      data: { status: Number(fresh.paidAmount) >= Number(fresh.totalAmount) - AMOUNT_EPSILON ? "PAID" : "PARTIALLY_PAID" },
    });
  } else {
    const { count } = await tx.purchaseInvoice.updateMany({
      where: { id: allocation.purchaseInvoiceId!, paidAmount: { lte: allocation.invoiceTotalAmount - allocatedAmount + AMOUNT_EPSILON } },
      data: { paidAmount: { increment: allocatedAmount } },
    });
    if (count === 0) {
      throw new BusinessRuleError(
        "OVER_PAYMENT_NOT_ALLOWED",
        "This invoice's outstanding balance changed and no longer covers this allocation.",
        { purchaseInvoiceId: allocation.purchaseInvoiceId }
      );
    }

    const fresh = await tx.purchaseInvoice.findUniqueOrThrow({
      where: { id: allocation.purchaseInvoiceId! },
      select: { paidAmount: true, totalAmount: true },
    });
    await tx.purchaseInvoice.update({
      where: { id: allocation.purchaseInvoiceId! },
      data: { status: Number(fresh.paidAmount) >= Number(fresh.totalAmount) - AMOUNT_EPSILON ? "PAID" : "PARTIALLY_PAID" },
    });
  }
}

export async function createPayment(actor: ActorContext, input: PaymentInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await PaymentRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const partyId = input.direction === "RECEIPT" ? input.customerId! : input.supplierId!;

  const party =
    input.direction === "RECEIPT"
      ? await CustomerRepository.findByIdWithBuyers(actor.companyId, partyId)
      : await SupplierRepository.findById(actor.companyId, partyId);
  if (!party) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      `${input.direction === "RECEIPT" ? "Customer" : "Supplier"} not found.`,
      { id: partyId }
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

  const allocationRows = await buildAndValidateAllocations(
    actor.companyId,
    input.direction,
    partyId,
    input.amount,
    input.allocations
  );

  const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  const paymentNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "PAYMENT",
  });

  let payment;
  try {
    payment = await PaymentRepository.createWithAllocations(
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        paymentNumber,
        direction: input.direction,
        customerId: input.direction === "RECEIPT" ? partyId : null,
        supplierId: input.direction === "PAYMENT_OUT" ? partyId : null,
        paymentDate: new Date(input.paymentDate),
        paymentTypeId: input.paymentTypeId,
        bankAccountId: input.bankAccountId || null,
        referenceNumber: input.referenceNumber || null,
        amount: round2(input.amount),
        status: "DRAFT",
        currencyCode: company.baseCurrencyCode,
        createdByUserId: actor.userId,
        idempotencyKey: input.idempotencyKey ?? null,
      },
      // Whitelisted down to the repository's real column shape — ValidatedAllocation
      // also carries invoiceTotalAmount (used only by applyAllocationInTx's own
      // in-memory guard), which is not a real PaymentAllocation column and must
      // never reach Prisma's create payload directly.
      allocationRows.map((r) => ({ salesInvoiceId: r.salesInvoiceId, purchaseInvoiceId: r.purchaseInvoiceId, allocatedAmount: r.allocatedAmount }))
    );
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await PaymentRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payments",
    recordId: payment.id,
    action: "CREATE",
    newValues: { paymentNumber: payment.paymentNumber, direction: payment.direction, amount: payment.amount },
  });

  return payment;
}

/**
 * DRAFT -> POSTED. Gated on "approve" (not "post" — payments' own RBAC grants
 * use "approve" as the real verb; ACCOUNTS_MANAGER has it, ACCOUNTS_EXECUTIVE
 * doesn't), self-approval-guarded via the same {createdBy} mechanism used
 * everywhere else (PermissionService already treats "approve" as a
 * self-approval-guarded action). One transaction: for each allocation, a
 * guarded conditional increment of the invoice's paidAmount — safe with the
 * plain Prisma updateMany idiom (no raw SQL needed) because the cap
 * (invoice.totalAmount) is frozen once POSTED and captured once, before the
 * transaction, as a JS literal. On guard success, a FRESH in-transaction
 * re-read of paidAmount followed by an UNCONDITIONAL status write (PAID or
 * PARTIALLY_PAID) — not a guarded conditional transition, since a second or
 * third partial payment has no single "expected prior status" to key
 * against (same idiom PurchaseOrder's own received-quantity status recompute
 * already uses in goods-receipt.service.ts). Then a settlement Journal via
 * postJournalCore, then a guarded conditional flip of this Payment.
 */
export async function postPayment(actor: ActorContext, id: string) {
  const payment = await PaymentRepository.findByIdWithDetails(actor.companyId, id);
  if (!payment) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  await PermissionService.assert(actor.userId, "payments", "approve", { createdBy: payment.createdByUserId });

  if (payment.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot post a payment in "${payment.status}" status.`, {
      currentStatus: payment.status,
    });
  }

  // Cash/Bank resolution is keyed off PaymentType.type (the PaymentTypeKind
  // enum), NEVER off PaymentType.code. PaymentType.code "BANK" (a seeded
  // payment-type code) and ChartOfAccount.code "BANK" are the same string in
  // two unrelated tables purely by coincidence — looking up
  // ChartOfAccount.findByCode(companyId, paymentType.code) directly would
  // silently return nothing for CHEQUE/CARD/UPI-typed payment types.
  const cashOrBankAccountCode = payment.paymentType.type === "CASH" ? "CASH" : "BANK";
  const [cashOrBankAccount, arAccount, apAccount] = await Promise.all([
    resolveMoneyAccount(actor.companyId, payment.paymentType.type, payment.bankAccountId),
    payment.direction === "RECEIPT" ? ChartOfAccountRepository.findByCode(actor.companyId, "AR") : null,
    payment.direction === "PAYMENT_OUT" ? ChartOfAccountRepository.findByCode(actor.companyId, "AP") : null,
  ]);
  if (!cashOrBankAccount) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      `The ${cashOrBankAccountCode === "CASH" ? "Cash" : "Bank"} control account is missing from the Chart of Accounts.`,
      {}
    );
  }
  if (payment.direction === "RECEIPT" && !arAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Accounts Receivable control account is missing from the Chart of Accounts.", {});
  }
  if (payment.direction === "PAYMENT_OUT" && !apAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Accounts Payable control account is missing from the Chart of Accounts.", {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  const amount = Number(payment.amount);

  await prisma.$transaction(async (tx) => {
    // Comparing this base-currency Payment.amount against
    // SalesInvoice/PurchaseInvoice.totalAmount is only safe because every
    // Sales/Purchase Order (and thus every invoice) is already forced to
    // company.baseCurrencyCode — see sales-order.service.ts's own
    // hardcoding. A future multi-currency slice would need to revisit this.
    for (const allocation of payment.allocations) {
      await applyAllocationInTx(tx, {
        salesInvoiceId: allocation.salesInvoiceId,
        purchaseInvoiceId: allocation.purchaseInvoiceId,
        allocatedAmount: Number(allocation.allocatedAmount),
        invoiceTotalAmount: Number(allocation.salesInvoiceId ? allocation.salesInvoice!.totalAmount : allocation.purchaseInvoice!.totalAmount),
      });
    }

    const lines =
      payment.direction === "RECEIPT"
        ? [
            { accountId: cashOrBankAccount.id, lineNumber: 1, debitAmount: amount, creditAmount: 0, description: `Payment ${payment.paymentNumber}` },
            { accountId: arAccount!.id, lineNumber: 2, debitAmount: 0, creditAmount: amount, description: `Payment ${payment.paymentNumber}` },
          ]
        : [
            { accountId: apAccount!.id, lineNumber: 1, debitAmount: amount, creditAmount: 0, description: `Payment ${payment.paymentNumber}` },
            { accountId: cashOrBankAccount.id, lineNumber: 2, debitAmount: 0, creditAmount: amount, description: `Payment ${payment.paymentNumber}` },
          ];

    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: payment.paymentDate,
        status: "DRAFT",
        narration: `Auto-posted for Payment ${payment.paymentNumber}`,
        sourceModule: "PAYMENT",
        sourceRecordId: payment.id,
        createdByUserId: actor.userId,
        lines: { create: lines },
      },
    });

    // Internal auto-post — no second PermissionService call (see
    // postJournalCore's doc comment): the outer "approve" assertion above
    // already authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.payment.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This payment is no longer in Draft status.", {});
    }
  });

  const updated = await PaymentRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payments",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", journalId: updated.journalId },
  });

  return updated;
}

/**
 * Applies part or all of an already-POSTED payment's unallocated ("On
 * Account") remainder to real invoices as they arrive. Gated on "approve"
 * (self-approval-guarded, same {createdBy} mechanism as postPayment) — this
 * still moves real invoice paidAmount/status, the same class of action as
 * the original post. No new Journal: the cash movement already happened at
 * post time for the payment's full amount; this is bookkeeping only.
 */
export async function allocatePayment(actor: ActorContext, id: string, input: PaymentAllocateInput) {
  const payment = await PaymentRepository.findByIdWithDetails(actor.companyId, id);
  if (!payment) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  await PermissionService.assert(actor.userId, "payments", "approve", { createdBy: payment.createdByUserId });

  if (payment.status !== "POSTED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot allocate a payment in "${payment.status}" status.`, {
      currentStatus: payment.status,
    });
  }

  const partyId = payment.direction === "RECEIPT" ? payment.customerId! : payment.supplierId!;
  const alreadyAllocated = round2(payment.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0));
  const unallocated = round2(Number(payment.amount) - alreadyAllocated);

  const newRows = await buildAndValidateAllocations(actor.companyId, payment.direction, partyId, unallocated, input.allocations);

  // A supplier advance (Payments Request "on account") sits in SUP-ADV, not AP.
  // Allocating it to bills moves that amount: Dr AP / Cr SUP-ADV.
  const reclass = payment.isAdvance
    ? await (async () => {
        const [ap, supAdv] = await Promise.all([
          ChartOfAccountRepository.findByCode(actor.companyId, "AP"),
          ChartOfAccountRepository.findByCode(actor.companyId, "SUP-ADV"),
        ]);
        if (!ap || !supAdv) {
          throw new BusinessRuleError("NOT_FOUND", "The Accounts Payable or Advance to Suppliers account is missing from the Chart of Accounts.");
        }
        const journalNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: payment.branchId ?? null, documentType: "JOURNAL" });
        return { ap, supAdv, journalNumber, amount: round2(newRows.reduce((sum, r) => sum + r.allocatedAmount, 0)) };
      })()
    : null;

  await prisma.$transaction(async (tx) => {
    if (reclass && reclass.amount > 0) {
      const journal = await tx.journal.create({
        data: {
          companyId: actor.companyId,
          branchId: payment.branchId ?? null,
          journalNumber: reclass.journalNumber,
          journalDate: new Date(),
          status: "DRAFT",
          narration: `Supplier advance ${payment.paymentNumber} adjusted against bills`,
          sourceModule: "PAYMENT",
          sourceRecordId: payment.id,
          createdByUserId: actor.userId,
          lines: {
            create: [
              { accountId: reclass.ap.id, lineNumber: 1, debitAmount: reclass.amount, creditAmount: 0, description: `Advance ${payment.paymentNumber} adjusted` },
              { accountId: reclass.supAdv.id, lineNumber: 2, debitAmount: 0, creditAmount: reclass.amount, description: `Advance ${payment.paymentNumber} adjusted` },
            ],
          },
        },
      });
      await postJournalCore(tx, journal.id, "DRAFT", actor.userId);
    }

    for (const row of newRows) {
      await applyAllocationInTx(tx, row);
      await tx.paymentAllocation.create({
        data: {
          paymentId: id,
          salesInvoiceId: row.salesInvoiceId,
          purchaseInvoiceId: row.purchaseInvoiceId,
          allocatedAmount: row.allocatedAmount,
        },
      });
    }
  });

  const updated = await PaymentRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_allocations",
    recordId: id,
    action: "CREATE",
    newValues: { paymentId: id, newAllocations: newRows },
  });

  return updated;
}

/** Only from DRAFT — no compensating decrement needed, since DRAFT never
 * touched paidAmount in the first place (only POST does). No updatePayment
 * exists (deliberately — see the schema-file doc comment); the only
 * DRAFT-stage correction is cancel-and-recreate. */
export async function cancelPayment(actor: ActorContext, id: string) {
  const existing = await PaymentRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  const { count } = await PaymentRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a payment in "${existing.status}" status.`, {
      currentStatus: existing.status,
    });
  }

  const updated = await PaymentRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payments",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

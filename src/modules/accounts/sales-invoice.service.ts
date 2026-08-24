import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { Prisma } from "@prisma/client";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import type { SalesInvoiceInput } from "./sales-invoice.schema";
import { SalesInvoiceRepository } from "./sales-invoice.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { TaxRateRepository } from "./tax-config.repository";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface OrderItemLike {
  id: string;
  productId: string;
  unitPrice: Prisma.Decimal | number;
  breakdown: { orderedQuantity: number }[];
}

async function buildInvoiceItems(companyId: string, orderItems: OrderItemLike[], lines: SalesInvoiceInput["lines"]) {
  const orderItemIds = new Set(orderItems.map((i) => i.id));
  const lineItemIds = new Set(lines.map((l) => l.salesOrderItemId));
  if (orderItemIds.size !== lineItemIds.size || [...orderItemIds].some((id) => !lineItemIds.has(id))) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "The invoice must include exactly one line for every style line on the sales order — no fewer, no extra.",
      {}
    );
  }

  const lineByOrderItemId = new Map(lines.map((l) => [l.salesOrderItemId, l]));
  const items = [];
  for (const orderItem of orderItems) {
    const line = lineByOrderItemId.get(orderItem.id)!;
    const quantity = orderItem.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    const unitPrice = Number(orderItem.unitPrice);
    const lineSubtotal = round2(quantity * unitPrice);

    let taxPercentage: number | null = null;
    if (line.taxRateId) {
      const taxRate = await TaxRateRepository.findAnyById(companyId, line.taxRateId);
      if (!taxRate) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id: line.taxRateId });
      taxPercentage = Number(taxRate.ratePercentage);
    }
    const taxAmount = taxPercentage ? round2((lineSubtotal * taxPercentage) / 100) : 0;

    items.push({
      salesOrderItemId: orderItem.id,
      productId: orderItem.productId,
      quantity,
      unitPrice,
      taxRateId: line.taxRateId || null,
      taxPercentage,
      taxAmount,
      lineTotal: round2(lineSubtotal + taxAmount),
    });
  }
  return items;
}

function sumTotals(items: Awaited<ReturnType<typeof buildInvoiceItems>>) {
  const subtotalAmount = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const taxAmount = round2(items.reduce((sum, i) => sum + i.taxAmount, 0));
  return { subtotalAmount, taxAmount, totalAmount: round2(subtotalAmount + taxAmount) };
}

export async function listSalesInvoices(companyId: string, query: ListQuery) {
  const where: Prisma.SalesInvoiceWhereInput = {
    companyId,
    ...(query.search ? { invoiceNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    SalesInvoiceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    SalesInvoiceRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getSalesInvoiceById(companyId: string, id: string) {
  const invoice = await SalesInvoiceRepository.findByIdWithDetails(companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });
  return invoice;
}

export async function createSalesInvoice(actor: ActorContext, input: SalesInvoiceInput) {
  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, input.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: input.salesOrderId });

  if (!(ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot invoice a sales order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  const active = await SalesInvoiceRepository.findActiveByOrderId(actor.companyId, order.id);
  if (active) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      `This sales order already has an active invoice (${active.invoiceNumber}).`,
      { salesInvoiceId: active.id }
    );
  }

  const items = await buildInvoiceItems(actor.companyId, order.items, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "SALES_INVOICE",
  });

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (order.customer.paymentTermsDays ?? 0));

  let invoice;
  try {
    invoice = await SalesInvoiceRepository.createWithItems(
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        invoiceNumber,
        salesOrderId: order.id,
        customerId: order.customerId,
        invoiceDate,
        dueDate,
        status: "DRAFT",
        currencyCode: order.currencyCode,
        exchangeRate: order.exchangeRate,
        baseCurrencyCode: order.baseCurrencyCode,
        subtotalAmount,
        taxAmount,
        totalAmount,
        baseTotalAmount: totalAmount,
        createdByUserId: actor.userId,
      },
      items
    );
  } catch (error) {
    // sales_invoices_one_active_per_order (partial unique index) — the real
    // guarantee against a concurrent double-create race the findActiveByOrderId
    // pre-check above cannot fully close by itself.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BusinessRuleError(
        "REFERENCED_RECORD_IN_USE",
        "This sales order already has an active invoice (created by a concurrent request).",
        { salesOrderId: order.id }
      );
    }
    throw error;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_invoices",
    recordId: invoice.id,
    action: "CREATE",
    newValues: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
  });

  return invoice;
}

/** Editable only while DRAFT — the linked order/items never change, only tax-rate selections. */
export async function updateSalesInvoice(actor: ActorContext, id: string, input: SalesInvoiceInput) {
  const existing = await SalesInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });

  if (existing.status !== "DRAFT") {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot edit an invoice in "${existing.status}" status — posted invoices are immutable.`,
      { currentStatus: existing.status }
    );
  }

  if (input.salesOrderId !== existing.salesOrderId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An invoice cannot be re-linked to a different sales order.", {});
  }

  const order = await SalesOrderRepository.findByIdWithDetails(actor.companyId, existing.salesOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales order not found.", { id: existing.salesOrderId });

  const items = await buildInvoiceItems(actor.companyId, order.items, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (order.customer.paymentTermsDays ?? 0));

  const updated = await SalesInvoiceRepository.replaceItems(
    id,
    { invoiceDate, dueDate, subtotalAmount, taxAmount, totalAmount, baseTotalAmount: totalAmount },
    items
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_invoices",
    recordId: id,
    action: "UPDATE",
    oldValues: { totalAmount: existing.totalAmount },
    newValues: { totalAmount: updated.totalAmount },
  });

  return updated;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded (same reasoning as Journal's own
 * post gate — this moves real AR/Revenue balances). In one transaction:
 * auto-create+auto-post a settlement Journal (Dr Accounts Receivable / Cr
 * Sales Revenue / Cr GST Payable if any tax) via the same internal,
 * non-permission-checked postJournalCore path reverseJournal() uses, then
 * guarded conditional flips of both this invoice and its Sales Order.
 */
export async function postSalesInvoice(actor: ActorContext, id: string) {
  const invoice = await SalesInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });

  await PermissionService.assert(actor.userId, "invoices", "post", { createdBy: invoice.createdByUserId });

  if (invoice.status !== "DRAFT") {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot post an invoice in "${invoice.status}" status.`,
      { currentStatus: invoice.status }
    );
  }

  const [arAccount, revenueAccount, gstPayableAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, "AR"),
    ChartOfAccountRepository.findByCode(actor.companyId, "SALES-REV"),
    ChartOfAccountRepository.findByCode(actor.companyId, "GST-PAY"),
  ]);
  // Hardcoded well-known control-account codes for this first slice — no
  // configurable "default account" mapping exists yet (deliberately deferred
  // per the 7A plan). Revisit once a second revenue-type document needs a
  // different account.
  if (!arAccount || !revenueAccount) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      "The Accounts Receivable or Sales Revenue control account is missing from the Chart of Accounts.",
      {}
    );
  }
  const taxAmountNum = Number(invoice.taxAmount);
  if (taxAmountNum > 0 && !gstPayableAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The GST Payable control account is missing from the Chart of Accounts.", {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  await prisma.$transaction(async (tx) => {
    const lines = [
      {
        accountId: arAccount.id,
        lineNumber: 1,
        debitAmount: Number(invoice.totalAmount),
        creditAmount: 0,
        description: `Invoice ${invoice.invoiceNumber}`,
      },
      {
        accountId: revenueAccount.id,
        lineNumber: 2,
        debitAmount: 0,
        creditAmount: Number(invoice.subtotalAmount),
        description: `Invoice ${invoice.invoiceNumber}`,
      },
    ];
    if (taxAmountNum > 0 && gstPayableAccount) {
      lines.push({
        accountId: gstPayableAccount.id,
        lineNumber: 3,
        debitAmount: 0,
        creditAmount: taxAmountNum,
        description: `Invoice ${invoice.invoiceNumber} — GST`,
      });
    }

    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: invoice.invoiceDate,
        status: "DRAFT",
        narration: `Auto-posted for Sales Invoice ${invoice.invoiceNumber}`,
        sourceModule: "SALES_INVOICE",
        sourceRecordId: invoice.id,
        createdByUserId: actor.userId,
        lines: { create: lines },
      },
    });

    // Internal auto-post — no second PermissionService call (see
    // postJournalCore's doc comment): the outer post action above already
    // authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count: invoiceCount } = await tx.salesInvoice.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (invoiceCount === 0) {
      throw new BusinessRuleError("POSTED_INVOICE_LOCKED", "This invoice is no longer in Draft status.", {});
    }

    const { count: orderCount } = await tx.salesOrder.updateMany({
      where: { id: invoice.salesOrderId, status: { in: [...ELIGIBLE_ORDER_STATUSES] } },
      data: { status: "INVOICED" },
    });
    if (orderCount === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "The underlying sales order is no longer in a state that can be invoiced.",
        {}
      );
    }
  });

  const updated = await SalesInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_invoices",
    recordId: id,
    action: "POST",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", journalId: updated.journalId },
  });

  return updated;
}

/** Only from DRAFT — a POSTED invoice has no reversal/void path in this slice
 * (a real Credit Note is a separate document, deferred). Its own auto-generated
 * Journal can still be reversed via the Journal UI if a correction is needed. */
export async function cancelSalesInvoice(actor: ActorContext, id: string) {
  const existing = await SalesInvoiceRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });

  const { count } = await SalesInvoiceRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot cancel an invoice in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const updated = await SalesInvoiceRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Sales invoice not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_invoices",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

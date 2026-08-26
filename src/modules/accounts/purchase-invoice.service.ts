import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { Prisma } from "@prisma/client";
import { PurchaseOrderRepository, PurchaseOrderItemRepository } from "@/modules/purchasing/purchase-order.repository";
import type { PurchaseInvoiceInput } from "./purchase-invoice.schema";
import { PurchaseInvoiceRepository } from "./purchase-invoice.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { TaxRateRepository } from "./tax-config.repository";
import { postJournalCore } from "./journal.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

// Supplier bills routinely arrive after the buyer has already closed
// receiving, so CLOSED is deliberately included, not excluded — see the
// reviewed plan's explicit eligibility-policy decision.
const ELIGIBLE_PO_STATUSES = ["SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

interface OrderItemLike {
  id: string;
  productId: string;
  receivedQuantity: Prisma.Decimal | number;
  invoicedQuantity: Prisma.Decimal | number;
}

async function buildInvoiceItems(companyId: string, orderItems: OrderItemLike[], lines: PurchaseInvoiceInput["lines"]) {
  const orderItemsById = new Map(orderItems.map((i) => [i.id, i]));
  const items = [];
  for (const line of lines) {
    const orderItem = orderItemsById.get(line.purchaseOrderItemId);
    if (!orderItem) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "One or more lines do not belong to the selected purchase order.",
        { purchaseOrderItemId: line.purchaseOrderItemId }
      );
    }

    const availableAtCheckTime = round4(Number(orderItem.receivedQuantity) - Number(orderItem.invoicedQuantity));
    if (line.quantity > availableAtCheckTime) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Cannot invoice ${line.quantity} for this line — only ${availableAtCheckTime} has been received and not yet invoiced.`,
        { purchaseOrderItemId: line.purchaseOrderItemId, requestedQuantity: line.quantity, availableAtCheckTime }
      );
    }

    const lineSubtotal = round2(line.quantity * line.unitPrice);

    let taxPercentage: number | null = null;
    if (line.taxRateId) {
      const taxRate = await TaxRateRepository.findAnyById(companyId, line.taxRateId);
      if (!taxRate) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id: line.taxRateId });
      taxPercentage = Number(taxRate.ratePercentage);
    }
    const taxAmount = taxPercentage ? round2((lineSubtotal * taxPercentage) / 100) : 0;

    items.push({
      purchaseOrderItemId: orderItem.id,
      productId: orderItem.productId,
      quantity: round4(line.quantity),
      unitPrice: round2(line.unitPrice),
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

export async function listPurchaseInvoices(companyId: string, query: ListQuery) {
  const where: Prisma.PurchaseInvoiceWhereInput = {
    companyId,
    ...(query.search ? { invoiceNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    PurchaseInvoiceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    PurchaseInvoiceRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getPurchaseInvoiceById(companyId: string, id: string) {
  const invoice = await PurchaseInvoiceRepository.findByIdWithDetails(companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });
  return invoice;
}

export async function createPurchaseInvoice(actor: ActorContext, input: PurchaseInvoiceInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await PurchaseInvoiceRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const order = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, input.purchaseOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id: input.purchaseOrderId });

  if (!(ELIGIBLE_PO_STATUSES as readonly string[]).includes(order.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot invoice a purchase order in "${order.status}" status.`,
      { currentStatus: order.status }
    );
  }

  const items = await buildInvoiceItems(actor.companyId, order.items, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "PURCHASE_INVOICE",
  });

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (order.supplier.paymentTermsDays ?? 0));

  let invoice;
  try {
    invoice = await PurchaseInvoiceRepository.createWithItems(
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        invoiceNumber,
        purchaseOrderId: order.id,
        supplierId: order.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber || null,
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
        idempotencyKey: input.idempotencyKey ?? null,
      },
      items
    );
  } catch (error) {
    // Two distinct unique constraints can raise P2002 here — they must not be
    // conflated, or an idempotency replay would be misreported as a duplicate
    // supplier invoice number (or vice versa).
    if (input.idempotencyKey && isUniqueConstraintViolationOnColumn(error, "idempotency_key")) {
      // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
      const existing = await PurchaseInvoiceRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    // purchase_invoices_supplier_invoice_number_unique (partial unique index)
    // — Purchase Invoice deliberately allows multiple invoices per order
    // (unlike Sales Invoice), so nothing else stops double-entering the same
    // physical supplier bill without this.
    if (isUniqueConstraintViolationOnColumn(error, "supplier_invoice_number")) {
      throw new BusinessRuleError(
        "REFERENCED_RECORD_IN_USE",
        `A purchase invoice with supplier reference "${input.supplierInvoiceNumber}" already exists for this supplier.`,
        { supplierId: order.supplierId, supplierInvoiceNumber: input.supplierInvoiceNumber }
      );
    }
    throw error;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_invoices",
    recordId: invoice.id,
    action: "CREATE",
    newValues: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
  });

  return invoice;
}

/** Editable only while DRAFT — the linked purchase order never changes, only line quantities/prices/tax. */
export async function updatePurchaseInvoice(actor: ActorContext, id: string, input: PurchaseInvoiceInput) {
  const existing = await PurchaseInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  if (existing.status !== "DRAFT") {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot edit an invoice in "${existing.status}" status — posted invoices are immutable.`,
      { currentStatus: existing.status }
    );
  }

  if (input.purchaseOrderId !== existing.purchaseOrderId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An invoice cannot be re-linked to a different purchase order.", {});
  }

  const order = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, existing.purchaseOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id: existing.purchaseOrderId });

  const items = await buildInvoiceItems(actor.companyId, order.items, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + (order.supplier.paymentTermsDays ?? 0));

  let updated;
  try {
    updated = await PurchaseInvoiceRepository.replaceItems(
      id,
      {
        supplierInvoiceNumber: input.supplierInvoiceNumber || null,
        invoiceDate,
        dueDate,
        subtotalAmount,
        taxAmount,
        totalAmount,
        baseTotalAmount: totalAmount,
      },
      items
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BusinessRuleError(
        "REFERENCED_RECORD_IN_USE",
        `A purchase invoice with supplier reference "${input.supplierInvoiceNumber}" already exists for this supplier.`,
        { supplierId: existing.supplierId, supplierInvoiceNumber: input.supplierInvoiceNumber }
      );
    }
    throw error;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_invoices",
    recordId: id,
    action: "UPDATE",
    oldValues: { totalAmount: existing.totalAmount },
    newValues: { totalAmount: updated.totalAmount },
  });

  return updated;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded (same reasoning as Sales Invoice's
 * own post gate). In one transaction: guarded-increment invoicedQuantity per
 * line (the real over-invoice guard — a raw-SQL comparison against the LIVE
 * receivedQuantity column, see PurchaseOrderItemRepository), then
 * auto-create+auto-post a settlement Journal (Dr Purchases/COGS, Dr GST Input
 * Tax Credit if any, Cr Accounts Payable) via postJournalCore, then a guarded
 * conditional flip of this invoice. Deliberately does NOT change
 * PurchaseOrder.status — see the reviewed plan's Divergence 3.
 */
export async function postPurchaseInvoice(actor: ActorContext, id: string) {
  const invoice = await PurchaseInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  await PermissionService.assert(actor.userId, "invoices", "post", { createdBy: invoice.createdByUserId });

  if (invoice.status !== "DRAFT") {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot post an invoice in "${invoice.status}" status.`,
      { currentStatus: invoice.status }
    );
  }

  const [cogsAccount, gstInputAccount, apAccount] = await Promise.all([
    ChartOfAccountRepository.findByCode(actor.companyId, "COGS"),
    ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC"),
    ChartOfAccountRepository.findByCode(actor.companyId, "AP"),
  ]);
  if (!cogsAccount || !apAccount) {
    throw new BusinessRuleError(
      "NOT_FOUND",
      "The Purchases/COGS or Accounts Payable control account is missing from the Chart of Accounts.",
      {}
    );
  }
  const taxAmountNum = Number(invoice.taxAmount);
  if (taxAmountNum > 0 && !gstInputAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The GST Input Tax Credit control account is missing from the Chart of Accounts.", {});
  }

  const journalNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOURNAL",
  });

  await prisma.$transaction(async (tx) => {
    for (const item of invoice.items) {
      const affected = await PurchaseOrderItemRepository.guardedIncrementInvoiced(tx, item.purchaseOrderItemId, Number(item.quantity));
      if (affected === 0) {
        const current = await tx.purchaseOrderItem.findUnique({
          where: { id: item.purchaseOrderItemId },
          select: { receivedQuantity: true, invoicedQuantity: true },
        });
        const availableNow = current ? Number(current.receivedQuantity) - Number(current.invoicedQuantity) : 0;
        throw new BusinessRuleError(
          "OVER_INVOICE_NOT_ALLOWED",
          `Cannot invoice ${item.quantity} for "${item.product.styleName}" — only ${availableNow} is currently available to invoice.`,
          { purchaseOrderItemId: item.purchaseOrderItemId, requestedQuantity: item.quantity, availableQuantityAtCheckTime: availableNow }
        );
      }
    }

    const lines = [
      {
        accountId: cogsAccount.id,
        lineNumber: 1,
        debitAmount: Number(invoice.subtotalAmount),
        creditAmount: 0,
        description: `Purchase Invoice ${invoice.invoiceNumber}`,
      },
    ];
    let nextLineNumber = 2;
    if (taxAmountNum > 0 && gstInputAccount) {
      lines.push({
        accountId: gstInputAccount.id,
        lineNumber: nextLineNumber++,
        debitAmount: taxAmountNum,
        creditAmount: 0,
        description: `Purchase Invoice ${invoice.invoiceNumber} — GST Input`,
      });
    }
    lines.push({
      accountId: apAccount.id,
      lineNumber: nextLineNumber++,
      debitAmount: 0,
      creditAmount: Number(invoice.totalAmount),
      description: `Purchase Invoice ${invoice.invoiceNumber}`,
    });

    const journal = await tx.journal.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        journalNumber,
        journalDate: invoice.invoiceDate,
        status: "DRAFT",
        narration: `Auto-posted for Purchase Invoice ${invoice.invoiceNumber}`,
        sourceModule: "PURCHASE_INVOICE",
        sourceRecordId: invoice.id,
        createdByUserId: actor.userId,
        lines: { create: lines },
      },
    });

    // Internal auto-post — no second PermissionService call (see
    // postJournalCore's doc comment): the outer post action above already
    // authorized this whole operation.
    await postJournalCore(tx, journal.id, "DRAFT", actor.userId);

    const { count } = await tx.purchaseInvoice.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", journalId: journal.id, postedAt: new Date(), postedByUserId: actor.userId },
    });
    if (count === 0) {
      throw new BusinessRuleError("POSTED_INVOICE_LOCKED", "This invoice is no longer in Draft status.", {});
    }
  });

  const updated = await PurchaseInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_invoices",
    recordId: id,
    action: "POST",
    oldValues: { status: "DRAFT" },
    newValues: { status: "POSTED", journalId: updated.journalId },
  });

  return updated;
}

/** Only from DRAFT — no compensating decrement needed, since DRAFT never
 * incremented invoicedQuantity in the first place (only POST does). No
 * reversal/void path for a POSTED invoice this slice (same documented gap
 * as Sales Invoice — correct via reversing the linked Journal if needed). */
export async function cancelPurchaseInvoice(actor: ActorContext, id: string) {
  const existing = await PurchaseInvoiceRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  const { count } = await PurchaseInvoiceRepository.updateStatusConditional(id, "DRAFT", { status: "CANCELLED" });
  if (count === 0) {
    throw new BusinessRuleError(
      "POSTED_INVOICE_LOCKED",
      `Cannot cancel an invoice in "${existing.status}" status.`,
      { currentStatus: existing.status }
    );
  }

  const updated = await PurchaseInvoiceRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "purchase_invoices",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: "DRAFT" },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { Prisma } from "@prisma/client";
import { PurchaseOrderRepository, PurchaseOrderItemRepository } from "@/modules/purchasing/purchase-order.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import type { PurchaseInvoiceInput } from "./purchase-invoice.schema";
import { PurchaseInvoiceRepository, CompanyRepository, type PurchaseInvoiceItemCreateData } from "./purchase-invoice.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { assertValidExpenseAccount } from "./chart-of-account.service";
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

/**
 * Builds every line of the invoice. Each line is EXACTLY one of two shapes
 * (enforced by the Zod schema before this ever runs, and by a DB CHECK
 * constraint as a hard backstop): a PO-linked line (bounded by
 * receivedQuantity - invoicedQuantity, same as always) or a direct/"party
 * bill" line (a chosen Expense account, no PO backing at all — a service or
 * expense bill from a supplier, e.g. freight, consulting, rent). orderItems
 * is null for a standalone bill with no PO at all — any line still claiming
 * a purchaseOrderItemId in that case correctly fails to resolve below (the
 * Zod schema already blocks this combination, this is defense in depth).
 */
async function buildInvoiceItems(
  companyId: string,
  orderItems: OrderItemLike[] | null,
  lines: PurchaseInvoiceInput["lines"]
): Promise<PurchaseInvoiceItemCreateData[]> {
  const orderItemsById = new Map((orderItems ?? []).map((i) => [i.id, i]));
  const items: PurchaseInvoiceItemCreateData[] = [];
  for (const line of lines) {
    let purchaseOrderItemId: string | null = null;
    let productId: string | null = null;
    let description: string | null = null;
    let expenseAccountId: string | null = null;
    let quantity: number;
    let unitPrice: number;

    if (line.purchaseOrderItemId) {
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

      purchaseOrderItemId = orderItem.id;
      productId = orderItem.productId;
      quantity = round4(line.quantity);
      unitPrice = round2(line.unitPrice);
    } else {
      // Direct/party-bill line — no PO backing, debits a chosen expense
      // account directly at post time instead of the automatic COGS line.
      const account = await assertValidExpenseAccount(companyId, line.expenseAccountId as string);
      description = (line.description as string).trim();
      expenseAccountId = account.id;
      quantity = round4(line.quantity);
      unitPrice = round2(line.unitPrice);
    }

    const lineSubtotal = round2(quantity * unitPrice);

    let taxPercentage: number | null = null;
    if (line.taxRateId) {
      const taxRate = await TaxRateRepository.findAnyById(companyId, line.taxRateId);
      if (!taxRate) throw new BusinessRuleError("NOT_FOUND", "Tax rate not found.", { id: line.taxRateId });
      taxPercentage = Number(taxRate.ratePercentage);
    }
    const taxAmount = taxPercentage ? round2((lineSubtotal * taxPercentage) / 100) : 0;

    items.push({
      purchaseOrderItemId,
      productId,
      description,
      expenseAccountId,
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

function sumTotals(items: PurchaseInvoiceItemCreateData[]) {
  const subtotalAmount = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const taxAmount = round2(items.reduce((sum, i) => sum + i.taxAmount, 0));
  return { subtotalAmount, taxAmount, totalAmount: round2(subtotalAmount + taxAmount) };
}

export async function listPurchaseInvoices(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.PurchaseInvoiceWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
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

/** A branch-restricted user gets NOT_FOUND for an invoice outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getPurchaseInvoiceById(actor: { companyId: string; userId: string }, id: string) {
  const invoice = await PurchaseInvoiceRepository.findByIdWithDetails(actor.companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!invoice.branchId || !allowedBranchIds.has(invoice.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Purchase invoice not found.", { id });
  }

  return invoice;
}

export async function createPurchaseInvoice(actor: ActorContext, input: PurchaseInvoiceInput) {
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await PurchaseInvoiceRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  let purchaseOrderId: string | null = null;
  let supplierId: string;
  let currencyCode: string;
  let exchangeRate: number;
  let baseCurrencyCode: string;
  let paymentTermsDays: number;
  let orderItems: OrderItemLike[] | null = null;

  if (input.purchaseOrderId) {
    const order = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, input.purchaseOrderId);
    if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id: input.purchaseOrderId });

    if (!(ELIGIBLE_PO_STATUSES as readonly string[]).includes(order.status)) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot invoice a purchase order in "${order.status}" status.`,
        { currentStatus: order.status }
      );
    }

    purchaseOrderId = order.id;
    supplierId = order.supplierId;
    currencyCode = order.currencyCode;
    exchangeRate = Number(order.exchangeRate);
    baseCurrencyCode = order.baseCurrencyCode;
    paymentTermsDays = order.supplier.paymentTermsDays ?? 0;
    orderItems = order.items;
  } else {
    // Standalone "party/direct bill" — no PO at all, e.g. a service or
    // expense bill from a supplier (freight, consulting, rent).
    const supplier = await SupplierRepository.findById(actor.companyId, input.supplierId as string);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });

    const company = await CompanyRepository.findBaseCurrencyCode(actor.companyId);
    if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", {});

    supplierId = supplier.id;
    currencyCode = company.baseCurrencyCode;
    exchangeRate = 1;
    baseCurrencyCode = company.baseCurrencyCode;
    paymentTermsDays = supplier.paymentTermsDays ?? 0;
  }

  const items = await buildInvoiceItems(actor.companyId, orderItems, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "PURCHASE_INVOICE",
  });

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + paymentTermsDays);

  let invoice;
  try {
    invoice = await PurchaseInvoiceRepository.createWithItems(
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        invoiceNumber,
        purchaseOrderId,
        supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber || null,
        invoiceDate,
        dueDate,
        status: "DRAFT",
        currencyCode,
        exchangeRate,
        baseCurrencyCode,
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
        { supplierId, supplierInvoiceNumber: input.supplierInvoiceNumber }
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

/** Editable only while DRAFT — the linked purchase order (or lack thereof) never changes, only line quantities/prices/tax/direct-line detail. */
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

  if ((input.purchaseOrderId || null) !== existing.purchaseOrderId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An invoice cannot be re-linked to a different purchase order (or converted to/from a direct bill).", {});
  }

  let orderItems: OrderItemLike[] | null = null;
  let paymentTermsDays: number;

  if (existing.purchaseOrderId) {
    const order = await PurchaseOrderRepository.findByIdWithDetails(actor.companyId, existing.purchaseOrderId);
    if (!order) throw new BusinessRuleError("NOT_FOUND", "Purchase order not found.", { id: existing.purchaseOrderId });
    orderItems = order.items;
    paymentTermsDays = order.supplier.paymentTermsDays ?? 0;
  } else {
    const supplier = await SupplierRepository.findById(actor.companyId, existing.supplierId);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: existing.supplierId });
    paymentTermsDays = supplier.paymentTermsDays ?? 0;
  }

  const items = await buildInvoiceItems(actor.companyId, orderItems, input.lines);
  const { subtotalAmount, taxAmount, totalAmount } = sumTotals(items);

  const invoiceDate = new Date(input.invoiceDate);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + paymentTermsDays);

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

interface PostableInvoiceItem {
  purchaseOrderItemId: string | null;
  expenseAccountId: string | null;
  quantity: string | number;
  unitPrice: string | number;
  product: { styleName: string } | null;
  expenseAccount: { id: string; code: string; name: string; isActive: boolean } | null;
}

/**
 * DRAFT -> POSTED. Self-approval-guarded (same reasoning as Sales Invoice's
 * own post gate). In one transaction: guarded-increment invoicedQuantity per
 * PO-linked line (the real over-invoice guard — a raw-SQL comparison against
 * the LIVE receivedQuantity column, see PurchaseOrderItemRepository), then
 * auto-create+auto-post a settlement Journal — one Dr line per distinct
 * debit account (COGS for the sum of all PO-linked lines, one line per
 * distinct chosen Expense account for direct lines), Dr GST Input Tax
 * Credit if any, Cr Accounts Payable for the total — via postJournalCore,
 * then a guarded conditional flip of this invoice. Deliberately does NOT
 * change PurchaseOrder.status — see the reviewed plan's Divergence 3.
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

  const items = invoice.items as unknown as PostableInvoiceItem[];
  const poLinkedItems = items.filter((i) => i.purchaseOrderItemId);
  const directItems = items.filter((i) => !i.purchaseOrderItemId);

  const directByAccount = new Map<string, { name: string; code: string; subtotal: number }>();
  let directTotal = 0;
  for (const item of directItems) {
    if (!item.expenseAccount) {
      throw new BusinessRuleError("NOT_FOUND", "One of this invoice's direct lines is missing its expense account.", {});
    }
    if (!item.expenseAccount.isActive) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${item.expenseAccount.name}" is no longer active.`, {});
    }
    const lineSubtotal = round2(Number(item.quantity) * Number(item.unitPrice));
    directTotal = round2(directTotal + lineSubtotal);
    const existing = directByAccount.get(item.expenseAccount.id);
    if (existing) existing.subtotal = round2(existing.subtotal + lineSubtotal);
    else directByAccount.set(item.expenseAccount.id, { name: item.expenseAccount.name, code: item.expenseAccount.code, subtotal: lineSubtotal });
  }
  // Derived from the already-trusted, already-rounded header total rather
  // than re-summed from raw quantity*unitPrice — matches this function's
  // original "trust invoice.subtotalAmount, don't recompute it" precedent,
  // and sidesteps any rounding drift between the two derivations.
  const poLinkedSubtotal = poLinkedItems.length > 0 ? round2(Number(invoice.subtotalAmount) - directTotal) : 0;

  const [cogsAccount, gstInputAccount, apAccount] = await Promise.all([
    poLinkedSubtotal > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "COGS") : Promise.resolve(null),
    Number(invoice.taxAmount) > 0 ? ChartOfAccountRepository.findByCode(actor.companyId, "GST-ITC") : Promise.resolve(null),
    ChartOfAccountRepository.findByCode(actor.companyId, "AP"),
  ]);
  if (poLinkedSubtotal > 0 && !cogsAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Purchases/COGS control account is missing from the Chart of Accounts.", {});
  }
  if (!apAccount) {
    throw new BusinessRuleError("NOT_FOUND", "The Accounts Payable control account is missing from the Chart of Accounts.", {});
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
    for (const item of poLinkedItems) {
      const affected = await PurchaseOrderItemRepository.guardedIncrementInvoiced(tx, item.purchaseOrderItemId as string, Number(item.quantity));
      if (affected === 0) {
        const current = await tx.purchaseOrderItem.findUnique({
          where: { id: item.purchaseOrderItemId as string },
          select: { receivedQuantity: true, invoicedQuantity: true },
        });
        const availableNow = current ? Number(current.receivedQuantity) - Number(current.invoicedQuantity) : 0;
        throw new BusinessRuleError(
          "OVER_INVOICE_NOT_ALLOWED",
          `Cannot invoice ${item.quantity} for "${item.product?.styleName}" — only ${availableNow} is currently available to invoice.`,
          { purchaseOrderItemId: item.purchaseOrderItemId, requestedQuantity: item.quantity, availableQuantityAtCheckTime: availableNow }
        );
      }
    }

    const lines: Array<{ accountId: string; lineNumber: number; debitAmount: number; creditAmount: number; description: string }> = [];
    let nextLineNumber = 1;

    if (poLinkedSubtotal > 0 && cogsAccount) {
      lines.push({
        accountId: cogsAccount.id,
        lineNumber: nextLineNumber++,
        debitAmount: poLinkedSubtotal,
        creditAmount: 0,
        description: `Purchase Invoice ${invoice.invoiceNumber}`,
      });
    }
    for (const [accountId, group] of directByAccount) {
      lines.push({
        accountId,
        lineNumber: nextLineNumber++,
        debitAmount: group.subtotal,
        creditAmount: 0,
        description: `Purchase Invoice ${invoice.invoiceNumber} — ${group.name}`,
      });
    }
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

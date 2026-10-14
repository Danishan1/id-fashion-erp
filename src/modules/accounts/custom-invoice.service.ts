import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import { round2 } from "@/lib/money";
import { extractStateCodeFromGstin, isValidStateCode, calculateInvoiceGst } from "@/lib/gst";
import type { ListQuery } from "@/lib/list-query";
import { CustomInvoiceStatus, Prisma } from "@prisma/client";
import type { CustomInvoiceInput } from "./custom-invoice.schema";
import { CustomInvoiceRepository } from "./custom-invoice.repository";
import { InvoiceSeriesRepository } from "./invoice-series.repository";
import { ChartOfAccountRepository } from "./chart-of-account.repository";
import { CustomInvoiceCreditNoteRepository } from "./custom-invoice-credit-note.repository";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface ComputedLine {
  productId: string | null;
  itemName: string;
  hsnCode: string | null;
  quantity: number;
  unitPrice: number;
  gstPercentage: number;
  lineAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
}

// Discount% is applied per line (discountedPrice = unitPrice * (1 -
// discount%)) before GST, and reverse charge zeroes every line's GST
// entirely — both confirmed against the reference tool's own live
// calculation code, not guessed from its screenshot.
function computeLines(items: CustomInvoiceInput["items"], discountPercentage: number, isReverseCharge: boolean): ComputedLine[] {
  return items.map((item) => {
    const discountedPrice = round2(item.unitPrice * (1 - discountPercentage / 100));
    const lineAmount = round2(item.quantity * discountedPrice);
    const lineTaxAmount = isReverseCharge ? 0 : round2(lineAmount * (item.gstPercentage / 100));
    const lineTotal = round2(lineAmount + lineTaxAmount);
    return {
      productId: item.productId || null,
      itemName: item.itemName,
      hsnCode: item.hsnCode || null,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      gstPercentage: item.gstPercentage,
      lineAmount,
      lineTaxAmount,
      lineTotal,
    };
  });
}

function computeTotals(items: CustomInvoiceInput["items"], lines: ComputedLine[]) {
  const subtotalAmount = round2(lines.reduce((sum, l) => sum + l.lineAmount, 0));
  const grossAmount = round2(items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0));
  const discountAmount = round2(grossAmount - subtotalAmount);
  const taxAmount = round2(lines.reduce((sum, l) => sum + l.lineTaxAmount, 0));
  const grandTotal = round2(subtotalAmount + taxAmount);
  return { subtotalAmount, discountAmount, taxAmount, grandTotal };
}

function assertAdvanceNotOverGrandTotal(advanceAmount: number | undefined, grandTotal: number) {
  if (advanceAmount && advanceAmount > grandTotal) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Advance Payment cannot be greater than the Grand Total.", {
      advanceAmount,
      grandTotal,
    });
  }
}

// The single source of truth for what's actually still owed — recomputed
// (and persisted, see CustomInvoice.balanceDue's own schema comment)
// wherever any of these five inputs change: at create/update (grandTotal,
// advance, payable) and by the payment/credit-note services (paidAmount,
// creditedAmount). Exported so those services never re-derive this formula
// themselves.
export function computeBalanceDue(invoice: {
  grandTotal: number;
  advancePaymentAmount: number | null;
  payableAmountValue: number | null;
  paidAmount: number;
  creditedAmount: number;
}): number {
  return round2(
    invoice.grandTotal - (invoice.advancePaymentAmount ?? 0) - (invoice.payableAmountValue ?? 0) - invoice.paidAmount - invoice.creditedAmount
  );
}

async function assertValidIncomeAccount(companyId: string, incomeAccountId: string | undefined) {
  if (!incomeAccountId) return;
  const account = await ChartOfAccountRepository.findAnyById(companyId, incomeAccountId);
  if (!account) throw new BusinessRuleError("NOT_FOUND", "Income account not found.", { incomeAccountId });
  if (account.accountType !== "INCOME") {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${account.name}" is not an Income account.`, { incomeAccountId });
  }
  if (!account.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Income account "${account.name}" is inactive.`, { incomeAccountId });
  }
}

const VALID_CUSTOM_INVOICE_STATUSES = new Set<string>(Object.values(CustomInvoiceStatus));

export async function listCustomInvoices(companyId: string, query: ListQuery) {
  const where: Prisma.CustomInvoiceWhereInput = {
    companyId,
    ...(query.search ? { invoiceNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_CUSTOM_INVOICE_STATUSES.has(query.status)
      ? { status: query.status as CustomInvoiceStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    CustomInvoiceRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    CustomInvoiceRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getCustomInvoiceById(companyId: string, id: string) {
  const invoice = await CustomInvoiceRepository.findByIdWithDetails(companyId, id);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Custom invoice not found.", { id });
  return invoice;
}

async function resolveGstBreakdown(params: {
  companyId: string;
  customerId: string;
  inputPlaceOfSupply?: string | null;
  taxAmount: number;
  isReverseCharge: boolean;
}): Promise<{
  placeOfSupplyStateCode: string | null;
  isInterState: boolean;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}> {
  const { companyId, customerId, inputPlaceOfSupply, taxAmount, isReverseCharge } = params;

  // Retrieve company and customer tax information
  const [company, customer] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, taxRegistrationNo: true },
    }),
    prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, taxRegistrationNo: true },
    }),
  ]);

  const supplierStateCode = extractStateCodeFromGstin(company?.taxRegistrationNo);

  let customerStateCode: string | null = null;
  const trimmedPos = inputPlaceOfSupply?.trim();
  if (trimmedPos) {
    if (!isValidStateCode(trimmedPos)) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `Invalid Place of Supply state code "${trimmedPos}". Must be a valid 2-digit state code (01-38, 97).`,
        { placeOfSupplyStateCode: trimmedPos }
      );
    }
    customerStateCode = trimmedPos;
  } else if (customer?.taxRegistrationNo) {
    customerStateCode = extractStateCodeFromGstin(customer.taxRegistrationNo);
  }

  // When GST is applicable (taxAmount > 0 and reverse charge is false), state determination is mandatory
  if (taxAmount > 0 && !isReverseCharge) {
    if (!supplierStateCode) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "Supplier GSTIN is missing or invalid on Company. Place of supply cannot be determined for GST calculation.",
        { companyId }
      );
    }
    if (!customerStateCode) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        "Customer GSTIN or Place of Supply state code is missing or invalid. Place of supply cannot be determined for GST calculation.",
        { customerId }
      );
    }

    const isInterState = supplierStateCode !== customerStateCode;
    const { cgstAmount, sgstAmount, igstAmount } = calculateInvoiceGst(taxAmount, isInterState, isReverseCharge);

    return {
      placeOfSupplyStateCode: customerStateCode,
      isInterState,
      cgstAmount,
      sgstAmount,
      igstAmount,
    };
  }

  // Zero tax or Reverse Charge (RCM)
  const isInterState = supplierStateCode && customerStateCode ? supplierStateCode !== customerStateCode : false;
  return {
    placeOfSupplyStateCode: customerStateCode ?? null,
    isInterState,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
  };
}

export async function createCustomInvoice(actor: ActorContext, input: CustomInvoiceInput) {
  const series = await InvoiceSeriesRepository.findById(input.invoiceSeriesId, actor.companyId);
  if (!series) throw new BusinessRuleError("NOT_FOUND", "Invoice series not found.", { invoiceSeriesId: input.invoiceSeriesId });
  if (!series.isActive) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Invoice series "${series.name}" is inactive.`, { invoiceSeriesId: series.id });
  }

  await assertValidIncomeAccount(actor.companyId, input.incomeAccountId || undefined);

  const lines = computeLines(input.items, input.discountPercentage, input.isReverseCharge);
  const { subtotalAmount, discountAmount, taxAmount, grandTotal } = computeTotals(input.items, lines);
  assertAdvanceNotOverGrandTotal(input.advancePaymentAmount, grandTotal);
  const gstBreakdown = await resolveGstBreakdown({
    companyId: actor.companyId,
    customerId: input.customerId,
    inputPlaceOfSupply: input.placeOfSupplyStateCode,
    taxAmount,
    isReverseCharge: input.isReverseCharge,
  });

  const balanceDue = computeBalanceDue({
    grandTotal,
    advancePaymentAmount: input.advancePaymentAmount ?? null,
    payableAmountValue: input.payableAmountValue ?? null,
    paidAmount: 0,
    creditedAmount: 0,
  });

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      // Always advances regardless of whether the user kept the suggested
      // number or typed their own — same "external numbering" idiom as
      // Phase 3's sequential master codes. Real uniqueness comes from the
      // @@unique([companyId, invoiceNumber]) constraint below, not this
      // counter, so a lost race here is cosmetic (a skipped/duplicated
      // suggestion), never a correctness issue.
      await tx.invoiceSeries.update({ where: { id: series.id }, data: { nextNumber: { increment: 1 } } });

      return tx.customInvoice.create({
        data: {
          companyId: actor.companyId,
          branchId: actor.branchId ?? null,
          invoiceDate: new Date(input.invoiceDate),
          invoiceType: input.invoiceType,
          hasDueDate: input.hasDueDate,
          dueDate: input.hasDueDate && input.dueDate ? new Date(input.dueDate) : null,
          invoiceSeriesId: series.id,
          invoiceNumber: input.invoiceNumber,
          customerId: input.customerId,
          incomeAccountId: input.incomeAccountId || null,
          discountPercentage: input.discountPercentage,
          isReverseCharge: input.isReverseCharge,
          placeOfSupplyStateCode: gstBreakdown.placeOfSupplyStateCode,
          isInterState: gstBreakdown.isInterState,
          cgstAmount: gstBreakdown.cgstAmount,
          sgstAmount: gstBreakdown.sgstAmount,
          igstAmount: gstBreakdown.igstAmount,
          subtotalAmount,
          discountAmount,
          taxAmount,
          grandTotal,
          advancePaymentTitle: input.advancePaymentTitle || null,
          advancePaymentAmount: input.advancePaymentAmount ?? null,
          payableAmountTitle: input.payableAmountTitle || null,
          payableAmountValue: input.payableAmountValue ?? null,
          balanceDue,
          termsAndConditions: input.termsAndConditions || null,
          createdByUserId: actor.userId,
          items: { create: lines },
          notes: { create: input.notes.map((note) => ({ note })) },
        },
        include: { items: true, notes: true, customer: true, invoiceSeries: true },
      });
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "custom_invoices",
      recordId: invoice.id,
      action: "CREATE",
      newValues: invoice,
    });

    return invoice;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "invoice_number")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Invoice number "${input.invoiceNumber}" is already in use.`, {
        invoiceNumber: input.invoiceNumber,
      });
    }
    throw error;
  }
}

export async function updateCustomInvoice(actor: ActorContext, id: string, input: CustomInvoiceInput) {
  const existing = await CustomInvoiceRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Custom invoice not found.", { id });
  if (existing.status !== "DRAFT") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot edit a custom invoice in "${existing.status}" status.`, {
      status: existing.status,
    });
  }
  // Real-state guard, not a status-label check — DRAFT is this model's only
  // "live" status (there's no separate locked/finalized state), so a real
  // payment or credit note can already exist against a DRAFT invoice.
  // Editing items/pricing out from under either would silently desync them
  // from what was actually collected/credited.
  //
  // Active (ISSUED) credit notes or live paid/credited balances strictly block
  // editing. However, when all past credit notes have been CANCELLED and
  // paidAmount/creditedAmount are fully reversed back to 0, editing is safe
  // because replaceItemsAndNotes() preserves referenced item rows in-place.
  const hasActiveCreditNote = (await CustomInvoiceCreditNoteRepository.countActiveByInvoiceId(id)) > 0;
  if (Number(existing.paidAmount) > 0 || Number(existing.creditedAmount) > 0 || hasActiveCreditNote) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Cannot edit this invoice — an active payment or credit note is currently recorded against it.",
      { id }
    );
  }

  const series = await InvoiceSeriesRepository.findById(input.invoiceSeriesId, actor.companyId);
  if (!series) throw new BusinessRuleError("NOT_FOUND", "Invoice series not found.", { invoiceSeriesId: input.invoiceSeriesId });

  await assertValidIncomeAccount(actor.companyId, input.incomeAccountId || undefined);

  const lines = computeLines(input.items, input.discountPercentage, input.isReverseCharge);
  const { subtotalAmount, discountAmount, taxAmount, grandTotal } = computeTotals(input.items, lines);
  assertAdvanceNotOverGrandTotal(input.advancePaymentAmount, grandTotal);
  const gstBreakdown = await resolveGstBreakdown({
    companyId: actor.companyId,
    customerId: input.customerId,
    inputPlaceOfSupply: input.placeOfSupplyStateCode,
    taxAmount,
    isReverseCharge: input.isReverseCharge,
  });

  // A DRAFT invoice (the only state this function ever runs against) can
  // never have real payments/credit notes yet — both actions are blocked
  // until the invoice exists in its final form — so paidAmount/creditedAmount
  // are always still 0 here; no need to re-read them from `existing`.
  const balanceDue = computeBalanceDue({
    grandTotal,
    advancePaymentAmount: input.advancePaymentAmount ?? null,
    payableAmountValue: input.payableAmountValue ?? null,
    paidAmount: 0,
    creditedAmount: 0,
  });

  try {
    const updated = await CustomInvoiceRepository.replaceItemsAndNotes(
      id,
      {
        invoiceDate: new Date(input.invoiceDate),
        invoiceType: input.invoiceType,
        hasDueDate: input.hasDueDate,
        dueDate: input.hasDueDate && input.dueDate ? new Date(input.dueDate) : null,
        invoiceSeriesId: input.invoiceSeriesId,
        invoiceNumber: input.invoiceNumber,
        customerId: input.customerId,
        incomeAccountId: input.incomeAccountId || null,
        discountPercentage: input.discountPercentage,
        isReverseCharge: input.isReverseCharge,
        placeOfSupplyStateCode: gstBreakdown.placeOfSupplyStateCode,
        isInterState: gstBreakdown.isInterState,
        cgstAmount: gstBreakdown.cgstAmount,
        sgstAmount: gstBreakdown.sgstAmount,
        igstAmount: gstBreakdown.igstAmount,
        subtotalAmount,
        discountAmount,
        taxAmount,
        grandTotal,
        advancePaymentTitle: input.advancePaymentTitle || null,
        advancePaymentAmount: input.advancePaymentAmount ?? null,
        payableAmountTitle: input.payableAmountTitle || null,
        payableAmountValue: input.payableAmountValue ?? null,
        balanceDue,
        termsAndConditions: input.termsAndConditions || null,
      },
      lines,
      input.notes
    );

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "custom_invoices",
      recordId: id,
      action: "UPDATE",
      oldValues: existing,
      newValues: updated,
    });

    return updated;
  } catch (error) {
    if (isUniqueConstraintViolationOnColumn(error, "invoice_number")) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Invoice number "${input.invoiceNumber}" is already in use.`, {
        invoiceNumber: input.invoiceNumber,
      });
    }
    throw error;
  }
}

export async function cancelCustomInvoice(actor: ActorContext, id: string) {
  const existing = await CustomInvoiceRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Custom invoice not found.", { id });
  if (existing.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This custom invoice is already cancelled.", { id });
  }
  // Checked directly, not inferred from status — same reasoning as the edit
  // guard above.
  if (Number(existing.paidAmount) > 0 || Number(existing.creditedAmount) > 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Cannot cancel this invoice — a payment or credit note has already been recorded against it. Cancel those first.",
      { id }
    );
  }

  const result = await CustomInvoiceRepository.updateStatusConditional(id, existing.status, { status: "CANCELLED" });
  if (result.count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This invoice was already changed by someone else — reload and try again.", { id });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "custom_invoices",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: existing.status },
    newValues: { status: "CANCELLED" },
  });

  return CustomInvoiceRepository.findByIdWithDetails(actor.companyId, id);
}

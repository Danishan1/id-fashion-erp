import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { prisma } from "@/core/db/client";
import { round2 } from "@/lib/money";
import type { ListQuery } from "@/lib/list-query";
import { Prisma } from "@prisma/client";
import type { CustomInvoiceCreditNoteInput } from "./custom-invoice-credit-note.schema";
import { CustomInvoiceCreditNoteRepository } from "./custom-invoice-credit-note.repository";
import { CustomInvoiceRepository } from "./custom-invoice.repository";
import { computeBalanceDue } from "./custom-invoice.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export async function listCustomInvoiceCreditNotes(companyId: string, query: ListQuery) {
  const where: Prisma.CustomInvoiceCreditNoteWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { creditNoteNumber: { contains: query.search, mode: "insensitive" as const } },
            { customInvoice: { invoiceNumber: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    CustomInvoiceCreditNoteRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    CustomInvoiceCreditNoteRepository.count(where),
  ]);

  return { data, totalCount };
}

interface ResolvedLine {
  customInvoiceItemId: string;
  quantity: number | null;
  amount: number;
}

// PRODUCT_WISE takes the caller's own amount at face value (bounds-checked
// below); PRODUCT_RETURN derives the amount from the line's own effective
// per-unit rate (lineTotal / quantity), so a returned quantity always
// credits back exactly the discounted+taxed rate that was actually billed —
// never the raw list price.
function resolveLines(
  type: CustomInvoiceCreditNoteInput["type"],
  inputItems: CustomInvoiceCreditNoteInput["items"],
  invoiceItems: { id: string; quantity: unknown; lineTotal: unknown; creditedAmount: unknown }[]
): ResolvedLine[] {
  return inputItems.map((line) => {
    const item = invoiceItems.find((i) => i.id === line.customInvoiceItemId);
    if (!item) {
      throw new BusinessRuleError("NOT_FOUND", "One of the selected item lines doesn't belong to this invoice.", {
        customInvoiceItemId: line.customInvoiceItemId,
      });
    }

    if (type === "PRODUCT_RETURN") {
      const itemQuantity = Number(item.quantity);
      const itemLineTotal = Number(item.lineTotal);
      const ratePerUnit = itemQuantity > 0 ? itemLineTotal / itemQuantity : 0;
      return { customInvoiceItemId: item.id, quantity: line.quantity!, amount: round2(line.quantity! * ratePerUnit) };
    }
    // PRODUCT_WISE
    return { customInvoiceItemId: item.id, quantity: null, amount: round2(line.amount!) };
  });
}

function assertLinesWithinRemaining(lines: ResolvedLine[], invoiceItems: { id: string; lineTotal: unknown; creditedAmount: unknown }[]) {
  for (const line of lines) {
    const item = invoiceItems.find((i) => i.id === line.customInvoiceItemId)!;
    const remaining = round2(Number(item.lineTotal) - Number(item.creditedAmount));
    if (line.amount > remaining) {
      throw new BusinessRuleError(
        "OVER_CREDIT_NOTE_NOT_ALLOWED",
        `This line's credit amount exceeds what's left to credit on that item. Available: ${remaining.toFixed(2)}, Requested: ${line.amount.toFixed(2)}.`,
        { customInvoiceItemId: line.customInvoiceItemId, available: remaining, requested: line.amount }
      );
    }
  }
}

export async function issueCustomInvoiceCreditNote(actor: ActorContext, customInvoiceId: string, input: CustomInvoiceCreditNoteInput) {
  const invoice = await CustomInvoiceRepository.findByIdWithDetails(actor.companyId, customInvoiceId);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Custom invoice not found.", { customInvoiceId });
  if (invoice.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot issue a credit note against a cancelled invoice.", { customInvoiceId });
  }

  let lines: ResolvedLine[] = [];
  let totalAmount: number;

  if (input.type === "OVERALL_DISCOUNT") {
    totalAmount = round2(input.amount!);
  } else {
    lines = resolveLines(input.type, input.items, invoice.items);
    assertLinesWithinRemaining(lines, invoice.items);
    totalAmount = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  }

  const availableOnInvoice = round2(Number(invoice.grandTotal) - Number(invoice.creditedAmount));
  if (totalAmount > availableOnInvoice) {
    throw new BusinessRuleError(
      "OVER_CREDIT_NOTE_NOT_ALLOWED",
      `This credit note exceeds what's left to credit on the invoice. Available: ${availableOnInvoice.toFixed(2)}, Requested: ${totalAmount.toFixed(2)}.`,
      { available: availableOnInvoice, requested: totalAmount }
    );
  }

  // Drawn before the transaction — same "a number pulled just before a
  // downstream check fails is never reused" tradeoff already accepted
  // project-wide for every other document-numbering call site.
  const creditNoteNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "CUSTOM_INVOICE_CREDIT_NOTE",
  });

  const creditNote = await prisma.$transaction(async (tx) => {
    const guard = await tx.customInvoice.updateMany({
      where: { id: customInvoiceId, creditedAmount: invoice.creditedAmount },
      data: { creditedAmount: { increment: totalAmount } },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("OVER_CREDIT_NOTE_NOT_ALLOWED", "This invoice was just updated by someone else — reload and try again.", {
        customInvoiceId,
      });
    }

    for (const line of lines) {
      await tx.customInvoiceItem.update({
        where: { id: line.customInvoiceItemId },
        data: { creditedAmount: { increment: line.amount } },
      });
    }

    const refreshed = await tx.customInvoice.findUniqueOrThrow({ where: { id: customInvoiceId } });
    const balanceDue = computeBalanceDue({
      grandTotal: Number(refreshed.grandTotal),
      advancePaymentAmount: refreshed.advancePaymentAmount ? Number(refreshed.advancePaymentAmount) : null,
      payableAmountValue: refreshed.payableAmountValue ? Number(refreshed.payableAmountValue) : null,
      paidAmount: Number(refreshed.paidAmount),
      creditedAmount: Number(refreshed.creditedAmount),
    });
    await tx.customInvoice.update({ where: { id: customInvoiceId }, data: { balanceDue } });

    return tx.customInvoiceCreditNote.create({
      data: {
        companyId: actor.companyId,
        customInvoiceId,
        creditNoteNumber,
        creditNoteDate: new Date(input.creditNoteDate),
        type: input.type,
        reason: input.reason || null,
        totalAmount,
        createdByUserId: actor.userId,
        items: {
          create: lines.map((l) => ({ customInvoiceItemId: l.customInvoiceItemId, quantity: l.quantity, amount: l.amount })),
        },
      },
      include: { createdBy: { select: { id: true, fullName: true } }, items: true },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "custom_invoice_credit_notes",
    recordId: creditNote.id,
    action: "CREATE",
    newValues: creditNote,
  });

  return creditNote;
}

export async function cancelCustomInvoiceCreditNote(actor: ActorContext, creditNoteId: string) {
  const creditNote = await CustomInvoiceCreditNoteRepository.findAnyById(actor.companyId, creditNoteId);
  if (!creditNote) throw new BusinessRuleError("NOT_FOUND", "Credit note not found.", { creditNoteId });
  if (creditNote.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This credit note is already cancelled.", { creditNoteId });
  }

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.customInvoice.findUniqueOrThrow({ where: { id: creditNote.customInvoiceId } });

    const guard = await tx.customInvoice.updateMany({
      where: { id: creditNote.customInvoiceId, creditedAmount: invoice.creditedAmount },
      data: { creditedAmount: { decrement: Number(creditNote.totalAmount) } },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This invoice was just updated by someone else — reload and try again.", {
        customInvoiceId: creditNote.customInvoiceId,
      });
    }

    for (const line of creditNote.items) {
      await tx.customInvoiceItem.update({
        where: { id: line.customInvoiceItemId },
        data: { creditedAmount: { decrement: Number(line.amount) } },
      });
    }

    const refreshed = await tx.customInvoice.findUniqueOrThrow({ where: { id: creditNote.customInvoiceId } });
    const balanceDue = computeBalanceDue({
      grandTotal: Number(refreshed.grandTotal),
      advancePaymentAmount: refreshed.advancePaymentAmount ? Number(refreshed.advancePaymentAmount) : null,
      payableAmountValue: refreshed.payableAmountValue ? Number(refreshed.payableAmountValue) : null,
      paidAmount: Number(refreshed.paidAmount),
      creditedAmount: Number(refreshed.creditedAmount),
    });
    await tx.customInvoice.update({ where: { id: creditNote.customInvoiceId }, data: { balanceDue } });

    const cnGuard = await tx.customInvoiceCreditNote.updateMany({
      where: { id: creditNoteId, status: "ISSUED" },
      data: { status: "CANCELLED" },
    });
    if (cnGuard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This credit note was already cancelled by someone else.", { creditNoteId });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "custom_invoice_credit_notes",
    recordId: creditNoteId,
    action: "UPDATE",
    oldValues: { status: "ISSUED" },
    newValues: { status: "CANCELLED" },
  });

  return CustomInvoiceCreditNoteRepository.findAnyById(actor.companyId, creditNoteId);
}

import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import { round2 } from "@/lib/money";
import { CustomerRepository } from "@/modules/customers/customer.repository";

interface LedgerEntry {
  date: string;
  type: "INVOICE" | "PAYMENT" | "CREDIT_NOTE";
  reference: string;
  invoiceId: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

// A per-customer statement of every Custom Invoice, payment, and credit
// note — the "client transaction history" the reference tool's own Report
// card provides. Deliberately excludes CANCELLED invoices entirely rather
// than showing a debit-then-reversal pair: cancelCustomInvoice() only ever
// succeeds while paidAmount/creditedAmount are both still 0 (see
// custom-invoice.service.ts), so a cancelled invoice never had any real
// financial activity to show in the first place.
export async function getCustomInvoiceClientLedger(companyId: string, customerId: string) {
  const customer = await CustomerRepository.findByIdWithBuyers(companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { customerId });

  const invoices = await prisma.customInvoice.findMany({
    where: { companyId, customerId, status: { not: "CANCELLED" } },
    include: {
      payments: { where: { status: "RECORDED" } },
      creditNotes: { where: { status: "ISSUED" } },
    },
    orderBy: { invoiceDate: "asc" },
  });

  const rawEntries: Omit<LedgerEntry, "runningBalance">[] = [];
  for (const invoice of invoices) {
    rawEntries.push({
      date: invoice.invoiceDate.toISOString(),
      type: "INVOICE",
      reference: invoice.invoiceNumber,
      invoiceId: invoice.id,
      debit: Number(invoice.grandTotal),
      credit: 0,
    });
    for (const payment of invoice.payments) {
      rawEntries.push({
        date: payment.paymentDate.toISOString(),
        type: "PAYMENT",
        reference: invoice.invoiceNumber,
        invoiceId: invoice.id,
        debit: 0,
        credit: Number(payment.amount),
      });
    }
    for (const creditNote of invoice.creditNotes) {
      rawEntries.push({
        date: creditNote.creditNoteDate.toISOString(),
        type: "CREDIT_NOTE",
        reference: creditNote.creditNoteNumber,
        invoiceId: invoice.id,
        debit: 0,
        credit: Number(creditNote.totalAmount),
      });
    }
  }

  rawEntries.sort((a, b) => a.date.localeCompare(b.date));

  let runningBalance = 0;
  const entries: LedgerEntry[] = rawEntries.map((e) => {
    runningBalance = round2(runningBalance + e.debit - e.credit);
    return { ...e, runningBalance };
  });

  const totalInvoiced = round2(invoices.reduce((sum, i) => sum + Number(i.grandTotal), 0));
  const totalPaid = round2(invoices.reduce((sum, i) => sum + Number(i.paidAmount), 0));
  const totalCredited = round2(invoices.reduce((sum, i) => sum + Number(i.creditedAmount), 0));

  return {
    customer: { id: customer.id, name: customer.name, code: customer.code },
    entries,
    totalInvoiced,
    totalPaid,
    totalCredited,
    netOutstanding: round2(totalInvoiced - totalPaid - totalCredited),
  };
}

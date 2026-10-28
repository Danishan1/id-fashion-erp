import { round2 } from "@/lib/money";
import { extractStateCodeFromGstin } from "@/lib/gst";
import { calculatePayableInvoice, isInterStateSupply } from "@/lib/payables-gst";
import type { GstInvoiceInput } from "./gst-invoice.schema";

/**
 * Server side of the shared GST invoice block (2026-10-28): recomputes every
 * amount from the lines and builds the journal lines the paying request type
 * posts. Pure — no database access — so the owning services decide where it
 * is saved and which accounts are used.
 */

export function computeGstInvoice(input: GstInvoiceInput, companyGstin: string | null | undefined) {
  const companyStateCode = extractStateCodeFromGstin(companyGstin);
  const placeOfSupplyStateCode = input.placeOfSupplyStateCode || companyStateCode || null;
  const isInterState = isInterStateSupply(companyStateCode, placeOfSupplyStateCode);
  const totals = calculatePayableInvoice(input.lines, { isInterState, isReverseCharge: input.isReverseCharge });

  const lines = input.lines.map((line, i) => {
    const r = totals.lines[i];
    return {
      lineNumber: i + 1,
      description: line.description,
      isForStock: line.isForStock,
      purposeId: line.purposeId || null,
      expenseAccountId: line.expenseAccountId || null,
      productId: line.productId || null,
      hsnCode: line.hsnCode || null,
      mrp: line.mrp ?? null,
      rate: line.rate,
      quantity: line.quantity,
      discountPercentage: line.discountPercentage ?? null,
      discountAmount: r.discountAmount,
      taxableAmount: r.taxableAmount,
      gstRate: line.gstRate,
      cgstRate: r.cgstRate,
      cgstAmount: r.cgstAmount,
      sgstRate: r.sgstRate,
      sgstAmount: r.sgstAmount,
      igstRate: r.igstRate,
      igstAmount: r.igstAmount,
      lineAmount: r.lineAmount,
    };
  });

  return {
    header: {
      invoiceNumber: input.invoiceNumber,
      invoiceDate: new Date(input.invoiceDate),
      isItcApplicable: input.isItcApplicable,
      isReverseCharge: input.isReverseCharge,
      placeOfSupplyStateCode,
      payToGstin: input.payToGstin || null,
      isRawMaterialForProduction: input.isRawMaterialForProduction,
      invoiceTaxableTotal: totals.taxableTotal,
      invoiceGstTotal: totals.gstTotal,
      invoiceDiscountTotal: totals.discountTotal,
      invoiceGrandTotal: totals.grandTotal,
    },
    lines,
    isInterState,
    /** The request amount: what we pay the party (taxable only under RCM). */
    payableToParty: totals.payableToParty,
  };
}

export interface GstJournalLine {
  accountId: string;
  debitAmount: number;
  creditAmount: number;
  description: string;
}

/**
 * Journal for a GST invoice:
 * - ITC=Y, RCM=N: Dr line accounts (taxable) + Dr GST-ITC / Cr payable (grand total)
 * - ITC=N, RCM=N: Dr line accounts (taxable + GST) / Cr payable (grand total)
 * - RCM=Y, ITC=Y: Dr line accounts (taxable) + Dr GST-ITC / Cr GST-RCM-PAY / Cr payable (taxable)
 * - RCM=Y, ITC=N: Dr line accounts (taxable + GST) / Cr GST-RCM-PAY / Cr payable (taxable)
 * Debits to the same account are combined. Every line must carry an account.
 */
export function buildGstInvoiceJournalLines(params: {
  lines: { expenseAccountId: string | null; taxableAmount: number; cgstAmount: number; sgstAmount: number; igstAmount: number }[];
  isItcApplicable: boolean;
  isReverseCharge: boolean;
  accounts: { payableAccountId: string; gstItcAccountId?: string; gstRcmPayableAccountId?: string };
  narration: string;
}): GstJournalLine[] {
  const { lines, isItcApplicable, isReverseCharge, accounts, narration } = params;

  const debits = new Map<string, number>();
  let gstTotal = 0;
  let taxableTotal = 0;
  for (const line of lines) {
    if (!line.expenseAccountId) throw new Error("Every invoice line needs an account to debit.");
    const gst = round2(line.cgstAmount + line.sgstAmount + line.igstAmount);
    gstTotal = round2(gstTotal + gst);
    taxableTotal = round2(taxableTotal + line.taxableAmount);
    const amount = isItcApplicable ? line.taxableAmount : round2(line.taxableAmount + gst);
    debits.set(line.expenseAccountId, round2((debits.get(line.expenseAccountId) ?? 0) + amount));
  }

  const out: GstJournalLine[] = [];
  for (const [accountId, amount] of debits) {
    if (amount > 0) out.push({ accountId, debitAmount: amount, creditAmount: 0, description: narration });
  }
  if (isItcApplicable && gstTotal > 0) {
    if (!accounts.gstItcAccountId) throw new Error("GST input credit account is missing.");
    out.push({ accountId: accounts.gstItcAccountId, debitAmount: gstTotal, creditAmount: 0, description: `${narration} — GST input credit` });
  }
  if (isReverseCharge && gstTotal > 0) {
    if (!accounts.gstRcmPayableAccountId) throw new Error("GST reverse-charge payable account is missing.");
    out.push({ accountId: accounts.gstRcmPayableAccountId, debitAmount: 0, creditAmount: gstTotal, description: `${narration} — GST payable (reverse charge)` });
  }
  const payable = isReverseCharge ? taxableTotal : round2(taxableTotal + gstTotal);
  if (payable > 0) out.push({ accountId: accounts.payableAccountId, debitAmount: 0, creditAmount: payable, description: narration });
  return out;
}

/** Control accounts this block may need (created lazily by the owning service). */
export const GST_CONTROL_ACCOUNTS = {
  itc: { code: "GST-ITC", name: "GST Input Tax Credit", accountType: "ASSET" as const },
  rcmPayable: { code: "GST-RCM-PAY", name: "GST Payable (Reverse Charge)", accountType: "LIABILITY" as const },
};

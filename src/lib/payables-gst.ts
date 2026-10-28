import { round2 } from "./money";

/**
 * GST for bills we PAY (payment requests: tax invoice, supplier bill,
 * adjustment) — 2026-10-28. Client-safe: the invoice-lines editor previews
 * with it and the server recomputes with the same functions, so the screen and
 * the saved totals can't disagree.
 *
 * Differs from calculateLineGst (src/lib/gst.ts, used for sales): under
 * Reverse Charge the GST is still worked out — the buyer (us) owes it to the
 * government — it just isn't paid to the party, so the amount payable is the
 * taxable value. ITC only changes the journal (claimable vs. part of cost),
 * never the numbers here.
 */

export interface PayableLineInput {
  rate: number;
  quantity: number;
  /** Discount as a %. When given it wins over discountAmount. */
  discountPercentage?: number | null;
  discountAmount?: number | null;
  gstRate: number;
}

export interface PayableLineResult {
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  taxAmount: number;
  /** taxable + GST (what the line is worth on the invoice). */
  lineAmount: number;
}

export function calculatePayableLine(line: PayableLineInput, isInterState: boolean): PayableLineResult {
  const grossAmount = round2(line.rate * line.quantity);
  const discountAmount =
    line.discountPercentage != null && line.discountPercentage > 0
      ? round2((grossAmount * line.discountPercentage) / 100)
      : round2(Math.min(line.discountAmount ?? 0, grossAmount));
  const taxableAmount = round2(grossAmount - discountAmount);
  const taxAmount = round2((taxableAmount * line.gstRate) / 100);

  // Intra-state halves exactly: CGST rounded, SGST takes the odd paisa.
  const cgstAmount = isInterState ? 0 : round2(taxAmount / 2);
  const sgstAmount = isInterState ? 0 : round2(taxAmount - cgstAmount);
  const half = round2(line.gstRate / 2);
  return {
    grossAmount,
    discountAmount,
    taxableAmount,
    cgstRate: isInterState ? 0 : half,
    cgstAmount,
    sgstRate: isInterState ? 0 : round2(line.gstRate - half),
    sgstAmount,
    igstRate: isInterState ? line.gstRate : 0,
    igstAmount: isInterState ? taxAmount : 0,
    taxAmount,
    lineAmount: round2(taxableAmount + taxAmount),
  };
}

export interface PayableInvoiceTotals {
  isInterState: boolean;
  lines: PayableLineResult[];
  taxableTotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  gstTotal: number;
  /** Sum of line amounts (taxable + GST) — the invoice's own grand total. */
  grandTotal: number;
  /** What we pay the party: grand total, or only the taxable value under RCM. */
  payableToParty: number;
}

/**
 * Inter-state = the place of supply differs from our own state. If either is
 * unknown the bill is treated as intra-state (CGST + SGST).
 */
export function isInterStateSupply(companyStateCode: string | null | undefined, placeOfSupplyStateCode: string | null | undefined) {
  return Boolean(companyStateCode && placeOfSupplyStateCode && companyStateCode !== placeOfSupplyStateCode);
}

export function calculatePayableInvoice(
  lines: PayableLineInput[],
  opts: { isInterState: boolean; isReverseCharge: boolean }
): PayableInvoiceTotals {
  const results = lines.map((l) => calculatePayableLine(l, opts.isInterState));
  const sum = (pick: (r: PayableLineResult) => number) => round2(results.reduce((s, r) => s + pick(r), 0));
  const taxableTotal = sum((r) => r.taxableAmount);
  const gstTotal = sum((r) => r.taxAmount);
  const grandTotal = sum((r) => r.lineAmount);
  return {
    isInterState: opts.isInterState,
    lines: results,
    taxableTotal,
    discountTotal: sum((r) => r.discountAmount),
    cgstTotal: sum((r) => r.cgstAmount),
    sgstTotal: sum((r) => r.sgstAmount),
    igstTotal: sum((r) => r.igstAmount),
    gstTotal,
    grandTotal,
    payableToParty: opts.isReverseCharge ? taxableTotal : grandTotal,
  };
}

/** HSN/SAC: 4, 6 or 8 digits. */
export function isValidHsn(code: string) {
  return /^(\d{4}|\d{6}|\d{8})$/.test(code);
}

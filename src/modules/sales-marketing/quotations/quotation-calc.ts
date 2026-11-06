import { round2 } from "@/lib/money";
import { calculatePayableLine, isInterStateSupply, type PayableLineResult } from "@/lib/payables-gst";

/**
 * Quotation calculation (Sales & Marketing S2, 2026-10-28). Client-safe and
 * pure: the editor previews with it and the server recomputes with it before
 * saving, so the screen and the stored totals can't disagree. Totals sent by a
 * client are never trusted — the server ignores them and runs this.
 *
 * It reuses the ERP's existing GST line maths (`calculatePayableLine` in
 * src/lib/payables-gst.ts) instead of a second tax engine. Order and rounding:
 *
 *   per line   gross    = round2(qty × unit price)
 *              discount = round2(gross × discount% / 100)
 *              taxable  = gross − discount
 *              GST      = round2(taxable × GST% / 100)
 *              intra-state: CGST = round2(GST / 2), SGST = GST − CGST (odd paisa to SGST)
 *              inter-state: IGST = GST
 *              line total = taxable + GST
 *   charges    freight and other charges are each a taxable amount with their
 *              own GST rate, worked out exactly like a line (qty 1, no discount)
 *   totals     sums of the rounded line / charge values (never re-rounded from
 *              unrounded figures), each rounded to 2 decimals
 *   grand      taxable lines + charges + GST
 *
 * Rounding is half-up to the paisa (`round2`). Zero-priced lines are allowed
 * (e.g. a free sample line); quantity must be > 0; discount 0–100 %; no
 * negative amounts.
 */

export interface QuotationCalcLine {
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstRate: number;
}

export interface QuotationCalcInput {
  lines: QuotationCalcLine[];
  freightAmount: number;
  freightGstRate: number;
  otherChargesAmount: number;
  otherChargesGstRate: number;
  companyStateCode: string | null;
  placeOfSupplyStateCode: string | null;
}

export interface QuotationCalcResult {
  isInterState: boolean;
  lines: PayableLineResult[];
  freight: PayableLineResult;
  otherCharges: PayableLineResult;
  subtotalAmount: number;
  discountTotal: number;
  taxableTotal: number;
  chargesTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  grandTotal: number;
}

export function calculateQuotation(input: QuotationCalcInput): QuotationCalcResult {
  const isInterState = isInterStateSupply(input.companyStateCode, input.placeOfSupplyStateCode);
  const lines = input.lines.map((l) =>
    calculatePayableLine({ rate: l.unitPrice, quantity: l.quantity, discountPercentage: l.discountPercent, gstRate: l.gstRate }, isInterState)
  );
  const charge = (amount: number, gstRate: number) => calculatePayableLine({ rate: amount, quantity: 1, gstRate }, isInterState);
  const freight = charge(input.freightAmount, input.freightGstRate);
  const otherCharges = charge(input.otherChargesAmount, input.otherChargesGstRate);

  const all = [...lines, freight, otherCharges];
  const sum = (items: PayableLineResult[], pick: (r: PayableLineResult) => number) => round2(items.reduce((s, r) => s + pick(r), 0));
  const taxableTotal = sum(lines, (r) => r.taxableAmount);
  const chargesTotal = round2(freight.taxableAmount + otherCharges.taxableAmount);
  const taxTotal = sum(all, (r) => r.taxAmount);

  return {
    isInterState,
    lines,
    freight,
    otherCharges,
    subtotalAmount: sum(lines, (r) => r.grossAmount),
    discountTotal: sum(lines, (r) => r.discountAmount),
    taxableTotal,
    chargesTotal,
    cgstTotal: sum(all, (r) => r.cgstAmount),
    sgstTotal: sum(all, (r) => r.sgstAmount),
    igstTotal: sum(all, (r) => r.igstAmount),
    taxTotal,
    grandTotal: round2(taxableTotal + chargesTotal + taxTotal),
  };
}

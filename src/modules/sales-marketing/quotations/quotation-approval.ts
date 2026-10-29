import { round2 } from "@/lib/money";

/**
 * Quotation approval rule (decision D2, S3 2026-10-28). Client-safe and pure.
 * A revision needs approval when ANY line discount is above the company's
 * limit OR the grand total is above the company's limit (Sales & Marketing
 * settings; defaults 10 % and ₹5,00,000). The approver must be someone other
 * than whoever created, last saved or submitted the revision.
 */

export interface ApprovalLimits {
  maxDiscountPercent: number;
  maxTotal: number;
}

export interface ApprovalInput {
  lines: { lineNumber: number; discountPercent: number }[];
  grandTotal: number;
}

/** Plain-language reasons, one per rule that fires; empty = no approval needed. */
export function approvalReasons(input: ApprovalInput, limits: ApprovalLimits): string[] {
  const reasons: string[] = [];
  const over = input.lines.filter((l) => l.discountPercent > limits.maxDiscountPercent);
  if (over.length) {
    const top = Math.max(...over.map((l) => l.discountPercent));
    reasons.push(`Discount ${top}% on line${over.length > 1 ? "s" : ""} ${over.map((l) => l.lineNumber).join(", ")} is above the ${limits.maxDiscountPercent}% limit`);
  }
  if (round2(input.grandTotal) > round2(limits.maxTotal)) {
    reasons.push(`Total ₹${input.grandTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })} is above the ₹${limits.maxTotal.toLocaleString("en-IN")} limit`);
  }
  return reasons;
}

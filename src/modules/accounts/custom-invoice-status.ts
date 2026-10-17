import { round2 } from "@/lib/money";

export const CUSTOM_INVOICE_STATUS_LABELS = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially Paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
} as const;

export type CustomInvoiceDerivedStatus = keyof typeof CUSTOM_INVOICE_STATUS_LABELS;

export const CUSTOM_INVOICE_STATUS_BADGE_CLASS: Record<CustomInvoiceDerivedStatus, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  ISSUED: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  PARTIALLY_PAID: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  CANCELLED: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-700 dark:text-zinc-400",
};

/**
 * Computes the canonical user-facing derived lifecycle status of a Custom Invoice.
 *
 * Rules:
 * 1. CANCELLED: If invoice.status === "CANCELLED", always CANCELLED.
 * 2. PAID: If balanceDue <= 0 and (paidAmount > 0 or creditedAmount > 0 or grandTotal == 0).
 * 3. PARTIALLY_PAID: If balanceDue > 0 and (paidAmount > 0 or creditedAmount > 0).
 * 4. ISSUED: If active with no payments or credit adjustments recorded yet.
 */
export function getDerivedCustomInvoiceStatus(invoice: {
  status: string;
  balanceDue: number | string | { toString(): string };
  paidAmount?: number | string | { toString(): string } | null;
  creditedAmount?: number | string | { toString(): string } | null;
  grandTotal?: number | string | { toString(): string } | null;
}): CustomInvoiceDerivedStatus {
  if (invoice.status === "CANCELLED") {
    return "CANCELLED";
  }

  const balance = round2(Number(invoice.balanceDue));
  const paid = round2(Number(invoice.paidAmount ?? 0));
  const credited = round2(Number(invoice.creditedAmount ?? 0));
  const grandTotal = round2(Number(invoice.grandTotal ?? 0));

  if (balance <= 0 && (paid > 0 || credited > 0 || grandTotal === 0)) {
    return "PAID";
  }

  if (paid > 0 || credited > 0) {
    return "PARTIALLY_PAID";
  }

  return "ISSUED";
}

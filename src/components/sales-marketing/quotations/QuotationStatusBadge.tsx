import { QUOTATION_STATUSES, type QuotationStatus } from "@/modules/sales-marketing/quotations/quotation-registry";
import { TONE_BADGE } from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";

export function QuotationStatusBadge({ status }: { status: QuotationStatus }) {
  const meta = QUOTATION_STATUSES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_BADGE[meta?.tone ?? "neutral"]}`}>{meta?.label ?? status}</span>
  );
}

export const formatInr = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

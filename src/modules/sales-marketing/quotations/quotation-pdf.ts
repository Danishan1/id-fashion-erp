import { formatDocDate, formatMoney, getCompanyHeaderLines } from "@/core/documents/company-header";
import type { BusinessDocumentDescriptor } from "@/core/documents/document-pdf";
import { GST_STATE_CODES } from "@/lib/gst";
import { QUOTATION_REVISION_STATUSES } from "./quotation-registry";
import type { getQuotation } from "./quotation.service";

type QuotationDetail = Awaited<ReturnType<typeof getQuotation>>;

interface Snapshot {
  companyName: string;
  companyDetailLines: string[];
  partyName: string;
  partyLines: string[];
}

const qty = (v: unknown) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/**
 * Customer-facing quotation PDF (S3), built on the shared business-document
 * template. An issued revision prints from the letterhead/party snapshot taken
 * at issue, so it reproduces exactly; a draft prints live data and is marked
 * as not valid for the customer. Internal notes are never printed.
 */
export async function buildQuotationPdfDescriptor(q: QuotationDetail, generatedByName: string): Promise<BusinessDocumentDescriptor> {
  const r = q.current;
  const cur = r.currencyCode;
  const snap = r.documentSnapshot as Snapshot | null;
  const live = snap ? null : await getCompanyHeaderLines(q.companyId);
  const issued = Boolean(r.issuedAt);
  const isDraft = ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(r.status);
  const pos = r.placeOfSupplyStateCode ?? r.companyStateCode;

  const rows = r.lines.map((l) => ({
    no: String(l.lineNumber),
    item: [l.description, l.colorSizeRemarks, l.customerReference ? `Ref: ${l.customerReference}` : null, l.requestedDeliveryDate ? `Delivery: ${formatDocDate(l.requestedDeliveryDate)}` : null]
      .filter(Boolean)
      .join("\n"),
    qty: `${qty(l.quantity)}${l.uom ? ` ${l.uom.code}` : ""}`,
    rate: formatMoney(l.unitPrice, cur),
    disc: Number(l.discountPercent) ? `${Number(l.discountPercent)}%` : "—",
    taxable: formatMoney(l.taxableAmount, cur),
    gst: Number(l.gstRate) ? `${Number(l.gstRate)}%\n${formatMoney(l.taxAmount, cur)}` : "—",
    total: formatMoney(l.lineTotal, cur),
  }));
  for (const [label, amount, gst] of [
    ["Freight", r.freightAmount, r.freightGstRate],
    [r.otherChargesLabel ?? "Other charges", r.otherChargesAmount, r.otherChargesGstRate],
  ] as const) {
    if (Number(amount) > 0) rows.push({ no: "", item: label, qty: "", rate: "", disc: "", taxable: formatMoney(amount, cur), gst: Number(gst) ? `${Number(gst)}%` : "—", total: "" });
  }

  const totals: BusinessDocumentDescriptor["totalsLines"] = [{ label: "Gross", value: formatMoney(r.subtotalAmount, cur) }];
  if (Number(r.discountTotal) > 0) totals.push({ label: "Discount", value: `- ${formatMoney(r.discountTotal, cur)}` });
  totals.push({ label: "Taxable value", value: formatMoney(Number(r.taxableTotal) + Number(r.chargesTotal), cur) });
  if (r.isInterState) totals.push({ label: "IGST", value: formatMoney(r.igstTotal, cur) });
  else {
    totals.push({ label: "CGST", value: formatMoney(r.cgstTotal, cur) });
    totals.push({ label: "SGST", value: formatMoney(r.sgstTotal, cur) });
  }
  totals.push({ label: "Grand total", value: formatMoney(r.grandTotal, cur), final: true });

  return {
    companyName: snap?.companyName ?? live!.companyName,
    companyDetailLines: snap?.companyDetailLines ?? live!.companyDetailLines,
    docTitle: isDraft ? "Draft Quotation" : "Quotation",
    docNumber: `${q.quotationNumber}${r.revisionNumber > 1 ? ` / Rev ${r.revisionNumber}` : ""}`,
    docDate: formatDocDate(r.quotationDate),
    statusLabel: isDraft ? "DRAFT — not valid for acceptance" : QUOTATION_REVISION_STATUSES[r.status],
    partyLabel: "Quotation for",
    partyName: snap?.partyName ?? q.customer?.name ?? q.prospectName ?? "",
    partyDetailLines: snap?.partyLines ?? [r.billingAddress, q.buyer ? `Buyer: ${q.buyer.name}` : null].filter((v): v is string => Boolean(v)),
    metaLines: [
      { label: "Valid until", value: formatDocDate(r.validUntil) },
      ...(pos ? [{ label: "Place of supply", value: `${pos} ${GST_STATE_CODES[pos] ?? ""}`.trim() }] : []),
      ...(r.paymentTermsDays !== null ? [{ label: "Payment terms", value: `${r.paymentTermsDays} days` }] : []),
      ...(q.buyerEnquiry ? [{ label: "Your enquiry", value: q.buyerEnquiry.enquiryNumber }] : []),
      ...(issued ? [{ label: "Issued", value: formatDocDate(r.issuedAt!) }] : []),
    ],
    columns: [
      { key: "no", label: "#", width: "4%" },
      { key: "item", label: "Item", width: "30%" },
      { key: "qty", label: "Qty", align: "right", width: "9%" },
      { key: "rate", label: "Rate", align: "right", width: "11%" },
      { key: "disc", label: "Disc.", align: "right", width: "6%" },
      { key: "taxable", label: "Taxable", align: "right", width: "13%" },
      { key: "gst", label: r.isInterState ? "IGST" : "GST (C+S)", align: "right", width: "13%" },
      { key: "total", label: "Amount", align: "right", width: "14%" },
    ],
    rows,
    totalsLines: totals,
    sections: [
      { title: "Introduction", body: r.introduction ?? "" },
      { title: "Delivery terms", body: r.deliveryTerms ?? "" },
      { title: "Notes", body: r.customerNotes ?? "" },
      { title: "Terms & conditions", body: r.termsAndConditions ?? "" },
      { title: "Shipping address", body: r.shippingAddress ?? "" },
    ],
    footerNote: isDraft ? "This is a draft for internal review and is not an offer." : undefined,
    generatedAt: new Date().toLocaleString("en-IN"),
    generatedByName,
  };
}

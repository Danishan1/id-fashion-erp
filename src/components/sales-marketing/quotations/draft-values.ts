import type { QuotationDraftValues, QuotationLineDraft } from "./QuotationEditor";

/**
 * Turns a saved quotation or an enquiry prefill into the editor's string
 * fields. Plain module (no client/server-only code) so server pages can call it.
 */

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const d = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");
let seq = 0;
const key = () => `k${(seq++).toString(36)}`;

interface LineLike {
  productId?: string | null;
  sampleRequestId?: string | null;
  buyerEnquiryLineId?: string | null;
  description: string;
  colorSizeRemarks?: string | null;
  customerReference?: string | null;
  quantity: unknown;
  uomId?: string | null;
  unitPrice: unknown;
  discountPercent?: unknown;
  taxRateId?: string | null;
  requestedDeliveryDate?: unknown;
  notes?: string | null;
}

export function toLineDraft(l: LineLike): QuotationLineDraft {
  return {
    key: key(),
    kind: l.sampleRequestId ? "DESIGN" : l.productId ? "STYLE" : "FREE_TEXT",
    productId: s(l.productId),
    sampleRequestId: s(l.sampleRequestId),
    buyerEnquiryLineId: s(l.buyerEnquiryLineId),
    description: l.description,
    colorSizeRemarks: s(l.colorSizeRemarks),
    customerReference: s(l.customerReference),
    quantity: s(Number(l.quantity)),
    uomId: s(l.uomId),
    unitPrice: s(Number(l.unitPrice)),
    discountPercent: s(Number(l.discountPercent ?? 0)),
    taxRateId: s(l.taxRateId),
    requestedDeliveryDate: d(l.requestedDeliveryDate),
    notes: s(l.notes),
  };
}

export function toDraftValues(src: Record<string, unknown> & { lines: LineLike[] }): QuotationDraftValues {
  return {
    customerId: s(src.customerId),
    buyerId: s(src.buyerId),
    prospectName: s(src.prospectName),
    crmCompanyId: s(src.crmCompanyId),
    crmContactId: s(src.crmContactId),
    ownerUserId: s(src.ownerUserId),
    title: s(src.title),
    quotationDate: d(src.quotationDate),
    validUntil: d(src.validUntil),
    placeOfSupplyStateCode: s(src.placeOfSupplyStateCode),
    billingAddress: s(src.billingAddress),
    shippingAddress: s(src.shippingAddress),
    paymentTermsDays: s(src.paymentTermsDays),
    deliveryTerms: s(src.deliveryTerms),
    introduction: s(src.introduction),
    customerNotes: s(src.customerNotes),
    internalNotes: s(src.internalNotes),
    termsAndConditions: s(src.termsAndConditions),
    freightAmount: src.freightAmount === undefined ? "0" : s(Number(src.freightAmount)),
    freightTaxRateId: s(src.freightTaxRateId),
    otherChargesLabel: s(src.otherChargesLabel),
    otherChargesAmount: src.otherChargesAmount === undefined ? "0" : s(Number(src.otherChargesAmount)),
    otherChargesTaxRateId: s(src.otherChargesTaxRateId),
    lines: src.lines.map(toLineDraft),
  };
}

let keySeq = 0;
export const newLineKey = () => `l${Date.now().toString(36)}${(keySeq++).toString(36)}`;

/** A blank Style line for the editor. */
export function emptyLine(): QuotationLineDraft {
  return {
    key: newLineKey(),
    kind: "STYLE",
    productId: "",
    sampleRequestId: "",
    buyerEnquiryLineId: "",
    description: "",
    colorSizeRemarks: "",
    customerReference: "",
    quantity: "",
    uomId: "",
    unitPrice: "",
    discountPercent: "0",
    taxRateId: "",
    requestedDeliveryDate: "",
    notes: "",
  };
}

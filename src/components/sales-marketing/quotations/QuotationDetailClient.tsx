"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AttachmentsPanel } from "@/components/ui/AttachmentsPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { getApiErrorMessage } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { GST_STATE_CODES } from "@/lib/gst";
import { QUOTATION_LINE_TYPES, QUOTATION_REVISION_STATUSES, QUOTATION_STATUSES, type QuotationLineType, type QuotationRevisionStatus, type QuotationStatus } from "@/modules/sales-marketing/quotations/quotation-registry";
import { SALES_ENQUIRY_STAGES, type SalesEnquiryStage } from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";
import type { SalesMarketingPagePermissions } from "@/modules/sales-marketing/sales-marketing-page";
import { QuotationStatusBadge, formatInr } from "./QuotationStatusBadge";
import { TotalsCard } from "./QuotationEditor";

type Num = string;

interface QuotationLineView {
  id: string;
  lineNumber: number;
  lineType: QuotationLineType;
  description: string;
  colorSizeRemarks: string | null;
  customerReference: string | null;
  quantity: Num;
  unitPrice: Num;
  discountPercent: Num;
  gstRate: Num;
  taxableAmount: Num;
  cgstAmount: Num;
  sgstAmount: Num;
  igstAmount: Num;
  taxAmount: Num;
  lineTotal: Num;
  requestedDeliveryDate: string | null;
  product: { id: string; styleName: string; styleCode: string } | null;
  sampleRequest: { id: string; requestNumber: string; status: string } | null;
  uom: { code: string } | null;
  taxRate: { name: string } | null;
}

export interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: QuotationStatus;
  currentRevisionNumber: number;
  prospectName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  customer: { id: string; name: string; code: string } | null;
  buyer: { id: string; name: string } | null;
  buyerEnquiry: { id: string; enquiryNumber: string; subject: string | null; salesStage: SalesEnquiryStage } | null;
  crmCompany: { id: string; name: string } | null;
  crmContact: { id: string; fullName: string } | null;
  owner: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string };
  revisions: { id: string; revisionNumber: number; status: QuotationRevisionStatus; grandTotal: Num; updatedAt: string }[];
  current: {
    revisionNumber: number;
    status: QuotationRevisionStatus;
    title: string;
    quotationDate: string;
    validUntil: string;
    currencyCode: string;
    companyStateCode: string | null;
    placeOfSupplyStateCode: string | null;
    isInterState: boolean;
    billingAddress: string | null;
    shippingAddress: string | null;
    paymentTermsDays: number | null;
    deliveryTerms: string | null;
    introduction: string | null;
    customerNotes: string | null;
    internalNotes: string | null;
    termsAndConditions: string | null;
    freightAmount: Num;
    freightGstRate: Num;
    otherChargesLabel: string | null;
    otherChargesAmount: Num;
    otherChargesGstRate: Num;
    subtotalAmount: Num;
    discountTotal: Num;
    taxableTotal: Num;
    chargesTotal: Num;
    cgstTotal: Num;
    sgstTotal: Num;
    igstTotal: Num;
    taxTotal: Num;
    grandTotal: Num;
    version: number;
    lines: QuotationLineView[];
  };
}

const CARD = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const qty = (v: Num) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{children}</dd>
    </div>
  );
}

export function QuotationDetailClient({ initialQuotation, permissions }: { initialQuotation: QuotationDetail; permissions: SalesMarketingPagePermissions }) {
  const [q, setQ] = useState(initialQuotation);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = q.current;
  const isDraft = q.status === "DRAFT" && c.status === "DRAFT";
  const state = (code: string | null) => (code ? `${code} · ${GST_STATE_CODES[code] ?? ""}` : "—");

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-marketing/quotations/${q.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);
    if (!res.ok) return setError(await getApiErrorMessage(res));
    setQ((await res.json()).data);
    setCancelOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <QuotationStatusBadge status={q.status} />
          <span className="text-zinc-600 dark:text-zinc-300">
            Revision {c.revisionNumber} · {QUOTATION_REVISION_STATUSES[c.status]}
          </span>
          <span className="text-zinc-600 dark:text-zinc-300">
            Owner: <strong className="font-medium">{q.owner?.fullName ?? "Unassigned"}</strong>
          </span>
          <span className="text-zinc-600 dark:text-zinc-300">Valid until {formatDate(c.validUntil)}</span>
          <strong className="tabular-nums">{formatInr(c.grandTotal)}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft && permissions.quotations.edit && (
            <Link href={`/sales-marketing/quotations/${q.id}/edit`} className={buttonClasses("primary", "xs")}>
              Edit draft
            </Link>
          )}
          {isDraft && permissions.quotations.cancel && (
            <Button size="xs" variant="secondary" onClick={() => (setError(null), setCancelOpen(true))}>
              Cancel quotation
            </Button>
          )}
        </div>
      </div>
      {isDraft && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Draft — not yet sent to the customer. Approval, PDF and issuing come with the next release step; a free-text line must be linked to a Style before conversion.
        </p>
      )}
      {q.status === "CANCELLED" && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          Cancelled{q.cancelledAt ? ` on ${formatDate(q.cancelledAt)}` : ""}: {q.cancellationReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Details">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Field label="Customer / prospect">
                {q.customer ? q.customer.name : <>{q.prospectName} <span className="text-xs text-amber-600 dark:text-amber-400">(prospect)</span></>}
              </Field>
              <Field label="Buyer">{q.buyer?.name ?? "—"}</Field>
              <Field label="Enquiry">
                {q.buyerEnquiry ? (
                  permissions.view ? (
                    <Link href={`/sales-marketing/enquiries/${q.buyerEnquiry.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {q.buyerEnquiry.enquiryNumber}
                    </Link>
                  ) : (
                    q.buyerEnquiry.enquiryNumber
                  )
                ) : (
                  "—"
                )}
                {q.buyerEnquiry && <span className="ml-1 text-xs text-zinc-500">({SALES_ENQUIRY_STAGES[q.buyerEnquiry.salesStage]?.label})</span>}
              </Field>
              <Field label="Quotation date">{formatDate(c.quotationDate)}</Field>
              <Field label="Place of supply">{state(c.placeOfSupplyStateCode ?? c.companyStateCode)}</Field>
              <Field label="GST">{c.isInterState ? "IGST (inter-state)" : "CGST + SGST"}</Field>
              <Field label="Payment terms">{c.paymentTermsDays !== null ? `${c.paymentTermsDays} days` : "—"}</Field>
              <Field label="Delivery terms">{c.deliveryTerms ?? "—"}</Field>
              <Field label="CRM">{[q.crmCompany?.name, q.crmContact?.fullName].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="Billing address">{c.billingAddress ?? "—"}</Field>
              <Field label="Shipping address">{c.shippingAddress ?? "—"}</Field>
              <Field label="Created">
                {q.createdBy.fullName} · {formatDateTime(q.createdAt)}
              </Field>
            </dl>
            {c.introduction && <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{c.introduction}</p>}
          </Section>

          <Section title={`Lines (${c.lines.length})`}>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="py-2 pr-3 font-medium">#</th>
                    <th className="py-2 pr-3 font-medium">Item</th>
                    <th className="py-2 pr-3 text-right font-medium">Qty</th>
                    <th className="py-2 pr-3 text-right font-medium">Price</th>
                    <th className="py-2 pr-3 text-right font-medium">Disc.</th>
                    <th className="py-2 pr-3 text-right font-medium">Taxable</th>
                    <th className="py-2 pr-3 text-right font-medium">GST</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {c.lines.map((l) => (
                    <tr key={l.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800">
                      <td className="py-2 pr-3 text-zinc-500">{l.lineNumber}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{l.description}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {QUOTATION_LINE_TYPES[l.lineType].label}
                          {l.product && ` · ${l.product.styleCode}`}
                          {l.sampleRequest && ` · ${l.sampleRequest.requestNumber}`}
                          {l.colorSizeRemarks && ` · ${l.colorSizeRemarks}`}
                          {l.customerReference && ` · Ref ${l.customerReference}`}
                          {l.requestedDeliveryDate && ` · Delivery ${formatDate(l.requestedDeliveryDate)}`}
                        </div>
                        {l.lineType === "FREE_TEXT" && <div className="text-xs text-amber-700 dark:text-amber-400">Needs a Style before conversion</div>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {qty(l.quantity)} {l.uom?.code ?? ""}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInr(l.unitPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{Number(l.discountPercent) ? `${Number(l.discountPercent)}%` : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInr(l.taxableAmount)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatInr(l.taxAmount)}
                        <div className="text-xs text-zinc-500">{Number(l.gstRate) ? `${Number(l.gstRate)}%${c.isInterState ? " IGST" : ""}` : "No GST"}</div>
                      </td>
                      <td className="py-2 text-right font-medium tabular-nums">{formatInr(l.lineTotal)}</td>
                    </tr>
                  ))}
                  {Number(c.freightAmount) > 0 && (
                    <tr className="text-zinc-600 dark:text-zinc-300">
                      <td />
                      <td className="py-2 pr-3" colSpan={4}>Freight {Number(c.freightGstRate) ? `(GST ${Number(c.freightGstRate)}%)` : ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInr(c.freightAmount)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                  {Number(c.otherChargesAmount) > 0 && (
                    <tr className="text-zinc-600 dark:text-zinc-300">
                      <td />
                      <td className="py-2 pr-3" colSpan={4}>{c.otherChargesLabel ?? "Other charges"} {Number(c.otherChargesGstRate) ? `(GST ${Number(c.otherChargesGstRate)}%)` : ""}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInr(c.otherChargesAmount)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {(c.customerNotes || c.termsAndConditions || c.internalNotes) && (
            <Section title="Notes & terms">
              <dl className="space-y-3">
                {c.customerNotes && <Field label="Notes for the customer">{c.customerNotes}</Field>}
                {c.termsAndConditions && <Field label="Terms & conditions">{c.termsAndConditions}</Field>}
                {c.internalNotes && <Field label="Internal notes">{c.internalNotes}</Field>}
              </dl>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <TotalsCard preview={c} otherLabel={c.otherChargesLabel ?? undefined} />
          <Section title="Revisions">
            <ul className="space-y-1 text-sm">
              {q.revisions.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    Rev {r.revisionNumber} · {QUOTATION_REVISION_STATUSES[r.status]}
                  </span>
                  <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{formatInr(r.grandTotal)}</span>
                </li>
              ))}
            </ul>
          </Section>
          <AttachmentsPanel module="quotation" recordId={q.id} canEdit={permissions.quotations.edit && q.status !== "CANCELLED"} title="Attachments" labelForContext={(s) => QUOTATION_STATUSES[s as QuotationStatus]?.label ?? s} />
        </div>
      </div>

      {cancelOpen && (
        <Modal open onClose={() => setCancelOpen(false)} title="Cancel quotation">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              cancel();
            }}
          >
            <FormField label="Reason" htmlFor="cancel-reason" required>
              <textarea id="cancel-reason" required minLength={3} maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={textInputClass()} />
            </FormField>
            {q.buyerEnquiry && <p className="text-xs text-zinc-500">If this is the enquiry&apos;s only open quotation, the enquiry goes back to Qualified.</p>}
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCancelOpen(false)}>
                Keep it
              </Button>
              <Button type="submit" variant="danger" isLoading={busy}>
                Cancel quotation
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AttachmentsPanel } from "@/components/ui/AttachmentsPanel";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/components/ui/Toast";
import { getApiErrorMessage } from "@/lib/api-client";
import { todayIsoDate } from "@/lib/date";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { GST_STATE_CODES } from "@/lib/gst";
import {
  DECISION_METHODS,
  QUOTATION_EVENT_TYPES,
  QUOTATION_LINE_TYPES,
  QUOTATION_REVISION_STATUSES,
  QUOTATION_STATUSES,
  SENT_METHODS,
  type QuotationEventType,
  type QuotationLineType,
  type QuotationRevisionStatus,
  type QuotationStatus,
} from "@/modules/sales-marketing/quotations/quotation-registry";
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
  taxAmount: Num;
  lineTotal: Num;
  requestedDeliveryDate: string | null;
  product: { id: string; styleName: string; styleCode: string } | null;
  sampleRequest: { id: string; requestNumber: string; status: string } | null;
  uom: { code: string } | null;
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
  isCurrentRevision: boolean;
  isExpired: boolean;
  approvalPreview: string[] | null;
  viewerCanApprove: boolean;
  people: { submittedBy: string | null; approvedBy: string | null; issuedBy: string | null; sentBy: string | null; decisionRecordedBy: string | null };
  customer: { id: string; name: string; code: string } | null;
  buyer: { id: string; name: string } | null;
  buyerEnquiry: { id: string; enquiryNumber: string; subject: string | null; salesStage: SalesEnquiryStage } | null;
  crmCompany: { id: string; name: string } | null;
  crmContact: { id: string; fullName: string } | null;
  owner: { id: string; fullName: string } | null;
  createdBy: { id: string; fullName: string };
  revisions: { id: string; revisionNumber: number; status: QuotationRevisionStatus; grandTotal: Num; revisionReason: string | null; issuedAt: string | null; createdAt: string }[];
  events: { id: string; revisionNumber: number; type: QuotationEventType; comment: string | null; metadata: Record<string, unknown>; createdAt: string; createdBy: { fullName: string } | null }[];
  current: {
    revisionNumber: number;
    status: QuotationRevisionStatus;
    title: string;
    quotationDate: string;
    validUntil: string;
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
    revisionReason: string | null;
    approvalRequired: boolean;
    approvalReasons: string[];
    submittedAt: string | null;
    approvedAt: string | null;
    approvalComment: string | null;
    issuedAt: string | null;
    sentAt: string | null;
    sentTo: string | null;
    sentMethod: keyof typeof SENT_METHODS | null;
    customerDecisionAt: string | null;
    decisionMethod: keyof typeof DECISION_METHODS | null;
    customerReference: string | null;
    decisionComment: string | null;
    lines: QuotationLineView[];
  };
}

const CARD = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const qty = (v: Num) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {actions}
      </div>
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

// ── Generic action dialog ────────────────────────────────────────

interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "textarea" | "date" | "select";
  required?: boolean;
  options?: Record<string, string>;
  defaultValue?: string;
  max?: string;
  min?: string;
}

interface ActionSpec {
  action: string;
  title: string;
  help?: string;
  submitLabel: string;
  danger?: boolean;
  fields: FieldSpec[];
}

function ActionDialog({ spec, busy, error, onClose, onSubmit }: { spec: ActionSpec; busy: boolean; error: string | null; onClose: () => void; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(spec.fields.map((f) => [f.name, f.defaultValue ?? ""])));
  return (
    <Modal open onClose={onClose} title={spec.title}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(values);
        }}
      >
        {spec.help && <p className="text-sm text-zinc-600 dark:text-zinc-300">{spec.help}</p>}
        {spec.fields.map((f) => {
          const id = `act-${f.name}`;
          const common = { id, required: f.required, value: values[f.name], className: textInputClass() };
          const set = (v: string) => setValues((prev) => ({ ...prev, [f.name]: v }));
          return (
            <FormField key={f.name} label={f.label} htmlFor={id} required={f.required}>
              {f.type === "textarea" ? (
                <textarea {...common} rows={3} maxLength={1000} minLength={f.required ? 3 : undefined} onChange={(e) => set(e.target.value)} />
              ) : f.type === "select" ? (
                <select {...common} onChange={(e) => set(e.target.value)}>
                  {!f.required && <option value="">—</option>}
                  {Object.entries(f.options ?? {}).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...common} type={f.type} max={f.max} min={f.min} maxLength={f.type === "text" ? 300 : undefined} onChange={(e) => set(e.target.value)} />
              )}
            </FormField>
          );
        })}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" variant={spec.danger ? "danger" : "primary"} isLoading={busy} loadingLabel="Saving…">
            {spec.submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function QuotationDetailClient({ initialQuotation, permissions }: { initialQuotation: QuotationDetail; permissions: SalesMarketingPagePermissions }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuotation);
  const [dialog, setDialog] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = q.current;
  const p = permissions.quotations;
  const today = todayIsoDate();
  const live = q.isCurrentRevision;
  const issuedOn = c.issuedAt ? c.issuedAt.slice(0, 10) : undefined;
  const state = (code: string | null) => (code ? `${code} · ${GST_STATE_CODES[code] ?? ""}` : "—");
  const pdfUrl = (inline: boolean) => `/api/v1/sales-marketing/quotations/${q.id}/pdf?revision=${c.revisionNumber}${inline ? "&disposition=inline" : ""}`;

  const run = async (action: string, body: Record<string, string> = {}) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-marketing/quotations/${q.id}/actions/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== ""))),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res));
      return;
    }
    const { data } = await res.json();
    setDialog(null);
    if (data?.visible === false) {
      toast.success("Done. This quotation is no longer in your list.");
      router.push("/sales-marketing/quotations");
      return;
    }
    setQ(data);
    if (action === "revise") router.push(`/sales-marketing/quotations/${q.id}/edit`);
  };

  const open = (spec: ActionSpec) => {
    setError(null);
    if (spec.fields.length === 0 && !spec.help) return run(spec.action);
    setDialog(spec);
  };

  // What can be done now, per status (the server re-checks everything).
  const actions: { label: string; spec: ActionSpec; variant?: "primary" | "secondary" | "danger"; disabled?: string }[] = [];
  if (live) {
    const comment: FieldSpec = { name: "comment", label: "Comment (optional)", type: "textarea" };
    if (q.status === "DRAFT" && p.edit) {
      if (q.approvalPreview && q.approvalPreview.length > 0) {
        actions.push({ label: "Submit for approval", spec: { action: "submit", title: "Submit for approval", help: `Needs approval: ${q.approvalPreview.join("; ")}.`, submitLabel: "Submit", fields: [comment] } });
      } else {
        actions.push({ label: "Issue", spec: { action: "issue", title: "Issue quotation", help: "Issuing freezes this revision. Any later change needs a new revision.", submitLabel: "Issue", fields: [] } });
      }
    }
    if (q.status === "PENDING_APPROVAL") {
      if (q.viewerCanApprove) actions.push({ label: "Approve", spec: { action: "approve", title: "Approve quotation", help: c.approvalReasons.join("; "), submitLabel: "Approve", fields: [comment] } });
      if (p.reject) actions.push({ label: "Decline", variant: "secondary", spec: { action: "decline", title: "Send back to draft", submitLabel: "Decline", danger: true, fields: [{ name: "reason", label: "Reason", type: "textarea", required: true }] } });
    }
    if (q.status === "APPROVED" && p.edit) {
      actions.push({ label: "Issue", spec: { action: "issue", title: "Issue quotation", help: "Issuing freezes this revision. Any later change needs a new revision.", submitLabel: "Issue", fields: [] } });
    }
    if ((q.status === "PENDING_APPROVAL" || q.status === "APPROVED") && p.edit) {
      actions.push({ label: "Return to draft", variant: "secondary", spec: { action: "return-to-draft", title: "Return to draft", help: "The approval request or approval is cleared so the draft can be changed.", submitLabel: "Return to draft", fields: [comment] } });
    }
    if (q.status === "ISSUED" && p.edit) {
      actions.push({
        label: c.sentAt ? "Mark sent again" : "Mark as sent",
        variant: "secondary",
        spec: {
          action: "mark-sent",
          title: "Mark as sent",
          help: "Records how the PDF reached the customer. The ERP doesn't send e-mails itself.",
          submitLabel: "Save",
          fields: [
            { name: "sentTo", label: "Sent to", type: "text", required: true },
            { name: "method", label: "How", type: "select", required: true, options: SENT_METHODS, defaultValue: "EMAIL" },
            { name: "sentOn", label: "Sent on", type: "date", required: true, defaultValue: today, max: today, min: issuedOn },
            comment,
          ],
        },
      });
      actions.push({
        label: "Record acceptance",
        disabled: q.isExpired ? "Expired — make a new revision" : undefined,
        spec: {
          action: "accept",
          title: `Customer accepted revision ${c.revisionNumber}`,
          help: `Valid until ${formatDate(c.validUntil)}. Attach the PO or signed copy under Attachments.`,
          submitLabel: "Record acceptance",
          fields: [
            { name: "decisionDate", label: "Accepted on", type: "date", required: true, defaultValue: today, max: today, min: issuedOn },
            { name: "method", label: "How", type: "select", required: true, options: DECISION_METHODS, defaultValue: "PURCHASE_ORDER" },
            { name: "customerReference", label: "Customer reference (PO number)", type: "text" },
            comment,
          ],
        },
      });
      actions.push({
        label: "Record rejection",
        variant: "secondary",
        spec: {
          action: "reject",
          title: `Customer rejected revision ${c.revisionNumber}`,
          submitLabel: "Record rejection",
          danger: true,
          fields: [
            { name: "decisionDate", label: "Rejected on", type: "date", required: true, defaultValue: today, max: today, min: issuedOn },
            { name: "method", label: "How", type: "select", options: DECISION_METHODS },
            { name: "reason", label: "Reason", type: "textarea", required: true },
          ],
        },
      });
    }
    if ((q.status === "ISSUED" || q.status === "REJECTED") && p.edit) {
      actions.push({
        label: "New revision",
        variant: "secondary",
        spec: { action: "revise", title: "Start a new revision", help: `Revision ${c.revisionNumber + 1} starts as a draft copy${q.status === "ISSUED" ? `; revision ${c.revisionNumber} becomes superseded and can no longer be accepted` : ""}.`, submitLabel: "Start revision", fields: [{ name: "reason", label: "Why", type: "textarea", required: true }] },
      });
    }
    if (["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED"].includes(q.status) && p.cancel) {
      actions.push({ label: q.status === "ISSUED" ? "Withdraw" : "Cancel", variant: "danger", spec: { action: "cancel", title: q.status === "ISSUED" ? "Withdraw quotation" : "Cancel quotation", help: q.buyerEnquiry ? "If this is the enquiry's only open quotation, the enquiry goes back to Qualified." : undefined, submitLabel: "Cancel quotation", danger: true, fields: [{ name: "reason", label: "Reason", type: "textarea", required: true }] } });
    }
  }

  return (
    <div className="space-y-4">
      {!live && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          You are looking at revision {c.revisionNumber} ({QUOTATION_REVISION_STATUSES[c.status].toLowerCase()}).{" "}
          <Link href={`/sales-marketing/quotations/${q.id}`} className="font-medium underline">
            Go to the current revision ({q.currentRevisionNumber})
          </Link>
        </p>
      )}

      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {live ? <QuotationStatusBadge status={q.status} /> : <span className="text-xs font-medium">{QUOTATION_REVISION_STATUSES[c.status]}</span>}
          {q.isExpired && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Expired</span>}
          <span className="text-zinc-600 dark:text-zinc-300">Revision {c.revisionNumber}</span>
          <span className="text-zinc-600 dark:text-zinc-300">
            Owner: <strong className="font-medium">{q.owner?.fullName ?? "Unassigned"}</strong>
          </span>
          <span className="text-zinc-600 dark:text-zinc-300">Valid until {formatDate(c.validUntil)}</span>
          <strong className="tabular-nums">{formatInr(c.grandTotal)}</strong>
        </div>
        <div className="flex flex-wrap gap-2">
          {live && c.status === "DRAFT" && p.edit && (
            <Link href={`/sales-marketing/quotations/${q.id}/edit`} className={buttonClasses("secondary", "xs")}>
              Edit draft
            </Link>
          )}
          {actions.map((a) => (
            <Button key={a.spec.action} size="xs" variant={a.variant ?? "primary"} disabled={busy || Boolean(a.disabled)} title={a.disabled} onClick={() => open(a.spec)}>
              {a.label}
            </Button>
          ))}
          {p.print && (
            <a href={pdfUrl(true)} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "xs")}>
              PDF
            </a>
          )}
        </div>
      </div>
      {error && !dialog && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {live && c.status === "DRAFT" && q.approvalPreview && q.approvalPreview.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Needs approval before issue: {q.approvalPreview.join("; ")}.</p>
      )}
      {live && c.status === "DRAFT" && c.approvalComment && <p className="text-xs text-red-700 dark:text-red-400">Sent back by the approver: {c.approvalComment}</p>}
      {q.status === "ACCEPTED" && live && (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          Accepted — converting it to a Sales Order comes with the next release step.
        </p>
      )}
      {q.status === "CANCELLED" && live && (
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
              {c.revisionReason && (
                <div className="sm:col-span-3">
                  <Field label={`Why revision ${c.revisionNumber}`}>{c.revisionReason}</Field>
                </div>
              )}
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
                      <td className="py-2 pr-3" colSpan={4}>
                        Freight {Number(c.freightGstRate) ? `(GST ${Number(c.freightGstRate)}%)` : ""}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatInr(c.freightAmount)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                  {Number(c.otherChargesAmount) > 0 && (
                    <tr className="text-zinc-600 dark:text-zinc-300">
                      <td />
                      <td className="py-2 pr-3" colSpan={4}>
                        {c.otherChargesLabel ?? "Other charges"} {Number(c.otherChargesGstRate) ? `(GST ${Number(c.otherChargesGstRate)}%)` : ""}
                      </td>
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
                {c.internalNotes && <Field label="Internal notes (not printed)">{c.internalNotes}</Field>}
              </dl>
            </Section>
          )}

          <Section title="History">
            <ol className="space-y-3">
              {q.events.map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                  <div className="min-w-0">
                    <div className="text-zinc-900 dark:text-zinc-100">
                      <span className="font-medium">{QUOTATION_EVENT_TYPES[e.type] ?? e.type}</span>
                      <span className="text-zinc-500"> · rev {e.revisionNumber}</span>
                      {e.type === "SENT" && typeof e.metadata.sentTo === "string" && <span> — to {e.metadata.sentTo}</span>}
                      {e.type === "ACCEPTED" && typeof e.metadata.customerReference === "string" && <span> — ref {e.metadata.customerReference}</span>}
                      {e.comment && <span className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300"> — {e.comment}</span>}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {e.createdBy?.fullName ?? "—"} · {formatDateTime(e.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-4">
          <TotalsCard preview={c} otherLabel={c.otherChargesLabel ?? undefined} />
          {(c.approvalRequired || c.submittedAt || c.approvedAt) && (
            <Section title="Approval">
              <dl className="space-y-2">
                {c.approvalReasons.length > 0 && <Field label="Why">{c.approvalReasons.join("\n")}</Field>}
                {c.submittedAt && <Field label="Submitted">{`${q.people.submittedBy ?? "—"} · ${formatDateTime(c.submittedAt)}`}</Field>}
                {c.approvedAt && <Field label="Approved">{`${q.people.approvedBy ?? "—"} · ${formatDateTime(c.approvedAt)}${c.approvalComment ? `\n${c.approvalComment}` : ""}`}</Field>}
              </dl>
            </Section>
          )}
          {(c.issuedAt || c.sentAt || c.customerDecisionAt) && (
            <Section title="Customer">
              <dl className="space-y-2">
                {c.issuedAt && <Field label="Issued">{`${q.people.issuedBy ?? "—"} · ${formatDateTime(c.issuedAt)}`}</Field>}
                {c.sentAt && <Field label="Sent">{`${formatDate(c.sentAt)} · ${c.sentMethod ? SENT_METHODS[c.sentMethod] : ""} to ${c.sentTo ?? "—"}\nrecorded by ${q.people.sentBy ?? "—"}`}</Field>}
                {c.customerDecisionAt && (
                  <Field label={c.status === "REJECTED" ? "Rejected" : "Accepted"}>
                    {`${formatDate(c.customerDecisionAt)}${c.decisionMethod ? ` · ${DECISION_METHODS[c.decisionMethod]}` : ""}${c.customerReference ? ` · ${c.customerReference}` : ""}${c.decisionComment ? `\n${c.decisionComment}` : ""}\nrecorded by ${q.people.decisionRecordedBy ?? "—"}`}
                  </Field>
                )}
              </dl>
            </Section>
          )}
          <Section title="Revisions">
            <ul className="space-y-1.5 text-sm">
              {q.revisions.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <Link
                    href={r.revisionNumber === q.currentRevisionNumber ? `/sales-marketing/quotations/${q.id}` : `/sales-marketing/quotations/${q.id}?revision=${r.revisionNumber}`}
                    className={r.revisionNumber === c.revisionNumber ? "font-semibold" : "text-indigo-600 hover:underline dark:text-indigo-400"}
                    title={r.revisionReason ?? undefined}
                  >
                    Rev {r.revisionNumber} · {QUOTATION_REVISION_STATUSES[r.status]}
                  </Link>
                  <span className="tabular-nums text-zinc-600 dark:text-zinc-300">{formatInr(r.grandTotal)}</span>
                </li>
              ))}
            </ul>
          </Section>
          <AttachmentsPanel
            module="quotation"
            recordId={q.id}
            canEdit={p.edit && q.status !== "CANCELLED"}
            title="Attachments"
            labelForContext={(s) => QUOTATION_STATUSES[s as QuotationStatus]?.label ?? s}
          />
        </div>
      </div>

      {dialog && <ActionDialog key={dialog.action} spec={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSubmit={(values) => run(dialog.action, values)} />}
    </div>
  );
}

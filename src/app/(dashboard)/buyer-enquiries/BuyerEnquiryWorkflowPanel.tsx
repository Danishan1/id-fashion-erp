"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import {
  LINE_STATUS_BADGE_CLASS,
  LINE_STATUS_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
} from "./statusLabels";
import { SAMPLE_TYPE_LABELS } from "../sampling/sampleTypeLabels";
import { formatDate } from "@/lib/date-format";
import { suggestCodeFromName } from "@/lib/code-suggest";

type EnquiryStatus = keyof typeof STATUS_LABELS;
type LineStatus = keyof typeof LINE_STATUS_LABELS;

interface SampleRequestRef {
  id: string;
  requestNumber: string;
  status: string;
}

interface LineRow {
  id: string;
  productId: string | null;
  styleNameFreeText: string | null;
  description: string | null;
  colorRemarks: string | null;
  targetQuantity: string | null;
  targetUnitPrice: string | null;
  targetDeliveryDate: string | null;
  remarks: string | null;
  lineStatus: LineStatus;
  rejectionReason: string | null;
  product: { id: string; styleName: string; styleCode: string } | null;
  size: { id: string; name: string } | null;
  sampleRequest: SampleRequestRef | null;
}

interface EnquiryDetail {
  id: string;
  status: EnquiryStatus;
  customer: { id: string; name: string } | null;
  buyer: { name: string } | null;
  prospectName: string | null;
  prospectContactPerson: string | null;
  prospectEmail: string | null;
  prospectPhone: string | null;
  prospectCountry: string | null;
  lines: LineRow[];
}

const STATUS_HELP: Record<EnquiryStatus, string> = {
  OPEN: "Review each line below and decide whether it's worth sampling.",
  PARTIALLY_CONVERTED: "Some lines have already been converted to Sample Requests; others are still open.",
  CLOSED: "Every line has reached a final outcome (converted or rejected).",
  CANCELLED: "This enquiry was cancelled. Lines already converted to a Sample Request are unaffected.",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function BuyerEnquiryWorkflowPanel({
  buyerEnquiryId,
  initialEnquiry,
}: {
  buyerEnquiryId: string;
  initialEnquiry: EnquiryDetail;
}) {
  const [enquiry, setEnquiry] = useState(initialEnquiry);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refresh = async () => {
    const res = await fetch(`/api/v1/buyer-enquiries/${buyerEnquiryId}`);
    const body = await res.json();
    if (res.ok) setEnquiry(body.data);
  };

  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    const res = await action();
    if (!res.ok) {
      setError(await parseErrorMessage(res, fallbackError));
      setIsBusy(false);
      return false;
    }
    await refresh();
    setIsBusy(false);
    return true;
  };

  const setLineStatus = (lineId: string, lineStatus: string, rejectionReason?: string) =>
    run(
      () =>
        fetch(`/api/v1/buyer-enquiries/lines/${lineId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lineStatus, rejectionReason }),
        }),
      "Failed to change this line's status."
    );

  const cancelEnquiry = () =>
    run(() => fetch(`/api/v1/buyer-enquiries/${buyerEnquiryId}/cancel`, { method: "POST" }), "Failed to cancel this enquiry.");

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[enquiry.status]}`}>
          {STATUS_LABELS[enquiry.status]}
        </span>
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">{STATUS_HELP[enquiry.status]}</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!enquiry.customer && enquiry.status !== "CANCELLED" && (
        <LinkCustomerPanel
          buyerEnquiryId={buyerEnquiryId}
          prospectName={enquiry.prospectName}
          prospectContactPerson={enquiry.prospectContactPerson}
          prospectEmail={enquiry.prospectEmail}
          prospectPhone={enquiry.prospectPhone}
          prospectCountry={enquiry.prospectCountry}
          onLinked={refresh}
        />
      )}

      {(enquiry.status === "OPEN" || enquiry.status === "PARTIALLY_CONVERTED") && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>
          <ActionButton label="Cancel Enquiry" onClick={cancelEnquiry} isBusy={isBusy} variant="danger" />
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Enquiry Lines</h2>
        {enquiry.lines.map((line) => (
          <EnquiryLineCard
            key={line.id}
            line={line}
            enquiryStatus={enquiry.status}
            enquiryCustomerId={enquiry.customer?.id ?? null}
            isBusy={isBusy}
            onSetStatus={setLineStatus}
            onConverted={refresh}
          />
        ))}
      </div>
    </div>
  );
}

function EnquiryLineCard({
  line,
  enquiryStatus,
  enquiryCustomerId,
  isBusy,
  onSetStatus,
  onConverted,
}: {
  line: LineRow;
  enquiryStatus: EnquiryStatus;
  enquiryCustomerId: string | null;
  isBusy: boolean;
  onSetStatus: (lineId: string, lineStatus: string, rejectionReason?: string) => Promise<boolean>;
  onConverted: () => Promise<void>;
}) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [showConvertForm, setShowConvertForm] = useState(false);

  const displayName = line.product?.styleName ?? line.styleNameFreeText ?? "Untitled line";
  const enquiryIsCancelled = enquiryStatus === "CANCELLED";

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {displayName}
            {line.product && <span className="ml-1 text-xs text-zinc-400">({line.product.styleCode})</span>}
          </p>
          {line.description && <p className="mt-0.5 text-xs text-zinc-500">{line.description}</p>}
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${LINE_STATUS_BADGE_CLASS[line.lineStatus]}`}>
          {LINE_STATUS_LABELS[line.lineStatus]}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-5 gap-3 text-xs text-zinc-600 dark:text-zinc-300">
        <div>
          <dt className="text-zinc-400">Color</dt>
          <dd>{line.colorRemarks ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Size</dt>
          <dd>{line.size?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Target Qty</dt>
          <dd>{line.targetQuantity ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Target Price</dt>
          <dd>{line.targetUnitPrice ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Target Delivery</dt>
          <dd>{line.targetDeliveryDate ? formatDate(line.targetDeliveryDate) : "—"}</dd>
        </div>
      </dl>
      {line.remarks && <p className="mt-2 text-xs text-zinc-500">Remarks: {line.remarks}</p>}

      {line.lineStatus === "REJECTED" && line.rejectionReason && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">Rejected: {line.rejectionReason}</p>
      )}

      {line.lineStatus === "CONVERTED" && line.sampleRequest && (
        <p className="mt-2 text-xs text-green-700 dark:text-green-400">
          Converted to Sample Request{" "}
          <Link href={`/sampling/${line.sampleRequest.id}`} className="font-medium underline">
            {line.sampleRequest.requestNumber}
          </Link>
          {" "}({line.sampleRequest.status.replace(/_/g, " ")})
        </p>
      )}

      {!enquiryIsCancelled && line.lineStatus !== "REJECTED" && line.lineStatus !== "CONVERTED" && (
        <div className="mt-3 space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            {line.lineStatus === "PENDING_REVIEW" && (
              <>
                <ActionButton
                  label="Approve for Sampling"
                  onClick={() => onSetStatus(line.id, "APPROVED_FOR_SAMPLING")}
                  isBusy={isBusy}
                />
                <ActionButton
                  label="Put On Hold"
                  onClick={() => onSetStatus(line.id, "ON_HOLD")}
                  isBusy={isBusy}
                  variant="secondary"
                />
              </>
            )}

            {line.lineStatus === "APPROVED_FOR_SAMPLING" && (
              <>
                {enquiryCustomerId ? (
                  <ActionButton
                    label="Convert to Sample Request"
                    onClick={() => setShowConvertForm((v) => !v)}
                    isBusy={isBusy}
                  />
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Link a real Customer to this enquiry before converting — see the notice above.
                  </p>
                )}
                <ActionButton
                  label="Put On Hold"
                  onClick={() => onSetStatus(line.id, "ON_HOLD")}
                  isBusy={isBusy}
                  variant="secondary"
                />
              </>
            )}

            {line.lineStatus === "ON_HOLD" && (
              <>
                <ActionButton
                  label="Resume to Pending Review"
                  onClick={() => onSetStatus(line.id, "PENDING_REVIEW")}
                  isBusy={isBusy}
                  variant="secondary"
                />
                <ActionButton
                  label="Resume to Approved for Sampling"
                  onClick={() => onSetStatus(line.id, "APPROVED_FOR_SAMPLING")}
                  isBusy={isBusy}
                />
              </>
            )}

            <ActionButton
              label="Reject"
              onClick={() => setShowRejectForm((v) => !v)}
              isBusy={isBusy}
              variant="danger"
            />
          </div>

          {showRejectForm && (
            <div className="max-w-md space-y-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-900/10">
              <FormField label="Rejection reason" htmlFor={`reject-reason-${line.id}`} required>
                <input
                  id={`reject-reason-${line.id}`}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <ActionButton
                label="Confirm Reject"
                onClick={async () => {
                  const ok = await onSetStatus(line.id, "REJECTED", rejectionReason);
                  if (ok) {
                    setShowRejectForm(false);
                    setRejectionReason("");
                  }
                }}
                isBusy={isBusy}
                disabled={!rejectionReason}
                variant="danger"
              />
            </div>
          )}

          {showConvertForm && (
            <ConvertToSampleForm
              line={line}
              isBusy={isBusy}
              onConverted={async () => {
                setShowConvertForm(false);
                await onConverted();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ConvertToSampleForm({
  line,
  isBusy,
  onConverted,
}: {
  line: LineRow;
  isBusy: boolean;
  onConverted: () => Promise<void>;
}) {
  const [styleName, setStyleName] = useState(line.product?.styleName ?? line.styleNameFreeText ?? "");
  const [sampleType, setSampleType] = useState("");
  const [color, setColor] = useState(line.colorRemarks ?? "");
  // Pre-filled from the line's own real Size FK, unlike Color above — still
  // editable here in case the buyer's size changed between raising the
  // enquiry and converting it (see the schema.ts comment on
  // convertEnquiryLineSchema.sizeId).
  const [sizeId, setSizeId] = useState(line.size?.id ?? "");
  const [sizes, setSizes] = useState<Array<{ id: string; name: string }>>([]);
  const [targetSubmissionDate, setTargetSubmissionDate] = useState(line.targetDeliveryDate?.slice(0, 10) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/sizes?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSizes(body.data ?? []));
  }, []);

  const handleConvert = async () => {
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/buyer-enquiries/lines/${line.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        styleName,
        sampleType,
        color: color || undefined,
        sizeId: sizeId || undefined,
        targetSubmissionDate: targetSubmissionDate || undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to convert this line."));
      return;
    }

    await onConverted();
  };

  return (
    <div className="max-w-md space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-900/10">
      <p className="text-xs text-zinc-600 dark:text-zinc-300">
        Review before creating the Sample Request — you can still edit these on the sample itself afterward.
      </p>
      <FormField label="Style Name" htmlFor={`convert-style-${line.id}`} required>
        <input id={`convert-style-${line.id}`} required value={styleName} onChange={(e) => setStyleName(e.target.value)} className={textInputClass()} />
      </FormField>
      <FormField label="Sample Type" htmlFor={`convert-type-${line.id}`} required>
        <select
          id={`convert-type-${line.id}`}
          required
          value={sampleType}
          onChange={(e) => setSampleType(e.target.value)}
          className={textInputClass()}
        >
          <option value="">— Select —</option>
          {Object.entries(SAMPLE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Color" htmlFor={`convert-color-${line.id}`}>
        <input id={`convert-color-${line.id}`} value={color} onChange={(e) => setColor(e.target.value)} className={textInputClass()} />
      </FormField>
      <FormField label="Size" htmlFor={`convert-size-${line.id}`}>
        <select
          id={`convert-size-${line.id}`}
          value={sizeId}
          onChange={(e) => setSizeId(e.target.value)}
          className={textInputClass()}
        >
          <option value="">— Not decided —</option>
          {sizes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Target Submission Date" htmlFor={`convert-date-${line.id}`}>
        <input
          id={`convert-date-${line.id}`}
          type="date"
          value={targetSubmissionDate}
          onChange={(e) => setTargetSubmissionDate(e.target.value)}
          className={textInputClass()}
        />
      </FormField>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <ActionButton
        label="Create Sample Request"
        onClick={handleConvert}
        isBusy={isBusy || isSubmitting}
        disabled={!styleName || !sampleType}
      />
    </div>
  );
}

interface CustomerOption {
  id: string;
  name?: string;
}

/**
 * The action the create form's own "conversion requires a real Customer"
 * warning always implied existed but never did (2026-09-04) — a prospect
 * enquiry has no way to become a real one without this. Shown as a
 * persistent banner (not hidden behind a toggle) since it's the one thing
 * blocking every "Approved for Sampling" line from converting.
 */
function LinkCustomerPanel({
  buyerEnquiryId,
  prospectName,
  prospectContactPerson,
  prospectEmail,
  prospectPhone,
  prospectCountry,
  onLinked,
}: {
  buyerEnquiryId: string;
  prospectName: string | null;
  prospectContactPerson: string | null;
  prospectEmail: string | null;
  prospectPhone: string | null;
  prospectCountry: string | null;
  onLinked: () => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [buyers, setBuyers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openForm = () => {
    setIsOpen(true);
    if (customers.length === 0) {
      fetch("/api/v1/customers?pageSize=200")
        .then((res) => res.json())
        .then((body) => setCustomers(body.data ?? []));
    }
  };

  const selectCustomer = (id: string) => {
    setCustomerId(id);
    setBuyerId("");
    setBuyers([]);
    if (!id) return;
    fetch(`/api/v1/customers/${id}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/buyer-enquiries/${buyerEnquiryId}/link-customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, buyerId: buyerId || undefined }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to link this Customer."));
      return;
    }

    setIsOpen(false);
    await onLinked();
  };

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-900/10">
      <p className="text-sm text-amber-800 dark:text-amber-300">
        {prospectName ? `"${prospectName}" is still a prospect` : "This enquiry has no linked Customer"} — a real
        Customer must be linked before any line here can be converted to a Sample Request.
      </p>

      {!isOpen ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={openForm}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Link a Customer
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Create Customer
          </button>
        </div>
      ) : (
        <div className="mt-3 max-w-md space-y-2">
          <FormField label="Customer" htmlFor="link-customer-id" required>
            <SearchableSelect
              id="link-customer-id"
              required
              value={customerId}
              onChange={selectCustomer}
              options={customers.map((c) => ({ id: c.id, label: c.name ?? "" }))}
              placeholder="Search customer…"
            />
          </FormField>
          <FormField label="Buyer" htmlFor="link-buyer-id">
            <SearchableSelect
              id="link-buyer-id"
              value={buyerId}
              onChange={setBuyerId}
              disabled={!customerId}
              options={buyers.map((b) => ({ id: b.id, label: b.name ?? "" }))}
              placeholder="Search buyer…"
            />
          </FormField>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <ActionButton label="Link Customer" onClick={handleSubmit} isBusy={isSubmitting} disabled={!customerId} />
            <ActionButton label="Cancel" onClick={() => setIsOpen(false)} isBusy={isSubmitting} variant="secondary" />
          </div>
        </div>
      )}

      <CreateCustomerModal
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        prospectName={prospectName}
        prospectContactPerson={prospectContactPerson}
        prospectEmail={prospectEmail}
        prospectPhone={prospectPhone}
        prospectCountry={prospectCountry}
        buyerEnquiryId={buyerEnquiryId}
        onCreated={async () => {
          setIsCreateOpen(false);
          await onLinked();
        }}
      />
    </div>
  );
}

/**
 * "Create Customer" next to "Link a Customer" (2026-09-07) — a prospect
 * enquiry's own captured lead data (name/contact/email/phone/country) had
 * nowhere to go before this except a manual detour to Masters -> Customers,
 * retyping everything by hand. Pre-fills from that same data and, when a
 * contact person/email/phone were actually captured, also creates the
 * matching Buyer (Customer itself has no contact-person/email/phone fields
 * of its own — Buyer is where reachability lives, same shape as the
 * standalone "Add Buyer" form on a Customer's own page) — then links the
 * new Customer (+ Buyer, if created) straight back to this enquiry in one
 * action, through the exact same existing endpoints those flows already
 * use (no new orchestration endpoint).
 */
function CreateCustomerModal({
  open,
  onClose,
  prospectName,
  prospectContactPerson,
  prospectEmail,
  prospectPhone,
  prospectCountry,
  buyerEnquiryId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  prospectName: string | null;
  prospectContactPerson: string | null;
  prospectEmail: string | null;
  prospectPhone: string | null;
  prospectCountry: string | null;
  buyerEnquiryId: string;
  onCreated: () => Promise<void>;
}) {
  const [customerCode, setCustomerCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [country, setCountry] = useState("");
  const [buyerCode, setBuyerCode] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-seed every field fresh on each open — pre-filled from the prospect's
  // own captured data, never from whatever was left over in a previous
  // open/cancel of this same modal.
  const openKey = open ? "open" : "closed";
  const [lastOpenKey, setLastOpenKey] = useState(openKey);
  if (open && lastOpenKey !== openKey) {
    setLastOpenKey(openKey);
    setCustomerName(prospectName ?? "");
    setCountry(prospectCountry ?? "");
    setContactPerson(prospectContactPerson ?? "");
    setEmail(prospectEmail ?? "");
    setPhone(prospectPhone ?? "");
    setBuyerName(prospectContactPerson || prospectName || "");
    setBuyerCode(suggestCodeFromName(prospectContactPerson || prospectName || ""));
    setError(null);
    fetch("/api/v1/customers/next-code")
      .then((res) => res.json())
      .then((body) => setCustomerCode(body.data?.code ?? ""));
  }
  if (!open && lastOpenKey !== openKey) setLastOpenKey(openKey);

  // A Buyer requires contactPerson/email/phone (all three) — only attempt
  // creating one when the prospect actually captured at least one; an
  // enquiry logged with just a name has nothing to make a Buyer out of.
  const wantsBuyer = contactPerson.trim() !== "" || email.trim() !== "" || phone.trim() !== "";

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const customerRes = await fetch("/api/v1/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: customerCode, name: customerName, type: "CUSTOMER", country: country || undefined }),
    });
    if (!customerRes.ok) {
      setIsSubmitting(false);
      setError(await parseErrorMessage(customerRes, "Failed to create the Customer."));
      return;
    }
    const customer = (await customerRes.json()).data;

    let newBuyerId: string | undefined;
    if (wantsBuyer) {
      if (!contactPerson.trim() || !email.trim() || !phone.trim()) {
        setIsSubmitting(false);
        setError("Contact Person, Email, and Phone are all required to also create a Buyer — clear all three to skip creating one.");
        return;
      }
      const buyerRes = await fetch(`/api/v1/customers/${customer.id}/buyers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: buyerCode, name: buyerName, contactPerson, email, phone }),
      });
      if (buyerRes.ok) {
        newBuyerId = (await buyerRes.json()).data.id;
      } else {
        // The Customer already exists at this point — don't lose that
        // progress over a failed Buyer; surface it and still link the
        // Customer alone, same as a plain "Link a Customer" with no Buyer.
        setError(await parseErrorMessage(buyerRes, "Customer created, but failed to create the Buyer — linking the Customer alone."));
      }
    }

    const linkRes = await fetch(`/api/v1/buyer-enquiries/${buyerEnquiryId}/link-customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customer.id, buyerId: newBuyerId }),
    });
    setIsSubmitting(false);

    if (!linkRes.ok) {
      setError(await parseErrorMessage(linkRes, "Customer created, but failed to link it to this enquiry."));
      return;
    }
    await onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Customer from Prospect">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Customer Code" htmlFor="newCustomerCode" required>
            <input id="newCustomerCode" value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Customer Name" htmlFor="newCustomerName" required>
            <input id="newCustomerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={textInputClass()} />
          </FormField>
        </div>
        <FormField label="Country" htmlFor="newCustomerCountry">
          <input id="newCustomerCountry" value={country} onChange={(e) => setCountry(e.target.value)} className={textInputClass()} />
        </FormField>

        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-medium uppercase text-zinc-500">
            Primary Contact {wantsBuyer ? "(creates a Buyer)" : "(leave blank to skip creating a Buyer)"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Buyer Code" htmlFor="newBuyerCode" required={wantsBuyer}>
              <input id="newBuyerCode" value={buyerCode} onChange={(e) => setBuyerCode(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Buyer Name" htmlFor="newBuyerName" required={wantsBuyer}>
              <input id="newBuyerName" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <FormField label="Contact Person" htmlFor="newContactPerson" required={wantsBuyer}>
              <input id="newContactPerson" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Email" htmlFor="newEmail" required={wantsBuyer}>
              <input id="newEmail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Phone" htmlFor="newPhone" required={wantsBuyer}>
              <input id="newPhone" value={phone} onChange={(e) => setPhone(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <ActionButton
            label="Create & Link Customer"
            onClick={handleSubmit}
            isBusy={isSubmitting}
            disabled={!customerCode || !customerName}
          />
          <ActionButton label="Cancel" onClick={onClose} isBusy={isSubmitting} variant="secondary" />
        </div>
      </div>
    </Modal>
  );
}

function ActionButton({
  label,
  onClick,
  isBusy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  isBusy: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const variantClass =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy || disabled}
      className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${variantClass}`}
    >
      {label}
    </button>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface InvoiceItem {
  id: string;
  itemName: string;
  hsnCode: string | null;
  quantity: string;
  unitPrice: string;
  gstPercentage: string;
  lineAmount: string;
  lineTaxAmount: string;
  lineTotal: string;
  creditedAmount: string;
  product: { styleName: string } | null;
}

interface PaymentRow {
  id: string;
  paymentDate: string;
  amount: string;
  status: "RECORDED" | "CANCELLED";
  referenceNote: string | null;
  paymentType: { name: string } | null;
  receivedBy: { fullName: string };
}

interface CreditNoteItemRow {
  id: string;
  customInvoiceItemId: string;
  quantity: string | null;
  amount: string;
}

interface CreditNoteRow {
  id: string;
  creditNoteNumber: string;
  creditNoteDate: string;
  type: "OVERALL_DISCOUNT" | "PRODUCT_WISE" | "PRODUCT_RETURN";
  reason: string | null;
  totalAmount: string;
  status: "ISSUED" | "CANCELLED";
  createdBy: { fullName: string };
  items: CreditNoteItemRow[];
}

interface CustomInvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: "TAX_INVOICE" | "PROFORMA_INVOICE";
  hasDueDate: boolean;
  dueDate: string | null;
  status: "DRAFT" | "CANCELLED";
  discountPercentage: string;
  isReverseCharge: boolean;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  grandTotal: string;
  advancePaymentTitle: string | null;
  advancePaymentAmount: string | null;
  payableAmountTitle: string | null;
  payableAmountValue: string | null;
  paidAmount: string;
  creditedAmount: string;
  balanceDue: string;
  termsAndConditions: string | null;
  customer: { id: string; name: string; code: string };
  invoiceSeries: { name: string };
  incomeAccount: { code: string; name: string } | null;
  createdBy: { fullName: string };
  items: InvoiceItem[];
  notes: { id: string; note: string }[];
  payments: PaymentRow[];
  creditNotes: CreditNoteRow[];
}

interface PaymentTypeOption {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  RECORDED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  ISSUED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
};

const CREDIT_NOTE_TYPE_LABELS: Record<string, string> = {
  OVERALL_DISCOUNT: "Overall Discount",
  PRODUCT_WISE: "Product-Wise Reduction",
  PRODUCT_RETURN: "Product Return",
};

export function CustomInvoiceWorkflowPanel({ invoice }: { invoice: CustomInvoiceDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentTypeId, setPaymentTypeId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const [showCreditNoteModal, setShowCreditNoteModal] = useState(false);
  const [creditNoteDate, setCreditNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [creditNoteType, setCreditNoteType] = useState<"OVERALL_DISCOUNT" | "PRODUCT_WISE" | "PRODUCT_RETURN">("OVERALL_DISCOUNT");
  const [creditNoteReason, setCreditNoteReason] = useState("");
  const [creditNoteAmount, setCreditNoteAmount] = useState("");
  const [creditNoteLineTargetId, setCreditNoteLineTargetId] = useState("");
  const [creditNoteLineQty, setCreditNoteLineQty] = useState("");
  const [creditNoteLineAmount, setCreditNoteLineAmount] = useState("");
  const [creditNoteError, setCreditNoteError] = useState<string | null>(null);
  const [isIssuingCreditNote, setIsIssuingCreditNote] = useState(false);

  useEffect(() => {
    fetch("/api/v1/payment-types")
      .then((res) => res.json())
      .then((body) => setPaymentTypes(body.data ?? []))
      .catch(() => {});
  }, []);

  const runCancel = async () => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/custom-invoices/${invoice.id}/cancel`, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Action failed.");
      return;
    }
    setShowCancelConfirm(false);
    router.refresh();
  };

  const runCancelPayment = async (paymentId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/custom-invoices/payments/${paymentId}/cancel`, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to cancel payment.");
      return;
    }
    router.refresh();
  };

  const runCancelCreditNote = async (creditNoteId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/custom-invoices/credit-notes/${creditNoteId}/cancel`, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to cancel credit note.");
      return;
    }
    router.refresh();
  };

  const openPaymentModal = () => {
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentAmount("");
    setPaymentTypeId("");
    setPaymentReference("");
    setPaymentError(null);
    setShowPaymentModal(true);
  };

  const submitPayment = async () => {
    if (isRecordingPayment) return;
    setIsRecordingPayment(true);
    setPaymentError(null);
    try {
      const res = await fetch(`/api/v1/custom-invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDate,
          amount: Number(paymentAmount) || 0,
          paymentTypeId: paymentTypeId || undefined,
          referenceNote: paymentReference || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setPaymentError(body?.error?.message ?? "Failed to record payment.");
        return;
      }
      setShowPaymentModal(false);
      router.refresh();
    } catch {
      setPaymentError("Could not reach the server.");
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const openCreditNoteModal = () => {
    setCreditNoteDate(new Date().toISOString().slice(0, 10));
    setCreditNoteType("OVERALL_DISCOUNT");
    setCreditNoteReason("");
    setCreditNoteAmount("");
    setCreditNoteLineTargetId("");
    setCreditNoteLineQty("");
    setCreditNoteLineAmount("");
    setCreditNoteError(null);
    setShowCreditNoteModal(true);
  };

  const targetItem = invoice.items.find((i) => i.id === creditNoteLineTargetId);
  const targetItemRemaining = targetItem ? Number(targetItem.lineTotal) - Number(targetItem.creditedAmount) : 0;
  const targetItemRatePerUnit = targetItem && Number(targetItem.quantity) > 0 ? Number(targetItem.lineTotal) / Number(targetItem.quantity) : 0;

  const submitCreditNote = async () => {
    if (isIssuingCreditNote) return;
    setIsIssuingCreditNote(true);
    setCreditNoteError(null);
    try {
      const payload: Record<string, unknown> = {
        creditNoteDate,
        type: creditNoteType,
        reason: creditNoteReason || undefined,
      };
      if (creditNoteType === "OVERALL_DISCOUNT") {
        payload.amount = Number(creditNoteAmount) || 0;
      } else if (creditNoteType === "PRODUCT_WISE") {
        payload.items = [{ customInvoiceItemId: creditNoteLineTargetId, amount: Number(creditNoteLineAmount) || 0 }];
      } else {
        payload.items = [{ customInvoiceItemId: creditNoteLineTargetId, quantity: Number(creditNoteLineQty) || 0 }];
      }

      const res = await fetch(`/api/v1/custom-invoices/${invoice.id}/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCreditNoteError(body?.error?.message ?? "Failed to issue credit note.");
        return;
      }
      setShowCreditNoteModal(false);
      router.refresh();
    } catch {
      setCreditNoteError("Could not reach the server.");
    } finally {
      setIsIssuingCreditNote(false);
    }
  };

  // Mirrors updateCustomInvoice()'s own real guard exactly — including "any
  // credit note ever, even a cancelled one" (invoice.creditNotes includes
  // every status, not just live ones) — see that function's own comment for
  // why a cancelled credit note still permanently blocks item replacement.
  const hasActivity = Number(invoice.paidAmount) > 0 || Number(invoice.creditedAmount) > 0 || invoice.creditNotes.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status] ?? ""}`}>{invoice.status}</span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {invoice.invoiceType === "TAX_INVOICE" ? "Tax Invoice" : "Proforma Invoice"} · Series: {invoice.invoiceSeries.name}
        </span>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Client</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {invoice.customer.name} ({invoice.customer.code})
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Invoice Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.invoiceDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Due Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {invoice.hasDueDate && invoice.dueDate ? invoice.dueDate.slice(0, 10) : "Not set"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Discount</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{Number(invoice.discountPercentage)}%</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Reverse Charge</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{invoice.isReverseCharge ? "Yes" : "No"}</dd>
        </div>
        {invoice.incomeAccount && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Income Category</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {invoice.incomeAccount.code} — {invoice.incomeAccount.name}
            </dd>
          </div>
        )}
      </dl>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">HSN</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">GST%</th>
              <th className="px-3 py-2 font-medium">Line Total</th>
              <th className="px-3 py-2 font-medium">Credited</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">{item.itemName}</td>
                <td className="px-3 py-2">{item.hsnCode ?? "—"}</td>
                <td className="px-3 py-2">{Number(item.quantity)}</td>
                <td className="px-3 py-2">{Number(item.unitPrice).toFixed(2)}</td>
                <td className="px-3 py-2">{Number(item.gstPercentage)}%</td>
                <td className="px-3 py-2">{Number(item.lineTotal).toFixed(2)}</td>
                <td className="px-3 py-2">{Number(item.creditedAmount) > 0 ? `₹${Number(item.creditedAmount).toFixed(2)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
              <td className="px-3 py-2" colSpan={5}>
                Subtotal ₹{Number(invoice.subtotalAmount).toFixed(2)} − Discount ₹{Number(invoice.discountAmount).toFixed(2)} + Tax ₹
                {Number(invoice.taxAmount).toFixed(2)}
              </td>
              <td className="px-3 py-2" colSpan={2}>
                Grand Total ₹{Number(invoice.grandTotal).toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 p-3 text-sm sm:grid-cols-3 dark:border-zinc-800">
        {invoice.advancePaymentAmount && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">{invoice.advancePaymentTitle ?? "Advance Payment"}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(invoice.advancePaymentAmount).toFixed(2)}</dd>
          </div>
        )}
        {invoice.payableAmountValue && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">{invoice.payableAmountTitle ?? "Payable Amount"}</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(invoice.payableAmountValue).toFixed(2)}</dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Paid So Far</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(invoice.paidAmount).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Credited So Far</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(invoice.creditedAmount).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Balance Due (now)</dt>
          <dd className="text-base font-semibold text-zinc-900 dark:text-zinc-50">₹{Number(invoice.balanceDue).toFixed(2)}</dd>
        </div>
      </dl>

      {invoice.notes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Notes</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
            {invoice.notes.map((n) => (
              <li key={n.id}>{n.note}</li>
            ))}
          </ul>
        </div>
      )}

      {invoice.termsAndConditions && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Terms &amp; Conditions</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{invoice.termsAndConditions}</p>
        </div>
      )}

      {/* Payments */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Payments Received</h2>
          {invoice.status !== "CANCELLED" && (
            <button type="button" onClick={openPaymentModal} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              + Record Payment
            </button>
          )}
        </div>
        {invoice.payments.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No payments recorded yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Received By</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">{p.paymentDate.slice(0, 10)}</td>
                    <td className="px-3 py-2">₹{Number(p.amount).toFixed(2)}</td>
                    <td className="px-3 py-2">{p.paymentType?.name ?? "—"}</td>
                    <td className="px-3 py-2">{p.referenceNote ?? "—"}</td>
                    <td className="px-3 py-2">{p.receivedBy.fullName}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? ""}`}>{p.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {p.status === "RECORDED" && (
                        <button type="button" onClick={() => runCancelPayment(p.id)} disabled={isBusy} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Credit Notes */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Credit Notes</h2>
          {invoice.status !== "CANCELLED" && (
            <button type="button" onClick={openCreditNoteModal} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              + Issue Credit Note
            </button>
          )}
        </div>
        {invoice.creditNotes.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No credit notes issued yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invoice.creditNotes.map((cn) => (
                  <tr key={cn.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">{cn.creditNoteNumber}</td>
                    <td className="px-3 py-2">{cn.creditNoteDate.slice(0, 10)}</td>
                    <td className="px-3 py-2">{CREDIT_NOTE_TYPE_LABELS[cn.type]}</td>
                    <td className="px-3 py-2">{cn.reason ?? "—"}</td>
                    <td className="px-3 py-2">₹{Number(cn.totalAmount).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[cn.status] ?? ""}`}>{cn.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      {cn.status === "ISSUED" && (
                        <button type="button" onClick={() => runCancelCreditNote(cn.id)} disabled={isBusy} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invoice.status === "DRAFT" && (
        <div className="flex flex-col gap-2">
          {hasActivity && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Editing and cancelling are disabled — a payment or credit note has already been recorded against this invoice.
            </p>
          )}
          <div className="flex gap-3">
            {!hasActivity && (
              <>
                <Link
                  href={`/accounts/custom-invoices/${invoice.id}/edit`}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Edit
                </Link>
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isBusy}
                  className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel invoice?"
        message="This invoice will be cancelled. Create a new invoice for a correction instead of trying to reuse this one."
        confirmLabel="Cancel Invoice"
        isDangerous
        isBusy={isBusy}
        onConfirm={runCancel}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Record Payment">
        <div className="space-y-3">
          <FormField label="Payment Date" htmlFor="paymentDate" required>
            <input id="paymentDate" type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Amount" htmlFor="paymentAmount" required>
            <input
              id="paymentAmount"
              type="number"
              min={0}
              step="0.01"
              required
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Payment Type" htmlFor="paymentTypeId">
            <select id="paymentTypeId" value={paymentTypeId} onChange={(e) => setPaymentTypeId(e.target.value)} className={textInputClass()}>
              <option value="">— None —</option>
              {paymentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reference / Note" htmlFor="paymentReference">
            <input id="paymentReference" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} className={textInputClass()} />
          </FormField>
          {paymentError && <p className="text-sm text-red-600 dark:text-red-400">{paymentError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowPaymentModal(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitPayment}
              disabled={isRecordingPayment || !paymentAmount}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isRecordingPayment ? "Recording…" : "Record"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showCreditNoteModal} onClose={() => setShowCreditNoteModal(false)} title="Issue Credit Note" maxWidthClass="max-w-lg">
        <div className="space-y-3">
          <FormField label="Credit Note Date" htmlFor="creditNoteDate" required>
            <input id="creditNoteDate" type="date" required value={creditNoteDate} onChange={(e) => setCreditNoteDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Type" htmlFor="creditNoteType" required>
            <select
              id="creditNoteType"
              value={creditNoteType}
              onChange={(e) => setCreditNoteType(e.target.value as typeof creditNoteType)}
              className={textInputClass()}
            >
              <option value="OVERALL_DISCOUNT">Overall Discount — one flat amount off the whole invoice</option>
              <option value="PRODUCT_WISE">Product-Wise Reduction — decrease the amount on one line</option>
              <option value="PRODUCT_RETURN">Product Return — return a quantity of one line</option>
            </select>
          </FormField>

          {creditNoteType === "OVERALL_DISCOUNT" && (
            <FormField label="Amount" htmlFor="creditNoteAmount" required>
              <input
                id="creditNoteAmount"
                type="number"
                min={0}
                step="0.01"
                required
                value={creditNoteAmount}
                onChange={(e) => setCreditNoteAmount(e.target.value)}
                className={textInputClass()}
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Available to credit on this invoice: ₹{(Number(invoice.grandTotal) - Number(invoice.creditedAmount)).toFixed(2)}
              </p>
            </FormField>
          )}

          {(creditNoteType === "PRODUCT_WISE" || creditNoteType === "PRODUCT_RETURN") && (
            <>
              <FormField label="Item Line" htmlFor="creditNoteLineTargetId" required>
                <select
                  id="creditNoteLineTargetId"
                  required
                  value={creditNoteLineTargetId}
                  onChange={(e) => setCreditNoteLineTargetId(e.target.value)}
                  className={textInputClass()}
                >
                  <option value="">— Select a line —</option>
                  {invoice.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemName} (remaining ₹{(Number(it.lineTotal) - Number(it.creditedAmount)).toFixed(2)})
                    </option>
                  ))}
                </select>
              </FormField>
              {creditNoteType === "PRODUCT_WISE" ? (
                <FormField label="Amount to Credit" htmlFor="creditNoteLineAmount" required>
                  <input
                    id="creditNoteLineAmount"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={creditNoteLineAmount}
                    onChange={(e) => setCreditNoteLineAmount(e.target.value)}
                    className={textInputClass()}
                  />
                  {targetItem && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Remaining on this line: ₹{targetItemRemaining.toFixed(2)}</p>}
                </FormField>
              ) : (
                <FormField label="Quantity Returned" htmlFor="creditNoteLineQty" required>
                  <input
                    id="creditNoteLineQty"
                    type="number"
                    min={0}
                    step="0.0001"
                    required
                    value={creditNoteLineQty}
                    onChange={(e) => setCreditNoteLineQty(e.target.value)}
                    className={textInputClass()}
                  />
                  {targetItem && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Effective rate: ₹{targetItemRatePerUnit.toFixed(2)}/unit · Remaining on this line: ₹{targetItemRemaining.toFixed(2)}
                    </p>
                  )}
                </FormField>
              )}
            </>
          )}

          <FormField label="Reason (optional)" htmlFor="creditNoteReason">
            <input id="creditNoteReason" value={creditNoteReason} onChange={(e) => setCreditNoteReason(e.target.value)} className={textInputClass()} />
          </FormField>

          {creditNoteError && <p className="text-sm text-red-600 dark:text-red-400">{creditNoteError}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreditNoteModal(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitCreditNote}
              disabled={isIssuingCreditNote}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isIssuingCreditNote ? "Issuing…" : "Issue Credit Note"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

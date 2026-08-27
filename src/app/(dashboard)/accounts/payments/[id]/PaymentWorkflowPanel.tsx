"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { textInputClass } from "@/components/ui/FormField";

interface AllocationRow {
  id: string;
  allocatedAmount: string;
  salesInvoice: { id: string; invoiceNumber: string; totalAmount: string; paidAmount: string } | null;
  purchaseInvoice: { id: string; invoiceNumber: string; totalAmount: string; paidAmount: string } | null;
}

interface OutstandingInvoiceOption {
  id: string;
  invoiceNumber: string;
  totalAmount: string;
  paidAmount: string;
}

interface PaymentDetail {
  id: string;
  paymentNumber: string;
  direction: "RECEIPT" | "PAYMENT_OUT";
  paymentDate: string;
  amount: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  referenceNumber: string | null;
  customerId: string | null;
  supplierId: string | null;
  customer: { name: string } | null;
  supplier: { name: string } | null;
  paymentType: { name: string; type: string };
  bankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
  allocations: AllocationRow[];
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function PaymentWorkflowPanel({ payment }: { payment: PaymentDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [outstandingInvoices, setOutstandingInvoices] = useState<OutstandingInvoiceOption[]>([]);
  const [allocateInvoiceId, setAllocateInvoiceId] = useState("");
  const [allocateAmount, setAllocateAmount] = useState("");
  const [allocateError, setAllocateError] = useState<string | null>(null);
  const [isAllocating, setIsAllocating] = useState(false);

  const allocatedTotal = payment.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0);
  const unallocated = Math.round((Number(payment.amount) - allocatedTotal) * 100) / 100;

  const runAction = async (url: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Action failed.");
      return false;
    }
    router.refresh();
    return true;
  };

  const openAllocateModal = () => {
    setAllocateInvoiceId("");
    setAllocateAmount("");
    setAllocateError(null);
    setShowAllocateModal(true);
    const partyId = payment.customerId ?? payment.supplierId;
    if (partyId) {
      fetch(`/api/v1/payments/outstanding-invoices?direction=${payment.direction}&partyId=${partyId}`)
        .then((res) => res.json())
        .then((body) => setOutstandingInvoices(body.data ?? []))
        .catch(() => setOutstandingInvoices([]));
    }
  };

  const submitAllocate = async () => {
    if (isAllocating) return;
    setIsAllocating(true);
    setAllocateError(null);
    try {
      const res = await fetch(`/api/v1/payments/${payment.id}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: [
            payment.direction === "RECEIPT"
              ? { salesInvoiceId: allocateInvoiceId, allocatedAmount: Number(allocateAmount) || 0 }
              : { purchaseInvoiceId: allocateInvoiceId, allocatedAmount: Number(allocateAmount) || 0 },
          ],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAllocateError(body?.error?.message ?? "Failed to allocate.");
        return;
      }
      setShowAllocateModal(false);
      router.refresh();
    } catch {
      setAllocateError("Could not reach the server.");
    } finally {
      setIsAllocating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[payment.status] ?? ""}`}>{payment.status}</span>
        {payment.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${payment.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {payment.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Direction</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {payment.direction === "RECEIPT" ? "Receipt (from Customer)" : "Payment Out (to Supplier)"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{payment.direction === "RECEIPT" ? "Customer" : "Supplier"}</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.customer?.name ?? payment.supplier?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Payment Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.paymentDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Amount</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{Number(payment.amount).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Payment Type</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.paymentType.name}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Bank Account</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {payment.bankAccount ? `${payment.bankAccount.name} — ${payment.bankAccount.bankName}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Reference No.</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.referenceNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Approved By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{payment.postedBy?.fullName ?? "—"}</dd>
        </div>
      </dl>

      {payment.status === "POSTED" && unallocated > 0.005 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-500/10">
          <p className="text-amber-800 dark:text-amber-300">
            ₹{unallocated.toFixed(2)} of this payment is still unallocated (&quot;On Account&quot;) — apply it to an invoice as one arrives.
          </p>
          <button type="button" onClick={openAllocateModal} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500">
            Allocate
          </button>
        </div>
      )}

      {payment.allocations.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No allocations yet — this payment is fully &quot;On Account&quot;.
        </p>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Invoice Total</th>
              <th className="px-3 py-2 font-medium">Invoice Paid</th>
              <th className="px-3 py-2 font-medium">Allocated Here</th>
            </tr>
          </thead>
          <tbody>
            {payment.allocations.map((a) => {
              const invoice = a.salesInvoice ?? a.purchaseInvoice;
              const href = a.salesInvoice
                ? `/accounts/sales-invoices/${a.salesInvoice.id}`
                : `/accounts/purchase-invoices/${a.purchaseInvoice!.id}`;
              return (
                <tr key={a.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <Link href={href} className="text-indigo-600 hover:text-indigo-500">
                      {invoice?.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{Number(invoice?.totalAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{Number(invoice?.paidAmount ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2">{Number(a.allocatedAmount).toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {payment.status === "DRAFT" && (
        <div className="flex gap-3">
          <button
            onClick={() => setShowApproveConfirm(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Approve
          </button>
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={isBusy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
          >
            Cancel
          </button>
        </div>
      )}

      <ConfirmModal
        open={showApproveConfirm}
        title="Approve payment?"
        message={`Approving will lock this payment permanently, apply its allocations to the linked invoice(s), and auto-create a settlement Journal for ${Number(payment.amount).toFixed(2)}.`}
        confirmLabel="Approve"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/payments/${payment.id}/approve`);
          if (ok) setShowApproveConfirm(false);
        }}
        onCancel={() => setShowApproveConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel payment?"
        message="This draft payment will be cancelled."
        confirmLabel="Cancel Payment"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/payments/${payment.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showAllocateModal} onClose={() => setShowAllocateModal(false)} title="Allocate to an Invoice">
        <div className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Unallocated remaining: ₹{unallocated.toFixed(2)}</p>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Invoice</label>
            <select value={allocateInvoiceId} onChange={(e) => setAllocateInvoiceId(e.target.value)} className={`mt-1 ${textInputClass()}`}>
              <option value="">— Select an outstanding invoice —</option>
              {outstandingInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — outstanding ₹{(Number(inv.totalAmount) - Number(inv.paidAmount)).toFixed(2)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Amount to Allocate</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={allocateAmount}
              onChange={(e) => setAllocateAmount(e.target.value)}
              className={`mt-1 ${textInputClass()}`}
            />
          </div>
          {allocateError && <p className="text-sm text-red-600 dark:text-red-400">{allocateError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAllocateModal(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitAllocate}
              disabled={isAllocating || !allocateInvoiceId || !allocateAmount}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isAllocating ? "Allocating…" : "Allocate"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

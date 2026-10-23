"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { AttachmentsPanel, StagedFilesPicker, uploadFilesToRecord } from "@/components/ui/AttachmentsPanel";
import { formatCurrency } from "@/lib/currency";
import { todayIsoDate } from "@/lib/date";

interface ExpensePaymentRow {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  referenceNumber: string | null;
  notes: string | null;
  paymentType: { name: string; type: string };
  bankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string };
  createdBy: { fullName: string };
}

interface ExpenseDetail {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  description: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
  tdsPercentage: string | null;
  tdsAmount: string;
  paidAmount: string;
  source: "STANDARD" | "BILL_UPLOAD";
  referenceNumber: string | null;
  status: "PENDING_APPROVAL" | "APPROVED" | "PARTIALLY_PAID" | "REJECTED" | "PAID" | "CANCELLED";
  rejectionReason: string | null;
  account: { code: string; name: string } | null;
  supplier: { name: string } | null;
  taxRate: { name: string } | null;
  // Set only on expenses paid the old one-shot way (before part payments).
  paymentType: { name: string } | null;
  bankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  approvedBy: { fullName: string } | null;
  rejectedBy: { fullName: string } | null;
  postedBy: { fullName: string } | null;
  payments: ExpensePaymentRow[];
}

interface PaymentTypeOption {
  id: string;
  name: string;
  type: string;
}

interface BankAccountOption {
  id: string;
  name: string;
  bankName: string;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  PARTIALLY_PAID: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  PAID: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  PARTIALLY_PAID: "Part Paid",
  REJECTED: "Rejected",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ExpenseWorkflowPanel({ expense }: { expense: ExpenseDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showPayModal, setShowPayModal] = useState(false);
  const [openPaymentFiles, setOpenPaymentFiles] = useState<string | null>(null);

  const payable = round2(Number(expense.totalAmount) - Number(expense.tdsAmount));
  const paid = Number(expense.paidAmount);
  const remaining = round2(payable - paid);
  const canPay = expense.status === "APPROVED" || expense.status === "PARTIALLY_PAID";
  const canEditFiles = expense.status !== "CANCELLED" && expense.status !== "REJECTED";

  const runAction = async (url: string, body?: unknown) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    setIsBusy(false);
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Action failed."));
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[expense.status] ?? ""}`}>
          {EXPENSE_STATUS_LABELS[expense.status] ?? expense.status}
        </span>
        {expense.source === "BILL_UPLOAD" && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-400">
            Uploaded bill
          </span>
        )}
        {expense.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${expense.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {expense.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {expense.status === "REJECTED" && expense.rejectionReason && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-400">
          <span className="font-medium">Rejected by {expense.rejectedBy?.fullName ?? "—"}:</span> {expense.rejectionReason}
        </div>
      )}

      {expense.status === "PENDING_APPROVAL" && !expense.account && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          This bill was uploaded without an expense account. Use <span className="font-medium">Edit</span> to choose the
          account (and tax, if any) before approving.
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Item label="Account" value={expense.account ? `${expense.account.code} — ${expense.account.name}` : "Not set yet"} />
        <Item label="Description" value={expense.description} />
        <Item label="Expense Date" value={expense.expenseDate.slice(0, 10)} />
        <Item label="Supplier" value={expense.supplier?.name ?? "—"} />
        <Item label="Amount" value={`₹${formatCurrency(expense.amount)}`} />
        <Item
          label="Tax"
          value={expense.taxRate ? `${expense.taxRate.name} (₹${formatCurrency(expense.taxAmount)})` : "—"}
        />
        <Item label="Total" value={`₹${formatCurrency(expense.totalAmount)}`} />
        {Number(expense.tdsAmount) > 0 && (
          <Item
            label="TDS Withheld"
            value={`${Number(expense.tdsPercentage)}% (₹${formatCurrency(expense.tdsAmount)})`}
          />
        )}
        <Item label="Bill / Reference No." value={expense.referenceNumber ?? "—"} />
        <Item label="Created By" value={expense.createdBy.fullName} />
        <Item label="Approved By" value={expense.approvedBy?.fullName ?? "—"} />
        {expense.paymentType && (
          <Item
            label="Paid From"
            value={`${expense.paymentType.name}${expense.bankAccount ? ` — ${expense.bankAccount.name}` : ""}`}
          />
        )}
      </dl>

      {/* Payment summary */}
      {(canPay || expense.status === "PAID") && (
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <p className="text-zinc-500 dark:text-zinc-400">To Pay</p>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">₹{formatCurrency(payable)}</p>
          </div>
          <div>
            <p className="text-zinc-500 dark:text-zinc-400">Paid</p>
            <p className="text-base font-semibold text-green-700 dark:text-green-400">₹{formatCurrency(paid)}</p>
          </div>
          <div>
            <p className="text-zinc-500 dark:text-zinc-400">Balance</p>
            <p className={`text-base font-semibold ${remaining > 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-50"}`}>
              ₹{formatCurrency(Math.max(remaining, 0))}
            </p>
          </div>
        </div>
      )}

      {expense.status === "PENDING_APPROVAL" && (
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/accounts/expenses/${expense.id}/edit`}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            Edit
          </Link>
          <button
            onClick={() => setShowApproveConfirm(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Approve
          </button>
          <button
            onClick={() => setShowRejectModal(true)}
            disabled={isBusy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
          >
            Reject
          </button>
          <button
            onClick={() => setShowCancelConfirm(true)}
            disabled={isBusy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      )}

      {canPay && (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowPayModal(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {expense.status === "PARTIALLY_PAID" ? "Pay Balance / Next Part" : "Record Payment"}
          </button>
          {expense.status === "APPROVED" && (
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={isBusy}
              className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Payment history */}
      {expense.payments.length > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            Payments ({expense.payments.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2">Payment No.</th>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Paid From</th>
                  <th className="px-4 py-2">Reference</th>
                  <th className="px-4 py-2">Journal</th>
                  <th className="px-4 py-2">By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {expense.payments.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-2 font-medium">{p.paymentNumber}</td>
                    <td className="px-4 py-2">{p.paymentDate.slice(0, 10)}</td>
                    <td className="px-4 py-2 text-right">₹{formatCurrency(p.amount)}</td>
                    <td className="px-4 py-2">
                      {p.paymentType.name}
                      {p.bankAccount ? ` — ${p.bankAccount.name}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      {p.referenceNumber ?? "—"}
                      {p.notes && <p className="text-xs text-zinc-500">{p.notes}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/accounts/journals/${p.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
                        {p.journal.journalNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{p.createdBy.fullName}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenPaymentFiles(p.id)}
                        className="text-xs font-medium text-indigo-600 hover:underline"
                      >
                        Files &amp; voice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AttachmentsPanel
        module="expense"
        recordId={expense.id}
        canEdit={canEditFiles}
        title="Bills, Files & Voice Notes"
        labelForContext={(c) => EXPENSE_STATUS_LABELS[c] ?? c}
      />

      <Modal open={openPaymentFiles !== null} onClose={() => setOpenPaymentFiles(null)} title="Payment files & voice notes">
        {openPaymentFiles && <AttachmentsPanel compact module="expense-payment" recordId={openPaymentFiles} canEdit />}
      </Modal>

      {showPayModal && (
        <RecordPaymentModal
          expenseId={expense.id}
          expenseNumber={expense.expenseNumber}
          remaining={remaining}
          onClose={() => setShowPayModal(false)}
          onSaved={() => {
            setShowPayModal(false);
            router.refresh();
          }}
        />
      )}

      <ConfirmModal
        open={showApproveConfirm}
        title="Approve expense?"
        message="This moves the expense to Approved — no money moves yet. Payments (full or in parts) are recorded after this."
        confirmLabel="Approve"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/expenses/${expense.id}/approve`);
          if (ok) setShowApproveConfirm(false);
        }}
        onCancel={() => setShowApproveConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel expense?"
        message="This expense will be cancelled. This cannot be undone — a correction after this would need a new expense."
        confirmLabel="Cancel Expense"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/expenses/${expense.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showRejectModal} onClose={() => setShowRejectModal(false)} title="Reject expense">
        <div className="space-y-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This is final — the creator will need to raise a new expense if they want to retry.
          </p>
          <textarea
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Reason for rejection"
            rows={3}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRejectModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy || !rejectionReason.trim()}
              onClick={async () => {
                const ok = await runAction(`/api/v1/expenses/${expense.id}/reject`, { rejectionReason: rejectionReason.trim() });
                if (ok) {
                  setShowRejectModal(false);
                  setRejectionReason("");
                }
              }}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

function RecordPaymentModal({
  expenseId,
  expenseNumber,
  remaining,
  onClose,
  onSaved,
}: {
  expenseId: string;
  expenseNumber: string;
  remaining: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState(String(remaining));
  const [paymentTypeId, setPaymentTypeId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per open modal — a retry after a network error can't double-pay.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/payment-types")
      .then((res) => res.json())
      .then((body) => setPaymentTypes((body.data ?? []).filter((t: { isActive?: boolean }) => t.isActive !== false)))
      .catch(() => {});
    fetch("/api/v1/bank-accounts")
      .then((res) => res.json())
      .then((body) => setBankAccounts(body.data ?? []))
      .catch(() => {});
  }, []);

  const selectedType = paymentTypes.find((t) => t.id === paymentTypeId);
  const amountNum = Number(amount) || 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/expenses/${expenseId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDate,
          amount: amountNum,
          paymentTypeId,
          bankAccountId: bankAccountId || undefined,
          referenceNumber: referenceNumber || undefined,
          notes: notes || undefined,
          idempotencyKey,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not record the payment.");
        return;
      }
      const paymentId: string | undefined = body?.data?.recordedPaymentId;
      if (paymentId && files.length > 0) {
        try {
          await uploadFilesToRecord("expense-payment", paymentId, files);
        } catch (uploadErr) {
          setError(
            `${uploadErr instanceof Error ? uploadErr.message : "Files could not be uploaded."} The payment itself was saved — add the files from the Payments table.`
          );
          return;
        }
      }
      onSaved();
    } catch {
      setError("Could not reach the server. It's safe to try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Record payment — ${expenseNumber}`}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Balance to pay: <span className="font-semibold text-zinc-900 dark:text-zinc-50">₹{formatCurrency(remaining)}</span>. Pay it
          all now or only a part — the rest stays open on this expense.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Payment Date" htmlFor="payDate" required>
            <input id="payDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Amount" htmlFor="payAmount" required>
            <input
              id="payAmount"
              type="number"
              min={0}
              max={remaining}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Paid From (Payment Type)" htmlFor="payType" required>
            <select id="payType" value={paymentTypeId} onChange={(e) => setPaymentTypeId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {paymentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          {selectedType && selectedType.type !== "CASH" ? (
            <FormField label="Bank Account" htmlFor="payBank">
              <select id="payBank" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={textInputClass()}>
                <option value="">— None —</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.bankName}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <div />
          )}
          <FormField label="Reference No. (cheque/UTR)" htmlFor="payRef">
            <input id="payRef" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Notes" htmlFor="payNotes">
            <input id="payNotes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} />
          </FormField>
        </div>
        <FormField label="Payment proof / voice note (optional)" htmlFor="payFiles">
          <StagedFilesPicker files={files} onChange={setFiles} />
        </FormField>
        {amountNum > 0 && amountNum < remaining && (
          <p className="text-xs text-violet-700 dark:text-violet-400">
            Part payment — ₹{formatCurrency(round2(remaining - amountNum))} will remain to be paid later.
          </p>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !paymentTypeId || amountNum <= 0 || amountNum > remaining + 0.005}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save Payment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

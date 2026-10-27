"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/currency";
import { todayIsoDate } from "@/lib/date";

interface PaymentTypeOption {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface BankAccountOption {
  id: string;
  name: string;
  bankName: string;
  isActive: boolean;
}

interface Props {
  open: boolean;
  requestId: string;
  requestNumber: string;
  remaining: number;
  /** Paid in one go (cash withdrawal, deposits, transfers) — amount fixed to the remaining. */
  fullOnly: boolean;
  /** Cash withdrawal: also ask which cash account the money goes into. */
  isCashWithdrawal: boolean;
  onClose: () => void;
  onPaid: () => void;
}

export function PayoutModal({ open, requestId, requestNumber, remaining, fullOnly, isCashWithdrawal, onClose, onPaid }: Props) {
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [paymentTypeId, setPaymentTypeId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [toPaymentTypeId, setToPaymentTypeId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per opened modal: a retried submit can never pay twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { data: [] }));
    get("/api/v1/payment-types?pageSize=200").then((b) => setPaymentTypes((b.data ?? []).filter((p: PaymentTypeOption) => p.isActive)));
    get("/api/v1/bank-accounts?pageSize=200").then((b) => setBankAccounts((b.data ?? []).filter((a: BankAccountOption) => a.isActive)));
  }, []);

  const selectedType = paymentTypes.find((p) => p.id === paymentTypeId);
  const fromBank = selectedType ? selectedType.type !== "CASH" : false;
  const fromOptions = isCashWithdrawal ? paymentTypes.filter((p) => p.type !== "CASH") : paymentTypes;
  const cashTypes = paymentTypes.filter((p) => p.type === "CASH");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/payment-requests/${requestId}/payouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentDate,
          amount: Number(amount),
          paymentTypeId,
          bankAccountId: fromBank ? bankAccountId : "",
          referenceNumber,
          notes,
          toPaymentTypeId: isCashWithdrawal ? toPaymentTypeId : "",
          idempotencyKey,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Payment could not be recorded.");
        return;
      }
      onPaid();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Pay ${requestNumber}`} maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Left to pay: <span className="font-semibold">₹{formatCurrency(remaining)}</span>
          {fullOnly && " — this type is paid in full in one go."}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Payment date" htmlFor="paymentDate" required>
            <input
              id="paymentDate"
              type="date"
              required
              max={todayIsoDate()}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Amount" htmlFor="payAmount" required>
            <input
              id="payAmount"
              type="number"
              min="0.01"
              step="0.01"
              max={remaining}
              required
              readOnly={fullOnly}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label={isCashWithdrawal ? "Paid from (bank)" : "Paid from"} htmlFor="paymentTypeId" required>
            <select id="paymentTypeId" required value={paymentTypeId} onChange={(e) => setPaymentTypeId(e.target.value)} className={textInputClass()}>
              <option value="">Select…</option>
              {fromOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </FormField>
          {fromBank && (
            <FormField label="Bank account" htmlFor="bankAccountId" required>
              <select id="bankAccountId" required value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={textInputClass()}>
                <option value="">Select…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.bankName}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {isCashWithdrawal && (
            <FormField label="Cash goes into" htmlFor="toPaymentTypeId" required>
              <select id="toPaymentTypeId" required value={toPaymentTypeId} onChange={(e) => setToPaymentTypeId(e.target.value)} className={textInputClass()}>
                <option value="">Select…</option>
                {cashTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {fromBank && (
            <FormField label="UTR / cheque / reference no." htmlFor="referenceNumber" required>
              <input
                id="referenceNumber"
                required
                maxLength={100}
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          )}
        </div>
        <FormField label="Notes (optional)" htmlFor="payNotes">
          <textarea id="payNotes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} />
        </FormField>
        <p className="text-xs text-zinc-500">Attach the payment proof under Files &amp; Voice Remarks on this request.</p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? "Paying…" : "Record Payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

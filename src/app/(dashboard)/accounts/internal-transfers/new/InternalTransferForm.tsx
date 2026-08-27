"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

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

export function InternalTransferForm() {
  const router = useRouter();
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);

  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromPaymentTypeId, setFromPaymentTypeId] = useState("");
  const [fromBankAccountId, setFromBankAccountId] = useState("");
  const [toPaymentTypeId, setToPaymentTypeId] = useState("");
  const [toBankAccountId, setToBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // See CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/payment-types")
      .then((res) => res.json())
      .then((body) => setPaymentTypes(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/bank-accounts")
      .then((res) => res.json())
      .then((body) => setBankAccounts(body.data ?? []))
      .catch(() => {});
  }, []);

  const fromType = paymentTypes.find((t) => t.id === fromPaymentTypeId);
  const toType = paymentTypes.find((t) => t.id === toPaymentTypeId);
  const sameTypeWarning = fromType && toType && fromType.type === toType.type;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/internal-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferDate,
          fromPaymentTypeId,
          fromBankAccountId: fromBankAccountId || undefined,
          toPaymentTypeId,
          toBankAccountId: toBankAccountId || undefined,
          amount: Number(amount) || 0,
          narration: narration || undefined,
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create transfer.");
        return;
      }

      const body = await res.json();
      router.push(`/accounts/internal-transfers/${body.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <FormField label="Transfer Date" htmlFor="transferDate" required>
        <input
          id="transferDate"
          type="date"
          required
          value={transferDate}
          onChange={(e) => setTransferDate(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="From Account" htmlFor="fromPaymentTypeId" required>
          <select id="fromPaymentTypeId" required value={fromPaymentTypeId} onChange={(e) => setFromPaymentTypeId(e.target.value)} className={textInputClass()}>
            <option value="">— Select —</option>
            {paymentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {fromType && fromType.type !== "CASH" && (
            <select value={fromBankAccountId} onChange={(e) => setFromBankAccountId(e.target.value)} className={`${textInputClass()} mt-2`}>
              <option value="">— Which bank account (optional) —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.bankName}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="To Account" htmlFor="toPaymentTypeId" required>
          <select id="toPaymentTypeId" required value={toPaymentTypeId} onChange={(e) => setToPaymentTypeId(e.target.value)} className={textInputClass()}>
            <option value="">— Select —</option>
            {paymentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {toType && toType.type !== "CASH" && (
            <select value={toBankAccountId} onChange={(e) => setToBankAccountId(e.target.value)} className={`${textInputClass()} mt-2`}>
              <option value="">— Which bank account (optional) —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.bankName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      {sameTypeWarning && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          From and To are both &quot;{fromType!.type}&quot;-type accounts — this will be rejected. Pick a Cash-type account on one side and a Bank-type on the other.
        </p>
      )}

      <FormField label="Amount" htmlFor="amount" required>
        <input id="amount" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={textInputClass()} />
      </FormField>

      <FormField label="Narration (optional)" htmlFor="narration">
        <input id="narration" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Cash deposited into bank" className={textInputClass()} />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/accounts/internal-transfers")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

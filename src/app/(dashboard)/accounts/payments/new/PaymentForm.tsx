"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";

type Direction = "RECEIPT" | "PAYMENT_OUT";

interface PartyOption {
  id: string;
  name: string;
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

interface OutstandingInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: string;
  paidAmount: string;
}

export function PaymentForm() {
  const router = useRouter();
  const [direction, setDirection] = useState<Direction>("RECEIPT");
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [partyId, setPartyId] = useState("");
  const [paymentTypeId, setPaymentTypeId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([]);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [isOnAccount, setIsOnAccount] = useState(false);
  const [onAccountAmount, setOnAccountAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // See CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/payment-types")
      .then((res) => res.json())
      .then((body) => setPaymentTypes(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/bank-accounts")
      .then((res) => res.json())
      .then((body) => setBankAccounts(body.data ?? []))
      .catch(() => {});
  }, []);

  const selectDirection = (next: Direction) => {
    setDirection(next);
    setPartyId("");
    setInvoices([]);
    setAllocations({});
    setIsOnAccount(false);
    setOnAccountAmount("");
  };

  const selectParty = (id: string) => {
    setPartyId(id);
    setIsOnAccount(false);
    setOnAccountAmount("");
    if (!id) {
      setInvoices([]);
      setAllocations({});
      return;
    }
    fetch(`/api/v1/payments/outstanding-invoices?direction=${direction}&partyId=${id}`)
      .then((res) => res.json())
      .then((body) => {
        setInvoices(body.data ?? []);
        setAllocations({});
      })
      .catch(() => setInvoices([]));
  };

  const selectedPaymentType = paymentTypes.find((t) => t.id === paymentTypeId);

  const outstandingFor = (inv: OutstandingInvoice) => Number(inv.totalAmount) - Number(inv.paidAmount);

  const allocatedTotal = invoices.reduce((sum, inv) => sum + (Number(allocations[inv.id]) || 0), 0);

  const activeAllocations = invoices
    .map((inv) => ({ invoiceId: inv.id, amount: Number(allocations[inv.id]) || 0 }))
    .filter((a) => a.amount > 0);

  const canSubmit = isOnAccount ? Number(onAccountAmount) > 0 : activeAllocations.length > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !partyId || !canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          customerId: direction === "RECEIPT" ? partyId : undefined,
          supplierId: direction === "PAYMENT_OUT" ? partyId : undefined,
          paymentDate,
          paymentTypeId,
          bankAccountId: bankAccountId || undefined,
          referenceNumber: referenceNumber || undefined,
          amount: isOnAccount ? Number(onAccountAmount) || 0 : allocatedTotal,
          allocations: isOnAccount
            ? []
            : activeAllocations.map((a) => ({
                salesInvoiceId: direction === "RECEIPT" ? a.invoiceId : undefined,
                purchaseInvoiceId: direction === "PAYMENT_OUT" ? a.invoiceId : undefined,
                allocatedAmount: a.amount,
              })),
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create payment.");
        return;
      }

      const body = await res.json();
      router.push(`/accounts/payments/${body.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => selectDirection("RECEIPT")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            direction === "RECEIPT"
              ? "bg-indigo-600 text-white"
              : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          }`}
        >
          Receipt (from Customer)
        </button>
        <button
          type="button"
          onClick={() => selectDirection("PAYMENT_OUT")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            direction === "PAYMENT_OUT"
              ? "bg-indigo-600 text-white"
              : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          }`}
        >
          Payment (to Supplier)
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label={direction === "RECEIPT" ? "Customer" : "Supplier"} htmlFor="partyId" required>
          <SearchableSelect
            id="partyId"
            required
            value={partyId}
            onChange={selectParty}
            options={(direction === "RECEIPT" ? customers : suppliers).map((p) => ({ id: p.id, label: p.name }))}
            placeholder={direction === "RECEIPT" ? "Search customer…" : "Search supplier…"}
          />
        </FormField>
        <FormField label="Payment Date" htmlFor="paymentDate" required>
          <input
            id="paymentDate"
            type="date"
            required
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Payment Type" htmlFor="paymentTypeId" required>
          <select
            id="paymentTypeId"
            required
            value={paymentTypeId}
            onChange={(e) => setPaymentTypeId(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Select —</option>
            {paymentTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
        {selectedPaymentType && selectedPaymentType.type !== "CASH" && (
          <FormField label="Bank Account" htmlFor="bankAccountId">
            <select id="bankAccountId" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={textInputClass()}>
              <option value="">— None —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.bankName}
                </option>
              ))}
            </select>
          </FormField>
        )}
        <FormField label="Reference No. (cheque/UTR)" htmlFor="referenceNumber">
          <input
            id="referenceNumber"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      {partyId && (
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" checked={isOnAccount} onChange={(e) => setIsOnAccount(e.target.checked)} className="h-4 w-4" />
          Record as &quot;On Account&quot; — no specific invoice yet, allocate later as bills arrive
        </label>
      )}

      {partyId && isOnAccount && (
        <FormField label="Amount" htmlFor="onAccountAmount" required>
          <input
            id="onAccountAmount"
            type="number"
            min={0}
            step="0.01"
            required
            value={onAccountAmount}
            onChange={(e) => setOnAccountAmount(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      )}

      {partyId && !isOnAccount && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Outstanding Invoices — enter an amount to allocate against a line
          </h2>
          {invoices.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No outstanding invoices for this party.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">Invoice No.</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Outstanding</th>
                    <th className="px-3 py-2 font-medium">Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => {
                    const outstanding = outstandingFor(inv);
                    return (
                      <tr key={inv.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="px-3 py-2">{inv.invoiceNumber}</td>
                        <td className="px-3 py-2">{inv.invoiceDate?.slice(0, 10)}</td>
                        <td className="px-3 py-2">{Number(inv.totalAmount).toFixed(2)}</td>
                        <td className="px-3 py-2">{outstanding.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={outstanding}
                            step="0.01"
                            value={allocations[inv.id] ?? ""}
                            onChange={(e) => setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                            className={textInputClass()}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                    <td className="px-3 py-2" colSpan={4}>
                      Payment Amount
                    </td>
                    <td className="px-3 py-2">{allocatedTotal.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting || !partyId || !canSubmit}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/accounts/payments")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

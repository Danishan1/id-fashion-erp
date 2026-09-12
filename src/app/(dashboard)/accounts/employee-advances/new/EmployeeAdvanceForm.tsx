"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode: string;
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

interface EmployeeAdvanceFormProps {
  /** Provided only by the Employee Advances list's "New Advance" modal — when set, a successful create closes the modal instead of navigating. */
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function EmployeeAdvanceForm({ onSuccess, onCancel }: EmployeeAdvanceFormProps = {}) {
  const router = useRouter();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [paymentTypes, setPaymentTypes] = useState<PaymentTypeOption[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);

  const [advanceDate, setAdvanceDate] = useState(todayIsoDate());
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentTypeId, setPaymentTypeId] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [purpose, setPurpose] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // See CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/employees?pageSize=500")
      .then((res) => res.json())
      .then((body) => setEmployees(body.data ?? []))
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

  const selectedPaymentType = paymentTypes.find((t) => t.id === paymentTypeId);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/employee-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advanceDate,
          employeeId,
          amount: Number(amount) || 0,
          paymentTypeId,
          bankAccountId: bankAccountId || undefined,
          purpose: purpose || undefined,
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create advance.");
        return;
      }

      const body = await res.json();
      if (onSuccess) {
        onSuccess();
      } else {
        router.push(`/accounts/employee-advances/${body.data.id}`);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Advance Date" htmlFor="advanceDate" required>
          <input id="advanceDate" type="date" required value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Employee" htmlFor="employeeId" required>
          <SearchableSelect
            id="employeeId"
            required
            value={employeeId}
            onChange={setEmployeeId}
            options={employees.map((e) => ({ id: e.id, label: e.fullName, sublabel: e.employeeCode }))}
            placeholder="Search employee…"
          />
        </FormField>
      </div>

      <FormField label="Amount" htmlFor="amount" required>
        <input id="amount" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={textInputClass()} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment Type" htmlFor="paymentTypeId" required>
          <select id="paymentTypeId" required value={paymentTypeId} onChange={(e) => setPaymentTypeId(e.target.value)} className={textInputClass()}>
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
      </div>

      <FormField label="Purpose (optional)" htmlFor="purpose">
        <input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Client visit — Mumbai, 3 days" className={textInputClass()} />
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
          onClick={onCancel ?? (() => router.push("/accounts/employee-advances"))}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

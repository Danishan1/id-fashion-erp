"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatCurrency } from "@/lib/currency";
import { todayIsoDate } from "@/lib/date";
import { StagedFilesPicker, uploadFilesToRecord } from "@/components/ui/AttachmentsPanel";

interface ChartOfAccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface TaxRateOption {
  id: string;
  name: string;
  ratePercentage: string;
}

interface InitialExpense {
  id: string;
  expenseDate: string;
  accountId: string | null;
  supplierId: string | null;
  description: string;
  amount: string;
  taxRateId: string | null;
  tdsPercentage: string | null;
  referenceNumber: string | null;
}

interface ExpenseFormProps {
  initialExpense?: InitialExpense;
  /** Provided only by the Expenses list's "New Expense" modal — when set, a successful create closes the modal instead of navigating (edit mode always navigates, unaffected). */
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ExpenseForm({ initialExpense, onSuccess, onCancel }: ExpenseFormProps) {
  const router = useRouter();
  const isEditMode = !!initialExpense;

  const [accounts, setAccounts] = useState<ChartOfAccountOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);

  const [expenseDate, setExpenseDate] = useState(initialExpense?.expenseDate.slice(0, 10) ?? todayIsoDate());
  const [accountId, setAccountId] = useState(initialExpense?.accountId ?? "");
  const [supplierId, setSupplierId] = useState(initialExpense?.supplierId ?? "");
  const [description, setDescription] = useState(initialExpense?.description ?? "");
  const [amount, setAmount] = useState(initialExpense?.amount ?? "");
  const [taxRateId, setTaxRateId] = useState(initialExpense?.taxRateId ?? "");
  const [tdsPercentage, setTdsPercentage] = useState(initialExpense?.tdsPercentage ?? "");
  const [referenceNumber, setReferenceNumber] = useState(initialExpense?.referenceNumber ?? "");
  // Bills/photos/voice notes picked before saving — uploaded right after the
  // expense is created (create mode only; the detail page manages them after).
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Create-only — an edit PATCHes an existing row, so there's no "double
  // create" scenario to protect against there. See CF-5 in the independent
  // hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/chart-of-accounts?pageSize=500")
      .then((res) => res.json())
      .then((body) =>
        setAccounts(
          (body.data ?? []).filter(
            (a: ChartOfAccountOption) => a.accountType === "EXPENSE" && a.code !== "COGS" && a.isActive
          )
        )
      )
      .catch(() => {});
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/tax-rates")
      .then((res) => res.json())
      .then((body) => setTaxRates(body.data ?? []))
      .catch(() => {});
  }, []);

  const selectedTaxRate = taxRates.find((t) => t.id === taxRateId);

  const amountNum = Number(amount) || 0;
  const taxAmount = selectedTaxRate ? (amountNum * Number(selectedTaxRate.ratePercentage)) / 100 : 0;
  const totalAmount = amountNum + taxAmount;
  const tdsAmount = tdsPercentage ? (amountNum * Number(tdsPercentage)) / 100 : 0;
  const netPayable = totalAmount - tdsAmount;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      expenseDate,
      accountId,
      supplierId: supplierId || undefined,
      description,
      amount: amountNum,
      taxRateId: taxRateId || undefined,
      tdsPercentage: tdsPercentage ? Number(tdsPercentage) : undefined,
      referenceNumber: referenceNumber || undefined,
      ...(isEditMode ? {} : { idempotencyKey }),
    };

    try {
      const res = await fetch(isEditMode ? `/api/v1/expenses/${initialExpense.id}` : "/api/v1/expenses", {
        method: isEditMode ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to save the expense.");
        return;
      }

      const body = await res.json();
      if (!isEditMode && stagedFiles.length > 0) {
        try {
          await uploadFilesToRecord("expense", body.data.id, stagedFiles);
        } catch (uploadErr) {
          // The expense exists — open it so the files can be added there.
          setError(uploadErr instanceof Error ? uploadErr.message : "Files could not be uploaded.");
          router.push(`/accounts/expenses/${body.data.id}`);
          return;
        }
      }
      if (onSuccess) {
        onSuccess();
      } else {
        router.push(`/accounts/expenses/${body.data.id}`);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Expense Date" htmlFor="expenseDate" required>
          <input
            id="expenseDate"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Expense Account" htmlFor="accountId" required>
          <SearchableSelect
            id="accountId"
            required
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) => ({ id: a.id, label: a.name, sublabel: a.code }))}
            placeholder="Search account…"
          />
        </FormField>
      </div>

      <FormField label="Description" htmlFor="description" required>
        <input
          id="description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Office Internet Bill — August 2026"
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Amount" htmlFor="amount" required>
          <input
            id="amount"
            type="number"
            min={0}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Tax Rate (optional)" htmlFor="taxRateId">
          <select id="taxRateId" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} className={textInputClass()}>
            <option value="">No tax</option>
            {taxRates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Supplier (optional)" htmlFor="supplierId">
          <SearchableSelect
            id="supplierId"
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
            placeholder="Search supplier…"
          />
        </FormField>
        <FormField label="TDS % (optional)" htmlFor="tdsPercentage">
          <input
            id="tdsPercentage"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={tdsPercentage}
            onChange={(e) => setTdsPercentage(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Bill / Reference No. (optional)" htmlFor="referenceNumber">
        <input
          id="referenceNumber"
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      {!isEditMode && (
        <FormField label="Bills, photos & voice notes (optional)" htmlFor="stagedFiles">
          <StagedFilesPicker files={stagedFiles} onChange={setStagedFiles} />
        </FormField>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        How it is paid (cash/bank, part or full) is recorded later on the expense, after it is approved.
      </p>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p>Amount: ₹{formatCurrency(amountNum)}</p>
        <p>Tax: ₹{formatCurrency(taxAmount)}</p>
        <p className="font-medium">Total: ₹{formatCurrency(totalAmount)}</p>
        {tdsAmount > 0 && (
          <>
            <p>TDS Withheld: −₹{formatCurrency(tdsAmount)}</p>
            <p className="font-medium">Net Payable: ₹{formatCurrency(netPayable)}</p>
          </>
        )}
      </div>

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
          onClick={onCancel ?? (() => router.push("/accounts/expenses"))}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

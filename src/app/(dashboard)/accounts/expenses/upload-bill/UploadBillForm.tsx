"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { StagedFilesPicker } from "@/components/ui/AttachmentsPanel";
import { todayIsoDate } from "@/lib/date";

interface SupplierOption {
  id: string;
  name: string;
}

export function UploadBillForm() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [expenseDate, setExpenseDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []))
      .catch(() => {});
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (files.length === 0) {
      setError("Add the bill (photo, PDF or voice note) before submitting.");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const form = new FormData();
    form.append("expenseDate", expenseDate);
    form.append("amount", amount);
    form.append("description", description);
    if (supplierId) form.append("supplierId", supplierId);
    if (referenceNumber) form.append("referenceNumber", referenceNumber);
    form.append("idempotencyKey", idempotencyKey);
    files.forEach((f) => form.append("files", f));

    try {
      const res = await fetch("/api/v1/expenses/upload-bill", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not upload the bill.");
        return;
      }
      router.push(`/accounts/expenses/${body.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. It's safe to submit again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <FormField label="Bill (photo / PDF) and voice note" htmlFor="billFiles" required>
        <StagedFilesPicker files={files} onChange={setFiles} />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Bill Date" htmlFor="expenseDate" required>
          <input
            id="expenseDate"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Amount (as on the bill)" htmlFor="amount" required>
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
      </div>

      <FormField label="What is it for?" htmlFor="description" required>
        <input
          id="description"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Tea & snacks for staff, courier charges"
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Party / Supplier (optional)" htmlFor="supplierId">
          <SearchableSelect
            id="supplierId"
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
            placeholder="Search supplier…"
          />
        </FormField>
        <FormField label="Bill No. (optional)" htmlFor="referenceNumber">
          <input
            id="referenceNumber"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Uploading…" : "Submit Bill"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/accounts/expenses")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

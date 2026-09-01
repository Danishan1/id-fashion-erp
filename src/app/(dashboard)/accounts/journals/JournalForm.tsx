"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { todayIsoDate } from "@/lib/date";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

export interface JournalLineFormValue {
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string;
}

export interface JournalFormValues {
  journalDate: string;
  narration: string;
  lines: JournalLineFormValue[];
}

const EMPTY_LINE: JournalLineFormValue = { accountId: "", debitAmount: "", creditAmount: "", description: "" };

function emptyValues(): JournalFormValues {
  return {
    journalDate: todayIsoDate(),
    narration: "",
    lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
  };
}

interface JournalFormProps {
  initialValues?: JournalFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  /** Base path to redirect to after save — the created/updated journal's id is appended. */
  redirectBase: string;
}

export function JournalForm({ initialValues, submitUrl, method, redirectBase }: JournalFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<JournalFormValues>(initialValues ?? emptyValues());
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/chart-of-accounts?pageSize=200")
      .then((res) => res.json())
      .then((body) => setAccounts(body.data ?? []))
      .catch(() => {});
  }, []);

  const updateLine = (index: number, patch: Partial<JournalLineFormValue>) => {
    setValues((prev) => ({
      ...prev,
      lines: prev.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  };

  const addLine = () => setValues((prev) => ({ ...prev, lines: [...prev.lines, { ...EMPTY_LINE }] }));
  const removeLine = (index: number) =>
    setValues((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));

  const totalDebit = values.lines.reduce((sum, l) => sum + (Number(l.debitAmount) || 0), 0);
  const totalCredit = values.lines.reduce((sum, l) => sum + (Number(l.creditAmount) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        journalDate: values.journalDate,
        narration: values.narration,
        lines: values.lines
          .filter((l) => l.accountId)
          .map((l) => ({
            accountId: l.accountId,
            debitAmount: Number(l.debitAmount) || 0,
            creditAmount: Number(l.creditAmount) || 0,
            description: l.description,
          })),
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save journal.");
      return;
    }

    const body = await res.json();
    router.push(`${redirectBase}/${body.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Journal Date" htmlFor="journalDate" required>
          <input
            id="journalDate"
            type="date"
            required
            value={values.journalDate}
            onChange={(e) => setValues({ ...values, journalDate: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Narration" htmlFor="narration">
          <input
            id="narration"
            value={values.narration}
            onChange={(e) => setValues({ ...values, narration: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Lines</h2>
          <button type="button" onClick={addLine} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
            + Add Line
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Debit</th>
                <th className="px-3 py-2 font-medium">Credit</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {values.lines.map((line, index) => (
                <tr key={index} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <select
                      value={line.accountId}
                      onChange={(e) => updateLine(index, { accountId: e.target.value })}
                      className={textInputClass()}
                    >
                      <option value="">— Select account —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={line.description}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                      className={textInputClass()}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.debitAmount}
                      onChange={(e) => updateLine(index, { debitAmount: e.target.value, creditAmount: "" })}
                      className={textInputClass()}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={line.creditAmount}
                      onChange={(e) => updateLine(index, { creditAmount: e.target.value, debitAmount: "" })}
                      className={textInputClass()}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {values.lines.length > 2 && (
                      <button type="button" onClick={() => removeLine(index)} className="text-red-600 hover:text-red-500">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                <td className="px-3 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-2">{totalDebit.toFixed(2)}</td>
                <td className="px-3 py-2">{totalCredit.toFixed(2)}</td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className={`text-sm ${isBalanced ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
          {isBalanced
            ? "Balanced."
            : `Not balanced — debit ${totalDebit.toFixed(2)} vs credit ${totalCredit.toFixed(2)}.`}
        </p>
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
          onClick={() => router.push("/accounts/journals")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

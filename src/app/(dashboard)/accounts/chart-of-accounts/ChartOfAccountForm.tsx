"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ACCOUNT_TYPES } from "@/modules/accounts/chart-of-account.schema";

export interface ChartOfAccountFormValues {
  code: string;
  name: string;
  accountType: (typeof ACCOUNT_TYPES)[number];
  parentAccountId: string;
}

const EMPTY_VALUES: ChartOfAccountFormValues = { code: "", name: "", accountType: "ASSET", parentAccountId: "" };

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface ChartOfAccountFormProps {
  initialValues?: ChartOfAccountFormValues;
  currentId?: string;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function ChartOfAccountForm({ initialValues, currentId, submitUrl, method, onSuccess, onCancel }: ChartOfAccountFormProps) {
  const [values, setValues] = useState<ChartOfAccountFormValues>(initialValues ?? EMPTY_VALUES);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/chart-of-accounts?pageSize=200")
      .then((res) => res.json())
      .then((body) => setAccounts((body.data ?? []).filter((a: AccountOption) => a.id !== currentId)))
      .catch(() => {});
  }, [currentId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save account.");
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" htmlFor="code" required>
          <input
            id="code"
            required
            value={values.code}
            onChange={(e) => setValues({ ...values, code: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Account Type" htmlFor="accountType" required>
          <select
            id="accountType"
            value={values.accountType}
            onChange={(e) => setValues({ ...values, accountType: e.target.value as ChartOfAccountFormValues["accountType"] })}
            className={textInputClass()}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Name" htmlFor="name" required>
        <input
          id="name"
          required
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Parent Account" htmlFor="parentAccountId">
        <select
          id="parentAccountId"
          value={values.parentAccountId}
          onChange={(e) => setValues({ ...values, parentAccountId: e.target.value })}
          className={textInputClass()}
        >
          <option value="">— None —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { COUNTRIES } from "@/lib/countries";

export interface CustomerFormValues {
  code: string;
  name: string;
  type: "CUSTOMER" | "AGENT";
  country: string;
  paymentTermsDays: string;
  creditLimit: string;
  defaultCurrencyCode: string;
  isActive: boolean;
}

const EMPTY_VALUES: CustomerFormValues = {
  code: "",
  name: "",
  type: "CUSTOMER",
  country: "India",
  paymentTermsDays: "",
  creditLimit: "",
  defaultCurrencyCode: "INR",
  isActive: true,
};

interface Currency {
  code: string;
  name: string;
}

/** Currency model has no country column — this just labels the dropdown for the handful of seeded currencies. */
const COUNTRY_BY_CURRENCY: Record<string, string> = {
  INR: "India",
  USD: "United States",
  EUR: "Eurozone",
};

interface CustomerFormProps {
  initialValues?: CustomerFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
}

export function CustomerForm({ initialValues, submitUrl, method, redirectTo }: CustomerFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerFormValues>(initialValues ?? EMPTY_VALUES);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/currencies")
      .then((res) => res.json())
      .then((body) => setCurrencies(body.data ?? []))
      .catch(() => setCurrencies([]));
  }, []);

  // New records get a suggested sequential code (e.g. CUST-00006); the field stays editable.
  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/customers/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) setValues((prev) => (prev.code ? prev : { ...prev, code: body.data.code }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: values.code,
        name: values.name,
        type: values.type,
        country: values.country,
        paymentTermsDays: values.paymentTermsDays ? Number(values.paymentTermsDays) : undefined,
        creditLimit: values.creditLimit ? Number(values.creditLimit) : undefined,
        defaultCurrencyCode: values.defaultCurrencyCode,
        isActive: values.isActive,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save customer.");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
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
        <FormField label="Type" htmlFor="type" required>
          <select
            id="type"
            value={values.type}
            onChange={(e) => setValues({ ...values, type: e.target.value as "CUSTOMER" | "AGENT" })}
            className={textInputClass()}
          >
            <option value="CUSTOMER">Customer</option>
            <option value="AGENT">Agent</option>
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

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Country" htmlFor="country">
          <select
            id="country"
            value={values.country}
            onChange={(e) => setValues({ ...values, country: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— Select —</option>
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Default Currency" htmlFor="currency">
          <select
            id="currency"
            value={values.defaultCurrencyCode}
            onChange={(e) => setValues({ ...values, defaultCurrencyCode: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
                {COUNTRY_BY_CURRENCY[c.code] ? ` (${COUNTRY_BY_CURRENCY[c.code]})` : ""}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Payment Terms (days)" htmlFor="paymentTerms">
          <input
            id="paymentTerms"
            type="number"
            min={0}
            value={values.paymentTermsDays}
            onChange={(e) => setValues({ ...values, paymentTermsDays: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Credit Limit" htmlFor="creditLimit">
          <input
            id="creditLimit"
            type="number"
            min={0}
            step="0.01"
            value={values.creditLimit}
            onChange={(e) => setValues({ ...values, creditLimit: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
        />
        Active
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => router.push(redirectTo)}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

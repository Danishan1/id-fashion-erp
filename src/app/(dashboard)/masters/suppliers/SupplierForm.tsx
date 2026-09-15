"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { COUNTRIES } from "@/lib/countries";

export interface SupplierFormValues {
  code: string;
  name: string;
  categoryId: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  pinCode: string;
  country: string;
  taxRegistrationNo: string;
  paymentTermsDays: string;
  defaultCurrencyCode: string;
  isActive: boolean;
}

const EMPTY_VALUES: SupplierFormValues = {
  code: "",
  name: "",
  categoryId: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  pinCode: "",
  country: "India",
  taxRegistrationNo: "",
  paymentTermsDays: "",
  defaultCurrencyCode: "INR",
  isActive: true,
};

interface Currency {
  code: string;
  name: string;
}

interface SupplierCategory {
  id: string;
  name: string;
}

/** Currency model has no country column — this just labels the dropdown for the handful of seeded currencies. */
const COUNTRY_BY_CURRENCY: Record<string, string> = {
  INR: "India",
  USD: "United States",
  EUR: "Eurozone",
};

interface SupplierFormProps {
  initialValues?: SupplierFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function SupplierForm({ initialValues, submitUrl, method, onSuccess, onCancel }: SupplierFormProps) {
  const [values, setValues] = useState<SupplierFormValues>(initialValues ?? EMPTY_VALUES);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [categories, setCategories] = useState<SupplierCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/suppliers/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) setValues((prev) => (prev.code ? prev : { ...prev, code: body.data.code }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/v1/currencies")
      .then((res) => res.json())
      .then((body) => setCurrencies(body.data ?? []))
      .catch(() => setCurrencies([]));
    fetch("/api/v1/supplier-categories")
      .then((res) => res.json())
      .then((body) => setCategories(body.data ?? []))
      .catch(() => setCategories([]));
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
        ...values,
        paymentTermsDays: values.paymentTermsDays ? Number(values.paymentTermsDays) : undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save supplier.");
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
            readOnly
            disabled
            value={values.code}
            title="Auto-generated — not editable"
            className={`${textInputClass()} cursor-not-allowed bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
          />
        </FormField>
        <FormField label="Category" htmlFor="categoryId" required>
          <select
            id="categoryId"
            required
            value={values.categoryId}
            onChange={(e) => setValues({ ...values, categoryId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— Select —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Contact Person" htmlFor="contactPerson">
          <input
            id="contactPerson"
            value={values.contactPerson}
            onChange={(e) => setValues({ ...values, contactPerson: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Phone" htmlFor="phone">
          <input
            id="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Email" htmlFor="email">
        <input
          id="email"
          type="email"
          value={values.email}
          onChange={(e) => setValues({ ...values, email: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Address" htmlFor="address">
        <textarea
          id="address"
          rows={2}
          value={values.address}
          onChange={(e) => setValues({ ...values, address: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="City" htmlFor="city">
          <input
            id="city"
            value={values.city}
            onChange={(e) => setValues({ ...values, city: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Pin Code" htmlFor="pinCode">
          <input
            id="pinCode"
            value={values.pinCode}
            onChange={(e) => setValues({ ...values, pinCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
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
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Tax Reg. No." htmlFor="taxRegistrationNo">
          <input
            id="taxRegistrationNo"
            value={values.taxRegistrationNo}
            onChange={(e) => setValues({ ...values, taxRegistrationNo: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
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
        <FormField label="Currency" htmlFor="currency">
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

      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => setValues({ ...values, isActive: e.target.checked })}
        />
        Active
      </label>

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

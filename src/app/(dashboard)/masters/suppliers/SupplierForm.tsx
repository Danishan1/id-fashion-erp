"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SUPPLIER_CATEGORIES } from "@/modules/suppliers/supplier.schema";

export interface SupplierFormValues {
  code: string;
  name: string;
  category: (typeof SUPPLIER_CATEGORIES)[number];
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  taxRegistrationNo: string;
  paymentTermsDays: string;
  defaultCurrencyCode: string;
  isActive: boolean;
}

const EMPTY_VALUES: SupplierFormValues = {
  code: "",
  name: "",
  category: "FABRIC",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  taxRegistrationNo: "",
  paymentTermsDays: "",
  defaultCurrencyCode: "",
  isActive: true,
};

interface SupplierFormProps {
  initialValues?: SupplierFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
}

export function SupplierForm({ initialValues, submitUrl, method, redirectTo }: SupplierFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<SupplierFormValues>(initialValues ?? EMPTY_VALUES);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        <FormField label="Category" htmlFor="category" required>
          <select
            id="category"
            value={values.category}
            onChange={(e) => setValues({ ...values, category: e.target.value as SupplierFormValues["category"] })}
            className={textInputClass()}
          >
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
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
          <input
            id="currency"
            placeholder="USD"
            maxLength={3}
            value={values.defaultCurrencyCode}
            onChange={(e) => setValues({ ...values, defaultCurrencyCode: e.target.value.toUpperCase() })}
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

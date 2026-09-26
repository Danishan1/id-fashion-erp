"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface ContractorFormValues {
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  isActive: boolean;
}

const EMPTY_VALUES: ContractorFormValues = {
  code: "",
  name: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  isActive: true,
};

interface ContractorFormProps {
  initialValues?: ContractorFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function ContractorForm({ initialValues, submitUrl, method, onSuccess, onCancel }: ContractorFormProps) {
  const [values, setValues] = useState<ContractorFormValues>(initialValues ?? EMPTY_VALUES);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/contractors/next-code")
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
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save contractor.");
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
        <FormField label="Name" htmlFor="name" required>
          <input
            id="name"
            required
            value={values.name}
            onChange={(e) => setValues({ ...values, name: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

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

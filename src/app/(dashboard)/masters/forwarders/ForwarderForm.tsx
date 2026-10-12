"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface ForwarderFormValues {
  code: string;
  name: string;
  type: "COURIER" | "ROAD" | "RAIL" | "AIR" | "OTHER";
  contactPerson: string;
  phone: string;
  altPhone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  gstin: string;
  remarks: string;
  isActive: boolean;
}

const EMPTY_VALUES: ForwarderFormValues = {
  code: "",
  name: "",
  type: "COURIER",
  contactPerson: "",
  phone: "",
  altPhone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  country: "",
  postalCode: "",
  gstin: "",
  remarks: "",
  isActive: true,
};

interface ForwarderFormProps {
  initialValues?: ForwarderFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function ForwarderForm({ initialValues, submitUrl, method, onSuccess, onCancel }: ForwarderFormProps) {
  const [values, setValues] = useState<ForwarderFormValues>(initialValues ?? EMPTY_VALUES);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/forwarders/next-code")
      .then((res) => (res.ok ? res.json() : null))
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

    let res: Response;
    try {
      res = await fetch(submitUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-toast-success": method === "POST" ? "Forwarder created successfully." : "Forwarder updated successfully.",
        },
        body: JSON.stringify(values),
      });
    } catch {
      setIsSubmitting(false);
      setError("Could not reach the server. Check your connection and try again.");
      return;
    }

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save forwarder.");
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Code" htmlFor="code">
          <input
            id="code"
            readOnly
            disabled
            value={values.code}
            placeholder="Auto-generated on save"
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
        <FormField label="Type" htmlFor="type" required>
          <select
            id="type"
            value={values.type}
            onChange={(e) => setValues({ ...values, type: e.target.value as ForwarderFormValues["type"] })}
            className={textInputClass()}
          >
            <option value="COURIER">Courier</option>
            <option value="ROAD">Road / Truck</option>
            <option value="RAIL">Rail</option>
            <option value="AIR">Air</option>
            <option value="OTHER">Other</option>
          </select>
        </FormField>
        <FormField label="Contact Person" htmlFor="contactPerson">
          <input
            id="contactPerson"
            value={values.contactPerson}
            onChange={(e) => setValues({ ...values, contactPerson: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Phone" htmlFor="phone">
          <input
            id="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => setValues({ ...values, phone: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Alternate Phone" htmlFor="altPhone">
          <input
            id="altPhone"
            type="tel"
            value={values.altPhone}
            onChange={(e) => setValues({ ...values, altPhone: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="GSTIN" htmlFor="gstin">
          <input
            id="gstin"
            value={values.gstin}
            onChange={(e) => setValues({ ...values, gstin: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Address" htmlFor="address">
        <textarea
          id="address"
          rows={2}
          value={values.address}
          onChange={(e) => setValues({ ...values, address: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="City" htmlFor="city">
          <input
            id="city"
            value={values.city}
            onChange={(e) => setValues({ ...values, city: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="State" htmlFor="state">
          <input
            id="state"
            value={values.state}
            onChange={(e) => setValues({ ...values, state: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Country" htmlFor="country">
          <input
            id="country"
            value={values.country}
            onChange={(e) => setValues({ ...values, country: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Postal Code" htmlFor="postalCode">
          <input
            id="postalCode"
            value={values.postalCode}
            onChange={(e) => setValues({ ...values, postalCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Remarks" htmlFor="remarks">
        <textarea
          id="remarks"
          rows={2}
          value={values.remarks}
          onChange={(e) => setValues({ ...values, remarks: e.target.value })}
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

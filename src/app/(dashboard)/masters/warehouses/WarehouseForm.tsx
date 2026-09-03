"use client";

import { useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { WAREHOUSE_TYPES } from "@/modules/warehouses/warehouse.schema";
import { suggestCodeFromName } from "@/lib/code-suggest";

export interface WarehouseFormValues {
  code: string;
  name: string;
  /** Array, not a single value — a warehouse can store more than one
   * material kind in different rooms/sections. */
  type: (typeof WAREHOUSE_TYPES)[number][];
  isActive: boolean;
}

const EMPTY_VALUES: WarehouseFormValues = { code: "", name: "", type: ["RAW_MATERIAL"], isActive: true };

export interface WarehouseRecord extends WarehouseFormValues {
  id: string;
}

interface WarehouseFormProps {
  initialValues?: WarehouseFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  /** Receives the saved record — Create uses this to learn the new warehouse's id (to then show its Locations). */
  onSuccess: (saved: WarehouseRecord) => void;
  onCancel: () => void;
  /** Merged into the submitted JSON body — used by Create to stage Storage
   * Locations in the same request (see WarehousesListClient). Not used by Edit. */
  extraFields?: Record<string, unknown>;
}

export function WarehouseForm({ initialValues, submitUrl, method, onSuccess, onCancel, extraFields }: WarehouseFormProps) {
  const [values, setValues] = useState<WarehouseFormValues>(initialValues ?? EMPTY_VALUES);
  const [isCodeManuallyEdited, setIsCodeManuallyEdited] = useState(Boolean(initialValues));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleType = (type: (typeof WAREHOUSE_TYPES)[number]) => {
    setValues((prev) => ({
      ...prev,
      type: prev.type.includes(type) ? prev.type.filter((t) => t !== type) : [...prev.type, type],
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || values.type.length === 0) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...values, ...extraFields }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save warehouse.");
      return;
    }

    const body = await res.json().catch(() => null);
    onSuccess(body?.data ?? { id: "", ...values });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <FormField label="Code" htmlFor="code" required>
        <input
          id="code"
          required
          value={values.code}
          onChange={(e) => {
            setIsCodeManuallyEdited(true);
            setValues({ ...values, code: e.target.value });
          }}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Name" htmlFor="name" required>
        <input
          id="name"
          required
          value={values.name}
          onChange={(e) => {
            const name = e.target.value;
            setValues({ ...values, name, code: isCodeManuallyEdited ? values.code : suggestCodeFromName(name) });
          }}
          className={textInputClass()}
        />
      </FormField>

      <div>
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Type<span className="text-red-500"> *</span>
        </span>
        <div className="mt-1 grid grid-cols-2 gap-2 rounded-md border border-zinc-300 p-3 sm:grid-cols-3 dark:border-zinc-700">
          {WAREHOUSE_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={values.type.includes(t)} onChange={() => toggleType(t)} />
              {t.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        {values.type.length === 0 && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">Select at least one type.</p>
        )}
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
          disabled={isSubmitting || values.type.length === 0}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

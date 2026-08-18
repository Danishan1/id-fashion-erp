"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { WAREHOUSE_TYPES } from "@/modules/warehouses/warehouse.schema";
import { suggestCodeFromName } from "@/lib/code-suggest";

export interface WarehouseFormValues {
  code: string;
  name: string;
  type: (typeof WAREHOUSE_TYPES)[number];
  isActive: boolean;
}

const EMPTY_VALUES: WarehouseFormValues = { code: "", name: "", type: "RAW_MATERIAL", isActive: true };

interface WarehouseFormProps {
  initialValues?: WarehouseFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
}

export function WarehouseForm({ initialValues, submitUrl, method, redirectTo }: WarehouseFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<WarehouseFormValues>(initialValues ?? EMPTY_VALUES);
  const [isCodeManuallyEdited, setIsCodeManuallyEdited] = useState(Boolean(initialValues));
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
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save warehouse.");
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
            onChange={(e) => {
              setIsCodeManuallyEdited(true);
              setValues({ ...values, code: e.target.value });
            }}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Type" htmlFor="type" required>
          <select
            id="type"
            value={values.type}
            onChange={(e) => setValues({ ...values, type: e.target.value as WarehouseFormValues["type"] })}
            className={textInputClass()}
          >
            {WAREHOUSE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
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
          onChange={(e) => {
            const name = e.target.value;
            setValues({ ...values, name, code: isCodeManuallyEdited ? values.code : suggestCodeFromName(name) });
          }}
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

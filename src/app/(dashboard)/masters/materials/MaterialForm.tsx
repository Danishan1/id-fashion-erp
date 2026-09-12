"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

export interface MaterialFormValues {
  styleCode: string;
  styleName: string;
  materialCategory: (typeof MATERIAL_CATEGORIES)[number];
  baseUomId: string;
  defaultSupplierId: string;
  reorderLevel: string;
  unitCost: string;
  description: string;
  hsnSacCode: string;
  isActive: boolean;
}

const EMPTY_VALUES: MaterialFormValues = {
  styleCode: "",
  styleName: "",
  materialCategory: "FABRIC",
  baseUomId: "",
  defaultSupplierId: "",
  reorderLevel: "",
  unitCost: "",
  description: "",
  hsnSacCode: "",
  isActive: true,
};

interface Option {
  id: string;
  name?: string;
  code?: string;
}

interface MaterialFormProps {
  initialValues?: MaterialFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  onSuccess: () => void;
  onCancel: () => void;
}

export function MaterialForm({ initialValues, submitUrl, method, onSuccess, onCancel }: MaterialFormProps) {
  const [values, setValues] = useState<MaterialFormValues>(initialValues ?? EMPTY_VALUES);
  const [units, setUnits] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
  }, []);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/materials/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) setValues((prev) => (prev.styleCode ? prev : { ...prev, styleCode: body.data.code }));
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
        ...values,
        reorderLevel: values.reorderLevel ? Number(values.reorderLevel) : undefined,
        unitCost: values.unitCost ? Number(values.unitCost) : undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save material.");
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Item Code" htmlFor="styleCode" required>
          <input
            id="styleCode"
            required
            value={values.styleCode}
            onChange={(e) => setValues({ ...values, styleCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Category" htmlFor="materialCategory" required>
          <select
            id="materialCategory"
            value={values.materialCategory}
            onChange={(e) =>
              setValues({ ...values, materialCategory: e.target.value as MaterialFormValues["materialCategory"] })
            }
            className={textInputClass()}
          >
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Item Name" htmlFor="styleName" required>
        <input
          id="styleName"
          required
          value={values.styleName}
          onChange={(e) => setValues({ ...values, styleName: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Unit of Measure" htmlFor="baseUomId">
          <select
            id="baseUomId"
            value={values.baseUomId}
            onChange={(e) => setValues({ ...values, baseUomId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Default Supplier" htmlFor="defaultSupplierId">
          <SearchableSelect
            id="defaultSupplierId"
            value={values.defaultSupplierId}
            onChange={(defaultSupplierId) => setValues({ ...values, defaultSupplierId })}
            options={suppliers.map((s) => ({ id: s.id, label: s.name ?? "" }))}
            placeholder="Search supplier…"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Reorder Level" htmlFor="reorderLevel">
          <input
            id="reorderLevel"
            type="number"
            min={0}
            step="0.01"
            value={values.reorderLevel}
            onChange={(e) => setValues({ ...values, reorderLevel: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Unit Cost" htmlFor="unitCost">
          <input
            id="unitCost"
            type="number"
            min={0}
            step="0.01"
            value={values.unitCost}
            onChange={(e) => setValues({ ...values, unitCost: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Description" htmlFor="description">
        <textarea
          id="description"
          rows={2}
          value={values.description}
          onChange={(e) => setValues({ ...values, description: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="HSN/SAC Code" htmlFor="hsnSacCode">
        <input
          id="hsnSacCode"
          value={values.hsnSacCode}
          onChange={(e) => setValues({ ...values, hsnSacCode: e.target.value })}
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

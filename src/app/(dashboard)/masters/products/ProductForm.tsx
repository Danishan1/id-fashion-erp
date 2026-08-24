"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

export interface ProductFormValues {
  styleCode: string;
  styleName: string;
  designNumber: string;
  categoryId: string;
  seasonId: string;
  brandId: string;
  productTypeId: string;
  productFittingId: string;
  gender: string;
  description: string;
  hsnSacCode: string;
  customerId: string;
  isActive: boolean;
}

const EMPTY_VALUES: ProductFormValues = {
  styleCode: "",
  styleName: "",
  designNumber: "",
  categoryId: "",
  seasonId: "",
  brandId: "",
  productTypeId: "",
  productFittingId: "",
  gender: "",
  description: "",
  hsnSacCode: "",
  customerId: "",
  isActive: true,
};

interface Customer {
  id: string;
  name: string;
}

interface NamedOption {
  id: string;
  name: string;
}

interface ProductFormProps {
  initialValues?: ProductFormValues;
  submitUrl: string;
  method: "POST" | "PATCH";
  redirectTo: string;
}

export function ProductForm({ initialValues, submitUrl, method, redirectTo }: ProductFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>(initialValues ?? EMPTY_VALUES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [categories, setCategories] = useState<NamedOption[]>([]);
  const [seasons, setSeasons] = useState<NamedOption[]>([]);
  const [brands, setBrands] = useState<NamedOption[]>([]);
  const [productTypes, setProductTypes] = useState<NamedOption[]>([]);
  const [productFittings, setProductFittings] = useState<NamedOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []))
      .catch(() => setCustomers([]));
    fetch("/api/v1/categories?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCategories(body.data ?? []))
      .catch(() => setCategories([]));
    fetch("/api/v1/seasons?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSeasons(body.data ?? []))
      .catch(() => setSeasons([]));
    fetch("/api/v1/brands?pageSize=200")
      .then((res) => res.json())
      .then((body) => setBrands(body.data ?? []))
      .catch(() => setBrands([]));
    fetch("/api/v1/product-types?pageSize=200")
      .then((res) => res.json())
      .then((body) => setProductTypes(body.data ?? []))
      .catch(() => setProductTypes([]));
    fetch("/api/v1/product-fittings?pageSize=200")
      .then((res) => res.json())
      .then((body) => setProductFittings(body.data ?? []))
      .catch(() => setProductFittings([]));
  }, []);

  useEffect(() => {
    if (initialValues) return;
    fetch("/api/v1/products/next-code")
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
      body: JSON.stringify(values),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save style.");
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Style Code" htmlFor="styleCode" required>
          <input
            id="styleCode"
            required
            value={values.styleCode}
            onChange={(e) => setValues({ ...values, styleCode: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Customer" htmlFor="customerId">
          <select
            id="customerId"
            value={values.customerId}
            onChange={(e) => setValues({ ...values, customerId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Style Name" htmlFor="styleName" required>
        <input
          id="styleName"
          required
          value={values.styleName}
          onChange={(e) => setValues({ ...values, styleName: e.target.value })}
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Design Number" htmlFor="designNumber">
        <input
          id="designNumber"
          value={values.designNumber}
          onChange={(e) => setValues({ ...values, designNumber: e.target.value })}
          placeholder="For companies that identify styles by design number"
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Category" htmlFor="categoryId">
          <select
            id="categoryId"
            value={values.categoryId}
            onChange={(e) => setValues({ ...values, categoryId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Season" htmlFor="seasonId">
          <select
            id="seasonId"
            value={values.seasonId}
            onChange={(e) => setValues({ ...values, seasonId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Gender" htmlFor="gender">
          <input
            id="gender"
            value={values.gender}
            onChange={(e) => setValues({ ...values, gender: e.target.value })}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Brand" htmlFor="brandId">
          <select
            id="brandId"
            value={values.brandId}
            onChange={(e) => setValues({ ...values, brandId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Product Type" htmlFor="productTypeId">
          <select
            id="productTypeId"
            value={values.productTypeId}
            onChange={(e) => setValues({ ...values, productTypeId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {productTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Fitting" htmlFor="productFittingId">
          <select
            id="productFittingId"
            value={values.productFittingId}
            onChange={(e) => setValues({ ...values, productFittingId: e.target.value })}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {productFittings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Description" htmlFor="description">
        <textarea
          id="description"
          rows={3}
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

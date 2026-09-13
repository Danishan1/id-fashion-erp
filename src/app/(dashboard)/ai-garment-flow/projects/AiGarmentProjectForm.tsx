"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";

interface Option {
  id: string;
  name: string;
}

interface Currency {
  code: string;
  name: string;
  symbol: string;
}

export interface AiGarmentProjectFormValues {
  projectName: string;
  customerId: string;
  buyerId: string;
  brandId: string;
  seasonId: string;
  categoryId: string;
  targetMarket: string;
  targetCustomerProfile: string;
  targetSellingPrice: string;
  currencyCode: string;
  orderQuantityEstimate: string;
  notes: string;
}

interface AiGarmentProjectFormProps {
  sourceType: "REFERENCE" | "FABRIC";
  /** Edit mode: pre-fills the form and PATCHes `projectId` instead of creating a new project. */
  projectId?: string;
  initialValues?: Partial<AiGarmentProjectFormValues>;
  /** Called after a successful save in edit mode — the create-mode path always navigates to the new project's detail page instead. */
  onSaved?: () => void;
}

const emptyValues: AiGarmentProjectFormValues = {
  projectName: "",
  customerId: "",
  buyerId: "",
  brandId: "",
  seasonId: "",
  categoryId: "",
  targetMarket: "",
  targetCustomerProfile: "",
  targetSellingPrice: "",
  currencyCode: "",
  orderQuantityEstimate: "",
  notes: "",
};

export function AiGarmentProjectForm({ sourceType, projectId, initialValues, onSaved }: AiGarmentProjectFormProps) {
  const router = useRouter();
  const isEditMode = Boolean(projectId);

  const [values, setValues] = useState<AiGarmentProjectFormValues>({ ...emptyValues, ...initialValues });
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [seasons, setSeasons] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof AiGarmentProjectFormValues>(key: K, value: AiGarmentProjectFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200").then((res) => res.json()).then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/brands").then((res) => res.json()).then((body) => setBrands(body.data ?? []));
    fetch("/api/v1/seasons").then((res) => res.json()).then((body) => setSeasons(body.data ?? []));
    fetch("/api/v1/categories").then((res) => res.json()).then((body) => setCategories(body.data ?? []));
    fetch("/api/v1/currencies").then((res) => res.json()).then((body) => setCurrencies(body.data ?? []));
  }, []);

  useEffect(() => {
    if (!values.customerId) return;
    fetch(`/api/v1/customers/${values.customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [values.customerId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const payload = {
        projectName: values.projectName,
        ...(isEditMode ? {} : { sourceType }),
        customerId: values.customerId || undefined,
        buyerId: values.buyerId || undefined,
        brandId: values.brandId || undefined,
        seasonId: values.seasonId || undefined,
        categoryId: values.categoryId || undefined,
        targetMarket: values.targetMarket || undefined,
        targetCustomerProfile: values.targetCustomerProfile || undefined,
        targetSellingPrice: values.targetSellingPrice ? Number(values.targetSellingPrice) : undefined,
        currencyCode: values.currencyCode || undefined,
        orderQuantityEstimate: values.orderQuantityEstimate ? Number(values.orderQuantityEstimate) : undefined,
        notes: values.notes || undefined,
      };

      const res = await fetch(
        isEditMode ? `/api/v1/ai-garment-projects/${projectId}` : "/api/v1/ai-garment-projects",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save project information.");

      if (isEditMode) {
        setSaved(true);
        onSaved?.();
      } else {
        router.push(`/ai-garment-flow/projects/${body.data.id}`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <FormField label="Project Name" htmlFor="projectName" required>
        <input
          id="projectName"
          className={textInputClass()}
          value={values.projectName}
          onChange={(e) => set("projectName", e.target.value)}
          required
        />
      </FormField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Buyer / Customer" htmlFor="customerId">
          <SearchableSelect
            id="customerId"
            value={values.customerId}
            onChange={(customerId) => {
              set("customerId", customerId);
              set("buyerId", "");
              setBuyers([]);
            }}
            options={customers.map((c) => ({ id: c.id, label: c.name }))}
            placeholder="Search customer…"
            emptyOptionLabel="— None yet —"
          />
        </FormField>
        <FormField label="Buyer Contact" htmlFor="buyerId">
          <SearchableSelect
            id="buyerId"
            value={values.buyerId}
            onChange={(buyerId) => set("buyerId", buyerId)}
            disabled={!values.customerId}
            options={buyers.map((b) => ({ id: b.id, label: b.name }))}
            placeholder={values.customerId ? "Search buyer…" : "Pick a Buyer/Customer first"}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Brand" htmlFor="brandId">
          <select id="brandId" className={textInputClass()} value={values.brandId} onChange={(e) => set("brandId", e.target.value)}>
            <option value="">—</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Season" htmlFor="seasonId">
          <select id="seasonId" className={textInputClass()} value={values.seasonId} onChange={(e) => set("seasonId", e.target.value)}>
            <option value="">—</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Garment Category" htmlFor="categoryId">
          <select id="categoryId" className={textInputClass()} value={values.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Target Market" htmlFor="targetMarket">
          <input id="targetMarket" className={textInputClass()} value={values.targetMarket} onChange={(e) => set("targetMarket", e.target.value)} placeholder="e.g. USA, EU" />
        </FormField>
        <FormField label="Target Customer" htmlFor="targetCustomerProfile">
          <input
            id="targetCustomerProfile"
            className={textInputClass()}
            value={values.targetCustomerProfile}
            onChange={(e) => set("targetCustomerProfile", e.target.value)}
            placeholder="e.g. Young professional women, 25-35"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField label="Target Selling Price" htmlFor="targetSellingPrice">
          <input
            id="targetSellingPrice"
            type="number"
            min="0"
            step="0.01"
            className={textInputClass()}
            value={values.targetSellingPrice}
            onChange={(e) => set("targetSellingPrice", e.target.value)}
          />
        </FormField>
        <FormField label="Currency" htmlFor="currencyCode">
          <select id="currencyCode" className={textInputClass()} value={values.currencyCode} onChange={(e) => set("currencyCode", e.target.value)}>
            <option value="">—</option>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Expected Quantity" htmlFor="orderQuantityEstimate">
          <input
            id="orderQuantityEstimate"
            type="number"
            min="0"
            step="1"
            className={textInputClass()}
            value={values.orderQuantityEstimate}
            onChange={(e) => set("orderQuantityEstimate", e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Additional Notes" htmlFor="notes">
        <textarea id="notes" rows={3} className={textInputClass()} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
      </FormField>

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved && <span className="text-xs text-green-700 dark:text-green-300">Saved.</span>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : isEditMode ? "Save" : "Save & Continue"}
        </button>
      </div>
    </form>
  );
}

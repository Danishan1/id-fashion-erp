"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SAMPLE_TYPE_LABELS } from "./sampleTypeLabels";
import { todayIsoDate } from "@/lib/date";

interface Option {
  id: string;
  name?: string;
  styleName?: string;
}

const TODAY = todayIsoDate();

export function SampleRequestForm() {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [productId, setProductId] = useState("");
  const [sampleType, setSampleType] = useState("");
  const [styleName, setStyleName] = useState("");
  const [color, setColor] = useState("");
  const [requestDate, setRequestDate] = useState(TODAY);
  const [targetSubmissionDate, setTargetSubmissionDate] = useState("");
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/products?pageSize=200")
      .then((res) => res.json())
      .then((body) => setProducts(body.data ?? []));
  }, []);

  // Buyers are scoped to the selected customer — refetch whenever it changes.
  // Resetting buyers/buyerId on customer change happens in the <select>'s
  // onChange handler itself, not here, to avoid a synchronous setState in
  // the effect body.
  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/v1/customers/${customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [customerId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch("/api/v1/sampling", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        buyerId: buyerId || undefined,
        productId: productId || undefined,
        sampleType,
        styleName,
        color: color || undefined,
        requestDate,
        targetSubmissionDate: targetSubmissionDate || undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to create sample request.");
      return;
    }

    const { data } = await res.json();
    router.push(`/sampling/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
      <FormField label="Customer" htmlFor="customerId" required>
        <SearchableSelect
          id="customerId"
          required
          value={customerId}
          onChange={(next) => {
            setCustomerId(next);
            setBuyerId("");
            setBuyers([]);
          }}
          options={customers.map((c) => ({ id: c.id, label: c.name ?? "" }))}
          placeholder="Search customer…"
        />
      </FormField>

      <FormField label="Buyer" htmlFor="buyerId">
        <SearchableSelect
          id="buyerId"
          value={buyerId}
          onChange={setBuyerId}
          disabled={!customerId}
          options={buyers.map((b) => ({ id: b.id, label: b.name ?? "" }))}
          placeholder="Search buyer…"
        />
      </FormField>

      <FormField label="Link to an existing Style (optional)" htmlFor="productId">
        <SearchableSelect
          id="productId"
          value={productId}
          onChange={(value) => {
            setProductId(value);
            const linked = products.find((p) => p.id === value);
            if (linked?.styleName) setStyleName(linked.styleName);
          }}
          options={products.map((p) => ({ id: p.id, label: p.styleName ?? "" }))}
          placeholder="Search style…"
          emptyOptionLabel="— New / not yet in Styles —"
        />
      </FormField>

      <FormField label="Sample Type" htmlFor="sampleType" required>
        <select
          id="sampleType"
          required
          value={sampleType}
          onChange={(e) => setSampleType(e.target.value)}
          className={textInputClass()}
        >
          <option value="">— Select —</option>
          {Object.entries(SAMPLE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="Design Name" htmlFor="styleName" required>
        <input
          id="styleName"
          required
          value={styleName}
          onChange={(e) => setStyleName(e.target.value)}
          placeholder="e.g. Men's Slim Fit Polo — Summer 2026"
          className={textInputClass()}
        />
      </FormField>

      <FormField label="Color" htmlFor="color">
        <input
          id="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          placeholder="e.g. Navy Blue (leave blank if not yet decided)"
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Request Date" htmlFor="requestDate" required>
          <input
            id="requestDate"
            type="date"
            required
            value={requestDate}
            onChange={(e) => setRequestDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Target Submission Date" htmlFor="targetSubmissionDate">
          <input
            id="targetSubmissionDate"
            type="date"
            value={targetSubmissionDate}
            onChange={(e) => setTargetSubmissionDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Creating…" : "Create Sample Request"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/sampling")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { COUNTRIES } from "@/lib/countries";
import { BUSINESS_TYPE_LABELS, LEAD_PRIORITY_LABELS } from "./statusLabels";

interface NamedOption {
  id: string;
  name: string;
  isActive?: boolean;
}
interface UserOption {
  id: string;
  fullName: string;
}
interface CampaignOption {
  id: string;
  name: string;
  campaignNumber: string;
}
interface CurrencyOption {
  code: string;
  name: string;
}

export interface InitialLead {
  id: string;
  name: string;
  companyName: string | null;
  designation: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  alternativePhone: string | null;
  website: string | null;
  businessType: keyof typeof BUSINESS_TYPE_LABELS | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  productCategory: { id: string } | null;
  productInterests: Array<{ productType: { id: string } }>;
  season: { id: string } | null;
  market: string | null;
  expectedQuantity: number | null;
  targetPrice: string | null;
  currencyCode: string | null;
  moqRequirement: string | null;
  requiredDeliveryDate: string | null;
  samplingRequired: boolean;
  techPackAvailable: boolean;
  referenceImageAvailable: boolean;
  source: { id: string } | null;
  priority: keyof typeof LEAD_PRIORITY_LABELS;
  leadScore: string;
  value: string;
  expectedCloseDate: string | null;
  assignedTo: { id: string } | null;
  campaign: { id: string } | null;
  notes: string | null;
}

interface Duplicate {
  id: string;
  leadNumber: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <legend className="px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</legend>
      {children}
    </fieldset>
  );
}

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2";

async function fetchList<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return (body?.data ?? []) as T[];
}

export function LeadForm({ initialLead }: { initialLead?: InitialLead } = {}) {
  const router = useRouter();
  const [f, setF] = useState(() => ({
    name: initialLead?.name ?? "",
    companyName: initialLead?.companyName ?? "",
    designation: initialLead?.designation ?? "",
    email: initialLead?.email ?? "",
    phone: initialLead?.phone ?? "",
    whatsappNumber: initialLead?.whatsappNumber ?? "",
    alternativePhone: initialLead?.alternativePhone ?? "",
    website: initialLead?.website ?? "",
    businessType: (initialLead?.businessType ?? "") as string,
    country: initialLead?.country ?? "",
    state: initialLead?.state ?? "",
    city: initialLead?.city ?? "",
    address: initialLead?.address ?? "",
    productCategoryId: initialLead?.productCategory?.id ?? "",
    seasonId: initialLead?.season?.id ?? "",
    market: initialLead?.market ?? "",
    expectedQuantity: initialLead?.expectedQuantity != null ? String(initialLead.expectedQuantity) : "",
    targetPrice: initialLead?.targetPrice ?? "",
    currencyCode: initialLead?.currencyCode ?? "",
    moqRequirement: initialLead?.moqRequirement ?? "",
    requiredDeliveryDate: initialLead?.requiredDeliveryDate?.slice(0, 10) ?? "",
    sourceId: initialLead?.source?.id ?? "",
    campaignId: initialLead?.campaign?.id ?? "",
    priority: (initialLead?.priority ?? "MEDIUM") as string,
    leadScore: initialLead?.leadScore ?? "0",
    value: initialLead?.value ?? "0",
    expectedCloseDate: initialLead?.expectedCloseDate?.slice(0, 10) ?? "",
    assignedToUserId: initialLead?.assignedTo?.id ?? "",
    notes: initialLead?.notes ?? "",
  }));
  const [flags, setFlags] = useState({
    samplingRequired: initialLead?.samplingRequired ?? false,
    techPackAvailable: initialLead?.techPackAvailable ?? false,
    referenceImageAvailable: initialLead?.referenceImageAvailable ?? false,
  });
  const [interestIds, setInterestIds] = useState<string[]>(() => initialLead?.productInterests.map((p) => p.productType.id) ?? []);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [sources, setSources] = useState<NamedOption[]>([]);
  const [categories, setCategories] = useState<NamedOption[]>([]);
  const [seasons, setSeasons] = useState<NamedOption[]>([]);
  const [productTypes, setProductTypes] = useState<NamedOption[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const [liveDuplicates, setLiveDuplicates] = useState<Duplicate[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchList<UserOption>("/api/v1/users?pageSize=200").then(setUsers);
    fetchList<CampaignOption>("/api/v1/campaigns?pageSize=200").then(setCampaigns);
    fetchList<NamedOption>("/api/v1/crm/lead-sources?activeOnly=true").then(setSources);
    fetchList<NamedOption>("/api/v1/categories?pageSize=200").then(setCategories);
    fetchList<NamedOption>("/api/v1/seasons?pageSize=200").then(setSeasons);
    fetchList<NamedOption>("/api/v1/product-types?pageSize=200").then(setProductTypes);
    fetchList<CurrencyOption>("/api/v1/currencies").then(setCurrencies);
  }, []);

  const set = (key: keyof typeof f) => (value: string) => setF((prev) => ({ ...prev, [key]: value }));
  const input = (key: keyof typeof f, props: { type?: string; required?: boolean } = {}) => (
    <input
      id={key}
      type={props.type ?? "text"}
      required={props.required}
      value={f[key]}
      onChange={(e) => set(key)(e.target.value)}
      className={textInputClass()}
    />
  );

  const payload = () => ({
    ...f,
    leadScore: Number(f.leadScore || 0),
    value: Number(f.value || 0),
    ...flags,
    productInterestTypeIds: interestIds,
  });

  // Live duplicate check while typing — the same server-side matching the
  // save applies, so the warning appears before the user finishes the form.
  const dupKey = [f.email, f.phone, f.whatsappNumber, f.alternativePhone, f.companyName, f.country].map((v) => v.trim()).join("|");
  useEffect(() => {
    const [email, phone, whatsappNumber, alternativePhone, companyName, country] = dupKey.split("|");
    const hasKey = email || phone || whatsappNumber || alternativePhone || (companyName && country);
    const timer = setTimeout(() => {
      if (!hasKey) {
        setLiveDuplicates([]);
        return;
      }
      const qs = new URLSearchParams(
        Object.entries({ email, phone, whatsappNumber, alternativePhone, companyName, country, excludeId: initialLead?.id ?? "" }).filter(([, v]) => v)
      );
      fetch(`/api/v1/leads/duplicate-check?${qs.toString()}`)
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => setLiveDuplicates(body.data ?? []))
        .catch(() => setLiveDuplicates([]));
    }, 600);
    return () => clearTimeout(timer);
  }, [dupKey, initialLead?.id]);

  const shownDuplicates = duplicates && duplicates.length > 0 ? duplicates : liveDuplicates;

  const mergeInto = async (existingId: string) => {
    setIsSubmitting(true);
    setError(null);
    const res = await fetch(`/api/v1/leads/${existingId}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    }).catch(() => null);
    setIsSubmitting(false);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to merge into the existing lead.");
      return;
    }
    router.push(`/leads/${existingId}`);
    router.refresh();
  };

  const submit = async (overrideDuplicateCheck: boolean) => {
    setIsSubmitting(true);
    setError(null);

    const url = initialLead ? `/api/v1/leads/${initialLead.id}` : "/api/v1/leads";
    const res = await fetch(url, {
      method: initialLead ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(), overrideDuplicateCheck }),
    }).catch(() => null);

    setIsSubmitting(false);

    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      if (body?.error?.code === "DUPLICATE_LEAD_EXISTS") {
        setDuplicates(body.error.details?.duplicates ?? []);
        setError(body.error.message);
        return;
      }
      setError(body?.error?.message ?? "Failed to save this lead.");
      return;
    }

    const { data } = await res.json();
    router.push(`/leads/${data.id}`);
    router.refresh();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setDuplicates(null);
    submit(false);
  };

  const toggleInterest = (id: string) => setInterestIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      <Section title="General Information">
        <div className={GRID}>
          <FormField label="Lead / Company Name" htmlFor="companyName">
            {input("companyName")}
          </FormField>
          <FormField label="Contact Person" htmlFor="name" required>
            {input("name", { required: true })}
          </FormField>
          <FormField label="Designation" htmlFor="designation">
            {input("designation")}
          </FormField>
          <FormField label="Email" htmlFor="email">
            {input("email", { type: "email" })}
          </FormField>
          <FormField label="Mobile" htmlFor="phone">
            {input("phone", { type: "tel" })}
          </FormField>
          <FormField label="WhatsApp Number (with country code)" htmlFor="whatsappNumber">
            {input("whatsappNumber", { type: "tel" })}
          </FormField>
          <FormField label="Alternative Phone" htmlFor="alternativePhone">
            {input("alternativePhone", { type: "tel" })}
          </FormField>
          <FormField label="Website" htmlFor="website">
            {input("website")}
          </FormField>
        </div>
      </Section>

      <Section title="Business Information">
        <div className={GRID}>
          <FormField label="Business Type" htmlFor="businessType">
            <select id="businessType" value={f.businessType} onChange={(e) => set("businessType")(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Country" htmlFor="country">
            <SearchableSelect
              id="country"
              value={f.country}
              onChange={set("country")}
              options={COUNTRIES.map((c) => ({ id: c, label: c }))}
              placeholder="Search country…"
            />
          </FormField>
          <FormField label="State / Region" htmlFor="state">
            {input("state")}
          </FormField>
          <FormField label="City" htmlFor="city">
            {input("city")}
          </FormField>
        </div>
        <FormField label="Address" htmlFor="address">
          <textarea id="address" value={f.address} onChange={(e) => set("address")(e.target.value)} className={textInputClass()} rows={2} />
        </FormField>
      </Section>

      <Section title="Garment Business Information">
        <div className={GRID}>
          <FormField label="Interested Product Category" htmlFor="productCategoryId">
            <SearchableSelect
              id="productCategoryId"
              value={f.productCategoryId}
              onChange={set("productCategoryId")}
              options={categories.filter((c) => c.isActive !== false || c.id === f.productCategoryId).map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Search category…"
            />
          </FormField>
          <FormField label="Season" htmlFor="seasonId">
            <select id="seasonId" value={f.seasonId} onChange={(e) => set("seasonId")(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {seasons
                .filter((s) => s.isActive !== false || s.id === f.seasonId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </FormField>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Product Interest</p>
          {productTypes.length === 0 ? (
            <p className="text-xs text-zinc-500">No product types configured (Masters → Garment Attributes → Product Types).</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {productTypes
                .filter((p) => p.isActive !== false || interestIds.includes(p.id))
                .map((p) => {
                  const on = interestIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleInterest(p.id)}
                      aria-pressed={on}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        on
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        <div className={GRID}>
          <FormField label="Market" htmlFor="market">
            {input("market")}
          </FormField>
          <FormField label="Expected Quantity (pcs)" htmlFor="expectedQuantity">
            {input("expectedQuantity", { type: "number" })}
          </FormField>
          <FormField label="Target Price (per pc)" htmlFor="targetPrice">
            {input("targetPrice", { type: "number" })}
          </FormField>
          <FormField label="Currency" htmlFor="currencyCode">
            <select id="currencyCode" value={f.currencyCode} onChange={(e) => set("currencyCode")(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Expected Order Value" htmlFor="value">
            {input("value", { type: "number" })}
          </FormField>
          <FormField label="MOQ Requirement" htmlFor="moqRequirement">
            {input("moqRequirement")}
          </FormField>
          <FormField label="Required Delivery Date" htmlFor="requiredDeliveryDate">
            {input("requiredDeliveryDate", { type: "date" })}
          </FormField>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          {(
            [
              ["samplingRequired", "Sampling Required"],
              ["techPackAvailable", "Tech Pack Available"],
              ["referenceImageAvailable", "Reference Image Available"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={flags[key]} onChange={(e) => setFlags((prev) => ({ ...prev, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Sales Information">
        <div className={GRID}>
          <FormField label="Lead Source" htmlFor="sourceId">
            <select id="sourceId" value={f.sourceId} onChange={(e) => set("sourceId")(e.target.value)} className={textInputClass()}>
              <option value="">— Other / not specified —</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Campaign" htmlFor="campaignId">
            <SearchableSelect
              id="campaignId"
              value={f.campaignId}
              onChange={set("campaignId")}
              options={campaigns.map((c) => ({ id: c.id, label: c.name, sublabel: c.campaignNumber }))}
              placeholder="Search campaign…"
            />
          </FormField>
          <FormField label={initialLead ? "Assigned Salesperson" : "Assigned Salesperson (auto-assigned if blank)"} htmlFor="assignedToUserId">
            <SearchableSelect
              id="assignedToUserId"
              value={f.assignedToUserId}
              onChange={set("assignedToUserId")}
              options={users.map((u) => ({ id: u.id, label: u.fullName }))}
              placeholder="Search user…"
              emptyOptionLabel={initialLead ? "Unassigned" : "Auto Assign"}
            />
          </FormField>
          <FormField label="Priority" htmlFor="priority">
            <select id="priority" value={f.priority} onChange={(e) => set("priority")(e.target.value)} className={textInputClass()}>
              {Object.entries(LEAD_PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Lead Score (0-100)" htmlFor="leadScore">
            {input("leadScore", { type: "number" })}
          </FormField>
          <FormField label="Expected Close Date" htmlFor="expectedCloseDate">
            {input("expectedCloseDate", { type: "date" })}
          </FormField>
        </div>
        <FormField label="Notes" htmlFor="notes">
          <textarea id="notes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} className={textInputClass()} rows={3} />
        </FormField>
      </Section>

      {shownDuplicates.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-medium">
            Possible duplicate{shownDuplicates.length === 1 ? "" : "s"} — this buyer may already be in the CRM (matched on email, phone/WhatsApp, or company + country):
          </p>
          <ul className="mt-2 space-y-2">
            {shownDuplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <span className="font-medium">
                    {d.leadNumber} — {d.companyName ?? d.name}
                  </span>
                  <span className="text-xs"> · {[d.name, d.email, d.phone, d.country].filter(Boolean).join(" · ")}</span>
                </span>
                <a href={`/leads/${d.id}`} target="_blank" rel="noreferrer" className="text-xs font-medium underline">
                  Open Existing
                </a>
                {!initialLead && (
                  <button type="button" onClick={() => mergeInto(d.id)} disabled={isSubmitting} className="text-xs font-medium underline disabled:opacity-60">
                    Merge into this lead
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Merge fills only the blank fields on the existing lead, adds new product interests and notes, and records it on its timeline — nothing
            already there is overwritten.
          </p>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={isSubmitting}
            className="mt-3 rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 dark:text-amber-100 dark:hover:bg-amber-900/40"
          >
            {initialLead ? "Save Anyway" : "Create Anyway"}
          </button>
        </div>
      )}

      {error && !(duplicates && duplicates.length > 0) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : initialLead ? "Save Changes" : "Create Lead"}
      </button>
    </form>
  );
}

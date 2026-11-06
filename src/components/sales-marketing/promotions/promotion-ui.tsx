"use client";

import { Button } from "@/components/ui/Button";
import { FormField as BaseField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/SearchableSelect";
import { formatDate } from "@/lib/date-format";
import { DISCOUNT_TYPES, DISPLAY_LABELS, STACKING, VERSION_STATUSES, type PromotionDisplayStatus, type PromotionVersionStatus } from "@/modules/sales-marketing/promotions/promotion-registry";
import { Badge, inr } from "../pricing/pricing-ui";

export { Badge, CARD, inr } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";

/** Shared bits of the promotion screens (Phase 12). */

/** FormField with an optional help line under the input. */
export function FormField({ hint, children, ...rest }: { label: string; htmlFor: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <BaseField {...rest}>
      {children}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </BaseField>
  );
}

export function DisplayStatusBadge({ status }: { status: string }) {
  const s = DISPLAY_LABELS[status as PromotionDisplayStatus];
  return <Badge tone={s?.tone ?? "zinc"}>{s?.label ?? status}</Badge>;
}

export function VersionStatusBadge({ status }: { status: string }) {
  const s = VERSION_STATUSES[status as PromotionVersionStatus];
  return <Badge tone={(s?.tone as "zinc" | "amber" | "green" | "red") ?? "zinc"}>{s?.label ?? status}</Badge>;
}

export const discountText = (type: string, value: number) => (type === "PERCENT" ? `${value}% off` : `${inr(value)} off per unit`);

export interface PromotionOptions {
  styles: SearchableSelectOption[];
  categories: SearchableSelectOption[];
  customers: SearchableSelectOption[];
  priceLists: SearchableSelectOption[];
  salesChannels: SearchableSelectOption[];
  campaigns: SearchableSelectOption[];
  segmentSnapshots: SearchableSelectOption[];
  users: SearchableSelectOption[];
}

export interface TermsDraft {
  validFrom: string;
  validTo: string;
  discountType: "PERCENT" | "AMOUNT_PER_UNIT";
  value: string;
  stacking: "EXCLUSIVE" | "STACKABLE";
  priority: string;
  productIds: string[];
  categoryIds: string[];
  excludedProductIds: string[];
  customerIds: string[];
  priceListIds: string[];
  salesChannelIds: string[];
  campaignIds: string[];
  segmentEvaluationId: string;
  minQuantity: string;
  minLineValue: string;
  maxRedemptions: string;
  maxRedemptionsPerCustomer: string;
  changeNote: string;
}

export interface StoredTerms {
  validFrom: string;
  validTo: string | null;
  discountType: "PERCENT" | "AMOUNT_PER_UNIT";
  value: number;
  stacking: "EXCLUSIVE" | "STACKABLE";
  priority: number;
  productIds: string[];
  categoryIds: string[];
  excludedProductIds: string[];
  customerIds: string[];
  priceListIds: string[];
  salesChannelIds: string[];
  campaignIds: string[];
  segmentEvaluationId: string | null;
  minQuantity: number | null;
  minLineValue: number | null;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
  changeNote: string | null;
}

const s = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function emptyTerms(today: string): TermsDraft {
  return {
    validFrom: today,
    validTo: "",
    discountType: "PERCENT",
    value: "",
    stacking: "EXCLUSIVE",
    priority: "0",
    productIds: [],
    categoryIds: [],
    excludedProductIds: [],
    customerIds: [],
    priceListIds: [],
    salesChannelIds: [],
    campaignIds: [],
    segmentEvaluationId: "",
    minQuantity: "",
    minLineValue: "",
    maxRedemptions: "",
    maxRedemptionsPerCustomer: "",
    changeNote: "",
  };
}

export function toDraft(t: StoredTerms): TermsDraft {
  return {
    ...t,
    validTo: s(t.validTo),
    value: s(t.value),
    priority: s(t.priority),
    segmentEvaluationId: s(t.segmentEvaluationId),
    minQuantity: s(t.minQuantity),
    minLineValue: s(t.minLineValue),
    maxRedemptions: s(t.maxRedemptions),
    maxRedemptionsPerCustomer: s(t.maxRedemptionsPerCustomer),
    changeNote: "",
  };
}

export const termsPayload = (t: TermsDraft) => ({
  ...t,
  validTo: t.validTo || null,
  segmentEvaluationId: t.segmentEvaluationId || null,
  changeNote: t.changeNote || null,
});

/** Pick several records: a search box to add, chips to remove. */
export function ChipsPicker({ id, label, help, values, options, onChange }: { id: string; label: string; help?: string; values: string[]; options: SearchableSelectOption[]; onChange: (v: string[]) => void }) {
  const byId = new Map(options.map((o) => [o.id, o]));
  return (
    <FormField label={label} htmlFor={id} hint={help}>
      <SearchableSelect id={id} value="" onChange={(v) => v && !values.includes(v) && onChange([...values, v])} options={options.filter((o) => !values.includes(o.id))} placeholder="Search to add…" emptyOptionLabel={null} />
      {values.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
              {byId.get(v)?.label ?? "Unknown"}
              <button type="button" aria-label={`Remove ${byId.get(v)?.label ?? "item"}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-zinc-500 hover:text-red-600">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </FormField>
  );
}

/** The commercial terms of a version, as a form. Line-level conditions are checked per quotation line by the pricing engine. */
export function TermsEditor({ value, onChange, options, showChangeNote }: { value: TermsDraft; onChange: (t: TermsDraft) => void; options: PromotionOptions; showChangeNote?: boolean }) {
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  const input = textInputClass();
  return (
    <div className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Discount</legend>
        <FormField label="Type" htmlFor="t-type" required>
          <select id="t-type" value={value.discountType} onChange={(e) => set({ discountType: e.target.value as TermsDraft["discountType"] })} className={input}>
            {Object.entries(DISCOUNT_TYPES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={value.discountType === "PERCENT" ? "Percent off" : "₹ off per base unit"} htmlFor="t-value" required>
          <input id="t-value" type="number" required min={0.01} max={value.discountType === "PERCENT" ? 100 : undefined} step="0.01" value={value.value} onChange={(e) => set({ value: e.target.value })} className={input} />
        </FormField>
        <FormField label="Combining" htmlFor="t-stacking" required>
          <select id="t-stacking" value={value.stacking} onChange={(e) => set({ stacking: e.target.value as TermsDraft["stacking"] })} className={input}>
            {Object.entries(STACKING).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Priority" htmlFor="t-priority" hint="Breaks ties between equal exclusive discounts (higher first).">
          <input id="t-priority" type="number" min={-1000} max={1000} step={1} value={value.priority} onChange={(e) => set({ priority: e.target.value })} className={input} />
        </FormField>
        <FormField label="Valid from" htmlFor="t-from" required>
          <input id="t-from" type="date" required value={value.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className={input} />
        </FormField>
        <FormField label="Valid to" htmlFor="t-to" hint="Blank = no end date. Compared with the quotation date.">
          <input id="t-to" type="date" min={value.validFrom} value={value.validTo} onChange={(e) => set({ validTo: e.target.value })} className={input} />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Which lines (blank = every Style)</legend>
        <ChipsPicker id="t-products" label="Styles" values={value.productIds} options={options.styles} onChange={(productIds) => set({ productIds })} />
        <ChipsPicker id="t-categories" label="Categories" help="With Styles also set, a line must match both lists." values={value.categoryIds} options={options.categories} onChange={(categoryIds) => set({ categoryIds })} />
        <ChipsPicker id="t-excluded" label="Excluded Styles" values={value.excludedProductIds} options={options.styles} onChange={(excludedProductIds) => set({ excludedProductIds })} />
        <ChipsPicker id="t-pricelists" label="Price lists" help="Only lines priced from these lists." values={value.priceListIds} options={options.priceLists} onChange={(priceListIds) => set({ priceListIds })} />
        <FormField label="Minimum quantity (base units)" htmlFor="t-minqty">
          <input id="t-minqty" type="number" min={0.001} step="0.001" value={value.minQuantity} onChange={(e) => set({ minQuantity: e.target.value })} className={input} />
        </FormField>
        <FormField label="Minimum line value (₹, before discounts)" htmlFor="t-minval">
          <input id="t-minval" type="number" min={0.01} step="0.01" value={value.minLineValue} onChange={(e) => set({ minLineValue: e.target.value })} className={input} />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Which quotations (blank = any)</legend>
        <ChipsPicker id="t-channels" label="Sales channels" values={value.salesChannelIds} options={options.salesChannels} onChange={(salesChannelIds) => set({ salesChannelIds })} />
        <ChipsPicker id="t-campaigns" label="Campaigns" help="The quotation must be linked to one of these campaigns." values={value.campaignIds} options={options.campaigns} onChange={(campaignIds) => set({ campaignIds })} />
        <ChipsPicker id="t-customers" label="Customers" values={value.customerIds} options={options.customers} onChange={(customerIds) => set({ customerIds })} />
        <FormField label="Customer segment snapshot" htmlFor="t-segment" hint="The customers in this saved snapshot qualify. Refreshing the segment later doesn't change it — pick a newer snapshot in a new version.">
          <SearchableSelect id="t-segment" value={value.segmentEvaluationId} onChange={(segmentEvaluationId) => set({ segmentEvaluationId })} options={options.segmentSnapshots} placeholder="Search segments…" emptyOptionLabel="— Any customer —" />
        </FormField>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Limits</legend>
        <FormField label="Total uses" htmlFor="t-max" hint="One use = one issued quotation revision (reserved), kept when it becomes a Sales Order.">
          <input id="t-max" type="number" min={1} step={1} value={value.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} className={input} />
        </FormField>
        <FormField label="Uses per customer" htmlFor="t-maxcust">
          <input id="t-maxcust" type="number" min={1} step={1} value={value.maxRedemptionsPerCustomer} onChange={(e) => set({ maxRedemptionsPerCustomer: e.target.value })} className={input} />
        </FormField>
      </fieldset>

      {showChangeNote && (
        <FormField label="What changed in this version" htmlFor="t-note">
          <input id="t-note" maxLength={300} value={value.changeNote} onChange={(e) => set({ changeNote: e.target.value })} className={input} />
        </FormField>
      )}
    </div>
  );
}

/** Read-only terms. `labels` maps referenced ids to names. */
export function TermsView({ terms, labels }: { terms: StoredTerms; labels: Record<string, string> }) {
  const list = (ids: string[], empty: string) => (ids.length ? ids.map((i) => labels[i] ?? "Removed record").join(", ") : <span className="text-zinc-400">{empty}</span>);
  const rows: [string, React.ReactNode][] = [
    ["Discount", `${discountText(terms.discountType, terms.value)} · ${terms.stacking === "EXCLUSIVE" ? "exclusive" : "stackable"} · priority ${terms.priority}`],
    ["Valid", `${formatDate(terms.validFrom)} – ${terms.validTo ? formatDate(terms.validTo) : "no end date"}`],
    ["Styles", list(terms.productIds, "Any")],
    ["Categories", list(terms.categoryIds, "Any")],
    ["Excluded Styles", list(terms.excludedProductIds, "None")],
    ["Price lists", list(terms.priceListIds, "Any")],
    ["Minimum quantity", terms.minQuantity === null ? <span className="text-zinc-400">None</span> : terms.minQuantity.toLocaleString("en-IN")],
    ["Minimum line value", terms.minLineValue === null ? <span className="text-zinc-400">None</span> : inr(terms.minLineValue)],
    ["Sales channels", list(terms.salesChannelIds, "Any")],
    ["Campaigns", list(terms.campaignIds, "Any")],
    ["Customers", list(terms.customerIds, "Any")],
    ["Customer segment", terms.segmentEvaluationId ? (labels[terms.segmentEvaluationId] ?? "Removed snapshot") : <span className="text-zinc-400">Any customer</span>],
    ["Total uses", terms.maxRedemptions ?? <span className="text-zinc-400">No limit</span>],
    ["Uses per customer", terms.maxRedemptionsPerCustomer ?? <span className="text-zinc-400">No limit</span>],
  ];
  if (terms.changeNote) rows.push(["Change note", terms.changeNote]);
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[12rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-500">{k}</dt>
          <dd className="text-zinc-900 dark:text-zinc-100">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FormButtons({ busy, onCancel, submitLabel }: { busy: boolean; onCancel?: () => void; submitLabel: string }) {
  return (
    <div className="flex justify-end gap-2">
      {onCancel && (
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      )}
      <Button type="submit" isLoading={busy} loadingLabel="Saving…">
        {submitLabel}
      </Button>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { getApiErrorMessage } from "@/lib/api-client";
import { GST_STATE_CODES } from "@/lib/gst";
import { calculateQuotation } from "@/modules/sales-marketing/quotations/quotation-calc";
import { QUOTATION_LINE_TYPES, type QuotationLineType } from "@/modules/sales-marketing/quotations/quotation-registry";
import { CrmLinkFields } from "@/components/sales-marketing/enquiries/SalesEnquiryFields";
import { formatInr } from "./QuotationStatusBadge";
import { emptyLine } from "./draft-values";

// ── Types ────────────────────────────────────────────────────────

export interface QuotationLineDraft {
  key: string;
  kind: QuotationLineType;
  productId: string;
  sampleRequestId: string;
  buyerEnquiryLineId: string;
  description: string;
  colorSizeRemarks: string;
  customerReference: string;
  quantity: string;
  uomId: string;
  unitPrice: string;
  discountPercent: string;
  taxRateId: string;
  requestedDeliveryDate: string;
  notes: string;
  /** Phase 03: AUTO = use the price-list price when there is one; MANUAL = the typed price (an override if a list prices the line). */
  priceMode: "AUTO" | "MANUAL";
  priceOverrideReason: string;
}

/** What the pricing API returns for one line (subset used here). */
interface LinePricing {
  status: "PRICED" | "NO_PRICE" | "CONFLICT" | "INVALID";
  netUnitPrice: number | null;
  listUnitPrice: number | null;
  ruleDiscountAmount: number | null;
  message: string | null;
  explanation: string[];
  source: { priceListCode: string; versionNumber: number; level: string } | null;
  rules: { code: string }[];
}

export interface QuotationDraftValues {
  customerId: string;
  buyerId: string;
  prospectName: string;
  crmCompanyId: string;
  crmContactId: string;
  ownerUserId: string;
  title: string;
  quotationDate: string;
  validUntil: string;
  placeOfSupplyStateCode: string;
  billingAddress: string;
  shippingAddress: string;
  paymentTermsDays: string;
  deliveryTerms: string;
  introduction: string;
  customerNotes: string;
  internalNotes: string;
  termsAndConditions: string;
  freightAmount: string;
  freightTaxRateId: string;
  otherChargesLabel: string;
  otherChargesAmount: string;
  otherChargesTaxRateId: string;
  lines: QuotationLineDraft[];
}

export interface QuotationEditorProps {
  mode: "create" | "edit";
  quotationId?: string;
  quotationNumber?: string;
  version?: number;
  /** Set when the quotation is (or will be) linked to an enquiry: party is fixed to the enquiry's. */
  enquiry?: { id: string; enquiryNumber: string; partyLabel: string } | null;
  initial: QuotationDraftValues;
  canUseCrm: boolean;
}

interface EditorOptions {
  taxRates: { id: string; name: string; rate: number; taxType: string }[];
  units: { id: string; code: string; name: string }[];
  companyStateCode: string | null;
  owners: { id: string; fullName: string }[];
}

interface Option {
  id: string;
  name?: string;
  styleName?: string;
  styleCode?: string;
  requestNumber?: string;
  product?: { id: string; styleName: string } | null;
  customer?: { name: string } | null;
}

const STATE_OPTIONS = Object.entries(GST_STATE_CODES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, name]) => ({ code, name }));
const num = (v: string) => (v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const area = `${textInputClass()} min-h-[4.5rem]`;

function Card({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

// ── Editor ───────────────────────────────────────────────────────

export function QuotationEditor({ mode, quotationId, quotationNumber, version, enquiry, initial, canUseCrm }: QuotationEditorProps) {
  const router = useRouter();
  const [v, setV] = useState<QuotationDraftValues>(initial);
  const [isProspect, setIsProspect] = useState(!initial.customerId && Boolean(initial.prospectName));
  const [options, setOptions] = useState<EditorOptions | null>(null);
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [styles, setStyles] = useState<Option[]>([]);
  const [designs, setDesigns] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pricing, setPricing] = useState<Record<string, LinePricing>>({});
  const [openExplain, setOpenExplain] = useState<string | null>(null);
  const partyFixed = Boolean(enquiry);

  const set = (patch: Partial<QuotationDraftValues>) => setV((prev) => ({ ...prev, ...patch }));
  const setLine = (key: string, patch: Partial<QuotationLineDraft>) =>
    setV((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  // GST rates depend on the quotation date (rates are effective-dated).
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.quotationDate)) return;
    fetch(`/api/v1/sales-marketing/quotations/options?date=${v.quotationDate}`, { headers: { "x-toast": "off" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setOptions(body.data));
  }, [v.quotationDate]);

  useEffect(() => {
    const opts = { headers: { "x-toast": "off" } };
    const load = (url: string, setter: (rows: Option[]) => void) =>
      fetch(url, opts)
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then((body) => setter(body.data ?? []));
    if (!partyFixed) load("/api/v1/customers?pageSize=200", setCustomers);
    load("/api/v1/products?pageSize=200", setStyles);
    load("/api/v1/sampling?status=APPROVED&pageSize=200", setDesigns);
  }, [partyFixed]);

  useEffect(() => {
    if (partyFixed || !v.customerId) return;
    fetch(`/api/v1/customers/${v.customerId}`, { headers: { "x-toast": "off" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setBuyers(body?.data?.buyers ?? []));
  }, [v.customerId, partyFixed]);

  // Phase 03: price every Style / design line with the shared pricing engine
  // (quotation date + customer). AUTO lines take the price-list price; the
  // server prices again on save, so this is only the preview.
  const pricedProductId = (l: QuotationLineDraft) => (l.kind === "STYLE" ? l.productId : l.kind === "DESIGN" ? (designs.find((d) => d.id === l.sampleRequestId)?.product?.id ?? "") : "");
  const pricingRequest = useMemo(() => {
    const lines = v.lines
      .map((l) => ({ key: l.key, productId: pricedProductId(l), quantity: num(l.quantity), uomId: l.uomId }))
      .filter((l) => l.productId && l.quantity > 0);
    if (!lines.length || !/^\d{4}-\d{2}-\d{2}$/.test(v.quotationDate)) return null;
    return { date: v.quotationDate, customerId: isProspect ? null : v.customerId || null, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lines, v.quotationDate, v.customerId, isProspect, designs]);
  const pricingKey = pricingRequest ? JSON.stringify(pricingRequest) : "";
  useEffect(() => {
    if (!pricingRequest) return;
    const req = pricingRequest;
    const timer = setTimeout(() => {
      fetch("/api/v1/sales-marketing/pricing/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toast": "off" },
        body: JSON.stringify({ date: req.date, customerId: req.customerId, lines: req.lines.map(({ productId, quantity, uomId }) => ({ productId, quantity, uomId })) }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (!body?.data) return;
          const byKey: Record<string, LinePricing> = Object.fromEntries(req.lines.map((l, i) => [l.key, body.data[i]]));
          setPricing(byKey);
          setV((prev) => ({
            ...prev,
            lines: prev.lines.map((l) => {
              const r = byKey[l.key];
              return r && l.priceMode === "AUTO" && r.status === "PRICED" && r.netUnitPrice !== null && num(l.unitPrice) !== r.netUnitPrice ? { ...l, unitPrice: String(r.netUnitPrice) } : l;
            }),
          }));
        })
        .catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingKey]);
  const priced = (l: QuotationLineDraft) => {
    const r = pricing[l.key];
    return r && r.status === "PRICED" && r.netUnitPrice !== null && pricedProductId(l) ? r : null;
  };

  const rateById = useMemo(() => new Map((options?.taxRates ?? []).map((t) => [t.id, t.rate])), [options]);
  const preview = useMemo(
    () =>
      calculateQuotation({
        lines: v.lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice), discountPercent: num(l.discountPercent), gstRate: rateById.get(l.taxRateId) ?? 0 })),
        freightAmount: num(v.freightAmount),
        freightGstRate: rateById.get(v.freightTaxRateId) ?? 0,
        otherChargesAmount: num(v.otherChargesAmount),
        otherChargesGstRate: rateById.get(v.otherChargesTaxRateId) ?? 0,
        companyStateCode: options?.companyStateCode ?? null,
        placeOfSupplyStateCode: v.placeOfSupplyStateCode || null,
      }),
    [v, rateById, options]
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const body = {
      ...(mode === "create" && enquiry ? { buyerEnquiryId: enquiry.id } : {}),
      customerId: isProspect ? "" : v.customerId,
      buyerId: isProspect ? "" : v.buyerId,
      prospectName: isProspect ? v.prospectName : "",
      crmCompanyId: v.crmCompanyId,
      crmContactId: v.crmContactId,
      ownerUserId: v.ownerUserId,
      title: v.title,
      quotationDate: v.quotationDate,
      validUntil: v.validUntil,
      placeOfSupplyStateCode: v.placeOfSupplyStateCode,
      billingAddress: v.billingAddress,
      shippingAddress: v.shippingAddress,
      paymentTermsDays: v.paymentTermsDays,
      deliveryTerms: v.deliveryTerms,
      introduction: v.introduction,
      customerNotes: v.customerNotes,
      internalNotes: v.internalNotes,
      termsAndConditions: v.termsAndConditions,
      freightAmount: num(v.freightAmount),
      freightTaxRateId: v.freightTaxRateId,
      otherChargesLabel: v.otherChargesLabel,
      otherChargesAmount: num(v.otherChargesAmount),
      otherChargesTaxRateId: v.otherChargesTaxRateId,
      lines: v.lines.map((l) => ({
        productId: l.kind === "STYLE" ? l.productId : "",
        sampleRequestId: l.kind === "DESIGN" ? l.sampleRequestId : "",
        buyerEnquiryLineId: l.buyerEnquiryLineId,
        description: l.description,
        colorSizeRemarks: l.colorSizeRemarks,
        customerReference: l.customerReference,
        quantity: l.quantity,
        uomId: l.uomId,
        unitPrice: l.unitPrice === "" ? 0 : l.unitPrice,
        discountPercent: l.discountPercent === "" ? 0 : l.discountPercent,
        taxRateId: l.taxRateId,
        requestedDeliveryDate: l.requestedDeliveryDate,
        notes: l.notes,
        priceMode: l.priceMode === "AUTO" && priced(l) ? "AUTO" : "MANUAL",
        priceOverrideReason: l.priceMode === "MANUAL" && priced(l) ? l.priceOverrideReason : "",
      })),
      ...(mode === "edit" ? { version } : {}),
    };
    const res = await fetch(mode === "create" ? "/api/v1/sales-marketing/quotations" : `/api/v1/sales-marketing/quotations/${quotationId}`, {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "Content-Type": "application/json", "x-toast": "off" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError(await getApiErrorMessage(res, "Couldn't save the quotation."));
      return;
    }
    const { data } = await res.json();
    router.push(data?.visible === false ? "/sales-marketing/quotations" : `/sales-marketing/quotations/${data.id}`);
    router.refresh();
  };

  const rates = options?.taxRates ?? [];

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card title="Customer">
        {partyFixed ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {enquiry!.partyLabel} — from enquiry{" "}
            <Link href={`/sales-marketing/enquiries/${enquiry!.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {enquiry!.enquiryNumber}
            </Link>
            . The customer and CRM links come from the enquiry.
          </p>
        ) : (
          <>
            <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={isProspect}
                onChange={(e) => {
                  setIsProspect(e.target.checked);
                  set({ customerId: "", buyerId: "" });
                }}
              />
              Quote a prospect (not yet a Customer — a Customer is needed later to convert to a Sales Order)
            </label>
            {isProspect ? (
              <FormField label="Prospect name" htmlFor="prospectName" required>
                <input id="prospectName" required maxLength={200} value={v.prospectName} onChange={(e) => set({ prospectName: e.target.value })} className={textInputClass()} />
              </FormField>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Customer" htmlFor="customerId" required>
                  <SearchableSelect
                    id="customerId"
                    required
                    value={v.customerId}
                    onChange={(customerId) => {
                      setBuyers([]);
                      set({ customerId, buyerId: "" });
                    }}
                    options={customers.map((c) => ({ id: c.id, label: c.name ?? "" }))}
                    placeholder="Search customer…"
                  />
                </FormField>
                <FormField label="Buyer" htmlFor="buyerId">
                  <SearchableSelect
                    id="buyerId"
                    value={v.buyerId}
                    onChange={(buyerId) => set({ buyerId })}
                    disabled={!v.customerId}
                    options={buyers.map((b) => ({ id: b.id, label: b.name ?? "" }))}
                    placeholder="Search buyer…"
                  />
                </FormField>
              </div>
            )}
            {canUseCrm && (
              <CrmLinkFields crmCompanyId={v.crmCompanyId} crmContactId={v.crmContactId} onChange={(crm) => set(crm)} />
            )}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Billing address" htmlFor="billingAddress">
            <textarea id="billingAddress" maxLength={1000} value={v.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} className={area} />
          </FormField>
          <FormField label="Shipping address" htmlFor="shippingAddress">
            <textarea id="shippingAddress" maxLength={1000} value={v.shippingAddress} onChange={(e) => set({ shippingAddress: e.target.value })} className={area} />
          </FormField>
        </div>
      </Card>

      <Card title="Quotation">
        <FormField label="Title" htmlFor="title" required>
          <input id="title" required maxLength={200} value={v.title} onChange={(e) => set({ title: e.target.value })} className={textInputClass()} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-4">
          <FormField label="Quotation date" htmlFor="quotationDate" required>
            <input id="quotationDate" type="date" required value={v.quotationDate} onChange={(e) => set({ quotationDate: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Valid until" htmlFor="validUntil" required>
            <input id="validUntil" type="date" required min={v.quotationDate} value={v.validUntil} onChange={(e) => set({ validUntil: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Owner" htmlFor="ownerUserId">
            <select id="ownerUserId" value={v.ownerUserId} onChange={(e) => set({ ownerUserId: e.target.value })} className={textInputClass()}>
              <option value="">— Me —</option>
              {(options?.owners ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.fullName}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Place of supply (GST state)" htmlFor="placeOfSupplyStateCode">
            <select id="placeOfSupplyStateCode" value={v.placeOfSupplyStateCode} onChange={(e) => set({ placeOfSupplyStateCode: e.target.value })} className={textInputClass()}>
              <option value="">— Same as company —</option>
              {STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {options && !options.companyStateCode && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            The company GSTIN is missing or not valid, so GST is shown as CGST + SGST for every place of supply. Set it in company settings for IGST on
            inter-state quotes.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Payment terms (days)" htmlFor="paymentTermsDays">
            <input id="paymentTermsDays" type="number" min={0} max={365} value={v.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: e.target.value })} className={textInputClass()} />
          </FormField>
          <FormField label="Delivery terms" htmlFor="deliveryTerms">
            <input id="deliveryTerms" maxLength={1000} value={v.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} placeholder="e.g. FOB Chennai, 60 days from PO" className={textInputClass()} />
          </FormField>
        </div>
        <FormField label="Introduction (shown to the customer)" htmlFor="introduction">
          <textarea id="introduction" maxLength={4000} value={v.introduction} onChange={(e) => set({ introduction: e.target.value })} className={area} />
        </FormField>
      </Card>

      <Card
        title={`Lines (${v.lines.length})`}
        actions={
          <Button type="button" size="xs" variant="secondary" onClick={() => set({ lines: [...v.lines, emptyLine()] })}>
            + Add line
          </Button>
        }
      >
        {v.lines.map((line, index) => {
          const calc = preview.lines[index];
          return (
            <div key={line.key} className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
                  <select
                    aria-label={`Line ${index + 1} type`}
                    value={line.kind}
                    onChange={(e) => setLine(line.key, { kind: e.target.value as QuotationLineType, productId: "", sampleRequestId: "" })}
                    className={`${textInputClass()} !w-auto py-1 text-xs`}
                  >
                    {(Object.keys(QUOTATION_LINE_TYPES) as QuotationLineType[]).map((k) => (
                      <option key={k} value={k}>
                        {QUOTATION_LINE_TYPES[k].label}
                      </option>
                    ))}
                  </select>
                  {line.buyerEnquiryLineId && <span className="text-xs text-zinc-500">from the enquiry</span>}
                </div>
                {v.lines.length > 1 && (
                  <button type="button" onClick={() => set({ lines: v.lines.filter((l) => l.key !== line.key) })} className="text-xs font-medium text-red-600 hover:text-red-500">
                    Remove
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {line.kind === "STYLE" && (
                  <FormField label="Style" htmlFor={`style-${line.key}`} required>
                    <SearchableSelect
                      id={`style-${line.key}`}
                      required
                      value={line.productId}
                      onChange={(productId) => {
                        const s = styles.find((x) => x.id === productId);
                        setLine(line.key, { productId, description: line.description || (s ? `${s.styleName}${s.styleCode ? ` (${s.styleCode})` : ""}` : "") });
                      }}
                      options={styles.map((s) => ({ id: s.id, label: s.styleName ?? "", sublabel: s.styleCode }))}
                      placeholder="Search style…"
                    />
                  </FormField>
                )}
                {line.kind === "DESIGN" && (
                  <FormField label="Approved design" htmlFor={`design-${line.key}`} required>
                    <SearchableSelect
                      id={`design-${line.key}`}
                      required
                      value={line.sampleRequestId}
                      onChange={(sampleRequestId) => {
                        const d = designs.find((x) => x.id === sampleRequestId);
                        setLine(line.key, { sampleRequestId, description: line.description || (d ? (d.styleName ?? d.product?.styleName ?? d.requestNumber ?? "") : "") });
                      }}
                      options={designs.map((d) => ({ id: d.id, label: d.styleName ?? d.product?.styleName ?? d.requestNumber ?? "", sublabel: `${d.requestNumber}${d.customer ? ` · ${d.customer.name}` : ""}` }))}
                      placeholder="Search approved samples…"
                    />
                  </FormField>
                )}
                <div className={line.kind === "FREE_TEXT" ? "sm:col-span-2" : ""}>
                  <FormField label="Description" htmlFor={`desc-${line.key}`} required>
                    <input id={`desc-${line.key}`} required maxLength={1000} value={line.description} onChange={(e) => setLine(line.key, { description: e.target.value })} className={textInputClass()} />
                  </FormField>
                </div>
              </div>
              {line.kind === "FREE_TEXT" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">A new item has to be linked to a real Style before the quotation can become a Sales Order.</p>
              )}

              <div className="grid gap-3 sm:grid-cols-6">
                <FormField label="Qty" htmlFor={`qty-${line.key}`} required>
                  <input id={`qty-${line.key}`} type="number" required min={0.001} step="0.001" value={line.quantity} onChange={(e) => setLine(line.key, { quantity: e.target.value })} className={textInputClass()} />
                </FormField>
                <FormField label="Unit" htmlFor={`uom-${line.key}`}>
                  <select id={`uom-${line.key}`} value={line.uomId} onChange={(e) => setLine(line.key, { uomId: e.target.value })} className={textInputClass()}>
                    <option value="">—</option>
                    {(options?.units ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Unit price (₹)" htmlFor={`price-${line.key}`} required>
                  <input
                    id={`price-${line.key}`}
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    readOnly={line.priceMode === "AUTO" && Boolean(priced(line))}
                    value={line.unitPrice}
                    onChange={(e) => setLine(line.key, { unitPrice: e.target.value })}
                    className={`${textInputClass()}${line.priceMode === "AUTO" && priced(line) ? " bg-zinc-50 dark:bg-zinc-800" : ""}`}
                  />
                </FormField>
                <FormField label="Discount %" htmlFor={`disc-${line.key}`}>
                  <input id={`disc-${line.key}`} type="number" min={0} max={100} step="0.01" value={line.discountPercent} onChange={(e) => setLine(line.key, { discountPercent: e.target.value })} className={textInputClass()} />
                </FormField>
                <FormField label="GST" htmlFor={`gst-${line.key}`}>
                  <RateSelect rates={rates} id={`gst-${line.key}`} value={line.taxRateId} onChange={(taxRateId) => setLine(line.key, { taxRateId })} />
                </FormField>
                <FormField label="Delivery" htmlFor={`delivery-${line.key}`}>
                  <input id={`delivery-${line.key}`} type="date" value={line.requestedDeliveryDate} onChange={(e) => setLine(line.key, { requestedDeliveryDate: e.target.value })} className={textInputClass()} />
                </FormField>
              </div>
              <PriceInfo
                line={line}
                result={pricedProductId(line) ? pricing[line.key] : undefined}
                open={openExplain === line.key}
                onToggle={() => setOpenExplain(openExplain === line.key ? null : line.key)}
                onManual={() => setLine(line.key, { priceMode: "MANUAL" })}
                onAuto={() => {
                  const r = priced(line);
                  setLine(line.key, { priceMode: "AUTO", priceOverrideReason: "", ...(r ? { unitPrice: String(r.netUnitPrice) } : {}) });
                }}
                onReason={(priceOverrideReason) => setLine(line.key, { priceOverrideReason })}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Colour / size" htmlFor={`cs-${line.key}`}>
                  <input id={`cs-${line.key}`} maxLength={300} value={line.colorSizeRemarks} onChange={(e) => setLine(line.key, { colorSizeRemarks: e.target.value })} placeholder="e.g. Navy, Ecru · S–XL" className={textInputClass()} />
                </FormField>
                <FormField label="Customer reference" htmlFor={`ref-${line.key}`}>
                  <input id={`ref-${line.key}`} maxLength={200} value={line.customerReference} onChange={(e) => setLine(line.key, { customerReference: e.target.value })} className={textInputClass()} />
                </FormField>
                <div className="self-end pb-2 text-right text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                  {calc && (
                    <>
                      <span className="text-xs text-zinc-500">Taxable {formatInr(calc.taxableAmount)} + GST {formatInr(calc.taxAmount)} = </span>
                      <strong>{formatInr(calc.lineAmount)}</strong>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Charges">
            <div className="grid gap-3 sm:grid-cols-4">
              <FormField label="Freight (₹)" htmlFor="freightAmount">
                <input id="freightAmount" type="number" min={0} step="0.01" value={v.freightAmount} onChange={(e) => set({ freightAmount: e.target.value })} className={textInputClass()} />
              </FormField>
              <FormField label="Freight GST" htmlFor="freightTaxRateId">
                <RateSelect rates={rates} id="freightTaxRateId" value={v.freightTaxRateId} onChange={(freightTaxRateId) => set({ freightTaxRateId })} />
              </FormField>
              <FormField label="Other charges label" htmlFor="otherChargesLabel">
                <input id="otherChargesLabel" maxLength={100} value={v.otherChargesLabel} onChange={(e) => set({ otherChargesLabel: e.target.value })} placeholder="e.g. Packing" className={textInputClass()} />
              </FormField>
              <FormField label="Other charges (₹)" htmlFor="otherChargesAmount">
                <input id="otherChargesAmount" type="number" min={0} step="0.01" value={v.otherChargesAmount} onChange={(e) => set({ otherChargesAmount: e.target.value })} className={textInputClass()} />
              </FormField>
              <FormField label="Other charges GST" htmlFor="otherChargesTaxRateId">
                <RateSelect rates={rates} id="otherChargesTaxRateId" value={v.otherChargesTaxRateId} onChange={(otherChargesTaxRateId) => set({ otherChargesTaxRateId })} />
              </FormField>
            </div>
          </Card>
          <Card title="Notes & terms">
            <FormField label="Notes for the customer" htmlFor="customerNotes">
              <textarea id="customerNotes" maxLength={4000} value={v.customerNotes} onChange={(e) => set({ customerNotes: e.target.value })} className={area} />
            </FormField>
            <FormField label="Terms & conditions" htmlFor="termsAndConditions">
              <textarea id="termsAndConditions" maxLength={10000} value={v.termsAndConditions} onChange={(e) => set({ termsAndConditions: e.target.value })} className={area} />
            </FormField>
            <FormField label="Internal notes (never shown to the customer)" htmlFor="internalNotes">
              <textarea id="internalNotes" maxLength={4000} value={v.internalNotes} onChange={(e) => set({ internalNotes: e.target.value })} className={area} />
            </FormField>
          </Card>
        </div>
        <TotalsCard preview={preview} otherLabel={v.otherChargesLabel} note="Preview — the server recalculates every amount when you save." />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" isLoading={saving} loadingLabel="Saving…">
          {mode === "create" ? "Create draft quotation" : "Save draft"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(quotationId ? `/sales-marketing/quotations/${quotationId}` : enquiry ? `/sales-marketing/enquiries/${enquiry.id}` : "/sales-marketing/quotations")}>
          Cancel
        </Button>
        {quotationNumber && <span className="self-center text-xs text-zinc-500">{quotationNumber}</span>}
      </div>
    </form>
  );
}

/** Where the line's price comes from, with the engine's explanation and the override controls. */
function PriceInfo({
  line,
  result,
  open,
  onToggle,
  onManual,
  onAuto,
  onReason,
}: {
  line: QuotationLineDraft;
  result: LinePricing | undefined;
  open: boolean;
  onToggle: () => void;
  onManual: () => void;
  onAuto: () => void;
  onReason: (v: string) => void;
}) {
  if (line.kind === "FREE_TEXT") return null;
  if (!result) return <p className="text-xs text-zinc-500">Price list: pick a Style and a quantity to look up the price.</p>;
  if (result.status !== "PRICED" || result.netUnitPrice === null) {
    return <p className="text-xs text-zinc-500">No price-list price — enter the price by hand. {result.message}</p>;
  }
  const list = `${result.source?.priceListCode} v${result.source?.versionNumber}`;
  const differs = num(line.unitPrice) !== result.netUnitPrice;
  return (
    <div className="space-y-2 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Price list {list}: list {formatInr(result.listUnitPrice ?? 0)}
          {result.ruleDiscountAmount ? ` · rules −${formatInr(result.ruleDiscountAmount)} (${result.rules.map((r) => r.code).join(", ")})` : ""} → <strong>{formatInr(result.netUnitPrice)}</strong>
        </span>
        <button type="button" onClick={onToggle} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {open ? "Hide how" : "How?"}
        </button>
        {line.priceMode === "AUTO" ? (
          <button type="button" onClick={onManual} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Change price
          </button>
        ) : (
          <button type="button" onClick={onAuto} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Use list price
          </button>
        )}
      </div>
      {open && (
        <ul className="list-disc space-y-0.5 pl-4">
          {result.explanation.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {line.priceMode === "MANUAL" && differs && (
        <div className="space-y-1">
          <FormField label="Why a different price? (required)" htmlFor={`override-${line.key}`} required>
            <input id={`override-${line.key}`} required minLength={3} maxLength={500} value={line.priceOverrideReason} onChange={(e) => onReason(e.target.value)} className={textInputClass()} />
          </FormField>
          {num(line.unitPrice) < result.netUnitPrice && <p className="text-amber-700 dark:text-amber-400">Below the price-list price — the quotation will need approval.</p>}
        </div>
      )}
    </div>
  );
}

function RateSelect({ id, value, onChange, rates }: { id: string; value: string; onChange: (v: string) => void; rates: EditorOptions["taxRates"] }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={textInputClass()}>
      <option value="">No GST</option>
      {rates.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name} ({r.rate}%)
        </option>
      ))}
      {value && rates.length > 0 && !rates.some((r) => r.id === value) && <option value={value}>Rate not active on this date</option>}
    </select>
  );
}

// ── Totals (shared with the detail page) ─────────────────────────

export interface TotalsView {
  isInterState: boolean;
  subtotalAmount: number | string;
  discountTotal: number | string;
  taxableTotal: number | string;
  chargesTotal: number | string;
  cgstTotal: number | string;
  sgstTotal: number | string;
  igstTotal: number | string;
  taxTotal: number | string;
  grandTotal: number | string;
}

export function TotalsCard({ preview, otherLabel, note }: { preview: TotalsView; otherLabel?: string; note?: string }) {
  const row = (label: string, value: number | string, strong = false, minus = false) => (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-zinc-200 pt-2 text-base font-semibold dark:border-zinc-700" : ""}`}>
      <span className={strong ? "" : "text-zinc-600 dark:text-zinc-400"}>{label}</span>
      <span className="tabular-nums">
        {minus ? "− " : ""}
        {formatInr(value)}
      </span>
    </div>
  );
  return (
    <section className="h-fit space-y-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Totals</h2>
      {row("Gross", preview.subtotalAmount)}
      {Number(preview.discountTotal) > 0 && row("Discount", preview.discountTotal, false, true)}
      {row("Taxable value", preview.taxableTotal)}
      {Number(preview.chargesTotal) > 0 && row(`Freight${otherLabel ? ` & ${otherLabel}` : " & charges"}`, preview.chargesTotal)}
      {preview.isInterState ? (
        row("IGST", preview.igstTotal)
      ) : (
        <>
          {row("CGST", preview.cgstTotal)}
          {row("SGST", preview.sgstTotal)}
        </>
      )}
      {row("Grand total", preview.grandTotal, true)}
      {note && <p className="pt-1 text-xs text-zinc-500">{note}</p>}
    </section>
  );
}

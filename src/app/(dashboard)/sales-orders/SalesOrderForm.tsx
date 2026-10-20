"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatCurrency } from "@/lib/currency";
import { todayIsoDate } from "@/lib/date";
import { formatDate } from "@/lib/date-format";
import { dedupePriceOptions, type SalesPriceHistoryEntry } from "@/lib/price-history";

interface Option {
  id: string;
  name?: string;
  styleName?: string;
}

interface StyleOption extends Option {
  designNumber?: string | null;
}

interface SampleOption {
  id: string;
  requestNumber: string;
  // The sample's own identifying name (Sampling's "styleName" field — same
  // one shown as the header on the Sample Request's own detail page, e.g.
  // "SAM-2026-00018 — V-Neck T-Shirt"), so this dropdown reads as a name a
  // merchandiser actually recognizes instead of a bare document number.
  styleName: string | null;
  product: { id: string; styleName: string } | null;
  // The customer the design was originally developed/approved for — shown in
  // the picker so it's obvious when a design from another customer is used.
  customer?: { id: string; name: string } | null;
  // Current version's own costing only — see sample.repository.ts's
  // findMany include. Null until the sample has been costed at all.
  versions: { estimatedCostPerUnit: string | null }[];
  // The planned color+size the sample itself was made in (2026-09-15) —
  // used to default (not force) this line's variant grid to the same
  // combo, so ordering "against this sample" starts from the exact color/
  // size it was proven in, while still allowing other colors/sizes to be
  // added or changed freely.
  color: { id: string; name: string } | null;
  size: { id: string; name: string } | null;
}

/** styleName is nullable at the DB level (pre-existing rows) — falls back to
 * the linked Style's own current name, which every sample reachable in this
 * dropdown always has (it's filtered to `product.id === the selected Style`
 * already). requestNumber is the very thing this dropdown used to show
 * alone — kept in brackets so it's still visible for traceability. */
function sampleDisplayLabel(s: SampleOption): string {
  const name = s.styleName ?? s.product?.styleName;
  return name ? `${name} (${s.requestNumber})` : s.requestNumber;
}

function sampleSublabel(s: SampleOption, orderCustomerId: string): string | undefined {
  if (!s.customer) return undefined;
  return s.customer.id === orderCustomerId ? `Customer: ${s.customer.name}` : `Originally for: ${s.customer.name}`;
}

interface VariantOption {
  id: string;
  skuCode: string;
  color: { id: string; name: string };
  size: { id: string; name: string; sortOrder?: number };
}

interface LineItem {
  productId: string;
  sampleRequestId: string;
  unitPrice: string;
  notes: string;
  variants: VariantOption[];
  quantities: Record<string, string>;
  // Effective BOM (2026-09-24) — the stable SalesOrderLine this item
  // reuses on save, so its own frozen BOM/Sample snapshot and any active
  // Sales-Order-specific BOM overrides survive an ordinary edit untouched.
  // Absent for a genuinely new line (a fresh emptyLine(), or an existing
  // line whose Style/Sample was changed — see buildReconciledItemPlan's own
  // reuse-vs-new rule server-side).
  salesOrderLineId?: string;
}

const TODAY = todayIsoDate();

function emptyLine(): LineItem {
  return { productId: "", sampleRequestId: "", unitPrice: "", notes: "", variants: [], quantities: {} };
}

export interface InitialOrderItem {
  productId: string;
  sampleRequestId: string | null;
  unitPrice: string;
  notes: string | null;
  breakdown: Array<{ productVariantId: string; orderedQuantity: number }>;
  salesOrderLineId: string | null;
}

export interface InitialOrder {
  id: string;
  status: string;
  customerId: string;
  buyerId: string | null;
  orderDate: string;
  requiredShipDate: string | null;
  customerPoNumber?: string | null;
  items: InitialOrderItem[];
}

export function SalesOrderForm({
  initialOrder,
  presetCustomerId,
  originatingOpportunityId,
  originatingOpportunityNumber,
}: {
  initialOrder?: InitialOrder;
  presetCustomerId?: string;
  originatingOpportunityId?: string;
  originatingOpportunityNumber?: string;
} = {}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(initialOrder?.customerId ?? presetCustomerId ?? "");
  const [buyerId, setBuyerId] = useState(initialOrder?.buyerId ?? "");
  const [orderDate, setOrderDate] = useState(initialOrder ? initialOrder.orderDate.slice(0, 10) : TODAY);
  const [requiredShipDate, setRequiredShipDate] = useState(initialOrder?.requiredShipDate?.slice(0, 10) ?? "");
  const [customerPoNumber, setCustomerPoNumber] = useState(initialOrder?.customerPoNumber ?? "");
  const [customers, setCustomers] = useState<Option[]>([]);
  const [buyers, setBuyers] = useState<Option[]>([]);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [sizes, setSizes] = useState<Option[]>([]);
  const [approvedSamples, setApprovedSamples] = useState<SampleOption[]>([]);
  // Which variant id to visually default-highlight per line, once a linked
  // sample's own planned color+size resolves to a real ProductVariant (see
  // applySampleVariantDefault below) — a display cue only, never a forced
  // selection; every other cell in the grid stays fully editable as normal.
  const [highlightVariantId, setHighlightVariantId] = useState<Record<number, string>>({});
  // Keyed by line index — the same customer's own most recent price for
  // that line's Style, if any. See the dedicated effect below.
  const [lastOrderPrices, setLastOrderPrices] = useState<
    Record<number, { unitPrice: string; orderNumber: string; orderDate: string } | null>
  >({});
  // Keyed by line index — every real price this exact customer was charged
  // for this exact style in the last year, for the Unit Price field's own
  // datalist suggestions (same free-type-or-pick pattern already built for
  // Purchase Order's own Unit Price fields, just sourced from what we
  // charged rather than what we paid).
  const [priceHistoryByLine, setPriceHistoryByLine] = useState<Record<number, SalesPriceHistoryEntry[]>>({});
  const [items, setItems] = useState<LineItem[]>(
    initialOrder
      ? initialOrder.items.map((item) => ({
          productId: item.productId,
          sampleRequestId: item.sampleRequestId ?? "",
          unitPrice: item.unitPrice,
          notes: item.notes ?? "",
          variants: [],
          quantities: Object.fromEntries(item.breakdown.map((b) => [b.productVariantId, String(b.orderedQuantity)])),
          salesOrderLineId: item.salesOrderLineId ?? undefined,
        }))
      : [emptyLine()]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Editing a CONFIRMED order re-runs the sample-approval gate server-side —
  // only relevant when editing (creation has its own confirm-time gate on
  // the detail page instead).
  const [needsOverride, setNeedsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    fetch("/api/v1/customers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data ?? []));
    fetch("/api/v1/products?pageSize=200")
      .then((res) => res.json())
      .then((body) => setStyles(body.data ?? []));
    fetch("/api/v1/colors")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/sizes")
      .then((res) => res.json())
      .then((body) => setSizes(body.data ?? []));
  }, []);

  // Buyers stay scoped to the selected customer — resetting them on customer
  // change happens in the <select>'s onChange handler itself, not here, to
  // avoid a synchronous setState in the effect body (same pattern as
  // SampleRequestForm.tsx).
  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/v1/customers/${customerId}`)
      .then((res) => res.json())
      .then((body) => setBuyers(body.data?.buyers ?? []));
  }, [customerId]);

  // Customer and Design selection are independent: ANY customer can order
  // ANY approved design (one developed for another customer is referenced
  // as-is, never duplicated). The pool is company-wide and only narrowed to
  // the line's own Style at render time (see the design picker below).
  useEffect(() => {
    fetch("/api/v1/sampling?status=APPROVED&pageSize=200")
      .then((res) => res.json())
      .then((body) => setApprovedSamples(body.data ?? []));
  }, []);

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const onStyleChange = (index: number, productId: string) => {
    // A different Style means the previously-linked Sample and its cost, the
    // manually/auto-filled Unit Price, and any cached price hints all belong
    // to the OLD style — carrying them forward silently made the Style
    // change look like it did nothing (the Sample field visually clears
    // since it's no longer in the new style's filtered option list, but the
    // stale sampleRequestId stayed in state and kept resolving to the old
    // sample's cost/unit text; the stale Unit Price blocked the new style's
    // own Last Order Price from auto-filling, since that only fills an
    // empty field). Reset all of it so the new style starts clean.
    updateItem(index, { productId, sampleRequestId: "", unitPrice: "", variants: [], quantities: {} });
    setHighlightVariantId((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setLastOrderPrices((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setPriceHistoryByLine((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (!productId) return;
    fetch(`/api/v1/products/${productId}`)
      .then((res) => res.json())
      .then((body) => updateItem(index, { variants: body.data?.variants ?? [] }));
  };

  /**
   * Defaults (never forces) a line's variant grid to the linked sample's own
   * planned color+size — the exact combo the sample was proven in, per
   * explicit ask. If that combo doesn't exist yet as a real ProductVariant
   * for this Style (the common case — most samples are made before variants
   * are generated), it's auto-generated via the same bulk-variant endpoint
   * `InlineVariantGenerator` already uses, scoped to just this one
   * color+size, so the grid always has the relevant cell to fill in without
   * a separate manual step. Every other color/size stays fully addable —
   * this only decides which cell gets a starting highlight.
   */
  const applySampleVariantDefault = async (index: number, sample: SampleOption, currentVariants: VariantOption[], productId: string) => {
    if (!sample.color || !sample.size) return;

    const existing = currentVariants.find((v) => v.color.id === sample.color!.id && v.size.id === sample.size!.id);
    if (existing) {
      setHighlightVariantId((prev) => ({ ...prev, [index]: existing.id }));
      return;
    }

    const res = await fetch(`/api/v1/products/${productId}/variants/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorIds: [sample.color.id], sizeIds: [sample.size.id] }),
    }).catch(() => null);
    if (!res || !res.ok) return; // e.g. an inactive color/size — leave the grid as-is, no forced failure.

    const refreshed = await fetch(`/api/v1/products/${productId}`).then((r) => r.json());
    const variants: VariantOption[] = refreshed.data?.variants ?? [];
    updateItem(index, { variants });
    const created = variants.find((v) => v.color.id === sample.color!.id && v.size.id === sample.size!.id);
    if (created) setHighlightVariantId((prev) => ({ ...prev, [index]: created.id }));
  };

  // Pre-fill each existing line's variant grid when editing, so entered
  // quantities show up immediately instead of the grid staying empty until a
  // Style is re-picked. initialOrder only changes via a full remount
  // (key={id} on the edit page), so this only ever runs once per order.
  useEffect(() => {
    initialOrder?.items.forEach((item, index) => {
      fetch(`/api/v1/products/${item.productId}`)
        .then((res) => res.json())
        .then((body) => updateItem(index, { variants: body.data?.variants ?? [] }));
    });
  }, [initialOrder]);

  // "Last Order Price" — what this exact customer was actually charged the
  // last time they ordered this exact style, so a repeat order defaults to
  // real negotiated history instead of a generic sample-costing estimate.
  // Re-runs whenever the customer or any line's own Style changes (not on
  // every keystroke — the productId-list dependency key below is stable
  // across quantity/price edits). Default-fills Unit Price only while it's
  // still empty (never overwrites), the same "suggest, never enforce"
  // convention already used for the linked sample's own costing default —
  // since this fetch is triggered by Style selection, which always happens
  // before a Sample can even be picked, a real last-order price naturally
  // wins the race and fills the field first.
  const productIdsKey = items.map((item) => item.productId).join(",");
  useEffect(() => {
    // Reset-on-clear lives in the Customer <select>'s own onChange (see
    // below), not here — calling setState synchronously in an effect body
    // trips this project's react-hooks/set-state-in-effect rule; every
    // setState in this effect happens inside a fetch .then() instead.
    if (!customerId) return;
    items.forEach((item, index) => {
      if (!item.productId) return;
      const params = new URLSearchParams({ customerId, productId: item.productId });
      if (initialOrder) params.set("excludeOrderId", initialOrder.id);
      fetch(`/api/v1/sales-orders/last-price?${params}`)
        .then((res) => res.json())
        .then((body) => {
          setLastOrderPrices((prev) => ({ ...prev, [index]: body.data ?? null }));
          if (body.data?.unitPrice) {
            setItems((prev) => prev.map((it, i) => (i === index && !it.unitPrice ? { ...it, unitPrice: body.data.unitPrice } : it)));
          }
        });

      const historyParams = new URLSearchParams({ customerId, productId: item.productId, sinceDays: "365" });
      if (initialOrder) historyParams.set("excludeOrderId", initialOrder.id);
      fetch(`/api/v1/sales-orders/price-history?${historyParams}`)
        .then((res) => res.json())
        .then((body) => setPriceHistoryByLine((prev) => ({ ...prev, [index]: body.data ?? [] })));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, productIdsKey]);

  const setQuantities = (index: number, patch: Record<string, string>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantities: { ...item.quantities, ...patch } } : item))
    );
  };

  const addLine = () => setItems((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const lineTotal = (item: LineItem) => {
    const qty = Object.values(item.quantities).reduce((sum, v) => sum + (Number(v) || 0), 0);
    return qty * (Number(item.unitPrice) || 0);
  };
  const orderTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

  // This business only operates in INR today — multi-currency UI is
  // deferred project-wide, so the live preview is fixed to ₹ rather than
  // resolving a customer/company currency that isn't actually in use yet.
  // The order's stored currencyCode is still set correctly server-side.
  const formatAmount = (amount: number) => `₹${formatCurrency(amount)}`;

  const submitOrder = async (useOverride: boolean) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payloadItems = items.map((item) => ({
      productId: item.productId,
      sampleRequestId: item.sampleRequestId || undefined,
      unitPrice: Number(item.unitPrice),
      notes: item.notes || undefined,
      breakdown: Object.entries(item.quantities)
        .filter(([, qty]) => Number(qty) > 0)
        .map(([productVariantId, qty]) => ({ productVariantId, orderedQuantity: Number(qty) })),
      // A genuinely new line (never had one) omits this entirely; an
      // existing, unchanged line's own id lets the server reuse it — see
      // sales-order-bom.service.ts's buildReconciledItemPlan, which still
      // safely re-evaluates as "new" if the Style/Sample changed underneath
      // it, so nothing here needs to guess at that.
      salesOrderLineId: item.salesOrderLineId,
    }));

    const url = initialOrder ? `/api/v1/sales-orders/${initialOrder.id}` : "/api/v1/sales-orders";
    const res = await fetch(url, {
      method: initialOrder ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        buyerId: buyerId || undefined,
        orderDate,
        requiredShipDate: requiredShipDate || undefined,
        customerPoNumber: customerPoNumber || undefined,
        originatingOpportunityId: !initialOrder && originatingOpportunityId ? originatingOpportunityId : undefined,
        items: payloadItems,
        overrideReason: initialOrder && useOverride ? overrideReason : undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this sales order.");
      // Editing a CONFIRMED order can be blocked by the sample-approval
      // gate — only that case gets an override retry, since a DRAFT edit or
      // a plain validation error has nothing to override.
      if (initialOrder?.status === "CONFIRMED" && !useOverride) setNeedsOverride(true);
      return;
    }

    setNeedsOverride(false);
    const { data } = await res.json();
    router.push(`/sales-orders/${data.id}`);
    router.refresh();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitOrder(false);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {!initialOrder && originatingOpportunityId && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          Creating this order from Opportunity {originatingOpportunityNumber ?? originatingOpportunityId} — the link will be recorded on the order.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Customer" htmlFor="customerId" required>
          <SearchableSelect
            id="customerId"
            required
            value={customerId}
            onChange={(next) => {
              setCustomerId(next);
              setBuyerId("");
              setBuyers([]);
              setLastOrderPrices({});
              setPriceHistoryByLine({});
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Order Date" htmlFor="orderDate" required>
          <input
            id="orderDate"
            type="date"
            required
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Required Ship Date" htmlFor="requiredShipDate">
          <input
            id="requiredShipDate"
            type="date"
            value={requiredShipDate}
            onChange={(e) => setRequiredShipDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Customer PO Number (optional)" htmlFor="customerPoNumber">
          <input
            id="customerPoNumber"
            value={customerPoNumber}
            onChange={(e) => setCustomerPoNumber(e.target.value)}
            placeholder="Buyer's own purchase order reference"
            className={textInputClass()}
          />
        </FormField>
      </div>
      {!initialOrder && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          You can upload the buyer&apos;s PO document as an attachment from the order&apos;s detail page once it&apos;s created.
        </p>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Style Lines</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Any customer can order any approved design.
          </p>
        </div>
        {items.map((item, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="text-xs font-medium text-red-600 hover:text-red-500"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Style" htmlFor={`style-${index}`} required>
                <SearchableSelect
                  id={`style-${index}`}
                  required
                  value={item.productId}
                  onChange={(next) => onStyleChange(index, next)}
                  options={styles.map((s) => ({
                    id: s.id,
                    label: s.styleName ?? "",
                    sublabel: s.designNumber ? `Design: ${s.designNumber}` : undefined,
                  }))}
                  placeholder="Search style…"
                />
              </FormField>

              <FormField label="Design Name / Linked Sample (optional)" htmlFor={`sample-${index}`}>
                <SearchableSelect
                  id={`sample-${index}`}
                  value={item.sampleRequestId}
                  onChange={(sampleRequestId) => {
                    const selected = approvedSamples.find((s) => s.id === sampleRequestId);
                    const sampleCost = selected?.versions[0]?.estimatedCostPerUnit ?? null;
                    // Default, not enforced — only fills a still-empty Unit
                    // Price, same "suggest but never overwrite" convention
                    // already used for Add Material's Unit default in Sampling.
                    updateItem(index, {
                      sampleRequestId,
                      ...(sampleCost && !item.unitPrice ? { unitPrice: sampleCost } : {}),
                    });
                    if (selected && item.productId) {
                      void applySampleVariantDefault(index, selected, item.variants, item.productId);
                    }
                  }}
                  disabled={!item.productId}
                  options={approvedSamples
                    .filter((s) => s.product?.id === item.productId)
                    .map((s) => ({ id: s.id, label: sampleDisplayLabel(s), sublabel: sampleSublabel(s, customerId) }))}
                  placeholder="Search design / sample…"
                />
                {!item.productId ? (
                  <p className="mt-1 text-xs text-zinc-400">Pick a Style first.</p>
                ) : approvedSamples.filter((s) => s.product?.id === item.productId).length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-400">No approved samples for this style yet.</p>
                ) : item.sampleRequestId ? (
                  (() => {
                    const selected = approvedSamples.find((s) => s.id === item.sampleRequestId);
                    const sampleCost = selected?.versions[0]?.estimatedCostPerUnit ?? null;
                    return sampleCost ? (
                      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                        Sample cost/unit: {formatAmount(Number(sampleCost))}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-zinc-400">This sample has not been costed yet.</p>
                    );
                  })()
                ) : null}
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Unit Price" htmlFor={`price-${index}`} required>
                <input
                  id={`price-${index}`}
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={item.unitPrice}
                  onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                  // A real datalist, not a forced picker — the field stays
                  // freely typeable; every distinct price this customer was
                  // actually charged for this style in the last year is one
                  // native-dropdown click away instead.
                  list={`price-history-${index}`}
                  className={textInputClass()}
                />
                <datalist id={`price-history-${index}`}>
                  {dedupePriceOptions(priceHistoryByLine[index] ?? []).map((h, i) => (
                    <option key={i} value={h.unitPrice} label={`${h.orderNumber} — ${formatDate(h.orderDate)}`} />
                  ))}
                </datalist>
                {lastOrderPrices[index] && (
                  <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Last order price: {formatAmount(Number(lastOrderPrices[index]!.unitPrice))} ({lastOrderPrices[index]!.orderNumber} on{" "}
                    {formatDate(lastOrderPrices[index]!.orderDate)})
                  </p>
                )}
              </FormField>
              <FormField label="Notes" htmlFor={`notes-${index}`}>
                <input
                  id={`notes-${index}`}
                  value={item.notes}
                  onChange={(e) => updateItem(index, { notes: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
            </div>

            {item.productId && item.variants.length === 0 && (
              <InlineVariantGenerator
                productId={item.productId}
                colors={colors}
                sizes={sizes}
                onGenerated={(variants) => updateItem(index, { variants })}
              />
            )}

            {item.variants.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Quantity by Color / Size
                </label>
                <VariantQuantityGrid
                  variants={item.variants}
                  quantities={item.quantities}
                  onChange={(patch) => setQuantities(index, patch)}
                  highlightVariantId={highlightVariantId[index]}
                />
              </div>
            )}

            <p className="text-xs text-zinc-500">Line Amount: {formatAmount(lineTotal(item))}</p>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          + Add Style Line
        </button>
      </div>

      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Order Amount: {formatAmount(orderTotal)}</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {needsOverride && (
        <div className="max-w-md space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <FormField label="Management override reason" htmlFor="editOverrideReason">
            <input
              id="editOverrideReason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why save without full sample approval?"
              className={textInputClass()}
            />
          </FormField>
          <button
            type="button"
            onClick={() => submitOrder(true)}
            disabled={isSubmitting || !overrideReason}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Save Anyway (Override)
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : initialOrder ? "Save Changes" : "Create Sales Order"}
        </button>
        <button
          type="button"
          onClick={() => router.push(initialOrder ? `/sales-orders/${initialOrder.id}` : "/sales-orders")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Color × Size matrix, not a flat truncated list — colors as rows, sizes as
 * columns, so both dimensions are always fully legible. Each row/column
 * header carries its own "fill" input + button so a merchandiser can set one
 * color across every size, one size across every color, or a single cell,
 * without three different UIs for what's really one bulk-set operation.
 */
function VariantQuantityGrid({
  variants,
  quantities,
  onChange,
  highlightVariantId,
}: {
  variants: VariantOption[];
  quantities: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  /** The linked sample's own planned color+size, once resolved to a real
   * variant id — a display default only (see applySampleVariantDefault),
   * never a restriction on which other cells can be filled. */
  highlightVariantId?: string;
}) {
  const [rowFill, setRowFill] = useState<Record<string, string>>({});
  const [colFill, setColFill] = useState<Record<string, string>>({});
  const highlightRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (highlightVariantId) highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightVariantId]);

  const colors = Array.from(new Map(variants.map((v) => [v.color.id, v.color])).values());
  const sizes = Array.from(new Map(variants.map((v) => [v.size.id, v.size])).values()).sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  const cellByKey = new Map(variants.map((v) => [`${v.color.id}:${v.size.id}`, v]));

  const applyRow = (colorId: string) => {
    const value = rowFill[colorId];
    if (!value) return;
    const patch: Record<string, string> = {};
    for (const size of sizes) {
      const v = cellByKey.get(`${colorId}:${size.id}`);
      if (v) patch[v.id] = value;
    }
    onChange(patch);
  };

  const applyColumn = (sizeId: string) => {
    const value = colFill[sizeId];
    if (!value) return;
    const patch: Record<string, string> = {};
    for (const color of colors) {
      const v = cellByKey.get(`${color.id}:${sizeId}`);
      if (v) patch[v.id] = value;
    }
    onChange(patch);
  };

  const fillInputClass =
    "w-11 rounded border border-dashed border-zinc-300 bg-transparent px-1 py-1 text-center text-xs text-zinc-500 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:text-zinc-400";
  // w-20 (was w-14) — a 5-digit quantity like "10000" was clipping inside
  // the old 56px box (2026-09-05); widened to 80px, with the size <col>
  // below widened to match so the table's own alignment (header/fill-row/
  // data-rows sharing one <colgroup>) stays consistent.
  const cellInputClass =
    "w-20 rounded-md border border-zinc-300 bg-white px-1 py-1.5 text-center text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <div className="mt-1.5 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col style={{ width: 108 }} />
          <col style={{ width: 84 }} />
          {sizes.map((size) => (
            <col key={size.id} style={{ width: 96 }} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-zinc-50 dark:bg-zinc-900/60">
            <th className="border-b border-r border-zinc-200 dark:border-zinc-800"></th>
            <th className="border-b border-r border-zinc-200 px-1 py-1.5 text-center text-xs font-normal uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              Fill
            </th>
            {sizes.map((size) => (
              <th
                key={size.id}
                className="border-b border-zinc-200 px-1.5 py-1.5 text-center font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
              >
                {size.name}
              </th>
            ))}
          </tr>
          <tr className="bg-zinc-50 dark:bg-zinc-900/60">
            <th className="border-b border-r border-zinc-200 dark:border-zinc-800"></th>
            <th className="border-b border-r border-zinc-200 px-1 py-1 text-center text-xs font-normal text-zinc-400 dark:border-zinc-800">
              all sizes
            </th>
            {sizes.map((size) => (
              <td key={size.id} className="border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="number"
                    min={0}
                    placeholder="all"
                    title={`Set every color to this quantity for ${size.name}`}
                    value={colFill[size.id] ?? ""}
                    onChange={(e) => setColFill((prev) => ({ ...prev, [size.id]: e.target.value }))}
                    className={fillInputClass}
                  />
                  <button
                    type="button"
                    onClick={() => applyColumn(size.id)}
                    title={`Apply to all colors — ${size.name}`}
                    className="font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    ↓
                  </button>
                </div>
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {colors.map((color) => (
            <tr key={color.id}>
              <th className="truncate border-b border-r border-zinc-100 px-2 py-1.5 text-left font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
                {color.name}
              </th>
              <td className="border-b border-r border-zinc-100 px-1 py-1 dark:border-zinc-800">
                <div className="flex items-center justify-center gap-1">
                  <input
                    type="number"
                    min={0}
                    placeholder="all"
                    title={`Set every size to this quantity for ${color.name}`}
                    value={rowFill[color.id] ?? ""}
                    onChange={(e) => setRowFill((prev) => ({ ...prev, [color.id]: e.target.value }))}
                    className={fillInputClass}
                  />
                  <button
                    type="button"
                    onClick={() => applyRow(color.id)}
                    title={`Apply to all sizes — ${color.name}`}
                    className="font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    →
                  </button>
                </div>
              </td>
              {sizes.map((size) => {
                const variant = cellByKey.get(`${color.id}:${size.id}`);
                const isHighlighted = !!variant && variant.id === highlightVariantId;
                return (
                  <td key={size.id} className="border-b border-zinc-100 px-1.5 py-1 text-center dark:border-zinc-800">
                    {variant ? (
                      <input
                        ref={isHighlighted ? highlightRef : undefined}
                        type="number"
                        min={0}
                        title={isHighlighted ? "Defaulted from the linked sample's own color/size" : undefined}
                        value={quantities[variant.id] ?? ""}
                        onChange={(e) => onChange({ [variant.id]: e.target.value })}
                        className={
                          isHighlighted
                            ? `${cellInputClass} ring-2 ring-indigo-500 dark:ring-indigo-400`
                            : cellInputClass
                        }
                      />
                    ) : (
                      <span className="text-zinc-300 dark:text-zinc-700">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Shown instead of the quantity grid when the selected Style has no
 * Color×Size variants generated yet — reuses the exact same
 * `POST /api/v1/products/:id/variants/bulk` endpoint and Color/Size master
 * picker already built for this in Masters → Products → Variants, so a
 * merchandiser doesn't have to leave the order screen to unblock a new style.
 */
function InlineVariantGenerator({
  productId,
  colors,
  sizes,
  onGenerated,
}: {
  productId: string;
  colors: Option[];
  sizes: Option[];
  onGenerated: (variants: VariantOption[]) => void;
}) {
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const handleGenerate = async () => {
    if (selectedColorIds.length === 0 || selectedSizeIds.length === 0) {
      setError("Select at least one color and one size.");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const res = await fetch(`/api/v1/products/${productId}/variants/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ colorIds: selectedColorIds, sizeIds: selectedSizeIds }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to generate variants.");
      setIsSubmitting(false);
      return;
    }

    const refreshed = await fetch(`/api/v1/products/${productId}`).then((r) => r.json());
    setIsSubmitting(false);
    onGenerated(refreshed.data?.variants ?? []);
  };

  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
      <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
        This style has no color/size variants yet. Pick some to generate them now — no need to go to Masters first.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Colors</p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {colors.length === 0 && <p className="text-xs text-zinc-400">No colors defined yet.</p>}
            {colors.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={selectedColorIds.includes(c.id)}
                  onChange={() => toggle(selectedColorIds, setSelectedColorIds, c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Sizes</p>
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {sizes.length === 0 && <p className="text-xs text-zinc-400">No sizes defined yet.</p>}
            {sizes.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={selectedSizeIds.includes(s.id)}
                  onChange={() => toggle(selectedSizeIds, setSelectedSizeIds, s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isSubmitting}
        className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Generating…" : "Generate Variants"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

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
  isActive?: boolean;
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
  // Every variant the Style has (lookup only) — the grid itself shows just
  // the colours/sizes chosen for THIS order line (colorIds/sizeIds), so a new
  // order never starts with the colours/sizes of earlier orders (2026-10-21).
  variants: VariantOption[];
  colorIds: string[];
  sizeIds: string[];
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
  return { productId: "", sampleRequestId: "", unitPrice: "", notes: "", variants: [], colorIds: [], sizeIds: [], quantities: {} };
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
          colorIds: [],
          sizeIds: [],
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
    updateItem(index, { productId, sampleRequestId: "", unitPrice: "", variants: [], colorIds: [], sizeIds: [], quantities: {} });
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
    const colorId = sample.color.id;
    const sizeId = sample.size.id;

    // The sample's own colour/size also become this line's starting grid.
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? {
              ...it,
              colorIds: it.colorIds.includes(colorId) ? it.colorIds : [...it.colorIds, colorId],
              sizeIds: it.sizeIds.includes(sizeId) ? it.sizeIds : [...it.sizeIds, sizeId],
            }
          : it
      )
    );

    const existing = currentVariants.find((v) => v.color.id === colorId && v.size.id === sizeId);
    if (existing) {
      setHighlightVariantId((prev) => ({ ...prev, [index]: existing.id }));
      return;
    }

    const variants = await ensureVariants(productId, [colorId], [sizeId]);
    if (!variants) return; // e.g. an inactive color/size — leave the grid as-is, no forced failure.
    updateItem(index, { variants });
    const created = variants.find((v) => v.color.id === colorId && v.size.id === sizeId);
    if (created) setHighlightVariantId((prev) => ({ ...prev, [index]: created.id }));
  };

  /**
   * Creates any missing Style variants for these colours x sizes (the bulk
   * endpoint skips ones that already exist) and returns the Style's full,
   * refreshed variant list — or null when the server refused (e.g. an
   * inactive colour/size).
   */
  const ensureVariants = async (productId: string, colorIds: string[], sizeIds: string[]): Promise<VariantOption[] | null> => {
    if (colorIds.length > 0 && sizeIds.length > 0) {
      const res = await fetch(`/api/v1/products/${productId}/variants/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toast": "errors" },
        body: JSON.stringify({ colorIds, sizeIds }),
      }).catch(() => null);
      if (!res || !res.ok) return null;
    }
    const refreshed = await fetch(`/api/v1/products/${productId}`).then((r) => r.json());
    return refreshed.data?.variants ?? [];
  };

  const [variantError, setVariantError] = useState<Record<number, string>>({});

  /** Adds a colour or size to one order line's grid (its variants are created by the effect below). */
  const addGridOption = (index: number, kind: "color" | "size", id: string) => {
    if (!id) return;
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        if (kind === "color") return it.colorIds.includes(id) ? it : { ...it, colorIds: [...it.colorIds, id] };
        return it.sizeIds.includes(id) ? it : { ...it, sizeIds: [...it.sizeIds, id] };
      })
    );
  };

  // Every colour x size on a line needs a real Style variant to hold a
  // quantity. Whenever a line's grid has a combination the Style doesn't have
  // yet, create it (the bulk endpoint skips existing ones) and refresh the
  // line's variants. `variantRequests` stops the same request firing twice
  // while one is in flight.
  const variantRequests = useRef(new Set<string>());
  useEffect(() => {
    items.forEach((item, index) => {
      if (!item.productId) return;
      const have = new Set(item.variants.map((v) => `${v.color.id}:${v.size.id}`));
      const missing = item.colorIds.some((c) => item.sizeIds.some((sz) => !have.has(`${c}:${sz}`)));
      if (!missing) return;
      const key = `${index}|${item.productId}|${[...item.colorIds].sort().join(",")}|${[...item.sizeIds].sort().join(",")}`;
      if (variantRequests.current.has(key)) return;
      variantRequests.current.add(key);
      const productId = item.productId;
      ensureVariants(productId, item.colorIds, item.sizeIds).then((variants) => {
        if (!variants) {
          // Left in variantRequests on purpose so a refused combination isn't
          // retried on every keystroke; removing the colour/size clears it.
          setVariantError((prev) => ({ ...prev, [index]: "Couldn't add that colour/size to the style (it may be inactive)." }));
          return;
        }
        variantRequests.current.delete(key);
        setVariantError((prev) => ({ ...prev, [index]: "" }));
        setItems((prev) => prev.map((it, i) => (i === index && it.productId === productId ? { ...it, variants } : it)));
      });
    });
  }, [items]);

  /** Removes a colour or size from one order line's grid and clears its quantities. */
  const removeGridOption = (index: number, kind: "color" | "size", id: string) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const removedVariantIds = new Set(it.variants.filter((v) => (kind === "color" ? v.color.id : v.size.id) === id).map((v) => v.id));
        return {
          ...it,
          colorIds: kind === "color" ? it.colorIds.filter((c) => c !== id) : it.colorIds,
          sizeIds: kind === "size" ? it.sizeIds.filter((sz) => sz !== id) : it.sizeIds,
          quantities: Object.fromEntries(Object.entries(it.quantities).filter(([variantId]) => !removedVariantIds.has(variantId))),
        };
      })
    );
  };

  // Pre-fill each existing line's variant grid when editing, so entered
  // quantities show up immediately instead of the grid staying empty until a
  // Style is re-picked. initialOrder only changes via a full remount
  // (key={id} on the edit page), so this only ever runs once per order.
  useEffect(() => {
    initialOrder?.items.forEach((item, index) => {
      fetch(`/api/v1/products/${item.productId}`)
        .then((res) => res.json())
        .then((body) => {
          const variants: VariantOption[] = body.data?.variants ?? [];
          // An existing order shows exactly the colours/sizes it was ordered in.
          const ordered = variants.filter((v) => item.breakdown.some((b) => b.productVariantId === v.id));
          updateItem(index, {
            variants,
            colorIds: Array.from(new Set(ordered.map((v) => v.color.id))),
            sizeIds: Array.from(new Set(ordered.map((v) => v.size.id))),
          });
        });
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
    <form onSubmit={handleSubmit} className="w-full space-y-6">
      {!initialOrder && originatingOpportunityId && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          Creating this order from Opportunity {originatingOpportunityNumber ?? originatingOpportunityId} — the link will be recorded on the order.
        </p>
      )}
      {/* One responsive grid for the header fields, so the full-width form
          puts them side by side on wide screens instead of stretching two
          columns across the page. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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

            {/* Style | Design and Unit Price | Notes sit in one row on wide screens. */}
            <div className="grid gap-3 xl:grid-cols-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </div>

            {item.productId && (
              <div>
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Quantity by Color / Size
                </label>
                <GridOptionPicker
                  index={index}
                  colors={colors.filter((c) => c.isActive !== false && !item.colorIds.includes(c.id))}
                  sizes={sizes.filter((sz) => sz.isActive !== false && !item.sizeIds.includes(sz.id))}
                  onAdd={(kind, id) => addGridOption(index, kind, id)}
                />
                {variantError[index] && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{variantError[index]}</p>}
                {item.colorIds.length > 0 && item.sizeIds.length > 0 ? (
                  <VariantQuantityGrid
                    variants={item.variants}
                    colors={item.colorIds.map((id) => ({ id, name: colors.find((c) => c.id === id)?.name ?? variantName(item.variants, "color", id) }))}
                    sizes={sizes
                      .filter((sz) => item.sizeIds.includes(sz.id))
                      .concat(item.sizeIds.filter((id) => !sizes.some((sz) => sz.id === id)).map((id) => ({ id, name: variantName(item.variants, "size", id) })))
                      .map((sz) => ({ id: sz.id, name: sz.name ?? "" }))}
                    quantities={item.quantities}
                    onChange={(patch) => setQuantities(index, patch)}
                    onRemove={(kind, id) => removeGridOption(index, kind, id)}
                    highlightVariantId={highlightVariantId[index]}
                  />
                ) : (
                  <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    Add the colours and sizes for this order above — the grid appears once there is at least one of each.
                  </p>
                )}
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
  colors,
  sizes,
  quantities,
  onChange,
  onRemove,
  highlightVariantId,
}: {
  variants: VariantOption[];
  /** The colours/sizes chosen for this order line, in display order. */
  colors: Array<{ id: string; name: string }>;
  sizes: Array<{ id: string; name: string }>;
  quantities: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  onRemove: (kind: "color" | "size", id: string) => void;
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

  // Quantities run up to 5 digits (10000). Inputs render at the global 15px
  // input size (not text-xs), so the boxes are sized for that: the cell is
  // 96px and the fill box 64px. The browser's up/down spinner is hidden — it
  // is no use for typing large numbers and it covered the digits. The <col>
  // widths below are widened to match so header, fill row and data rows
  // (sharing one <colgroup>) stay aligned.
  const noSpinnerClass =
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const fillInputClass = `w-16 rounded border border-dashed border-zinc-300 bg-transparent px-1 py-1 text-center text-xs text-zinc-500 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:text-zinc-400 ${noSpinnerClass}`;
  const cellInputClass = `w-24 rounded-md border border-zinc-300 bg-white px-1 py-1.5 text-center text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 ${noSpinnerClass}`;

  return (
    <div className="mt-1.5 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col style={{ width: 108 }} />
          <col style={{ width: 100 }} />
          {sizes.map((size) => (
            <col key={size.id} style={{ width: 112 }} />
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
                <button
                  type="button"
                  onClick={() => onRemove("size", size.id)}
                  title={`Remove size ${size.name} from this order`}
                  aria-label={`Remove size ${size.name}`}
                  className="ml-1 text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
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
                <button
                  type="button"
                  onClick={() => onRemove("color", color.id)}
                  title={`Remove colour ${color.name} from this order`}
                  aria-label={`Remove colour ${color.name}`}
                  className="mr-1 text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
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

/** Display name for a colour/size that isn't in the (active) master list any more. */
function variantName(variants: VariantOption[], kind: "color" | "size", id: string): string {
  const v = variants.find((x) => (kind === "color" ? x.color.id : x.size.id) === id);
  return (kind === "color" ? v?.color.name : v?.size.name) ?? "—";
}

/**
 * "+ Add colour" / "+ Add size" for one order line (2026-10-21). Lists every
 * active Color/Size master not already on the line; picking one adds it to the
 * grid (the needed Style variants are created automatically).
 */
function GridOptionPicker({
  index,
  colors,
  sizes,
  onAdd,
}: {
  index: number;
  colors: Option[];
  sizes: Option[];
  onAdd: (kind: "color" | "size", id: string) => void;
}) {
  const selectClass =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <select
        aria-label={`Add colour to line ${index + 1}`}
        value=""
        onChange={(e) => onAdd("color", e.target.value)}
        className={selectClass}
      >
        <option value="">+ Add colour</option>
        {colors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label={`Add size to line ${index + 1}`}
        value=""
        onChange={(e) => onAdd("size", e.target.value)}
        className={selectClass}
      >
        <option value="">+ Add size</option>
        {sizes.map((sz) => (
          <option key={sz.id} value={sz.id}>
            {sz.name}
          </option>
        ))}
      </select>
    </div>
  );
}

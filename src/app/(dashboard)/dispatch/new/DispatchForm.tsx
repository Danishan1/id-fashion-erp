"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";
import { EXTRA_DISPATCH_REASONS, EXTRA_DISPATCH_REASON_LABELS } from "@/modules/dispatch/dispatch.schema";

// Mirrors DISPATCH_ELIGIBLE_ORDER_STATUSES in dispatch.service.ts exactly —
// DISPATCHED is included so an order the Regular fulfillment already
// considers complete can still be picked for a further Extra shipment
// (replacement/FOC/sample); every line on it will compute Regular=0 and
// require an Extra Dispatch Reason, same as any other line at 0 remaining.
const ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED", "DISPATCHED"];

interface SalesOrderOption {
  id: string;
  orderNumber: string;
  status: string;
}

interface BreakdownRow {
  orderedQuantity: number;
}

// Already embedded on each item by GET /api/v1/sales-orders/:id (via
// getSalesOrderById -> getSalesOrderItemProductionSummary, unchanged) — no
// separate fetch needed for these figures. Every quantity here is at the
// Style (Sales Order line) level, never per Colour/Size — Production's own
// data (Lot/JobOrder/QcInspection) has no variant dimension at all, so a
// per-variant split would be a fabricated estimate, not a real figure (see
// that function's own doc comment). availableStock stays null here (it
// needs a warehouseId, fetched separately once a warehouse is chosen — see
// availableStockByItemId below).
interface ProductionSummary {
  totalPlanned: number;
  totalProduced: number;
  totalRejected: number;
  totalQcAccepted: number;
  totalQcRejected: number;
  totalQcDamaged: number;
  // Release to Dispatch gate (2026-10-10) — one entry per non-cancelled
  // Production Order linked to this line; release status doesn't depend on
  // a warehouse, so it's always present on the embedded summary (unlike
  // contributingLots below, which needs one).
  productionOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    releasedToDispatchAt: string | null;
    releasedToDispatchByUserName: string | null;
  }>;
}

interface ContributingLot {
  lotId: string;
  lotNumber: string;
  quantity: number;
  productionOrderId: string;
  productionOrderNumber: string;
}

interface OrderItemDetail {
  id: string;
  productId: string;
  // TOTAL physical quantity ever dispatched (regular+extra) — display only.
  dispatchedQuantity: number;
  // What Sale Order fulfillment/"remaining" is actually based on.
  regularDispatchedQuantity: number;
  productId: string;
  product: { styleName: string; styleCode: string };
  breakdown: BreakdownRow[];
  productionSummary: ProductionSummary;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  customer: {
    name: string;
    billingAddress: string | null;
    shippingAddress: string | null;
    contactPerson: string | null;
    phone: string | null;
  };
  buyer: { name: string; contactPerson: string | null; phone: string | null } | null;
  items: OrderItemDetail[];
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface ForwarderOption {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
}

interface DispatchSettingsValue {
  allowExtraDispatch: boolean;
  extraDispatchApprovalRequired: boolean;
  extraDispatchApprovalThresholdQty: number | null;
  extraDispatchApprovalThresholdPercent: number | null;
}

// Avoids IEEE-754 display noise (e.g. 0.1 + 0.2) when summing two
// already-rounded server figures client-side — same convention used
// throughout this codebase's own reports for exactly this reason.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Remaining Order Qty = MAX(0, SO Qty - Already Regular Dispatched Qty). */
function orderedTotal(item: OrderItemDetail): number {
  return item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
}
function remaining(item: OrderItemDetail): number {
  return Math.max(0, orderedTotal(item) - item.regularDispatchedQuantity);
}
/** Same cumulative-Regular split the server applies — mirrored client-side
 * purely for the live preview; the server's own computation is what's
 * actually authoritative and re-derives this fresh at submit time. */
function split(item: OrderItemDetail, dispatchQty: number): { regularQty: number; extraQty: number } {
  const rem = remaining(item);
  const regularQty = Math.min(dispatchQty, rem);
  const extraQty = Math.max(0, dispatchQty - rem);
  return { regularQty, extraQty };
}

interface InitialDispatch {
  id: string;
  salesOrderId: string;
  warehouseId: string;
  dispatchDate: string;
  deliveryAddress: string;
  transporterName: string | null;
  vehicleNumber: string | null;
  trackingNumber: string | null;
  forwarderId: string | null;
  lrNumber: string | null;
  awbNumber: string | null;
  driverDetails: string | null;
  freightCharges: number | null;
  expectedDeliveryDate: string | null;
  shipmentRemarks: string | null;
  items: Array<{
    salesOrderItemId: string;
    dispatchedQuantity: number;
    extraDispatchReason?: string | null;
    extraDispatchRemarks?: string | null;
  }>;
}

/** Opened from the Dispatch page's "For Dispatching" list — pre-picks the Sale Order and line quantity. */
export interface DispatchPrefill {
  salesOrderId: string;
  salesOrderItemId?: string;
  quantity?: number;
}

export function DispatchForm({ initialDispatch, prefill }: { initialDispatch?: InitialDispatch; prefill?: DispatchPrefill }) {
  const router = useRouter();
  const isEditMode = !!initialDispatch;

  const [orders, setOrders] = useState<SalesOrderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [forwarders, setForwarders] = useState<ForwarderOption[]>([]);
  const [settings, setSettings] = useState<DispatchSettingsValue | null>(null);
  const [salesOrderId, setSalesOrderId] = useState(initialDispatch?.salesOrderId ?? prefill?.salesOrderId ?? "");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [warehouseId, setWarehouseId] = useState(initialDispatch?.warehouseId ?? "");
  const [dispatchDate, setDispatchDate] = useState(
    initialDispatch?.dispatchDate.slice(0, 10) ?? todayIsoDate()
  );
  const [deliveryAddress, setDeliveryAddress] = useState(initialDispatch?.deliveryAddress ?? "");
  const [transporterName, setTransporterName] = useState(initialDispatch?.transporterName ?? "");
  const [vehicleNumber, setVehicleNumber] = useState(initialDispatch?.vehicleNumber ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initialDispatch?.trackingNumber ?? "");
  const [forwarderId, setForwarderId] = useState(initialDispatch?.forwarderId ?? "");
  const [lrNumber, setLrNumber] = useState(initialDispatch?.lrNumber ?? "");
  const [awbNumber, setAwbNumber] = useState(initialDispatch?.awbNumber ?? "");
  const [driverDetails, setDriverDetails] = useState(initialDispatch?.driverDetails ?? "");
  const [freightCharges, setFreightCharges] = useState(
    initialDispatch?.freightCharges != null ? String(initialDispatch.freightCharges) : ""
  );
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(
    initialDispatch?.expectedDeliveryDate?.slice(0, 10) ?? ""
  );
  const [shipmentRemarks, setShipmentRemarks] = useState(initialDispatch?.shipmentRemarks ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    initialDispatch
      ? Object.fromEntries(initialDispatch.items.map((i) => [i.salesOrderItemId, String(i.dispatchedQuantity)]))
      : prefill?.salesOrderItemId && prefill.quantity
        ? { [prefill.salesOrderItemId]: String(prefill.quantity) }
        : {}
  );
  const [extraReasons, setExtraReasons] = useState<Record<string, string>>(
    Object.fromEntries((initialDispatch?.items ?? []).map((i) => [i.salesOrderItemId, i.extraDispatchReason ?? ""]))
  );
  const [extraRemarks, setExtraRemarks] = useState<Record<string, string>>(
    Object.fromEntries((initialDispatch?.items ?? []).map((i) => [i.salesOrderItemId, i.extraDispatchRemarks ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Real Finished-Goods stock per line at the chosen warehouse — fetched
  // separately from the order (production summary is embedded on the order
  // response already; this needs warehouseId, which the order fetch doesn't
  // know about). Keyed by salesOrderItemId. null = not yet fetched for this
  // line/warehouse combination, distinct from a real computed 0.
  const [availableStockByItemId, setAvailableStockByItemId] = useState<Record<string, number | null>>({});
  // Multi-lot dispatch visibility (2026-10-10) — which real Lots posted the
  // Finished-Goods receipts behind availableStockByItemId, fetched from the
  // exact same per-line call. Lives in a sibling map rather than folded into
  // availableStockByItemId's own value since it's a richer shape (an array,
  // not a number) and keeping the two separate avoids a breaking change to
  // every existing reader of availableStockByItemId.
  const [contributingLotsByItemId, setContributingLotsByItemId] = useState<Record<string, ContributingLot[]>>({});
  const [overrideProductionReleaseReason, setOverrideProductionReleaseReason] = useState("");

  useEffect(() => {
    fetch("/api/v1/sales-orders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setOrders((body.data ?? []).filter((o: SalesOrderOption) => ELIGIBLE_ORDER_STATUSES.includes(o.status))))
      .catch(() => {});
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/forwarders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setForwarders(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/dispatch-settings")
      .then((res) => res.json())
      .then((body) => setSettings(body.data))
      .catch(() => {});
  }, []);

  // Pre-fill the order detail (for the item picker) when editing, or when
  // opened from the "For Dispatching" list.
  const preloadOrderId = initialDispatch?.salesOrderId ?? prefill?.salesOrderId;
  useEffect(() => {
    if (!preloadOrderId) return;
    fetch(`/api/v1/sales-orders/${preloadOrderId}`)
      .then((res) => res.json())
      .then((body) => setOrder(body.data))
      .catch(() => setOrder(null));
  }, [preloadOrderId]);

  // Real available Finished-Goods stock per line, once both the order and a
  // warehouse are known — reuses the exact same production-summary endpoint
  // (its own ?warehouseId= support), never a separate stock-only call, so
  // there's only ever one source of truth for "how much is really on hand."
  // This is the SAME figure Dispatch's own confirmDispatch() stock check
  // reads at confirm time — deliberately not a distinct "packing-ready"
  // estimate (see ProductionSummary's own doc comment).
  useEffect(() => {
    // No setState here for the "nothing to fetch yet" case — the render
    // below already gates on `warehouseId`/the active order directly, so a
    // stale entry from a previously-selected order is simply never looked
    // up again (different order = different item ids) rather than needing
    // an explicit clear (matches this file's own set-state-in-effect
    // convention: only ever setState inside a .then()/.catch() callback).
    if (!order || order.id !== salesOrderId || !warehouseId) return;
    let cancelled = false;
    Promise.all(
      order.items.map((item) =>
        fetch(`/api/v1/sales-order-items/${item.id}/production-summary?warehouseId=${warehouseId}`)
          .then((res) => res.json())
          .then(
            (body) =>
              [item.id, body.data?.availableStock ?? null, body.data?.contributingLots ?? []] as const
          )
          .catch(() => [item.id, null, []] as const)
      )
    ).then((triples) => {
      if (cancelled) return;
      setAvailableStockByItemId(Object.fromEntries(triples.map(([id, stock]) => [id, stock])));
      setContributingLotsByItemId(Object.fromEntries(triples.map(([id, , lots]) => [id, lots])));
    });
    return () => {
      cancelled = true;
    };
  }, [order, salesOrderId, warehouseId]);

  const selectOrder = (id: string) => {
    setSalesOrderId(id);
    setQuantities({});
    setExtraReasons({});
    setExtraRemarks({});
    if (!id) {
      setOrder(null);
      return;
    }
    fetch(`/api/v1/sales-orders/${id}`)
      .then((res) => res.json())
      .then((body) => {
        setOrder(body.data);
        // Auto-fill the per-dispatch address snapshot from the order's own
        // Customer — a default only, never written back to Customer/Buyer/
        // the Sales Order itself (this textarea stays freely editable, and
        // nothing on the server ever reads it back into those records).
        // Prefers Shipping Address, falls back to Billing Address.
        const customer = body.data?.customer;
        setDeliveryAddress(customer?.shippingAddress || customer?.billingAddress || "");
      })
      .catch(() => setOrder(null));
  };

  const activeOrder = order && order.id === salesOrderId ? order : null;

  // Finished Goods stock at the chosen warehouse (minus other open dispatches),
  // shown per line so an impossible quantity is caught here, not at Confirm.
  const stockKey = activeOrder && warehouseId
    ? `${warehouseId}|${[...new Set(activeOrder.items.map((i) => i.productId))].join(",")}`
    : "";
  const [stockState, setStockState] = useState<{ key: string; data: Record<string, { onHand: number; reserved: number; available: number }> }>({ key: "", data: {} });
  useEffect(() => {
    if (!stockKey) return;
    const [wh, ids] = stockKey.split("|");
    const params = new URLSearchParams({ warehouseId: wh, productIds: ids });
    if (initialDispatch) params.set("excludeDispatchId", initialDispatch.id);
    fetch(`/api/v1/dispatches/available-stock?${params}`)
      .then((res) => res.json())
      .then((body) => setStockState({ key: stockKey, data: body.data ?? {} }))
      .catch(() => {});
  }, [stockKey, initialDispatch]);
  const stock = stockState.key === stockKey ? stockState.data : null;
  // Editing: an item this dispatch itself already has quantity against still
  // shows (its own not-yet-confirmed line doesn't count against remaining —
  // matches updateDispatch()'s own server-side reasoning). Creating: only
  // lines with real remaining OR real extra-eligibility are worth showing;
  // in practice every line is shown since Extra Dispatch means "fully
  // regular-fulfilled" no longer hides a line the way it used to.
  const dispatchableItems = activeOrder?.items ?? [];

  const activeLines = dispatchableItems
    .map((item) => ({ item, quantity: Number(quantities[item.id]) || 0 }))
    .filter(({ quantity }) => quantity > 0);

  const settingsBlockExtra = settings ? !settings.allowExtraDispatch : false;
  const linesNeedingReason = activeLines.filter(({ item, quantity }) => split(item, quantity).extraQty > 0 && !extraReasons[item.id]);
  const linesNeedingRemarks = activeLines.filter(
    ({ item }) => extraReasons[item.id] === "OTHER" && !extraRemarks[item.id]?.trim()
  );
  const linesBlockedByExtra = settingsBlockExtra
    ? activeLines.filter(({ item, quantity }) => split(item, quantity).extraQty > 0)
    : [];

  // Release-to-Dispatch gate (2026-10-10) — purely a client-side preview;
  // the server re-checks this for real (and never trusts this computation)
  // in dispatch.service.ts's own assertProductionReleasedForLines(). A line
  // with no Production Orders at all (Make-to-Stock, or production never
  // formally tracked) is correctly excluded here too, matching the server's
  // own opt-in-only gate. CLOSED orders are also treated as implicitly released.
  const linesNeedingProductionRelease = activeLines.filter(({ item }) =>
    item.productionSummary.productionOrders.some(
      (po) => po.status !== "CLOSED" && !po.releasedToDispatchAt
    )
  );

  const totals = activeLines.reduce(
    (acc, { item, quantity }) => {
      const { regularQty, extraQty } = split(item, quantity);
      return { regular: acc.regular + regularQty, extra: acc.extra + extraQty, total: acc.total + quantity };
    },
    { regular: 0, extra: 0, total: 0 }
  );

  const requestedByProduct = activeLines.reduce<Record<string, number>>((acc, { item, quantity }) => {
    acc[item.productId] = (acc[item.productId] ?? 0) + quantity;
    return acc;
  }, {});
  const overStockProductIds = stock
    ? Object.keys(requestedByProduct).filter((pid) => requestedByProduct[pid] > (stock[pid]?.available ?? 0))
    : [];

  const canSubmit =
    !isSubmitting &&
    overStockProductIds.length === 0 &&
    !!activeOrder &&
    activeLines.length > 0 &&
    linesNeedingReason.length === 0 &&
    linesNeedingRemarks.length === 0 &&
    linesBlockedByExtra.length === 0 &&
    (linesNeedingProductionRelease.length === 0 || !!overrideProductionReleaseReason.trim());

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !activeOrder) return;
    setIsSubmitting(true);
    setError(null);

    const payload = {
      salesOrderId: activeOrder.id,
      warehouseId,
      dispatchDate,
      deliveryAddress,
      transporterName: transporterName || undefined,
      vehicleNumber: vehicleNumber || undefined,
      trackingNumber: trackingNumber || undefined,
      forwarderId: forwarderId || undefined,
      lrNumber: lrNumber || undefined,
      awbNumber: awbNumber || undefined,
      driverDetails: driverDetails || undefined,
      freightCharges: freightCharges ? Number(freightCharges) : undefined,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      shipmentRemarks: shipmentRemarks || undefined,
      overrideProductionReleaseReason: overrideProductionReleaseReason.trim() || undefined,
      items: activeLines.map(({ item, quantity }) => ({
        salesOrderItemId: item.id,
        dispatchedQuantity: quantity,
        extraDispatchReason: extraReasons[item.id] || undefined,
        extraDispatchRemarks: extraRemarks[item.id] || undefined,
      })),
    };

    const res = await fetch(isEditMode ? `/api/v1/dispatches/${initialDispatch.id}` : "/api/v1/dispatches", {
      method: isEditMode ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to create dispatch.");
      return;
    }

    const body = await res.json();
    router.push(`/dispatch/${body.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-5xl space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Sales Order" htmlFor="salesOrderId" required>
          {isEditMode ? (
            <input disabled value={order?.orderNumber ?? "…"} className={textInputClass()} />
          ) : (
            <SearchableSelect
              id="salesOrderId"
              required
              value={salesOrderId}
              onChange={selectOrder}
              options={orders.map((o) => ({ id: o.id, label: o.orderNumber }))}
              placeholder="Search eligible order…"
            />
          )}
        </FormField>
        <FormField label="Warehouse" htmlFor="warehouseId" required>
          <SearchableSelect
            id="warehouseId"
            required
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
            placeholder="Search warehouse…"
          />
        </FormField>
        <FormField label="Dispatch Date" htmlFor="dispatchDate" required>
          <input
            id="dispatchDate"
            type="date"
            required
            value={dispatchDate}
            onChange={(e) => setDispatchDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      {activeOrder && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Customer: {activeOrder.customer.name}
          {activeOrder.buyer && ` · Buyer: ${activeOrder.buyer.name}`}
          {(() => {
            // Prefer the Buyer's own contact (the actual ordering contact)
            // over the Customer's general one, same precedence the address
            // auto-fill effectively follows (the more specific record wins).
            const contactPerson = activeOrder.buyer?.contactPerson || activeOrder.customer.contactPerson;
            const phone = activeOrder.buyer?.phone || activeOrder.customer.phone;
            if (!contactPerson && !phone) return null;
            return (
              <>
                {" · "}
                {contactPerson && `Contact: ${contactPerson}`}
                {contactPerson && phone && " · "}
                {phone && `Phone: ${phone}`}
              </>
            );
          })()}
        </p>
      )}

      <FormField label="Delivery Address" htmlFor="deliveryAddress" required>
        <textarea
          id="deliveryAddress"
          required
          rows={2}
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Transporter (optional)" htmlFor="transporterName">
          <input id="transporterName" value={transporterName} onChange={(e) => setTransporterName(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Vehicle No. (optional)" htmlFor="vehicleNumber">
          <input id="vehicleNumber" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="Tracking No. (optional)" htmlFor="trackingNumber">
          <input id="trackingNumber" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      {/* Forwarder Master integration (2026-10-10) — a real FK, a live join
          for contact display (never a snapshot — see the Forwarder model's
          own schema comment), alongside per-shipment facts that genuinely do
          vary per dispatch and are frozen on this row directly. */}
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Forwarder (optional)" htmlFor="forwarderId">
          <SearchableSelect
            id="forwarderId"
            value={forwarderId}
            onChange={setForwarderId}
            options={forwarders.map((f) => ({ id: f.id, label: `${f.name} (${f.code})` }))}
            placeholder="Search forwarder / courier…"
          />
        </FormField>
        <FormField label="LR Number (optional)" htmlFor="lrNumber">
          <input id="lrNumber" value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} className={textInputClass()} />
        </FormField>
        <FormField label="AWB / Airway Bill No. (optional)" htmlFor="awbNumber">
          <input id="awbNumber" value={awbNumber} onChange={(e) => setAwbNumber(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      {(() => {
        const selectedForwarder = forwarders.find((f) => f.id === forwarderId);
        if (!selectedForwarder || (!selectedForwarder.contactPerson && !selectedForwarder.phone)) return null;
        return (
          <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {selectedForwarder.contactPerson && `Contact: ${selectedForwarder.contactPerson}`}
            {selectedForwarder.contactPerson && selectedForwarder.phone && " · "}
            {selectedForwarder.phone && `Phone: ${selectedForwarder.phone}`}
          </p>
        );
      })()}

      <div className="grid grid-cols-3 gap-4">
        <FormField label="Driver Details (optional)" htmlFor="driverDetails">
          <input
            id="driverDetails"
            value={driverDetails}
            onChange={(e) => setDriverDetails(e.target.value)}
            placeholder="Name · phone"
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Freight Charges (optional)" htmlFor="freightCharges">
          <input
            id="freightCharges"
            type="number"
            min="0"
            step="0.01"
            value={freightCharges}
            onChange={(e) => setFreightCharges(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Expected Delivery Date (optional)" htmlFor="expectedDeliveryDate">
          <input
            id="expectedDeliveryDate"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Shipment Remarks (optional)" htmlFor="shipmentRemarks">
        <textarea
          id="shipmentRemarks"
          rows={2}
          value={shipmentRemarks}
          onChange={(e) => setShipmentRemarks(e.target.value)}
          className={textInputClass()}
        />
      </FormField>

      {settings && !settings.allowExtraDispatch && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Extra Dispatch is disabled for this company — dispatch quantity per line is capped at what remains against the
          sales order.
        </p>
      )}

      {activeOrder && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Lines — enter a quantity to dispatch (leave blank to skip)
          </h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            Planned/Produced/QC/Stock figures below are per Style (this order line as a whole) — Production tracks
            quantity at the Lot level, not per Colour/Size, so a per-variant split isn&apos;t a real number to show.
            &quot;Available Stock&quot; and &quot;Packing-Ready&quot; are the same figure: once production reaches
            Finished Goods it&apos;s immediately available, there&apos;s no separate pre-dispatch packing pool today.
          </p>
          {dispatchableItems.length === 0 ? (
            <p className="text-sm text-zinc-500">This order has no lines.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">Style</th>
                    <th className="px-3 py-2 font-medium">SO Qty</th>
                    <th className="px-3 py-2 font-medium">Already Regular</th>
                    <th className="px-3 py-2 font-medium">Remaining SO Qty</th>
                    <th className="px-3 py-2 font-medium">Available Stock</th>
                    <th className="px-3 py-2 font-medium">Dispatch Qty</th>
                    <th className="px-3 py-2 font-medium">Regular</th>
                    <th className="px-3 py-2 font-medium">Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchableItems.map((item) => {
                    const rem = remaining(item);
                    const qty = Number(quantities[item.id]) || 0;
                    const { regularQty, extraQty } = split(item, qty);
                    const needsReason = extraQty > 0;
                    const needsRemarks = extraReasons[item.id] === "OTHER";
                    return (
                      <Fragment key={item.id}>
                        <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                          <td className="px-3 py-2">
                            {item.product.styleCode} — {item.product.styleName}
                          </td>
                          <td className="px-3 py-2">{orderedTotal(item)}</td>
                          <td className="px-3 py-2">{item.regularDispatchedQuantity}</td>
                          <td className="px-3 py-2">{rem}</td>
                          <td
                            className={`px-3 py-2 ${overStockProductIds.includes(item.productId) ? "font-semibold text-red-600 dark:text-red-400" : ""}`}
                            title={stock?.[item.productId]?.reserved ? `In stock ${stock[item.productId].onHand}, ${stock[item.productId].reserved} on other open dispatches` : undefined}
                          >
                            {!warehouseId ? "Pick a warehouse" : stock ? (stock[item.productId]?.available ?? 0) : "…"}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="1"
                              value={quantities[item.id] ?? ""}
                              onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              className={textInputClass()}
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">{regularQty}</td>
                          <td className={`px-3 py-2 font-medium ${extraQty > 0 ? "text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>
                            {extraQty}
                          </td>
                        </tr>
                        <tr className="border-b border-zinc-100 bg-zinc-50/50 text-xs text-zinc-500 last:border-0 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                          <td colSpan={7} className="px-3 py-1.5">
                            Planned: {item.productionSummary.totalPlanned} · Produced (reached FG): {item.productionSummary.totalProduced}
                            {" · "}QC Accepted: {item.productionSummary.totalQcAccepted}
                            {" · "}QC Rejected/Damaged: {round2(item.productionSummary.totalQcRejected + item.productionSummary.totalQcDamaged)}
                            {" · "}
                            {warehouseId ? (
                              availableStockByItemId[item.id] != null ? (
                                <>Available Stock at Warehouse (= Packing-Ready): {availableStockByItemId[item.id]}</>
                              ) : (
                                "Available Stock at Warehouse: loading…"
                              )
                            ) : (
                              "Available Stock at Warehouse: pick a warehouse to see this"
                            )}
                          </td>
                        </tr>
                        {item.productionSummary.productionOrders.length > 0 && (
                          <tr className="border-b border-zinc-100 bg-zinc-50/50 text-xs text-zinc-500 last:border-0 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                            <td colSpan={7} className="px-3 py-1.5">
                              Production Release:{" "}
                              {item.productionSummary.productionOrders.map((po, i) => (
                                <span key={po.id}>
                                  {i > 0 && ", "}
                                  {po.orderNumber}{" "}
                                  {po.releasedToDispatchAt ? (
                                    <span className="text-green-700 dark:text-green-400">✓ Released</span>
                                  ) : (
                                    <span className="font-medium text-amber-700 dark:text-amber-400">⚠ Not released</span>
                                  )}
                                </span>
                              ))}
                              {warehouseId && contributingLotsByItemId[item.id]?.length > 0 && (
                                <>
                                  {" · "}Lots contributing to stock:{" "}
                                  {contributingLotsByItemId[item.id].map((l, i) => (
                                    <span key={l.lotId}>
                                      {i > 0 && ", "}
                                      {l.lotNumber} ({l.quantity})
                                    </span>
                                  ))}
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                        {needsReason && (
                          <tr className="border-b border-zinc-100 bg-amber-50/50 last:border-0 dark:border-zinc-800 dark:bg-amber-500/5">
                            <td colSpan={8} className="px-3 py-2">
                              <div className="grid grid-cols-2 gap-3">
                                <FormField label="Extra Dispatch Reason" htmlFor={`reason-${item.id}`} required>
                                  <select
                                    id={`reason-${item.id}`}
                                    value={extraReasons[item.id] ?? ""}
                                    onChange={(e) => setExtraReasons((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    className={textInputClass()}
                                  >
                                    <option value="">— Select a reason —</option>
                                    {EXTRA_DISPATCH_REASONS.map((r) => (
                                      <option key={r} value={r}>
                                        {EXTRA_DISPATCH_REASON_LABELS[r]}
                                      </option>
                                    ))}
                                  </select>
                                </FormField>
                                <FormField
                                  label={needsRemarks ? "Remarks (required)" : "Remarks (optional)"}
                                  htmlFor={`remarks-${item.id}`}
                                  required={needsRemarks}
                                >
                                  <input
                                    id={`remarks-${item.id}`}
                                    value={extraRemarks[item.id] ?? ""}
                                    onChange={(e) => setExtraRemarks((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    className={textInputClass()}
                                  />
                                </FormField>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeLines.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="mb-1 font-medium text-zinc-900 dark:text-zinc-50">Dispatch Summary</p>
          <dl className="grid grid-cols-3 gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <div>
              <dt className="text-zinc-400">Current Dispatch (Total)</dt>
              <dd className="font-medium">{totals.total}</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Regular</dt>
              <dd className="font-medium">{totals.regular}</dd>
            </div>
            <div>
              <dt className={totals.extra > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-400"}>Extra</dt>
              <dd className={`font-medium ${totals.extra > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>{totals.extra}</dd>
            </div>
          </dl>
          {totals.extra > 0 && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {totals.extra} extra piece(s) beyond the sales order quantity — this will never count toward Sale Order
              fulfillment, only the {totals.regular} Regular piece(s) will.
              {settings?.extraDispatchApprovalRequired && " Management approval will be required before this dispatch can be confirmed."}
            </p>
          )}
        </div>
      )}

      {linesBlockedByExtra.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Extra Dispatch is disabled for this company — reduce quantity on the highlighted line(s) to what remains.
        </p>
      )}

      {overStockProductIds.length > 0 && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          Dispatch quantity is more than the Finished Goods stock available in this warehouse:{" "}
          {overStockProductIds
            .map((pid) => {
              const name = dispatchableItems.find((i) => i.productId === pid)?.product.styleName ?? "Style";
              return `${name} — entered ${requestedByProduct[pid]}, available ${stock?.[pid]?.available ?? 0}`;
            })
            .join("; ")}
          .
        </p>
      )}

      {linesNeedingProductionRelease.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Production has not been released to dispatch for:{" "}
            {linesNeedingProductionRelease.map(({ item }) => item.product.styleCode).join(", ")}. A Production Manager
            should click &quot;Release to Dispatch&quot; on the relevant Production Order — or supply a reason below to
            override (requires Management approval permission).
          </p>
          <FormField label="Override Reason" htmlFor="overrideProductionReleaseReason">
            <textarea
              id="overrideProductionReleaseReason"
              rows={2}
              value={overrideProductionReleaseReason}
              onChange={(e) => setOverrideProductionReleaseReason(e.target.value)}
              className={textInputClass()}
              placeholder="Why is it safe to dispatch before Production released this?"
            />
          </FormField>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Create Dispatch"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/dispatch")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

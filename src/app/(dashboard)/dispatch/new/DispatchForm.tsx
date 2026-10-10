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

interface OrderItemDetail {
  id: string;
  // TOTAL physical quantity ever dispatched (regular+extra) — display only.
  dispatchedQuantity: number;
  // What Sale Order fulfillment/"remaining" is actually based on.
  regularDispatchedQuantity: number;
  product: { styleName: string; styleCode: string };
  breakdown: BreakdownRow[];
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  customer: { name: string };
  items: OrderItemDetail[];
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface DispatchSettingsValue {
  allowExtraDispatch: boolean;
  extraDispatchApprovalRequired: boolean;
  extraDispatchApprovalThresholdQty: number | null;
  extraDispatchApprovalThresholdPercent: number | null;
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
  items: Array<{
    salesOrderItemId: string;
    dispatchedQuantity: number;
    extraDispatchReason?: string | null;
    extraDispatchRemarks?: string | null;
  }>;
}

export function DispatchForm({ initialDispatch }: { initialDispatch?: InitialDispatch }) {
  const router = useRouter();
  const isEditMode = !!initialDispatch;

  const [orders, setOrders] = useState<SalesOrderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [settings, setSettings] = useState<DispatchSettingsValue | null>(null);
  const [salesOrderId, setSalesOrderId] = useState(initialDispatch?.salesOrderId ?? "");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [warehouseId, setWarehouseId] = useState(initialDispatch?.warehouseId ?? "");
  const [dispatchDate, setDispatchDate] = useState(
    initialDispatch?.dispatchDate.slice(0, 10) ?? todayIsoDate()
  );
  const [deliveryAddress, setDeliveryAddress] = useState(initialDispatch?.deliveryAddress ?? "");
  const [transporterName, setTransporterName] = useState(initialDispatch?.transporterName ?? "");
  const [vehicleNumber, setVehicleNumber] = useState(initialDispatch?.vehicleNumber ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initialDispatch?.trackingNumber ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>(
    Object.fromEntries((initialDispatch?.items ?? []).map((i) => [i.salesOrderItemId, String(i.dispatchedQuantity)]))
  );
  const [extraReasons, setExtraReasons] = useState<Record<string, string>>(
    Object.fromEntries((initialDispatch?.items ?? []).map((i) => [i.salesOrderItemId, i.extraDispatchReason ?? ""]))
  );
  const [extraRemarks, setExtraRemarks] = useState<Record<string, string>>(
    Object.fromEntries((initialDispatch?.items ?? []).map((i) => [i.salesOrderItemId, i.extraDispatchRemarks ?? ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/sales-orders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setOrders((body.data ?? []).filter((o: SalesOrderOption) => ELIGIBLE_ORDER_STATUSES.includes(o.status))))
      .catch(() => {});
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/dispatch-settings")
      .then((res) => res.json())
      .then((body) => setSettings(body.data))
      .catch(() => {});
  }, []);

  // Pre-fill the order detail (for the item picker) when editing.
  useEffect(() => {
    if (!initialDispatch) return;
    fetch(`/api/v1/sales-orders/${initialDispatch.salesOrderId}`)
      .then((res) => res.json())
      .then((body) => setOrder(body.data))
      .catch(() => setOrder(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDispatch?.salesOrderId]);

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
      .then((body) => setOrder(body.data))
      .catch(() => setOrder(null));
  };

  const activeOrder = order && order.id === salesOrderId ? order : null;
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

  const totals = activeLines.reduce(
    (acc, { item, quantity }) => {
      const { regularQty, extraQty } = split(item, quantity);
      return { regular: acc.regular + regularQty, extra: acc.extra + extraQty, total: acc.total + quantity };
    },
    { regular: 0, extra: 0, total: 0 }
  );

  const canSubmit =
    !isSubmitting &&
    !!activeOrder &&
    activeLines.length > 0 &&
    linesNeedingReason.length === 0 &&
    linesNeedingRemarks.length === 0 &&
    linesBlockedByExtra.length === 0;

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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Customer: {activeOrder.customer.name}</p>
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
                        {needsReason && (
                          <tr className="border-b border-zinc-100 bg-amber-50/50 last:border-0 dark:border-zinc-800 dark:bg-amber-500/5">
                            <td colSpan={7} className="px-3 py-2">
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

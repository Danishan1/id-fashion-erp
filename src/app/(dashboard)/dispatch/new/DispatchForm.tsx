"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { todayIsoDate } from "@/lib/date";

const ELIGIBLE_ORDER_STATUSES = ["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED"];

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
  dispatchedQuantity: number;
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

function remaining(item: OrderItemDetail): number {
  const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
  return orderedTotal - item.dispatchedQuantity;
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
  items: Array<{ salesOrderItemId: string; dispatchedQuantity: number }>;
}

export function DispatchForm({ initialDispatch }: { initialDispatch?: InitialDispatch }) {
  const router = useRouter();
  const isEditMode = !!initialDispatch;

  const [orders, setOrders] = useState<SalesOrderOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
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
  const dispatchableItems = (activeOrder?.items ?? []).filter((item) => remaining(item) > 0);

  const activeLines = dispatchableItems
    .map((item) => ({ item, quantity: Number(quantities[item.id]) || 0 }))
    .filter(({ quantity }) => quantity > 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !activeOrder || activeLines.length === 0) return;
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
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Sales Order" htmlFor="salesOrderId" required>
          {isEditMode ? (
            <input disabled value={order?.orderNumber ?? "…"} className={textInputClass()} />
          ) : (
            <select
              id="salesOrderId"
              required
              value={salesOrderId}
              onChange={(e) => selectOrder(e.target.value)}
              className={textInputClass()}
            >
              <option value="">— Select an eligible order —</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Warehouse" htmlFor="warehouseId" required>
          <select id="warehouseId" required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className={textInputClass()}>
            <option value="">— Select —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
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

      {activeOrder && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Lines — enter a quantity to dispatch (leave blank to skip)
          </h2>
          {dispatchableItems.length === 0 ? (
            <p className="text-sm text-zinc-500">Every line on this order has already been fully dispatched.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">Style</th>
                    <th className="px-3 py-2 font-medium">Remaining to Dispatch</th>
                    <th className="px-3 py-2 font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatchableItems.map((item) => {
                    const rem = remaining(item);
                    return (
                      <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="px-3 py-2">
                          {item.product.styleCode} — {item.product.styleName}
                        </td>
                        <td className="px-3 py-2">{rem}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={rem}
                            step="1"
                            value={quantities[item.id] ?? ""}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className={textInputClass()}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting || !activeOrder || activeLines.length === 0}
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

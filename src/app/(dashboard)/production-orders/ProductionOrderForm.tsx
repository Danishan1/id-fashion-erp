"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { todayIsoDate } from "@/lib/date";

interface StyleOption {
  id: string;
  styleName: string;
  styleCode: string;
}

interface SalesOrderOption {
  id: string;
  orderNumber: string;
  customer: { name: string } | null;
}

interface SalesOrderItemOption {
  id: string;
  product: { id: string; styleName: string; styleCode: string };
}

const TODAY = todayIsoDate();

export function ProductionOrderForm() {
  const router = useRouter();
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [salesOrderItems, setSalesOrderItems] = useState<SalesOrderItemOption[]>([]);
  const [salesOrderItemId, setSalesOrderItemId] = useState("");
  const [productId, setProductId] = useState("");
  const [plannedQuantity, setPlannedQuantity] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [plannedStartDate, setPlannedStartDate] = useState("");
  const [plannedEndDate, setPlannedEndDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/products?pageSize=200")
      .then((res) => res.json())
      .then((body) => setStyles(body.data ?? []));
    fetch("/api/v1/sales-orders?pageSize=200&status=CONFIRMED")
      .then((res) => res.json())
      .then((body) => setSalesOrders(body.data ?? []));
  }, []);

  const onSalesOrderChange = (id: string) => {
    setSalesOrderId(id);
    setSalesOrderItemId("");
    setSalesOrderItems([]);
    if (!id) return;
    fetch(`/api/v1/sales-orders/${id}`)
      .then((res) => res.json())
      .then((body) => setSalesOrderItems(body.data?.items ?? []));
  };

  const onSalesOrderItemChange = (id: string) => {
    setSalesOrderItemId(id);
    const item = salesOrderItems.find((i) => i.id === id);
    if (item) setProductId(item.product.id);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const res = await fetch("/api/v1/production-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salesOrderItemId: salesOrderItemId || undefined,
        productId,
        plannedQuantity: Number(plannedQuantity),
        priority,
        plannedStartDate: plannedStartDate || undefined,
        plannedEndDate: plannedEndDate || undefined,
        remarks: remarks || undefined,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to create this production order.");
      return;
    }

    const { data } = await res.json();
    router.push(`/production-orders/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <FormField label="Linked Sales Order (optional — leave blank for Make-to-Stock)" htmlFor="salesOrderId">
        <select id="salesOrderId" value={salesOrderId} onChange={(e) => onSalesOrderChange(e.target.value)} className={textInputClass()}>
          <option value="">— None (Make-to-Stock) —</option>
          {salesOrders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNumber} — {o.customer?.name ?? "—"}
            </option>
          ))}
        </select>
      </FormField>

      {salesOrderId && (
        <FormField label="Sales Order Line" htmlFor="salesOrderItemId">
          <select id="salesOrderItemId" value={salesOrderItemId} onChange={(e) => onSalesOrderItemChange(e.target.value)} className={textInputClass()}>
            <option value="">— Select a line —</option>
            {salesOrderItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.product.styleName} ({item.product.styleCode})
              </option>
            ))}
          </select>
        </FormField>
      )}

      <FormField label="Style" htmlFor="productId" required>
        <select id="productId" required value={productId} onChange={(e) => setProductId(e.target.value)} className={textInputClass()}>
          <option value="">— Select —</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.styleName} ({s.styleCode})
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Planned Quantity" htmlFor="plannedQuantity" required>
          <input
            id="plannedQuantity"
            type="number"
            min={0}
            step="1"
            required
            value={plannedQuantity}
            onChange={(e) => setPlannedQuantity(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Priority" htmlFor="priority">
          <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={textInputClass()}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Planned Start Date" htmlFor="plannedStartDate">
          <input
            id="plannedStartDate"
            type="date"
            min={TODAY}
            value={plannedStartDate}
            onChange={(e) => setPlannedStartDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Planned End Date" htmlFor="plannedEndDate">
          <input
            id="plannedEndDate"
            type="date"
            min={plannedStartDate || TODAY}
            value={plannedEndDate}
            onChange={(e) => setPlannedEndDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <FormField label="Remarks" htmlFor="remarks">
        <textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} rows={2} />
      </FormField>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Creating…" : "Create Production Order"}
      </button>
    </form>
  );
}

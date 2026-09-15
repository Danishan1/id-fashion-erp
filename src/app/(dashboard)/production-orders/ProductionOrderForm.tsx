"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";
import { MaterialRequirementPreview } from "./MaterialRequirementPreview";

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
  breakdown: Array<{ orderedQuantity: number; productVariant: { color: { name: string }; size: { name: string } } }>;
}

interface CommitmentInfo {
  orderedTotal: number;
  otherCommitted: number;
  remaining: number;
}

const TODAY = todayIsoDate();

export function ProductionOrderForm() {
  const router = useRouter();
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [salesOrderItems, setSalesOrderItems] = useState<SalesOrderItemOption[]>([]);
  const [salesOrderItemId, setSalesOrderItemId] = useState("");
  const [commitment, setCommitment] = useState<CommitmentInfo | null>(null);
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
    setCommitment(null);
    if (!id) return;
    fetch(`/api/v1/sales-orders/${id}`)
      .then((res) => res.json())
      .then((body) => setSalesOrderItems(body.data?.items ?? []));
  };

  const onSalesOrderItemChange = (id: string) => {
    setSalesOrderItemId(id);
    setCommitment(null);
    const item = salesOrderItems.find((i) => i.id === id);
    if (!item) return;
    setProductId(item.product.id);
    fetch(`/api/v1/production-orders/sales-order-commitment?salesOrderItemId=${id}`)
      .then((res) => res.json())
      .then((body) => {
        const info: CommitmentInfo = body.data;
        setCommitment(info);
        // Default only — never overwrites a quantity the user already typed.
        // Prefers what's actually still unplanned on this line; falls back
        // to the full ordered quantity once nothing's left (e.g. a repeat
        // run against an already-fulfilled line).
        if (!plannedQuantity) {
          const defaultQty = info.remaining > 0 ? info.remaining : info.orderedTotal;
          if (defaultQty > 0) setPlannedQuantity(String(defaultQty));
        }
      });
  };

  const selectedItem = salesOrderItems.find((i) => i.id === salesOrderItemId);
  const colors = selectedItem ? [...new Set(selectedItem.breakdown.map((b) => b.productVariant.color.name))] : [];
  const sizes = selectedItem ? [...new Set(selectedItem.breakdown.map((b) => b.productVariant.size.name))] : [];

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
        <SearchableSelect
          id="salesOrderId"
          value={salesOrderId}
          onChange={onSalesOrderChange}
          options={salesOrders.map((o) => ({ id: o.id, label: o.orderNumber, sublabel: o.customer?.name ?? undefined }))}
          placeholder="Search sales order…"
          emptyOptionLabel="— None (Make-to-Stock) —"
        />
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

      {selectedItem && commitment && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <p>
            Ordered Quantity: <span className="font-medium">{commitment.orderedTotal}</span>
            {colors.length > 0 && (
              <>
                {" "}
                · Colors: <span className="font-medium">{colors.join(", ")}</span>
              </>
            )}
            {sizes.length > 0 && (
              <>
                {" "}
                · Sizes: <span className="font-medium">{sizes.join(", ")}</span>
              </>
            )}
          </p>
          {commitment.otherCommitted > 0 && (
            <p className="mt-1">
              Already planned on other Production Order(s): <span className="font-medium">{commitment.otherCommitted}</span> ·
              Remaining unplanned: <span className="font-medium">{commitment.remaining}</span>
            </p>
          )}
          <p className="mt-1 text-zinc-400">
            This Production Order&apos;s own quantity below is independent — it can be more or less than the Sales Order
            quantity, which never changes.
          </p>
        </div>
      )}

      <FormField label="Style" htmlFor="productId" required>
        <SearchableSelect
          id="productId"
          required
          value={productId}
          onChange={setProductId}
          options={styles.map((s) => ({ id: s.id, label: s.styleName, sublabel: s.styleCode }))}
          placeholder="Search style…"
        />
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

      {productId && (
        <MaterialRequirementPreview
          productId={productId}
          quantity={Number(plannedQuantity) || 0}
          salesOrderItemId={salesOrderItemId || undefined}
        />
      )}

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

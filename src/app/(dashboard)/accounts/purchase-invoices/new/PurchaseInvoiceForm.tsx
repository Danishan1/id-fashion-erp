"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";

const ELIGIBLE_PO_STATUSES = ["SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"];

interface PurchaseOrderOption {
  id: string;
  orderNumber: string;
  status: string;
}

interface OrderItemDetail {
  id: string;
  unitPrice: string;
  receivedQuantity: string;
  invoicedQuantity: string;
  product: { styleName: string; styleCode: string };
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  items: OrderItemDetail[];
}

interface TaxRateOption {
  id: string;
  name: string;
  ratePercentage: string;
}

interface LineDraft {
  quantity: string;
  unitPrice: string;
  taxRateId: string;
}

export function PurchaseInvoiceForm() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrderOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // See CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/purchase-orders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setOrders((body.data ?? []).filter((o: PurchaseOrderOption) => ELIGIBLE_PO_STATUSES.includes(o.status))))
      .catch(() => {});
    fetch("/api/v1/tax-rates")
      .then((res) => res.json())
      .then((body) => setTaxRates(body.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!purchaseOrderId) return;
    fetch(`/api/v1/purchase-orders/${purchaseOrderId}`)
      .then((res) => res.json())
      .then((body) => {
        setOrder(body.data);
        setLines({});
      })
      .catch(() => setOrder(null));
  }, [purchaseOrderId]);

  const activeOrder = order && order.id === purchaseOrderId ? order : null;

  const availableFor = (item: OrderItemDetail) => Number(item.receivedQuantity) - Number(item.invoicedQuantity);

  const lineFor = (item: OrderItemDetail): LineDraft =>
    lines[item.id] ?? { quantity: "", unitPrice: item.unitPrice, taxRateId: "" };

  const updateLine = (itemId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? { quantity: "", unitPrice: "", taxRateId: "" }), ...patch } }));
  };

  const activeLines = (activeOrder?.items ?? [])
    .map((item) => ({ item, draft: lineFor(item) }))
    .filter(({ draft }) => Number(draft.quantity) > 0);

  const lineAmounts = activeLines.map(({ item, draft }) => {
    const quantity = Number(draft.quantity) || 0;
    const unitPrice = Number(draft.unitPrice) || 0;
    const subtotal = quantity * unitPrice;
    const taxRate = taxRates.find((t) => t.id === draft.taxRateId);
    const taxAmount = taxRate ? (subtotal * Number(taxRate.ratePercentage)) / 100 : 0;
    return { item, quantity, unitPrice, subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const subtotalAmount = lineAmounts.reduce((sum, l) => sum + l.subtotal, 0);
  const taxAmount = lineAmounts.reduce((sum, l) => sum + l.taxAmount, 0);
  const totalAmount = subtotalAmount + taxAmount;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !activeOrder || activeLines.length === 0) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/purchase-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: activeOrder.id,
          supplierInvoiceNumber,
          invoiceDate,
          lines: activeLines.map(({ item, draft }) => ({
            purchaseOrderItemId: item.id,
            quantity: Number(draft.quantity),
            unitPrice: Number(draft.unitPrice),
            taxRateId: draft.taxRateId,
          })),
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create invoice.");
        return;
      }

      const body = await res.json();
      router.push(`/accounts/purchase-invoices/${body.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="Purchase Order" htmlFor="purchaseOrderId" required>
          <select
            id="purchaseOrderId"
            required
            value={purchaseOrderId}
            onChange={(e) => setPurchaseOrderId(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Select an eligible order —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Supplier Reference No." htmlFor="supplierInvoiceNumber">
          <input
            id="supplierInvoiceNumber"
            value={supplierInvoiceNumber}
            onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
            placeholder="Supplier's own bill number"
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Invoice Date" htmlFor="invoiceDate" required>
          <input
            id="invoiceDate"
            type="date"
            required
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      {activeOrder && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Lines — enter a quantity to include a line on this invoice (leave blank to skip)
          </h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Style</th>
                  <th className="px-3 py-2 font-medium">Available to Invoice</th>
                  <th className="px-3 py-2 font-medium">Quantity</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Tax</th>
                  <th className="px-3 py-2 font-medium">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {activeOrder.items.map((item) => {
                  const draft = lineFor(item);
                  const available = availableFor(item);
                  const amounts = lineAmounts.find((l) => l.item.id === item.id);
                  return (
                    <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="px-3 py-2">
                        {item.product.styleCode} — {item.product.styleName}
                      </td>
                      <td className="px-3 py-2">{available.toFixed(4)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          max={available}
                          step="0.0001"
                          value={draft.quantity}
                          onChange={(e) => updateLine(item.id, { quantity: e.target.value })}
                          className={textInputClass()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={draft.unitPrice}
                          onChange={(e) => updateLine(item.id, { unitPrice: e.target.value })}
                          className={textInputClass()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={draft.taxRateId}
                          onChange={(e) => updateLine(item.id, { taxRateId: e.target.value })}
                          className={textInputClass()}
                        >
                          <option value="">No tax</option>
                          {taxRates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-zinc-500">{(amounts?.taxAmount ?? 0).toFixed(2)}</div>
                      </td>
                      <td className="px-3 py-2">{(amounts?.lineTotal ?? 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                  <td className="px-3 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2">{subtotalAmount.toFixed(2)} + {taxAmount.toFixed(2)}</td>
                  <td className="px-3 py-2">{totalAmount.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting || !activeOrder || activeLines.length === 0}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/accounts/purchase-invoices")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

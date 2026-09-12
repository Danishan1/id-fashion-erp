"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { todayIsoDate } from "@/lib/date";

interface SalesOrderOption {
  id: string;
  orderNumber: string;
  status: string;
}

interface OrderItemDetail {
  id: string;
  unitPrice: string;
  product: { styleName: string; styleCode: string };
  breakdown: { orderedQuantity: number }[];
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  currencyCode: string;
  items: OrderItemDetail[];
}

interface TaxRateOption {
  id: string;
  name: string;
  ratePercentage: string;
}

interface SalesInvoiceFormProps {
  /** Provided only by the Sales Invoices list's "New Invoice" modal — when set, a successful create closes the modal instead of navigating. */
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function SalesInvoiceForm({ onSuccess, onCancel }: SalesInvoiceFormProps = {}) {
  const router = useRouter();
  const [orders, setOrders] = useState<SalesOrderOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const [salesOrderId, setSalesOrderId] = useState("");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  const [lineTaxRateIds, setLineTaxRateIds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // See CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/sales-orders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setOrders((body.data ?? []).filter((o: SalesOrderOption) => o.status === "CONFIRMED")))
      .catch(() => {});
    fetch("/api/v1/tax-rates")
      .then((res) => res.json())
      .then((body) => setTaxRates(body.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!salesOrderId) return;
    fetch(`/api/v1/sales-orders/${salesOrderId}`)
      .then((res) => res.json())
      .then((body) => {
        setOrder(body.data);
        setLineTaxRateIds({});
      })
      .catch(() => setOrder(null));
  }, [salesOrderId]);

  // Guards against showing/submitting a previous order's data if the picker
  // is cleared back to the placeholder without a new selection replacing it.
  const activeOrder = order && order.id === salesOrderId ? order : null;

  const lineAmounts = (activeOrder?.items ?? []).map((item) => {
    const quantity = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    const unitPrice = Number(item.unitPrice);
    const subtotal = quantity * unitPrice;
    const taxRateId = lineTaxRateIds[item.id] ?? "";
    const taxRate = taxRates.find((t) => t.id === taxRateId);
    const taxAmount = taxRate ? (subtotal * Number(taxRate.ratePercentage)) / 100 : 0;
    return { item, quantity, unitPrice, subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const subtotalAmount = lineAmounts.reduce((sum, l) => sum + l.subtotal, 0);
  const taxAmount = lineAmounts.reduce((sum, l) => sum + l.taxAmount, 0);
  const totalAmount = subtotalAmount + taxAmount;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !activeOrder) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/sales-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesOrderId: activeOrder.id,
          invoiceDate,
          lines: activeOrder.items.map((item) => ({
            salesOrderItemId: item.id,
            taxRateId: lineTaxRateIds[item.id] || "",
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
      if (onSuccess) {
        onSuccess();
      } else {
        router.push(`/accounts/sales-invoices/${body.data.id}`);
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Sales Order" htmlFor="salesOrderId" required>
          <SearchableSelect
            id="salesOrderId"
            required
            value={salesOrderId}
            onChange={setSalesOrderId}
            options={orders.map((o) => ({ id: o.id, label: o.orderNumber }))}
            placeholder="Search sales order…"
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
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Lines</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Style</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Subtotal</th>
                  <th className="px-3 py-2 font-medium">Tax</th>
                  <th className="px-3 py-2 font-medium">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {lineAmounts.map(({ item, quantity, unitPrice, subtotal, taxAmount: lineTax, lineTotal }) => (
                  <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">
                      {item.product.styleCode} — {item.product.styleName}
                    </td>
                    <td className="px-3 py-2">{quantity}</td>
                    <td className="px-3 py-2">{unitPrice.toFixed(2)}</td>
                    <td className="px-3 py-2">{subtotal.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={lineTaxRateIds[item.id] ?? ""}
                        onChange={(e) => setLineTaxRateIds({ ...lineTaxRateIds, [item.id]: e.target.value })}
                        className={textInputClass()}
                      >
                        <option value="">No tax</option>
                        {taxRates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1 text-xs text-zinc-500">{lineTax.toFixed(2)}</div>
                    </td>
                    <td className="px-3 py-2">{lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
                  <td className="px-3 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="px-3 py-2">{subtotalAmount.toFixed(2)}</td>
                  <td className="px-3 py-2">{taxAmount.toFixed(2)}</td>
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
          disabled={isSubmitting || !activeOrder}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={onCancel ?? (() => router.push("/accounts/sales-invoices"))}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

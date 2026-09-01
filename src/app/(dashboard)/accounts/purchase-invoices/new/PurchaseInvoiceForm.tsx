"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { todayIsoDate } from "@/lib/date";

const ELIGIBLE_PO_STATUSES = ["SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CLOSED"];

type BillMode = "PO" | "DIRECT";

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

interface SupplierOption {
  id: string;
  name: string;
}

interface ChartOfAccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface LineDraft {
  quantity: string;
  unitPrice: string;
  taxRateId: string;
}

interface DirectLineDraft {
  id: string;
  description: string;
  expenseAccountId: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
}

function newDirectLine(): DirectLineDraft {
  return { id: crypto.randomUUID(), description: "", expenseAccountId: "", quantity: "1", unitPrice: "", taxRateId: "" };
}

export function PurchaseInvoiceForm() {
  const router = useRouter();
  const [billMode, setBillMode] = useState<BillMode>("PO");

  const [orders, setOrders] = useState<PurchaseOrderOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ChartOfAccountOption[]>([]);

  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIsoDate());
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [directLines, setDirectLines] = useState<DirectLineDraft[]>([]);
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
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/chart-of-accounts?pageSize=500")
      .then((res) => res.json())
      .then((body) =>
        setExpenseAccounts(
          (body.data ?? []).filter((a: ChartOfAccountOption) => a.accountType === "EXPENSE" && a.code !== "COGS" && a.isActive)
        )
      )
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

  const selectBillMode = (mode: BillMode) => {
    setBillMode(mode);
    setPurchaseOrderId("");
    setOrder(null);
    setLines({});
    setSupplierId("");
  };

  const activeOrder = order && order.id === purchaseOrderId ? order : null;

  const availableFor = (item: OrderItemDetail) => Number(item.receivedQuantity) - Number(item.invoicedQuantity);

  const lineFor = (item: OrderItemDetail): LineDraft => lines[item.id] ?? { quantity: "", unitPrice: item.unitPrice, taxRateId: "" };

  const updateLine = (itemId: string, patch: Partial<LineDraft>) => {
    setLines((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? { quantity: "", unitPrice: "", taxRateId: "" }), ...patch } }));
  };

  const activeLines = (activeOrder?.items ?? [])
    .map((item) => ({ item, draft: lineFor(item) }))
    .filter(({ draft }) => Number(draft.quantity) > 0);

  const addDirectLine = () => setDirectLines((prev) => [...prev, newDirectLine()]);
  const updateDirectLine = (id: string, patch: Partial<DirectLineDraft>) =>
    setDirectLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeDirectLine = (id: string) => setDirectLines((prev) => prev.filter((l) => l.id !== id));

  const activeDirectLines = directLines.filter((l) => l.description.trim() && l.expenseAccountId && Number(l.quantity) > 0);

  const poLineAmounts = activeLines.map(({ item, draft }) => {
    const quantity = Number(draft.quantity) || 0;
    const unitPrice = Number(draft.unitPrice) || 0;
    const subtotal = quantity * unitPrice;
    const taxRate = taxRates.find((t) => t.id === draft.taxRateId);
    const taxAmount = taxRate ? (subtotal * Number(taxRate.ratePercentage)) / 100 : 0;
    return { item, quantity, unitPrice, subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const directLineAmounts = activeDirectLines.map((l) => {
    const quantity = Number(l.quantity) || 0;
    const unitPrice = Number(l.unitPrice) || 0;
    const subtotal = quantity * unitPrice;
    const taxRate = taxRates.find((t) => t.id === l.taxRateId);
    const taxAmount = taxRate ? (subtotal * Number(taxRate.ratePercentage)) / 100 : 0;
    return { line: l, quantity, unitPrice, subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const subtotalAmount = poLineAmounts.reduce((sum, l) => sum + l.subtotal, 0) + directLineAmounts.reduce((sum, l) => sum + l.subtotal, 0);
  const taxAmount = poLineAmounts.reduce((sum, l) => sum + l.taxAmount, 0) + directLineAmounts.reduce((sum, l) => sum + l.taxAmount, 0);
  const totalAmount = subtotalAmount + taxAmount;

  const hasAnyLine = activeLines.length > 0 || activeDirectLines.length > 0;
  const canSubmit = billMode === "PO" ? !!activeOrder && hasAnyLine : !!supplierId && hasAnyLine;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/purchase-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseOrderId: billMode === "PO" ? activeOrder?.id : undefined,
          supplierId: billMode === "DIRECT" ? supplierId : undefined,
          supplierInvoiceNumber,
          invoiceDate,
          lines: [
            ...activeLines.map(({ item, draft }) => ({
              purchaseOrderItemId: item.id,
              quantity: Number(draft.quantity),
              unitPrice: Number(draft.unitPrice),
              taxRateId: draft.taxRateId,
            })),
            ...activeDirectLines.map((l) => ({
              description: l.description.trim(),
              expenseAccountId: l.expenseAccountId,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              taxRateId: l.taxRateId,
            })),
          ],
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
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => selectBillMode("PO")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            billMode === "PO" ? "bg-indigo-600 text-white" : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          }`}
        >
          Against Purchase Order
        </button>
        <button
          type="button"
          onClick={() => selectBillMode("DIRECT")}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            billMode === "DIRECT" ? "bg-indigo-600 text-white" : "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          }`}
        >
          Direct Bill (No PO — services, freight, rent, etc.)
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {billMode === "PO" ? (
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
        ) : (
          <FormField label="Party / Supplier" htmlFor="supplierId" required>
            <select id="supplierId" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={textInputClass()}>
              <option value="">— Select a supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
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

      {billMode === "PO" && activeOrder && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Lines from {activeOrder.orderNumber} — enter a quantity to include a line (leave blank to skip)
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
                  const amounts = poLineAmounts.find((l) => l.item.id === item.id);
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
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {billMode === "PO" ? "Additional Direct Lines (optional — e.g. freight, handling)" : "Bill Lines"}
          </h2>
          <button
            type="button"
            onClick={addDirectLine}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            + Add Line
          </button>
        </div>
        {directLines.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {billMode === "DIRECT" ? "Add at least one line describing what this bill is for." : "No direct lines added."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Expense Account</th>
                  <th className="px-3 py-2 font-medium">Qty</th>
                  <th className="px-3 py-2 font-medium">Unit Price</th>
                  <th className="px-3 py-2 font-medium">Tax</th>
                  <th className="px-3 py-2 font-medium">Line Total</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {directLines.map((l) => {
                  const amounts = directLineAmounts.find((a) => a.line.id === l.id);
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="px-3 py-2">
                        <input
                          value={l.description}
                          onChange={(e) => updateDirectLine(l.id, { description: e.target.value })}
                          placeholder="What is this bill for?"
                          className={textInputClass()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.expenseAccountId}
                          onChange={(e) => updateDirectLine(l.id, { expenseAccountId: e.target.value })}
                          className={textInputClass()}
                        >
                          <option value="">— Select —</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.0001"
                          value={l.quantity}
                          onChange={(e) => updateDirectLine(l.id, { quantity: e.target.value })}
                          className={textInputClass()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={l.unitPrice}
                          onChange={(e) => updateDirectLine(l.id, { unitPrice: e.target.value })}
                          className={textInputClass()}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={l.taxRateId}
                          onChange={(e) => updateDirectLine(l.id, { taxRateId: e.target.value })}
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
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => removeDirectLine(l.id)} className="text-xs text-red-600 hover:underline dark:text-red-400">
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {hasAnyLine && (
        <div className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex justify-between">
            <span className="text-zinc-500 dark:text-zinc-400">Subtotal + Tax</span>
            <span>
              {subtotalAmount.toFixed(2)} + {taxAmount.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 flex justify-between font-medium">
            <span>Total</span>
            <span>{totalAmount.toFixed(2)}</span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isSubmitting || !canSubmit}
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

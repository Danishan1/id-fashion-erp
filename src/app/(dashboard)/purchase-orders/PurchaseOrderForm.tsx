"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatCurrency } from "@/lib/currency";
import { todayIsoDate } from "@/lib/date";

interface Option {
  id: string;
  name?: string;
  code?: string;
}

interface MaterialOption extends Option {
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
  baseUom: { id: string; code: string } | null;
}

interface LineItem {
  productId: string;
  uomId: string;
  orderedQuantity: string;
  unitPrice: string;
  notes: string;
  colorId: string;
  dyeId: string;
}

const TODAY = todayIsoDate();

function emptyLine(): LineItem {
  return { productId: "", uomId: "", orderedQuantity: "", unitPrice: "", notes: "", colorId: "", dyeId: "" };
}

export interface InitialPurchaseOrderItem {
  productId: string;
  uomId: string;
  orderedQuantity: string;
  unitPrice: string;
  notes: string | null;
  colorId?: string | null;
  dyeId?: string | null;
}

export interface InitialPurchaseOrder {
  id: string;
  status: string;
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  items: InitialPurchaseOrderItem[];
}

export function PurchaseOrderForm({ initialOrder }: { initialOrder?: InitialPurchaseOrder } = {}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(initialOrder?.supplierId ?? "");
  const [orderDate, setOrderDate] = useState(initialOrder ? initialOrder.orderDate.slice(0, 10) : TODAY);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(
    initialOrder?.expectedDeliveryDate?.slice(0, 10) ?? ""
  );
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [dyes, setDyes] = useState<(Option & { pantone: string | null })[]>([]);
  const [items, setItems] = useState<LineItem[]>(
    initialOrder
      ? initialOrder.items.map((item) => ({
          productId: item.productId,
          uomId: item.uomId,
          orderedQuantity: item.orderedQuantity,
          unitPrice: item.unitPrice,
          notes: item.notes ?? "",
          colorId: item.colorId ?? "",
          dyeId: item.dyeId ?? "",
        }))
      : [emptyLine()]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/colors?pageSize=200")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/fabric-dyes?pageSize=200")
      .then((res) => res.json())
      .then((body) => setDyes(body.data ?? []));
  }, []);

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const onMaterialChange = (index: number, productId: string) => {
    const material = materials.find((m) => m.id === productId);
    updateItem(index, { productId, uomId: material?.baseUom?.id ?? "" });
  };

  const addLine = () => setItems((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const lineAmount = (item: LineItem) => (Number(item.orderedQuantity) || 0) * (Number(item.unitPrice) || 0);
  const orderAmount = items.reduce((sum, item) => sum + lineAmount(item), 0);
  const formatAmount = (amount: number) => `₹${formatCurrency(amount)}`;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payloadItems = items.map((item) => ({
      productId: item.productId,
      uomId: item.uomId,
      orderedQuantity: Number(item.orderedQuantity),
      unitPrice: Number(item.unitPrice),
      notes: item.notes || undefined,
      colorId: item.colorId || undefined,
      dyeId: item.dyeId || undefined,
    }));

    const url = initialOrder ? `/api/v1/purchase-orders/${initialOrder.id}` : "/api/v1/purchase-orders";
    const res = await fetch(url, {
      method: initialOrder ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        orderDate,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        items: payloadItems,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this purchase order.");
      return;
    }

    const { data } = await res.json();
    router.push(`/purchase-orders/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      {initialOrder?.status === "APPROVED" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Saving changes will revert this order to Draft — it will need to be approved again.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Supplier" htmlFor="supplierId" required>
          <SearchableSelect
            id="supplierId"
            required
            value={supplierId}
            onChange={setSupplierId}
            options={suppliers.map((s) => ({ id: s.id, label: s.name ?? "" }))}
            placeholder="Search supplier…"
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
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Expected Delivery Date" htmlFor="expectedDeliveryDate">
          <input
            id="expectedDeliveryDate"
            type="date"
            value={expectedDeliveryDate}
            onChange={(e) => setExpectedDeliveryDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
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
              <FormField label="Raw Material" htmlFor={`material-${index}`} required>
                <MaterialPicker
                  id={`material-${index}`}
                  required
                  materials={materials}
                  value={item.productId}
                  onChange={(materialId) => onMaterialChange(index, materialId)}
                />
              </FormField>
              <FormField label="Unit" htmlFor={`uom-${index}`} required>
                <select
                  id={`uom-${index}`}
                  required
                  value={item.uomId}
                  onChange={(e) => updateItem(index, { uomId: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">— Select —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <FormField label="Ordered Quantity" htmlFor={`qty-${index}`} required>
                <input
                  id={`qty-${index}`}
                  type="number"
                  min={0}
                  step="0.0001"
                  required
                  value={item.orderedQuantity}
                  onChange={(e) => updateItem(index, { orderedQuantity: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Unit Price" htmlFor={`price-${index}`} required>
                <input
                  id={`price-${index}`}
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={item.unitPrice}
                  onChange={(e) => updateItem(index, { unitPrice: e.target.value })}
                  className={textInputClass()}
                />
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

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Color (optional)" htmlFor={`color-${index}`}>
                <select
                  id={`color-${index}`}
                  value={item.colorId}
                  onChange={(e) => updateItem(index, { colorId: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">— None —</option>
                  {colors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Shade / Pantone (optional)" htmlFor={`dye-${index}`}>
                <select
                  id={`dye-${index}`}
                  value={item.dyeId}
                  onChange={(e) => updateItem(index, { dyeId: e.target.value })}
                  className={textInputClass()}
                >
                  <option value="">— None —</option>
                  {dyes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.pantone ? ` (${d.pantone})` : ""}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">Line Amount: {formatAmount(lineAmount(item))}</p>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          + Add Line
        </button>
      </div>

      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Order Amount: {formatAmount(orderAmount)}</p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : initialOrder ? "Save Changes" : "Create Purchase Order"}
      </button>
    </form>
  );
}

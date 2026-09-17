"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatCategoryLabel } from "@/lib/format-category-label";

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

interface LocationOption {
  id: string;
  code: string;
  materialCategory: string | null;
  isActive: boolean;
}

interface LineItem {
  productId: string;
  uomId: string;
  quantity: string;
  remarks: string;
  warehouseLocationId: string;
}

const MOVEMENT_TYPES = [
  { value: "TRANSFER", label: "Transfer (between warehouses)" },
  { value: "ADJUSTMENT", label: "Adjustment (physical count correction)" },
  { value: "RETURN_TO_SUPPLIER", label: "Return to Supplier" },
] as const;

function emptyLine(): LineItem {
  return { productId: "", uomId: "", quantity: "", remarks: "", warehouseLocationId: "" };
}

export function StockMovementForm() {
  const router = useRouter();
  // Optional deep-link prefill — e.g. from a Material Request line's "Other
  // Warehouse Stock" modal, which knows exactly which material/from/to
  // warehouse a merchandiser is about to correct and shouldn't force them to
  // re-pick all three by hand. Every param is optional; the form behaves
  // identically to a bare /new visit when none are present.
  const searchParams = useSearchParams();
  const prefillMovementType = searchParams.get("movementType");
  const prefillProductId = searchParams.get("materialId") ?? "";

  const [movementType, setMovementType] = useState<(typeof MOVEMENT_TYPES)[number]["value"]>(
    MOVEMENT_TYPES.some((t) => t.value === prefillMovementType) ? (prefillMovementType as (typeof MOVEMENT_TYPES)[number]["value"]) : "TRANSFER"
  );
  const [warehouseId, setWarehouseId] = useState(searchParams.get("fromWarehouseId") ?? "");
  const [toWarehouseId, setToWarehouseId] = useState(searchParams.get("toWarehouseId") ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<LineItem[]>([{ ...emptyLine(), productId: prefillProductId }]);

  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  // Locations within the SOURCE warehouse only — a line's stock always
  // leaves from `warehouseId`, so the picker is scoped to that warehouse
  // regardless of movement type (even Transfer's destination side has no
  // location field this pass, see stock-movement.schema.ts).
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One value for the lifetime of this mounted form, resent on every retry —
  // see CF-5 in the independent hardening audit.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => {
        const list: MaterialOption[] = body.data ?? [];
        setMaterials(list);
        // The prefilled line's own Unit can't be set until this list is
        // back (it needs that material's baseUom) — same defaulting
        // onMaterialChange already does for a manually-picked material, just
        // done here once instead of on a change event. Lives inside this
        // same async callback (not a separate effect keyed on `materials`)
        // to avoid a synchronous setState-in-effect render cascade.
        if (!prefillProductId) return;
        const material = list.find((m) => m.id === prefillProductId);
        if (!material?.baseUom) return;
        setLines((prev) =>
          prev.map((line) => (line.productId === prefillProductId && !line.uomId ? { ...line, uomId: material.baseUom!.id } : line))
        );
      });
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
  }, [prefillProductId]);

  useEffect(() => {
    const request = warehouseId
      ? fetch(`/api/v1/warehouses/${warehouseId}/locations`).then((res) => res.json())
      : Promise.resolve({ data: [] });
    request
      .then((body) => setLocations((body.data ?? []).filter((l: LocationOption) => l.isActive)))
      .catch(() => setLocations([]));
  }, [warehouseId]);

  const updateLine = (index: number, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  // Changing the source warehouse invalidates every line's already-picked
  // location (it belonged to the old warehouse) — cleared explicitly rather
  // than silently submitting a stale, cross-warehouse location id.
  const onWarehouseChange = (value: string) => {
    setWarehouseId(value);
    setLines((prev) => prev.map((line) => ({ ...line, warehouseLocationId: "" })));
  };

  const onMaterialChange = (index: number, productId: string) => {
    const material = materials.find((m) => m.id === productId);
    updateLine(index, { productId, uomId: material?.baseUom?.id ?? "" });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const isAdjustment = movementType === "ADJUSTMENT";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payloadLines = lines.map((line) => ({
      productId: line.productId,
      uomId: line.uomId,
      quantity: Number(line.quantity),
      remarks: line.remarks || undefined,
      warehouseLocationId: line.warehouseLocationId || undefined,
    }));

    try {
      const res = await fetch("/api/v1/stock-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movementType,
          warehouseId,
          toWarehouseId: movementType === "TRANSFER" ? toWarehouseId || undefined : undefined,
          supplierId: movementType === "RETURN_TO_SUPPLIER" ? supplierId || undefined : undefined,
          reason: reason || undefined,
          remarks: remarks || undefined,
          items: payloadLines,
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to create this stock movement.");
        return;
      }

      const { data } = await res.json();
      router.push(`/inventory/stock-movements/${data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <FormField label="Movement Type" htmlFor="movementType" required>
        <select
          id="movementType"
          required
          value={movementType}
          onChange={(e) => setMovementType(e.target.value as typeof movementType)}
          className={textInputClass()}
        >
          {MOVEMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label={movementType === "TRANSFER" ? "From Warehouse" : "Warehouse"} htmlFor="warehouseId" required>
          <SearchableSelect
            id="warehouseId"
            required
            value={warehouseId}
            onChange={onWarehouseChange}
            options={warehouses.map((w) => ({ id: w.id, label: w.name ?? "" }))}
            placeholder="Search warehouse…"
          />
        </FormField>

        {movementType === "TRANSFER" && (
          <FormField label="To Warehouse" htmlFor="toWarehouseId" required>
            <SearchableSelect
              id="toWarehouseId"
              required
              value={toWarehouseId}
              onChange={setToWarehouseId}
              options={warehouses.filter((w) => w.id !== warehouseId).map((w) => ({ id: w.id, label: w.name ?? "" }))}
              placeholder="Search warehouse…"
            />
          </FormField>
        )}

        {movementType === "RETURN_TO_SUPPLIER" && (
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
        )}
      </div>

      {isAdjustment && (
        <FormField label="Reason" htmlFor="reason" required>
          <input
            id="reason"
            required
            placeholder="e.g. Physical stock count correction"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
      )}

      <FormField label="Remarks (optional)" htmlFor="remarks">
        <textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} rows={2} />
      </FormField>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
        {isAdjustment && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Use a positive quantity for stock found on a physical count, or a negative quantity for shrinkage / write-off.
          </p>
        )}
        {lines.map((line, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {lines.length > 1 && (
                <button type="button" onClick={() => removeLine(index)} className="text-xs font-medium text-red-600 hover:text-red-500">
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Material" htmlFor={`material-${index}`} required>
                <MaterialPicker
                  id={`material-${index}`}
                  required
                  materials={materials}
                  value={line.productId}
                  onChange={(productId) => onMaterialChange(index, productId)}
                />
              </FormField>
              <FormField label="Unit" htmlFor={`uom-${index}`} required>
                <select
                  id={`uom-${index}`}
                  required
                  value={line.uomId}
                  onChange={(e) => updateLine(index, { uomId: e.target.value })}
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

            <FormField label={isAdjustment ? "Quantity (+ found / − written off)" : "Quantity"} htmlFor={`qty-${index}`} required>
              <input
                id={`qty-${index}`}
                type="number"
                min={isAdjustment ? undefined : 0}
                step="0.0001"
                required
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: e.target.value })}
                className={textInputClass()}
              />
            </FormField>

            <FormField label="Location (optional)" htmlFor={`location-${index}`}>
              <select
                id={`location-${index}`}
                value={line.warehouseLocationId}
                onChange={(e) => updateLine(index, { warehouseLocationId: e.target.value })}
                disabled={!warehouseId}
                className={textInputClass()}
              >
                <option value="">{warehouseId ? "— No specific location —" : "Pick a warehouse first"}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code}
                    {l.materialCategory ? ` (${formatCategoryLabel(l.materialCategory)})` : ""}
                  </option>
                ))}
              </select>
              {(() => {
                const material = materials.find((m) => m.id === line.productId);
                const location = locations.find((l) => l.id === line.warehouseLocationId);
                if (!material?.materialCategory || !location?.materialCategory) return null;
                if (material.materialCategory === location.materialCategory) return null;
                return (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    &ldquo;{location.code}&rdquo; is tagged for {formatCategoryLabel(location.materialCategory)}, but this
                    material is {formatCategoryLabel(material.materialCategory)}. You can still save — just double-check
                    this is intentional.
                  </p>
                );
              })()}
            </FormField>

            <FormField label="Remarks (optional)" htmlFor={`remarks-${index}`}>
              <input
                id={`remarks-${index}`}
                value={line.remarks}
                onChange={(e) => updateLine(index, { remarks: e.target.value })}
                className={textInputClass()}
              />
            </FormField>
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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Create Stock Movement"}
      </button>
    </form>
  );
}

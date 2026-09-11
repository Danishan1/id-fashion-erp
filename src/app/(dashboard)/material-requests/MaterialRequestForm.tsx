"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";
import { todayIsoDate } from "@/lib/date";
import { useSubmoduleVisibility } from "@/lib/use-submodule-visibility";

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
  materialId: string;
  colorId: string;
  dyeId: string;
  uomId: string;
  requestedQuantity: string;
  damageReason: string;
  remarks: string;
}

interface OrderPreviewMaterial {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomId: string;
  uomCode: string;
  quantityPerUnit: number;
  neededQuantity: number;
  lineCost: number | null;
}

interface OrderPreviewItem {
  salesOrderItemId: string;
  styleName: string;
  sampleStyleName: string | null;
  orderedQuantity: number;
  hasApprovedBom: boolean;
  materials: OrderPreviewMaterial[];
}

interface OrderPreview {
  items: OrderPreviewItem[];
  grandTotalMaterialCost: number | null;
}

const TODAY = todayIsoDate();
const REQUEST_TYPES = [
  { value: "PRODUCTION_REQUIREMENT", label: "Production Requirement" },
  { value: "DAMAGE_REPLACEMENT", label: "Damage Replacement" },
] as const;

function emptyLine(): LineItem {
  return { materialId: "", colorId: "", dyeId: "", uomId: "", requestedQuantity: "", damageReason: "", remarks: "" };
}

export interface InitialMaterialRequestItem {
  materialId: string;
  colorId: string | null;
  dyeId: string | null;
  uomId: string;
  requestedQuantity: string;
  damageReason?: string | null;
  remarks: string | null;
}

/** A line that's already had real stock issued or a shortfall escalated to
 * a Purchase Order — display only, never submitted back to the server (see
 * updateMaterialRequestLines/replaceLines, which only ever replace a
 * request's still-unlocked lines). Shown read-only so the user still sees
 * the full request while editing the rest of it. */
export interface LockedMaterialRequestItem {
  materialName: string;
  colorName: string | null;
  uomCode: string;
  requestedQuantity: string;
  issuedQuantity: string;
  lockedReason: string;
}

export interface InitialMaterialRequest {
  id: string;
  requestType?: string;
  departmentId: string | null;
  warehouseId: string;
  requiredDate: string | null;
  purpose: string | null;
  salesOrderId?: string | null;
  bomId?: string | null;
  originalMaterialRequestId?: string | null;
  originalMaterialRequestNumber?: string | null;
  remarks: string | null;
  lines: InitialMaterialRequestItem[];
  lockedLines?: LockedMaterialRequestItem[];
}

export function MaterialRequestForm({ initialRequest }: { initialRequest?: InitialMaterialRequest } = {}) {
  const router = useRouter();
  const isVisible = useSubmoduleVisibility();
  const [requestType, setRequestType] = useState(initialRequest?.requestType ?? "PRODUCTION_REQUIREMENT");
  const [departmentId, setDepartmentId] = useState(initialRequest?.departmentId ?? "");
  const [warehouseId, setWarehouseId] = useState(initialRequest?.warehouseId ?? "");
  const [requiredDate, setRequiredDate] = useState(initialRequest?.requiredDate?.slice(0, 10) ?? TODAY);
  const [purpose, setPurpose] = useState(initialRequest?.purpose ?? "");
  const [remarks, setRemarks] = useState(initialRequest?.remarks ?? "");

  // User-editable only when creating a fresh request (see the Sales Order
  // FormField below) — an already-linked request (set by the BOM/MRP
  // "Generate Material Request" flow) keeps its own link read-only on edit,
  // since bomId is only meaningful alongside the specific Sales Order it was
  // derived from; changing one without the other would desync them. Kept in
  // state either way (not just re-read from initialRequest at submit time)
  // so a full-replace edit never silently nulls out traceability that flow
  // already established.
  const [salesOrderId, setSalesOrderId] = useState(initialRequest?.salesOrderId ?? "");
  const [bomId] = useState(initialRequest?.bomId ?? "");
  const [salesOrders, setSalesOrders] = useState<Array<{ id: string; orderNumber: string; customer: { name: string } | null }>>([]);
  // "Add items from the order's BOM" preview — self-fetched whenever an
  // (only-on-create) Sales Order is picked, per the user's own explicit
  // rule: a style line with no linked sample uses the Style's own approved
  // BOM, a line with a linked sample uses that sample's own materials
  // instead (getMaterialRequirementForOrderLine already resolves this).
  // Nothing here is submitted automatically — Add Selected Items below
  // turns a checked/edited row into a normal, freely editable request line.
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [orderPreviewError, setOrderPreviewError] = useState<string | null>(null);
  const [previewSelections, setPreviewSelections] = useState<Record<string, { checked: boolean; qty: string }>>({});

  const [originalMaterialRequestId, setOriginalMaterialRequestId] = useState(initialRequest?.originalMaterialRequestId ?? "");
  const [originalRequestSearch, setOriginalRequestSearch] = useState(initialRequest?.originalMaterialRequestNumber ?? "");
  const [originalRequestOptions, setOriginalRequestOptions] = useState<Array<{ id: string; requestNumber: string }>>([]);

  const [departments, setDepartments] = useState<Option[]>([]);
  const [warehouses, setWarehouses] = useState<Option[]>([]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [dyes, setDyes] = useState<Array<{ id: string; name: string; pantone: string | null }>>([]);

  const [lines, setLines] = useState<LineItem[]>(
    initialRequest
      ? initialRequest.lines.map((line) => ({
          materialId: line.materialId,
          colorId: line.colorId ?? "",
          dyeId: line.dyeId ?? "",
          uomId: line.uomId,
          requestedQuantity: line.requestedQuantity,
          damageReason: line.damageReason ?? "",
          remarks: line.remarks ?? "",
        }))
      : [emptyLine()]
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (requestType !== "DAMAGE_REPLACEMENT" || originalRequestSearch.trim().length < 2) {
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/v1/material-requests?search=${encodeURIComponent(originalRequestSearch)}&pageSize=10`)
        .then((res) => res.json())
        .then((body) => setOriginalRequestOptions(body.data ?? []));
    }, 250);
    return () => clearTimeout(handle);
  }, [requestType, originalRequestSearch]);

  useEffect(() => {
    fetch("/api/v1/departments?pageSize=200")
      .then((res) => res.json())
      .then((body) => setDepartments(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/colors")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/fabric-dyes")
      .then((res) => res.json())
      .then((body) => setDyes(body.data ?? []));
    fetch("/api/v1/sales-orders?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSalesOrders(body.data ?? []));
  }, []);

  useEffect(() => {
    if (!salesOrderId) {
      setOrderPreview(null);
      setOrderPreviewError(null);
      setPreviewSelections({});
      return;
    }
    fetch(`/api/v1/sales-orders/${salesOrderId}/material-preview`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load this order's material breakdown.");
        const data: OrderPreview = body.data;
        setOrderPreview(data);
        setOrderPreviewError(null);
        const initial: Record<string, { checked: boolean; qty: string }> = {};
        data.items.forEach((item) => {
          item.materials.forEach((m) => {
            initial[`${item.salesOrderItemId}:${m.materialId}`] = { checked: true, qty: String(m.neededQuantity) };
          });
        });
        setPreviewSelections(initial);
      })
      .catch((err) => {
        setOrderPreview(null);
        setOrderPreviewError((err as Error).message);
      });
  }, [salesOrderId]);

  const updateLine = (index: number, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const onMaterialChange = (index: number, materialId: string) => {
    const material = materials.find((m) => m.id === materialId);
    updateLine(index, { materialId, uomId: material?.baseUom?.id ?? "" });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  // Turns every checked/edited preview row into a normal request line —
  // after this, they're indistinguishable from a manually-typed line: the
  // user can still edit the quantity, remove them, or add more by hand.
  // Replaces the form's still-untouched starting blank line rather than
  // leaving it dangling (its own `required` fields would otherwise block
  // submission), but never discards anything the user has already typed.
  const addPreviewMaterialsToRequest = () => {
    if (!orderPreview) return;
    const newLines: LineItem[] = [];
    orderPreview.items.forEach((item) => {
      item.materials.forEach((m) => {
        const sel = previewSelections[`${item.salesOrderItemId}:${m.materialId}`];
        if (!sel?.checked) return;
        const qty = Number(sel.qty);
        if (!qty || qty <= 0) return;
        newLines.push({
          materialId: m.materialId,
          colorId: "",
          dyeId: "",
          uomId: m.uomId,
          requestedQuantity: sel.qty,
          damageReason: "",
          remarks: item.sampleStyleName ? `From Design: ${item.sampleStyleName}` : `From Style: ${item.styleName}`,
        });
      });
    });
    if (newLines.length === 0) return;
    setLines((prev) => {
      const isPristine = prev.length === 1 && !prev[0].materialId && !prev[0].requestedQuantity;
      return isPristine ? newLines : [...prev, ...newLines];
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const payloadLines = lines.map((line) => ({
      materialId: line.materialId,
      colorId: line.colorId || undefined,
      dyeId: line.dyeId || undefined,
      uomId: line.uomId,
      requestedQuantity: Number(line.requestedQuantity),
      damageReason: requestType === "DAMAGE_REPLACEMENT" ? line.damageReason || undefined : undefined,
      remarks: line.remarks || undefined,
    }));

    const url = initialRequest ? `/api/v1/material-requests/${initialRequest.id}` : "/api/v1/material-requests";
    const res = await fetch(url, {
      method: initialRequest ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestType,
        departmentId: departmentId || undefined,
        warehouseId,
        requiredDate: requiredDate || undefined,
        purpose: purpose || undefined,
        salesOrderId: salesOrderId || undefined,
        bomId: bomId || undefined,
        originalMaterialRequestId: requestType === "DAMAGE_REPLACEMENT" ? originalMaterialRequestId || undefined : undefined,
        remarks: remarks || undefined,
        lines: payloadLines,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this material request.");
      return;
    }

    const { data } = await res.json();
    router.push(`/material-requests/${data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
      <FormField label="Request Type" htmlFor="requestType" required>
        <select
          id="requestType"
          required
          value={requestType}
          onChange={(e) => {
            setRequestType(e.target.value);
            if (e.target.value !== "DAMAGE_REPLACEMENT") setOriginalRequestOptions([]);
          }}
          className={textInputClass()}
        >
          {REQUEST_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </FormField>

      {!initialRequest && (
        <FormField label="Sales Order (optional)" htmlFor="salesOrderId">
          <select
            id="salesOrderId"
            value={salesOrderId}
            onChange={(e) => setSalesOrderId(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— None —</option>
            {salesOrders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNumber}
                {o.customer ? ` — ${o.customer.name}` : ""}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {!initialRequest && salesOrderId && (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Materials from this Order&apos;s BOM</p>
          {orderPreviewError && <p className="text-xs text-red-600 dark:text-red-400">{orderPreviewError}</p>}
          {orderPreview && orderPreview.items.length === 0 && (
            <p className="text-xs text-zinc-500">This order has no style lines.</p>
          )}
          {orderPreview?.items.map((item) => (
            <div key={item.salesOrderItemId} className="space-y-1.5">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                {item.sampleStyleName ? `Design Name: ${item.sampleStyleName}` : item.styleName} · Ordered: {item.orderedQuantity}
              </p>
              {!item.hasApprovedBom && (
                <p className="text-xs text-zinc-500">No approved BOM or sample materials recorded for this style yet.</p>
              )}
              {item.materials.map((m) => {
                const key = `${item.salesOrderItemId}:${m.materialId}`;
                const sel = previewSelections[key] ?? { checked: true, qty: String(m.neededQuantity) };
                return (
                  <div key={key} className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={sel.checked}
                      onChange={(e) => setPreviewSelections((prev) => ({ ...prev, [key]: { ...sel, checked: e.target.checked } }))}
                    />
                    <span className="text-zinc-700 dark:text-zinc-200">
                      {m.materialName} — {item.orderedQuantity} × {m.quantityPerUnit} {m.uomCode} =
                    </span>
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={sel.qty}
                      onChange={(e) => setPreviewSelections((prev) => ({ ...prev, [key]: { ...sel, qty: e.target.value } }))}
                      className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                    />
                    <span className="text-zinc-500">{m.uomCode}</span>
                    {m.lineCost !== null && <span className="text-zinc-400">(~{m.lineCost})</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {orderPreview && orderPreview.grandTotalMaterialCost !== null && (
            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
              Estimated Total Material Cost: {orderPreview.grandTotalMaterialCost}
            </p>
          )}
          {orderPreview?.items.some((i) => i.materials.length > 0) && (
            <button
              type="button"
              onClick={addPreviewMaterialsToRequest}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Add Selected Items to Request
            </button>
          )}
        </div>
      )}

      {requestType === "DAMAGE_REPLACEMENT" && (
        <FormField label="Original Material Request" htmlFor="originalMaterialRequestId" required>
          <input
            id="originalMaterialRequestId"
            required
            placeholder="Search by request number…"
            value={originalRequestSearch}
            onChange={(e) => {
              setOriginalRequestSearch(e.target.value);
              setOriginalMaterialRequestId("");
              if (e.target.value.trim().length < 2) setOriginalRequestOptions([]);
            }}
            className={textInputClass()}
          />
          {originalRequestOptions.length > 0 && !originalMaterialRequestId && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-zinc-200 text-sm dark:border-zinc-800">
              {originalRequestOptions.map((opt) => (
                <li key={opt.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOriginalMaterialRequestId(opt.id);
                      setOriginalRequestSearch(opt.requestNumber);
                      setOriginalRequestOptions([]);
                    }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {opt.requestNumber}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Department" htmlFor="departmentId">
          <select id="departmentId" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Issue From (Warehouse)" htmlFor="warehouseId" required>
          <select
            id="warehouseId"
            required
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={textInputClass()}
          >
            <option value="">— Select —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Required Date" htmlFor="requiredDate">
          <input
            id="requiredDate"
            type="date"
            min={TODAY}
            value={requiredDate}
            onChange={(e) => setRequiredDate(e.target.value)}
            className={textInputClass()}
          />
        </FormField>
        <FormField label="Purpose / Reference" htmlFor="purpose">
          <input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={textInputClass()} />
        </FormField>
      </div>

      <FormField label="Remarks" htmlFor="remarks">
        <textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} rows={2} />
      </FormField>

      {initialRequest?.lockedLines && initialRequest.lockedLines.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Already Actioned Lines <span className="font-normal text-zinc-500">(cannot be edited)</span>
          </h2>
          {initialRequest.lockedLines.map((line, index) => (
            <div
              key={index}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-zinc-700 dark:text-zinc-200">
                {line.materialName}
                {line.colorName ? ` — ${line.colorName}` : ""} · {line.requestedQuantity} {line.uomCode} requested, {line.issuedQuantity}{" "}
                {line.uomCode} issued
              </span>
              <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                Locked — {line.lockedReason}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Line Items{initialRequest?.lockedLines && initialRequest.lockedLines.length > 0 ? " (editable)" : ""}
        </h2>
        {lines.map((line, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {/* Can remove down to zero editable lines when locked lines already
                  cover the "at least one line total" requirement — otherwise, same
                  as before, at least one editable line must remain. */}
              {(lines.length > 1 || (initialRequest?.lockedLines?.length ?? 0) > 0) && (
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
              <FormField label="Material" htmlFor={`material-${index}`} required>
                <MaterialPicker
                  id={`material-${index}`}
                  required
                  materials={materials}
                  value={line.materialId}
                  onChange={(materialId) => onMaterialChange(index, materialId)}
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

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Color (optional)" htmlFor={`color-${index}`}>
                <select
                  id={`color-${index}`}
                  value={line.colorId}
                  onChange={(e) => updateLine(index, { colorId: e.target.value })}
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
              {isVisible("FABRIC_DYE") && (
                <FormField label="Shade / Pantone (optional)" htmlFor={`dye-${index}`}>
                  <select
                    id={`dye-${index}`}
                    value={line.dyeId}
                    onChange={(e) => updateLine(index, { dyeId: e.target.value })}
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
              )}
            </div>

            <FormField label="Requested Quantity" htmlFor={`qty-${index}`} required>
              <input
                id={`qty-${index}`}
                type="number"
                min={0}
                step="0.0001"
                required
                value={line.requestedQuantity}
                onChange={(e) => updateLine(index, { requestedQuantity: e.target.value })}
                className={textInputClass()}
              />
            </FormField>

            {requestType === "DAMAGE_REPLACEMENT" && (
              <FormField label="Damage Reason" htmlFor={`damage-reason-${index}`} required>
                <input
                  id={`damage-reason-${index}`}
                  required
                  value={line.damageReason}
                  onChange={(e) => updateLine(index, { damageReason: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
            )}

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
        {isSubmitting ? "Saving…" : initialRequest ? "Save Changes" : "Create Material Request"}
      </button>
    </form>
  );
}

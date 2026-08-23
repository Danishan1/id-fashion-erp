"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";

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

const TODAY = new Date().toISOString().slice(0, 10);
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
}

export function MaterialRequestForm({ initialRequest }: { initialRequest?: InitialMaterialRequest } = {}) {
  const router = useRouter();
  const [requestType, setRequestType] = useState(initialRequest?.requestType ?? "PRODUCTION_REQUIREMENT");
  const [departmentId, setDepartmentId] = useState(initialRequest?.departmentId ?? "");
  const [warehouseId, setWarehouseId] = useState(initialRequest?.warehouseId ?? "");
  const [requiredDate, setRequiredDate] = useState(initialRequest?.requiredDate?.slice(0, 10) ?? "");
  const [purpose, setPurpose] = useState(initialRequest?.purpose ?? "");
  const [remarks, setRemarks] = useState(initialRequest?.remarks ?? "");

  // Pass-through, not directly editable here — set only by the BOM/MRP
  // "Generate Material Request" flow. Kept in state (not just re-read from
  // initialRequest at submit time) purely so a full-replace edit doesn't
  // silently null out traceability that flow already established.
  const [salesOrderId] = useState(initialRequest?.salesOrderId ?? "");
  const [bomId] = useState(initialRequest?.bomId ?? "");

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
  }, []);

  const updateLine = (index: number, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const onMaterialChange = (index: number, materialId: string) => {
    const material = materials.find((m) => m.id === materialId);
    updateLine(index, { materialId, uomId: material?.baseUom?.id ?? "" });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

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

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
        {lines.map((line, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {lines.length > 1 && (
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

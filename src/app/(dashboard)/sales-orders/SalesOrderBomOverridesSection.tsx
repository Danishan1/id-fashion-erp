"use client";

import { useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import { Modal } from "@/components/ui/Modal";

interface EffectiveBomMaterial {
  materialId: string;
  materialName: string;
  materialCode: string;
  colorId: string | null;
  colorName: string | null;
  dyeId: string | null;
  uomId: string;
  uomCode: string;
  quantityPerUnit: number;
  wastagePercentage: number;
}

interface OverrideRow {
  id: string;
  isActive: boolean;
  originalMaterial: { styleName: string; styleCode: string } | null;
  effectiveMaterial: { styleName: string; styleCode: string } | null;
  effectiveQuantityPerUnit: string | null;
  wastagePercentage: string | null;
  reason: string;
  remarks: string | null;
  changedBy: { fullName: string };
  changedAt: string;
  deactivatedBy: { fullName: string } | null;
}

const REASON_LABELS: Record<string, string> = {
  CUSTOMER_REQUIREMENT: "Customer requirement",
  BUYER_APPROVAL: "Buyer approval",
  SPECIFICATION_CHANGE: "Specification change",
  QUALITY_REQUIREMENT: "Quality requirement",
  OTHER: "Other",
};

/**
 * Sales Order BOM Override management (Phase 3/9 of the Effective BOM
 * work) — one section per Style Line, self-fetching on open. Every override
 * change here is deliberate customer/buyer-driven customization on top of
 * this line's own frozen BOM/Sample snapshot; it never touches the Style
 * Master BOM or the snapshot itself. "Revise / Refresh BOM" is the ONLY way
 * this line's snapshot moves onto a newer approved BomVersion/SampleVersion
 * — never a side effect of an ordinary order edit.
 */
export function SalesOrderBomOverridesSection({ salesOrderLineId }: { salesOrderLineId: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<OverrideRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPropose, setShowPropose] = useState(false);
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [units, setUnits] = useState<{ id: string; code: string }[]>([]);
  const [effectiveBom, setEffectiveBom] = useState<EffectiveBomMaterial[]>([]);
  const [effectiveBomLoaded, setEffectiveBomLoaded] = useState(false);

  // "" means "Add New Line" (no original material) — every other value is
  // the selected row's own index into effectiveBom, kept as a string index
  // rather than materialId since one material can legitimately appear on
  // the BOM more than once (once per color) and the two rows must stay
  // distinguishable.
  const [originalSelection, setOriginalSelection] = useState("");
  const [originalMaterialId, setOriginalMaterialId] = useState("");
  const [colorId, setColorId] = useState<string | null>(null);
  const [effectiveMaterialId, setEffectiveMaterialId] = useState("");
  const [effectiveQuantityPerUnit, setEffectiveQuantityPerUnit] = useState("");
  const [wastagePercentage, setWastagePercentage] = useState("");
  const [uomId, setUomId] = useState("");
  const [reason, setReason] = useState<keyof typeof REASON_LABELS>("CUSTOMER_REQUIREMENT");
  const [remarks, setRemarks] = useState("");

  const load = async () => {
    if (!salesOrderLineId) return;
    const res = await fetch(`/api/v1/sales-order-lines/${salesOrderLineId}/bom-overrides`);
    const body = await res.json();
    if (res.ok) setRows(body.data ?? []);
  };

  const toggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) await load();
  };

  const openPropose = async () => {
    if (!salesOrderLineId) return;
    setShowPropose(true);
    setOriginalSelection("");
    setOriginalMaterialId("");
    setColorId(null);
    setEffectiveMaterialId("");
    setEffectiveQuantityPerUnit("");
    setWastagePercentage("");
    setUomId("");
    setReason("CUSTOMER_REQUIREMENT");
    setRemarks("");
    setEffectiveBomLoaded(false);
    const [materialsRes, unitsRes, bomRes] = await Promise.all([
      fetch("/api/v1/materials?pageSize=200"),
      fetch("/api/v1/units"),
      fetch(`/api/v1/sales-order-lines/${salesOrderLineId}/effective-bom`),
    ]);
    setMaterials((await materialsRes.json()).data ?? []);
    setUnits((await unitsRes.json()).data ?? []);
    setEffectiveBom((await bomRes.json()).data ?? []);
    setEffectiveBomLoaded(true);
  };

  // Picking a real BOM/Sample line pre-fills everything from its own
  // current values (quantity, wastage, unit, color, and — as a sensible
  // starting point for the common "just adjust this material's own
  // quantity/wastage" case — the same material as the Effective Material
  // too, still freely changeable to swap it for a different one). Picking
  // "Add New Line" clears back to fully manual entry, matching the existing
  // add-a-brand-new-line behavior.
  const selectOriginal = (selection: string) => {
    setOriginalSelection(selection);
    if (selection === "") {
      setOriginalMaterialId("");
      setColorId(null);
      setEffectiveMaterialId("");
      setEffectiveQuantityPerUnit("");
      setWastagePercentage("");
      setUomId("");
      return;
    }
    const line = effectiveBom[Number(selection)];
    if (!line) return;
    setOriginalMaterialId(line.materialId);
    setColorId(line.colorId);
    setEffectiveMaterialId(line.materialId);
    setEffectiveQuantityPerUnit(String(line.quantityPerUnit));
    setWastagePercentage(String(line.wastagePercentage));
    setUomId(line.uomId);
  };

  const submitPropose = async () => {
    if (!salesOrderLineId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-order-lines/${salesOrderLineId}/bom-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalMaterialId: originalMaterialId || null,
        effectiveMaterialId: effectiveMaterialId || null,
        effectiveQuantityPerUnit: effectiveQuantityPerUnit ? Number(effectiveQuantityPerUnit) : null,
        wastagePercentage: wastagePercentage ? Number(wastagePercentage) : null,
        colorId: colorId || null,
        uomId: uomId || null,
        reason,
        remarks: remarks || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to propose this override.");
      return;
    }
    setShowPropose(false);
    await load();
  };

  const deactivate = async (id: string) => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-order-lines/bom-overrides/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to deactivate this override.");
      return;
    }
    await load();
  };

  const refreshBom = async () => {
    if (!salesOrderLineId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-order-lines/${salesOrderLineId}/refresh-bom`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to refresh this line's BOM snapshot.");
      return;
    }
  };

  if (!salesOrderLineId) return null;

  return (
    <div className="mt-3 rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between text-left text-xs font-semibold text-zinc-700 dark:text-zinc-200"
      >
        <span>BOM Overrides</span>
        <span className="font-normal text-indigo-600 dark:text-indigo-400">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2">
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={openPropose} className="text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">
              + Propose Override
            </button>
            <button
              type="button"
              onClick={refreshBom}
              disabled={busy}
              className="text-xs font-medium text-amber-700 hover:text-amber-600 disabled:opacity-50 dark:text-amber-400"
            >
              Revise / Refresh BOM
            </button>
          </div>
          {rows === null && <p className="text-xs text-zinc-500">Loading…</p>}
          {rows !== null && rows.length === 0 && <p className="text-xs text-zinc-500">No overrides on this line.</p>}
          {rows?.map((row) => (
            <div
              key={row.id}
              className={`rounded border p-2 text-xs ${row.isActive ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-100 opacity-50 dark:border-zinc-900"}`}
            >
              <p className="text-zinc-700 dark:text-zinc-200">
                {row.originalMaterial ? row.originalMaterial.styleName : "(new)"} <span className="text-zinc-400">→</span>{" "}
                {row.effectiveMaterial ? row.effectiveMaterial.styleName : "(removed)"}
                {row.effectiveQuantityPerUnit && ` · Qty/Unit: ${row.effectiveQuantityPerUnit}`}
                {row.wastagePercentage && ` · Wastage: ${row.wastagePercentage}%`}
              </p>
              <p className="mt-0.5 text-zinc-500">
                {REASON_LABELS[row.reason] ?? row.reason} · {row.changedBy.fullName} · {new Date(row.changedAt).toLocaleDateString()}
                {row.remarks && ` — ${row.remarks}`}
              </p>
              {!row.isActive && row.deactivatedBy && <p className="mt-0.5 text-zinc-400">Deactivated by {row.deactivatedBy.fullName}</p>}
              {row.isActive && (
                <button
                  type="button"
                  onClick={() => deactivate(row.id)}
                  disabled={busy}
                  className="mt-1 text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50 dark:text-red-400"
                >
                  Deactivate
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={showPropose} onClose={() => setShowPropose(false)} title="Propose BOM Override">
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Pick a material already on this line&apos;s BOM to replace or adjust it — Quantity/Wastage/Unit pre-fill from
            its current value automatically. Choose &quot;Add New Line&quot; for a material not on the BOM yet; leave
            &quot;Effective Material&quot; empty to remove the original line entirely.
          </p>
          <FormField label="Original Material" htmlFor="ovrOriginal">
            <select
              id="ovrOriginal"
              value={originalSelection}
              onChange={(e) => selectOriginal(e.target.value)}
              className={textInputClass()}
            >
              <option value="">— Add New Line (not currently on the BOM) —</option>
              {effectiveBom.map((line, idx) => (
                <option key={`${line.materialId}-${line.colorId ?? "any"}`} value={idx}>
                  {line.materialName} ({line.materialCode}){line.colorName ? ` — ${line.colorName}` : ""} · {line.quantityPerUnit}{" "}
                  {line.uomCode}
                  {line.wastagePercentage ? ` + ${line.wastagePercentage}% wastage` : ""}
                </option>
              ))}
            </select>
            {effectiveBomLoaded && effectiveBom.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                This line has no BOM materials yet — every override here will add a new line.
              </p>
            )}
          </FormField>
          <FormField label="Effective Material (optional)" htmlFor="ovrEffective">
            <MaterialPicker id="ovrEffective" materials={materials} value={effectiveMaterialId} onChange={setEffectiveMaterialId} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Quantity per Unit" htmlFor="ovrQty">
              <input
                id="ovrQty"
                type="number"
                min={0}
                step="0.0001"
                value={effectiveQuantityPerUnit}
                onChange={(e) => setEffectiveQuantityPerUnit(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Wastage %" htmlFor="ovrWastage">
              <input
                id="ovrWastage"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={wastagePercentage}
                onChange={(e) => setWastagePercentage(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <FormField label="Unit (required when adding/replacing)" htmlFor="ovrUom">
            <select id="ovrUom" value={uomId} onChange={(e) => setUomId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Reason" htmlFor="ovrReason" required>
            <select id="ovrReason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className={textInputClass()}>
              {Object.entries(REASON_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Remarks (optional)" htmlFor="ovrRemarks">
            <textarea id="ovrRemarks" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} className={textInputClass()} />
          </FormField>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPropose(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitPropose}
              disabled={busy || (!originalMaterialId && !effectiveMaterialId)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Propose"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

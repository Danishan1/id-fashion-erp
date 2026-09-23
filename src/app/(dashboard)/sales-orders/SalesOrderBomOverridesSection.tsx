"use client";

import { useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import { Modal } from "@/components/ui/Modal";

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

  const [originalMaterialId, setOriginalMaterialId] = useState("");
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
    setShowPropose(true);
    setOriginalMaterialId("");
    setEffectiveMaterialId("");
    setEffectiveQuantityPerUnit("");
    setWastagePercentage("");
    setUomId("");
    setReason("CUSTOMER_REQUIREMENT");
    setRemarks("");
    const [materialsRes, unitsRes] = await Promise.all([fetch("/api/v1/materials?pageSize=200"), fetch("/api/v1/units")]);
    setMaterials((await materialsRes.json()).data ?? []);
    setUnits((await unitsRes.json()).data ?? []);
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
            Leave &quot;Original Material&quot; empty to add a new line; leave &quot;Effective Material&quot; empty to
            remove the original line entirely; set both (same or different material) to replace or adjust quantity.
          </p>
          <FormField label="Original Material (optional)" htmlFor="ovrOriginal">
            <MaterialPicker id="ovrOriginal" materials={materials} value={originalMaterialId} onChange={setOriginalMaterialId} />
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

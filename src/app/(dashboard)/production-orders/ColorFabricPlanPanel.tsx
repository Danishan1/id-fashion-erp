"use client";

import { useEffect, useState } from "react";

export interface ColorFabricPlanRow {
  garmentColorId: string;
  garmentColorName: string;
  pieces: number;
  bomMaterialId: string;
  bomMaterialName: string;
  bomMaterialCode: string;
  perPieceQuantity: number;
  uomId: string;
  uomCode: string;
  suggestedQuantity: number;
  saved: {
    materialId: string;
    materialName: string;
    materialCode: string;
    fabricColorId: string | null;
    fabricColorName: string | null;
    quantity: number;
    uomId: string;
    uomCode: string;
  } | null;
  isComplete: boolean;
}

export interface ColorFabricPlan {
  applies: boolean;
  reason: string | null;
  rows: ColorFabricPlanRow[];
  isComplete: boolean;
  incompleteColors: string[];
}

interface MaterialOption {
  id: string;
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
  baseUom: { id: string; code: string } | null;
}

interface ColorOption {
  id: string;
  name: string;
  isActive?: boolean;
}

interface Draft {
  materialId: string;
  fabricColorId: string;
  quantity: string;
  uomId: string;
  uomCode: string;
}

const rowKey = (r: { garmentColorId: string; bomMaterialId: string }) => `${r.garmentColorId}:${r.bomMaterialId}`;

function draftsFromPlan(plan: ColorFabricPlan): Record<string, Draft> {
  return Object.fromEntries(
    plan.rows.map((r) => [
      rowKey(r),
      r.saved
        ? {
            materialId: r.saved.materialId,
            fabricColorId: r.saved.fabricColorId ?? "",
            quantity: String(r.saved.quantity),
            uomId: r.saved.uomId,
            uomCode: r.saved.uomCode,
          }
        : { materialId: r.bomMaterialId, fabricColorId: "", quantity: String(r.suggestedQuantity), uomId: r.uomId, uomCode: r.uomCode },
    ])
  );
}

/**
 * Colour-wise fabric (2026-10-21): for every garment colour on the Sales Order
 * line, which fabric to issue (defaults to the BOM's fabric), which fabric
 * colour, and how much. "Request Material" stays blocked until every row has
 * a fabric colour; the request's fabric lines come from here.
 */
export function ColorFabricPlanPanel({
  productionOrderId,
  canEdit,
  onPlanChange,
}: {
  productionOrderId: string;
  canEdit: boolean;
  onPlanChange?: (plan: ColorFabricPlan | null) => void;
}) {
  const [plan, setPlan] = useState<ColorFabricPlan | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fabrics, setFabrics] = useState<MaterialOption[]>([]);
  const [colors, setColors] = useState<ColorOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/production-orders/${productionOrderId}/color-fabrics`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load the colour-wise fabric plan.");
        return body.data as ColorFabricPlan;
      })
      .then((data) => {
        setPlan(data);
        setDrafts(draftsFromPlan(data));
        onPlanChange?.(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load the colour-wise fabric plan."));
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setFabrics(((body.data ?? []) as MaterialOption[]).filter((m) => m.materialCategory === "FABRIC")));
    fetch("/api/v1/colors")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setColors(((body.data ?? []) as ColorOption[]).filter((c) => c.isActive !== false)));
    // onPlanChange is a parent callback; reloading on its identity isn't wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionOrderId]);

  const updateDraft = (key: string, patch: Partial<Draft>) => {
    setSavedMessage(null);
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const onFabricChange = (key: string, materialId: string) => {
    const material = fabrics.find((m) => m.id === materialId);
    updateDraft(key, { materialId, ...(material?.baseUom ? { uomId: material.baseUom.id, uomCode: material.baseUom.code } : {}) });
  };

  const save = async () => {
    if (!plan) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/production-orders/${productionOrderId}/color-fabrics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-toast-success": "Colour-wise fabric saved." },
        body: JSON.stringify({
          rows: plan.rows.map((r) => {
            const d = drafts[rowKey(r)];
            return {
              garmentColorId: r.garmentColorId,
              bomMaterialId: r.bomMaterialId,
              materialId: d.materialId,
              fabricColorId: d.fabricColorId || null,
              quantity: Number(d.quantity),
              uomId: d.uomId,
            };
          }),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to save the colour-wise fabric plan.");
        return;
      }
      setPlan(body.data);
      setDrafts(draftsFromPlan(body.data));
      onPlanChange?.(body.data);
      setSavedMessage(body.data.isComplete ? "Saved — material can be requested." : "Saved. Pick a fabric colour for every row to request material.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (error && !plan) {
    return <p className="rounded-lg border border-red-200 p-4 text-sm text-red-600 dark:border-red-900 dark:text-red-400">{error}</p>;
  }
  if (!plan) return null;
  if (!plan.applies) return null;

  const fabricOptions = (row: ColorFabricPlanRow, selectedId: string) => {
    const list = [...fabrics];
    // Keep the BOM fabric and the current choice listed even if not tagged FABRIC/active.
    for (const id of [row.bomMaterialId, selectedId]) {
      if (id && !list.some((m) => m.id === id)) {
        const name = id === row.bomMaterialId ? row.bomMaterialName : row.saved?.materialName ?? id;
        list.unshift({ id, styleName: name, styleCode: id === row.bomMaterialId ? row.bomMaterialCode : row.saved?.materialCode ?? "", materialCategory: "FABRIC", baseUom: null });
      }
    }
    return list;
  };

  const draftsComplete = plan.rows.every((r) => {
    const d = drafts[rowKey(r)];
    return d && d.materialId && d.fabricColorId && Number(d.quantity) > 0;
  });

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Colour-wise Fabric</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            For each garment colour on the Sales Order, pick the fabric to issue (defaults to the BOM fabric), its colour, and
            how much. Request Material uses these and stays blocked until every colour has a fabric colour.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            plan.isComplete
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
          }`}
        >
          {plan.isComplete ? "Complete" : `Missing: ${plan.incompleteColors.join(", ")}`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1.5 pr-3 font-medium">Garment Colour</th>
              <th className="py-1.5 pr-3 text-right font-medium">Pieces</th>
              <th className="py-1.5 pr-3 font-medium">BOM Fabric</th>
              <th className="py-1.5 pr-3 font-medium">Fabric</th>
              <th className="py-1.5 pr-3 font-medium">Fabric Colour</th>
              <th className="py-1.5 font-medium">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {plan.rows.map((row) => {
              const key = rowKey(row);
              const d = drafts[key];
              if (!d) return null;
              return (
                <tr key={key}>
                  <td className="py-1.5 pr-3 font-medium text-zinc-900 dark:text-zinc-50">{row.garmentColorName}</td>
                  <td className="py-1.5 pr-3 text-right text-zinc-700 dark:text-zinc-300">{row.pieces}</td>
                  <td className="py-1.5 pr-3 text-xs text-zinc-500">
                    {row.bomMaterialName}
                    <div>
                      {row.perPieceQuantity} {row.uomCode}/pc · suggested {row.suggestedQuantity} {row.uomCode}
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      aria-label={`Fabric for ${row.garmentColorName}`}
                      value={d.materialId}
                      disabled={!canEdit}
                      onChange={(e) => onFabricChange(key, e.target.value)}
                      className="w-full min-w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {fabricOptions(row, d.materialId).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.styleName}
                          {m.id === row.bomMaterialId ? " (BOM)" : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      aria-label={`Fabric colour for ${row.garmentColorName}`}
                      value={d.fabricColorId}
                      disabled={!canEdit}
                      onChange={(e) => updateDraft(key, { fabricColorId: e.target.value })}
                      className={`w-full min-w-32 rounded-md border bg-white px-2 py-1 text-sm dark:bg-zinc-900 ${
                        d.fabricColorId ? "border-zinc-300 dark:border-zinc-700" : "border-amber-400 dark:border-amber-600"
                      }`}
                    >
                      <option value="">— Pick colour —</option>
                      {colors.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step="0.0001"
                        aria-label={`Quantity for ${row.garmentColorName}`}
                        value={d.quantity}
                        disabled={!canEdit}
                        onChange={(e) => updateDraft(key, { quantity: e.target.value })}
                        className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <span className="text-xs text-zinc-500">{d.uomCode}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {savedMessage && <p className="text-sm text-emerald-700 dark:text-emerald-400">{savedMessage}</p>}

      {canEdit && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Colour-wise Fabric"}
          </button>
          {!draftsComplete && <span className="text-xs text-amber-700 dark:text-amber-400">Pick a fabric colour for every row.</span>}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface RequirementRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  neededQuantity: number;
  availableQuantity: number;
  shortfallQuantity: number;
  unitCost: number | null;
  lineCost: number | null;
}

interface RequirementResult {
  hasApprovedBom: boolean;
  materials: RequirementRow[];
  totalMaterialCost: number | null;
  materialCostPerUnit: number | null;
}

function formatAmount(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Live material-requirement + estimated-material-cost preview, recalculated
 * from the BOM's own approved version every time productId/quantity changes
 * — the same calculation (getStyleMaterialRequirement) used both here and by
 * generateMaterialRequestForOrder, so a shortfall/cost figure a user sees
 * here can never disagree with what a later "Generate Material Request"
 * action actually raises. Debounced so typing a quantity doesn't fire one
 * request per keystroke.
 */
export function MaterialRequirementPreview({ productId, quantity }: { productId: string; quantity: number }) {
  const [result, setResult] = useState<RequirementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Derived, not a separate state variable — never set synchronously inside
  // the effect below (this project's own documented react-hooks/
  // set-state-in-effect fix pattern, same as ReportPage.tsx's own loading
  // derivation): true only while productId/quantity are valid and neither a
  // result nor an error has arrived yet.
  const isLoading = !!productId && quantity > 0 && result === null && error === null;

  useEffect(() => {
    if (!productId || !quantity || quantity <= 0) return;
    const timer = setTimeout(() => {
      fetch(`/api/v1/bom-mrp/style-requirement?productId=${productId}&quantity=${quantity}`)
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error?.message ?? "Failed to load material requirements.");
          }
          return res.json();
        })
        .then((body) => {
          setResult(body.data);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to load material requirements."));
    }, 400);
    return () => clearTimeout(timer);
  }, [productId, quantity]);

  if (!productId || !quantity || quantity <= 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Material Requirement &amp; Estimated Cost</h3>
      {isLoading && !result && <p className="text-sm text-zinc-500">Calculating…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {result && !result.hasApprovedBom && (
        <p className="text-sm text-zinc-500">This style has no approved BOM yet — material requirement and costing can&apos;t be calculated.</p>
      )}
      {result && result.hasApprovedBom && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-3 font-medium">Material</th>
                  <th className="py-1 pr-3 font-medium">Needed</th>
                  <th className="py-1 pr-3 font-medium">Available</th>
                  <th className="py-1 pr-3 font-medium">Shortfall</th>
                  <th className="py-1 pr-3 font-medium">Unit Cost</th>
                  <th className="py-1 font-medium">Line Cost</th>
                </tr>
              </thead>
              <tbody>
                {result.materials.map((m) => (
                  <tr key={m.materialId} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {m.materialName} ({m.materialCode})
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {m.neededQuantity} {m.uomCode}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {m.availableQuantity} {m.uomCode}
                    </td>
                    <td className={`py-2 pr-3 ${m.shortfallQuantity > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-zinc-700 dark:text-zinc-200"}`}>
                      {m.shortfallQuantity} {m.uomCode}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {m.unitCost !== null ? formatAmount(m.unitCost) : "—"}
                    </td>
                    <td className="py-2 text-zinc-700 dark:text-zinc-200">{m.lineCost !== null ? formatAmount(m.lineCost) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
            {result.totalMaterialCost !== null ? (
              <p className="font-medium text-zinc-900 dark:text-zinc-50">
                Estimated Material Cost: {formatAmount(result.totalMaterialCost)} ({formatAmount(result.materialCostPerUnit ?? 0)}/unit)
              </p>
            ) : (
              <p className="text-zinc-500">
                Estimated cost unavailable — one or more materials have no unit cost set, or no fixed unit conversion.
              </p>
            )}
            <p className="mt-1 text-xs text-zinc-400">
              Material cost only — labour and overhead are not included.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

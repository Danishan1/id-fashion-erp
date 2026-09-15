"use client";

import { useEffect, useState } from "react";

interface CostSheetLine {
  materialId: string;
  materialName: string;
  materialCode: string;
  colorId: string | null;
  colorName: string | null;
  quantityPerUnit: number;
  wastagePercentage: number;
  effectiveQuantity: number;
  uomCode: string;
  unitCost: number | null;
  lineCost: number | null;
  isCostAvailable: boolean;
}

interface ColorBreakdown {
  colorId: string | null;
  colorName: string;
  materialCostPerUnit: number;
  isComplete: boolean;
}

interface CostSheet {
  hasBom: boolean;
  lines: CostSheetLine[];
  colorBreakdown: ColorBreakdown[];
}

function formatMoney(value: number): string {
  return `₹${value.toFixed(2)}`;
}

export function BomCostSheetPanel({ productId }: { productId: string }) {
  const [sheet, setSheet] = useState<CostSheet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/bom-mrp/${productId}/cost-sheet`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load the cost sheet");
        setSheet(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the cost sheet");
      } finally {
        setIsLoading(false);
      }
    }, 0);
    return () => clearTimeout(timeout);
  }, [productId]);

  if (isLoading) return <p className="text-sm text-zinc-400">Loading…</p>;
  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!sheet) return null;

  if (!sheet.hasBom) {
    return <p className="text-sm text-zinc-400">This style has no BOM yet — add materials on the Edit BOM tab first.</p>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Material Cost</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Processing Cost, Labour Cost, and Overhead are not tracked anywhere in this ERP&apos;s schema yet — this sheet
          covers Material Cost only.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Material</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Color</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500">Qty / Piece</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500">Wastage %</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500">Effective Qty</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Unit</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500">Unit Cost</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-500">Line Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sheet.lines.map((line, i) => (
              <tr key={i}>
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
                  {line.materialName} <span className="text-xs text-zinc-400">({line.materialCode})</span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{line.colorName ?? "All Colors"}</td>
                <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{line.quantityPerUnit}</td>
                <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{line.wastagePercentage}%</td>
                <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{line.effectiveQuantity}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{line.uomCode}</td>
                <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                  {line.unitCost !== null ? formatMoney(line.unitCost) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                  {line.lineCost !== null ? formatMoney(line.lineCost) : "Not Available"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Material Cost per Unit</h2>
        <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Color</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-500">Material Cost / Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sheet.colorBreakdown.map((bucket) => (
                <tr key={bucket.colorId ?? "all"}>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{bucket.colorName}</td>
                  <td className="px-3 py-2 text-right font-semibold text-zinc-900 dark:text-zinc-100">
                    {bucket.isComplete ? formatMoney(bucket.materialCostPerUnit) : `${formatMoney(bucket.materialCostPerUnit)} (incomplete)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sheet.colorBreakdown.some((b) => !b.isComplete) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            One or more materials above have no unit cost configured, or their unit has no fixed conversion to the
            material&apos;s base unit — the marked total(s) are a known undercount, not the true cost.
          </p>
        )}
      </div>
    </div>
  );
}

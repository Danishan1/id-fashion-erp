"use client";

import { useEffect, useState } from "react";

interface ComparisonRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  plannedQuantity: number;
  issuedQuantity: number;
  isSubstitute: boolean;
}

/**
 * Production — Planned vs Issued material (Phase 8 of the Effective BOM/
 * Material Substitution work). Planned comes from this order's own real
 * Effective BOM (never the bare Style Master BOM once a Sales Order snapshot
 * or override exists); Issued comes from the real InventoryTransaction
 * ledger — never re-derived from the plan. A row with Planned "—" is a
 * material that was never part of the plan at all — a Material Substitution
 * issued in place of something else, per the spec's own worked example.
 * Always loaded and shown as soon as the page opens (not a click-to-reveal
 * panel) — the Hide/Show toggle only hides the already-fetched data, it
 * never re-fetches.
 */
export function MaterialPlannedVsIssuedPanel({ productionOrderId }: { productionOrderId: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Derived, not a separate state variable — never set synchronously inside
  // the effect below, matching MaterialRequirementPreview.tsx's own
  // established react-hooks/set-state-in-effect fix pattern.
  const isLoading = rows === null && error === null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/production-orders/${productionOrderId}/material-comparison`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? "Failed to load material comparison.");
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled) return;
        setRows(body.data ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load material comparison.");
      });
    return () => {
      cancelled = true;
    };
  }, [productionOrderId]);

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-zinc-900 dark:text-zinc-50"
      >
        <span>Planned vs Issued Material</span>
        <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && (
        <div className="mt-3">
          {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {!isLoading && !error && rows && rows.length === 0 && (
            <p className="text-sm text-zinc-500">Nothing planned or issued yet.</p>
          )}
          {!isLoading && !error && rows && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-1 pr-3 font-medium">Material</th>
                    <th className="py-1 pr-3 text-right font-medium">Planned</th>
                    <th className="py-1 pr-3 text-right font-medium">Issued</th>
                    <th className="py-1 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.materialId} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                        {row.materialName} <span className="text-xs text-zinc-400">({row.materialCode})</span>
                      </td>
                      <td className="py-2 pr-3 text-right text-zinc-700 dark:text-zinc-200">
                        {row.isSubstitute ? "—" : `${row.plannedQuantity} ${row.uomCode}`}
                      </td>
                      <td className="py-2 pr-3 text-right text-zinc-700 dark:text-zinc-200">
                        {row.issuedQuantity > 0 ? `${row.issuedQuantity} ${row.uomCode}` : "—"}
                      </td>
                      <td className="py-2 text-right">
                        {row.isSubstitute && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Substitute
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-zinc-400">
                Planned reflects this order&apos;s Effective BOM (the Style/Sample&apos;s own requirement, plus any
                Sales-Order-specific override) — it never changes just because a substitute material was issued.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

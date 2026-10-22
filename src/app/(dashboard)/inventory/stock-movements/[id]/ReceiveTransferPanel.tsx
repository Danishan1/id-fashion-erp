"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatCategoryLabel } from "@/lib/format-category-label";

interface ReceiveLine {
  id: string;
  materialName: string;
  quantity: number;
  uomCode: string;
  materialCategory: string | null;
}

interface LocationOption {
  id: string;
  code: string;
  materialCategory: string | null;
  isActive: boolean;
}

/** Pick a destination location for every line, then receive the in-transit transfer. */
export function ReceiveTransferPanel({
  movementId,
  toWarehouseId,
  toWarehouseName,
  lines,
  canReceive,
}: {
  movementId: string;
  toWarehouseId: string;
  toWarehouseName: string;
  lines: ReceiveLine[];
  canReceive: boolean;
}) {
  const router = useRouter();
  const [locations, setLocations] = useState<LocationOption[] | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/warehouses/${toWarehouseId}/locations`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setLocations((body.data ?? []).filter((l: LocationOption) => l.isActive)));
  }, [toWarehouseId]);

  const allPicked = lines.every((line) => !!selected[line.id]);

  const receive = async () => {
    if (!allPicked || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/stock-movements/${movementId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-toast-success": "Transfer received." },
        body: JSON.stringify({ items: lines.map((line) => ({ itemId: line.id, toWarehouseLocationId: selected[line.id] })) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Failed to receive this transfer.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Receive at {toWarehouseName}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          This transfer is in transit, so it isn&apos;t in either warehouse&apos;s stock yet. Pick where each material is put
          away; it is added to {toWarehouseName} when you receive it.
        </p>
      </div>

      {locations !== null && locations.length === 0 ? (
        <p className="text-sm text-red-700 dark:text-red-400">
          {toWarehouseName} has no active locations. Add one in Masters → Warehouses before receiving.
        </p>
      ) : (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500">
              <th className="py-1 pr-4 font-medium">Material</th>
              <th className="py-1 pr-4 font-medium">Quantity</th>
              <th className="py-1 font-medium">Put away at</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="py-1.5 pr-4 text-zinc-900 dark:text-zinc-50">{line.materialName}</td>
                <td className="py-1.5 pr-4 text-zinc-900 dark:text-zinc-50">
                  {line.quantity} {line.uomCode}
                </td>
                <td className="py-1.5">
                  <select
                    aria-label={`Destination location for ${line.materialName}`}
                    value={selected[line.id] ?? ""}
                    onChange={(e) => setSelected((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    disabled={!canReceive || locations === null}
                    className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">{locations === null ? "Loading…" : "— Pick a location —"}</option>
                    {locations?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                        {l.materialCategory ? ` (${formatCategoryLabel(l.materialCategory)})` : ""}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {canReceive ? (
        <button
          type="button"
          onClick={receive}
          disabled={!allPicked || isSubmitting}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isSubmitting ? "Receiving…" : allPicked ? "Receive Stock" : "Pick a location for every line"}
        </button>
      ) : (
        <p className="text-sm text-zinc-500">You don&apos;t have permission to receive stock.</p>
      )}
    </div>
  );
}

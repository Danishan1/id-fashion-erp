"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ReadyRow {
  productionOrderId: string;
  productionOrderNumber: string;
  salesOrderId: string | null;
  salesOrderNumber: string | null;
  salesOrderItemId: string | null;
  customerName: string | null;
  style: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  shippedQuantity: number;
  inProgressDispatchQuantity: number;
  pendingDispatchQuantity: number;
  jobWork: Array<{ id: string; jobWorkNumber: string; status: string; receivedQuantity: number; contractorName: string }>;
}

/** "For Dispatching" — production orders whose pieces are all finished (in-house or via job work) and not yet shipped. */
export function ReadyForDispatchPanel() {
  const [rows, setRows] = useState<ReadyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/dispatches/ready-for-dispatch")
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(body?.error?.message ?? "Could not load orders ready for dispatch.");
          return;
        }
        setRows(body.data ?? []);
      })
      .catch(() => setError("Could not load orders ready for dispatch."));
  }, []);

  return (
    <section className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          For Dispatching{rows && rows.length > 0 ? ` (${rows.length})` : ""}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Production orders whose pieces are fully finished — in-house or received back from job work.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!error && rows === null && <p className="text-sm text-zinc-500">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing waiting for dispatch right now.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-zinc-500 dark:text-zinc-400">
                <th className="py-2 pr-4">Production Order</th>
                <th className="py-2 pr-4">Sales Order</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Style</th>
                <th className="py-2 pr-4 text-right">Finished</th>
                <th className="py-2 pr-4 text-right">Dispatched</th>
                <th className="py-2 pr-4 text-right">Pending</th>
                <th className="py-2 pr-4">Job Work</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-100 dark:divide-emerald-500/10">
              {rows.map((row) => (
                <tr key={row.productionOrderId}>
                  <td className="py-2 pr-4">
                    <Link href={`/production-orders/${row.productionOrderId}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {row.productionOrderNumber}
                    </Link>
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                      For Dispatch
                    </span>
                  </td>
                  <td className="py-2 pr-4">{row.salesOrderNumber ?? <span className="text-zinc-400">Make-to-stock</span>}</td>
                  <td className="py-2 pr-4">{row.customerName ?? "—"}</td>
                  <td className="py-2 pr-4">{row.style}</td>
                  <td className="py-2 pr-4 text-right">{row.producedQuantity}</td>
                  <td className="py-2 pr-4 text-right">
                    {row.shippedQuantity}
                    {row.inProgressDispatchQuantity > 0 && (
                      <span className="block text-xs text-zinc-500">+{row.inProgressDispatchQuantity} in draft/packed</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold">{row.pendingDispatchQuantity}</td>
                  <td className="py-2 pr-4">
                    {row.jobWork.length === 0 ? (
                      <span className="text-zinc-400">In-house</span>
                    ) : (
                      row.jobWork.map((jw) => (
                        <Link key={jw.id} href={`/production/job-work/${jw.id}`} className="block text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                          {jw.jobWorkNumber} · {jw.contractorName} · Fully Received ({jw.receivedQuantity})
                        </Link>
                      ))
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {row.pendingDispatchQuantity <= 0 ? (
                      <span className="text-xs text-amber-700 dark:text-amber-400">On a dispatch — confirm it below</span>
                    ) : row.salesOrderId ? (
                      <Link
                        href={`/dispatch/new?salesOrderId=${row.salesOrderId}&salesOrderItemId=${row.salesOrderItemId}&quantity=${row.pendingDispatchQuantity}`}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                      >
                        Create Dispatch
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-400">No sales order</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

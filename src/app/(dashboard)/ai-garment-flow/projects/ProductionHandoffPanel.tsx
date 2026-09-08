"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface SalesOrderLink {
  id: string;
  orderNumber: string;
  status: string;
}

interface ProductionStatus {
  hasSalesOrder: boolean;
  hasProductionOrder: boolean;
}

export function ProductionHandoffPanel({
  projectId,
  productId,
  styleCode,
  salesOrder,
  setError,
  reloadProject,
}: {
  projectId: string;
  productId: string | null;
  styleCode: string | null;
  salesOrder: SalesOrderLink | null;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [orderNumber, setOrderNumber] = useState("");
  const [linking, setLinking] = useState(false);
  const [production, setProduction] = useState<ProductionStatus | undefined>(undefined);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [completing, setCompleting] = useState(false);

  async function loadProductionStatus() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/production-status`);
    const body = await res.json();
    if (res.ok) setProduction(body.data);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/production-status`)
      .then((res) => res.json())
      .then((body) => setProduction(body.data));
  }, [projectId]);

  async function linkOrder() {
    setError(null);
    setLinking(true);
    try {
      const searchRes = await fetch(`/api/v1/sales-orders?search=${encodeURIComponent(orderNumber.trim())}&pageSize=5`);
      const searchBody = await searchRes.json();
      if (!searchRes.ok) throw new Error(searchBody?.error?.message ?? "Failed to look up that Sales Order.");
      const match = (searchBody.data ?? []).find((o: { orderNumber: string }) => o.orderNumber === orderNumber.trim());
      if (!match) throw new Error(`No Sales Order found with number "${orderNumber.trim()}".`);

      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/link-sales-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOrderId: match.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to link this Sales Order.");
      setOrderNumber("");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLinking(false);
    }
  }

  async function markComplete() {
    setError(null);
    setCompleting(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/complete-workflow`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to mark this project complete.");
      setConfirmComplete(false);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {salesOrder ? (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-green-700 dark:text-green-300">
            Linked to Sales Order{" "}
            <Link href={`/sales-orders/${salesOrder.id}`} className="font-medium underline">
              {salesOrder.orderNumber}
            </Link>{" "}
            ({salesOrder.status})
          </p>
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Link a Sales Order</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Sales Order creation itself always happens through the real Sales Order form (unit prices, per-variant quantities, etc. — real
            commercial input this wizard can&apos;t default). Create the order there
            {productId ? (
              <>
                {" "}
                for <span className="font-medium">{styleCode}</span>
              </>
            ) : null}
            , then link it back below by its order number.
          </p>
          <Link
            href="/sales-orders/new"
            target="_blank"
            className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Create Sales Order (opens in a new tab)
          </Link>
          <FormField label="Order Number" htmlFor="link-order-number">
            <div className="flex gap-2">
              <input
                id="link-order-number"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="e.g. ORD-2026-00012"
                className={textInputClass()}
              />
              <button
                type="button"
                disabled={linking || !orderNumber.trim()}
                onClick={linkOrder}
                className="shrink-0 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {linking ? "Linking…" : "Link"}
              </button>
            </div>
          </FormField>
        </div>
      )}

      {salesOrder && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Production</h4>
          {production === undefined ? (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : production.hasProductionOrder ? (
            <p className="mt-1 text-sm text-green-700 dark:text-green-300">A real Production Order exists for this style.</p>
          ) : (
            <div className="mt-1 space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-400">No Production Order exists for this style yet.</p>
              <div className="flex gap-2">
                <Link
                  href="/production-orders/new"
                  target="_blank"
                  className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Create Production Order (opens in a new tab)
                </Link>
                <button
                  type="button"
                  onClick={loadProductionStatus}
                  className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={completing}
        onClick={() => setConfirmComplete(true)}
        className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      >
        Mark Project Complete
      </button>

      <ConfirmModal
        open={confirmComplete}
        title="Mark this project complete?"
        message="This requires a real Sales Order to already be linked and a real Production Order to already exist for this style. Once complete, the style continues forward entirely through the Production module's own workflow — this AI Garment Flow project's own wizard closes."
        confirmLabel="Mark Complete"
        isBusy={completing}
        onConfirm={markComplete}
        onCancel={() => setConfirmComplete(false)}
      />
    </div>
  );
}

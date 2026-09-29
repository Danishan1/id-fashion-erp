"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { todayIsoDate } from "@/lib/date";
import { formatDate } from "@/lib/date-format";
import { JOB_WORK_ORDER_STATUS_LABELS, JOB_WORK_ORDER_STATUS_BADGE_CLASS } from "../../../production-orders/statusLabels";

type JobWorkStatus = keyof typeof JOB_WORK_ORDER_STATUS_LABELS;

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  status: "COMPLETED" | "PARTIALLY_REVERSED" | "CANCELLED";
  remarks: string | null;
  receivedBy: { fullName: string };
}

interface MaterialRow {
  id: string;
  product: { styleName: string };
  quantity: string;
  uom: { code: string };
  notes: string | null;
}

interface JobWorkOrderDetail {
  id: string;
  jobWorkNumber: string;
  status: JobWorkStatus;
  issuedQuantity: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  issueDate: string;
  expectedCompletionDate: string | null;
  remarks: string | null;
  uom: { code: string };
  materials: MaterialRow[];
  receipts: ReceiptRow[];
  metrics: { pendingQuantity: number; daysElapsed: number; isOverdue: boolean };
  // Multi-stage job work + frozen cost sheet (2026-09-28). Optional so an
  // older payload shape never crashes the page.
  coveredStages?: {
    id: string;
    sequence: number;
    quantity: string;
    defaultRate: string | null;
    defaultSource: "STYLE_DEFAULT" | "DESIGN_OVERRIDE" | "NOT_CONFIGURED";
    rate: string;
    isOverridden: boolean;
    amount: string;
    productionStage: { id: string; name: string; isFinal: boolean };
  }[];
  extraCharges?: { id: string; costType: string; description: string | null; amount: string }[];
  stageCostTotal?: string;
  extraCostTotal?: string;
  totalCost?: string;
  finishedGoodsWarehouse?: { id: string; name: string } | null;
  contractor?: { id: string; name: string };
  jobOrder: {
    id: string;
    jobNumber: string;
    productionStage: { id: string; name: string };
    lot: {
      id: string;
      lotNumber: string;
      productionOrder: { id: string; orderNumber: string; salesOrderItem: { salesOrder: { orderNumber: string } } | null };
    };
  };
  // Sent from → received at → next stage (2026-09-29), derived from the ledger.
  stageTracking?: {
    sentFromStage: { id: string; name: string };
    receivedAtStage: { id: string; name: string };
    nextStage: { id: string; name: string; isFinal: boolean } | null;
    receivingJobOrder: { id: string; jobNumber: string; completedQuantity: number; forwardedQuantity: number } | null;
    availableForNextStage: number;
    finishedAtReceipt: boolean;
  };
}

const COST_SOURCE_LABELS = {
  STYLE_DEFAULT: "Style default",
  DESIGN_OVERRIDE: "Design cost",
  NOT_CONFIGURED: "Not configured",
} as const;

function money(v: string | number | null | undefined) {
  return `₹${Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function JobWorkOrderWorkflowPanel({ jobWorkOrderId, initialOrder }: { jobWorkOrderId: string; initialOrder: JobWorkOrderDetail }) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [showReceive, setShowReceive] = useState(false);
  // Regenerated each time the Receive modal opens (not once for this
  // long-lived panel's whole lifetime) — this panel handles many distinct
  // receive actions over a job-work order's life, and each one is its own
  // physical event needing its own key. See CF-5 in the independent
  // hardening audit.
  const [receiveIdempotencyKey, setReceiveIdempotencyKey] = useState(() => crypto.randomUUID());
  const [receivedDate, setReceivedDate] = useState(todayIsoDate());
  const [receivedQty, setReceivedQty] = useState(String(order.metrics.pendingQuantity));
  const [rejectedQty, setRejectedQty] = useState("0");
  const [damagedQty, setDamagedQty] = useState("0");
  const [receiveRemarks, setReceiveRemarks] = useState("");

  const [reverseTarget, setReverseTarget] = useState<ReceiptRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const [confirmCancel, setConfirmCancel] = useState(false);

  const [showForward, setShowForward] = useState(false);
  const [forwardQty, setForwardQty] = useState("");
  const [forwardFgWarehouseId, setForwardFgWarehouseId] = useState("");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const tracking = order.stageTracking;
  const nextIsFinal = !!tracking?.nextStage?.isFinal;

  useEffect(() => {
    if (!showForward || !nextIsFinal) return;
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []))
      .catch(() => {});
  }, [showForward, nextIsFinal]);

  const submitForward = async () => {
    if (!tracking?.receivingJobOrder) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-orders/${tracking.receivingJobOrder!.id}/forward`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toast-success": "Moved to the next stage." },
          body: JSON.stringify({
            quantity: Number(forwardQty),
            targetStageId: tracking.nextStage?.id,
            finishedGoodsWarehouseId: nextIsFinal ? forwardFgWarehouseId : undefined,
          }),
        }),
      "Failed to move these pieces to the next stage."
    );
    if (ok) setShowForward(false);
  };

  const refresh = async () => {
    const res = await fetch(`/api/v1/job-work-orders/${jobWorkOrderId}`);
    const body = await res.json();
    if (res.ok) setOrder(body.data);
  };

  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(await parseErrorMessage(res, fallbackError));
        return false;
      }
      await refresh();
      return true;
    } catch {
      // A genuine network failure (not a server-returned error) — without
      // this, isBusy would stay stuck true forever with no way to retry,
      // which would make the receive flow's idempotency key useless in
      // exactly the scenario it exists for.
      setError("Could not reach the server. Check your connection and try again — it's safe to resubmit.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const submitReceive = async () => {
    const ok = await run(
      () =>
        fetch(`/api/v1/job-work-orders/${jobWorkOrderId}/receive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            receivedDate,
            receivedQuantity: Number(receivedQty),
            rejectedQuantity: Number(rejectedQty),
            damagedQuantity: Number(damagedQty),
            remarks: receiveRemarks || undefined,
            idempotencyKey: receiveIdempotencyKey,
          }),
        }),
      "Failed to record this receipt."
    );
    if (ok) {
      setShowReceive(false);
      setRejectedQty("0");
      setDamagedQty("0");
      setReceiveRemarks("");
      // A new key for the NEXT distinct receive action — the one that just
      // succeeded keeps its key retired, so a stray retry of it later can
      // never accidentally collide with a genuinely new receipt.
      setReceiveIdempotencyKey(crypto.randomUUID());
    }
  };

  const submitReverse = async () => {
    if (!reverseTarget) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/job-work-orders/receipts/${reverseTarget.id}/reverse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reverseReason }),
        }),
      "Failed to reverse this receipt."
    );
    if (ok) {
      setReverseTarget(null);
      setReverseReason("");
    }
  };

  const hold = () => run(() => fetch(`/api/v1/job-work-orders/${jobWorkOrderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ON_HOLD" }) }), "Failed to hold this job-work order.");
  const resume = () => run(() => fetch(`/api/v1/job-work-orders/${jobWorkOrderId}/resume`, { method: "POST" }), "Failed to resume this job-work order.");
  const confirmCancelAction = async () => {
    const ok = await run(() => fetch(`/api/v1/job-work-orders/${jobWorkOrderId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }) }), "Failed to cancel this job-work order.");
    if (ok) setConfirmCancel(false);
  };

  const canReceive = order.status === "ISSUED" || order.status === "PARTIALLY_RECEIVED";
  const canHold = canReceive;
  const canCancel = order.status !== "CANCELLED" && order.status !== "CLOSED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${JOB_WORK_ORDER_STATUS_BADGE_CLASS[order.status]}`}>
          {JOB_WORK_ORDER_STATUS_LABELS[order.status]}
        </span>
        {order.metrics.isOverdue && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            Overdue
          </span>
        )}
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-4">
        <div>
          <div className="text-xs text-zinc-500">Issued</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.issuedQuantity} {order.uom.code}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Received</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.receivedQuantity}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Rejected</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.rejectedQuantity}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Damaged</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.damagedQuantity}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Pending</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.metrics.pendingQuantity}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Days Elapsed</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{order.metrics.daysElapsed}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Issue Date</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">{formatDate(order.issueDate)}</div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Expected Completion</div>
          <div className="font-medium text-zinc-900 dark:text-zinc-50">
            {order.expectedCompletionDate ? formatDate(order.expectedCompletionDate) : "—"}
          </div>
        </div>
      </div>

      {tracking && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 text-sm dark:border-indigo-900 dark:bg-indigo-950/30">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Production Stage Tracking</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <div className="text-xs text-zinc-500">Production Order / Lot</div>
              <div className="font-medium">
                <Link href={`/production-orders/${order.jobOrder.lot.productionOrder.id}/lots/${order.jobOrder.lot.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {order.jobOrder.lot.lotNumber}
                </Link>
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Sale Order</div>
              <div className="font-medium">{order.jobOrder.lot.productionOrder.salesOrderItem?.salesOrder.orderNumber ?? "— (Make-to-Stock)"}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Sent From Stage</div>
              <div className="font-medium">{tracking.sentFromStage.name}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Received At Stage</div>
              <div className="font-medium">{tracking.receivedAtStage.name}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Next Stage</div>
              <div className="font-medium">
                {tracking.finishedAtReceipt ? "— (finished goods)" : tracking.nextStage?.name ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Available for Next Stage</div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                {tracking.availableForNextStage} {order.uom.code}
              </div>
            </div>
            {tracking.receivingJobOrder && (
              <div>
                <div className="text-xs text-zinc-500">Received Into Job Order</div>
                <div className="font-medium">{tracking.receivingJobOrder.jobNumber}</div>
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            {order.jobOrder.productionStage.name} → Job Work ({order.contractor?.name ?? "contractor"}) → Received at {tracking.receivedAtStage.name}
            {tracking.nextStage && !tracking.finishedAtReceipt ? ` → next: ${tracking.nextStage.name}` : ""}. Available counts every completed
            piece at {tracking.receivedAtStage.name} on this lot that hasn&apos;t moved on yet.
          </p>
          {tracking.nextStage && !tracking.finishedAtReceipt && tracking.availableForNextStage > 0 && tracking.receivingJobOrder && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setForwardQty(String(tracking.availableForNextStage));
                setShowForward(true);
              }}
              className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Move to {tracking.nextStage.name}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {canReceive && (
          <button
            type="button"
            onClick={() => {
              setReceivedQty(String(order.metrics.pendingQuantity));
              setShowReceive(true);
            }}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Receive
          </button>
        )}
        {canHold && (
          <button type="button" onClick={hold} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Hold
          </button>
        )}
        {order.status === "ON_HOLD" && (
          <button type="button" onClick={resume} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
            Resume
          </button>
        )}
        {canCancel && (
          <button type="button" onClick={() => setConfirmCancel(true)} className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-500/10">
            Cancel
          </button>
        )}
      </div>

      {order.coveredStages && order.coveredStages.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Stages &amp; Job Work Cost</h2>
          <p className="mb-2 text-xs text-zinc-500">
            {order.coveredStages.map((s) => s.productionStage.name).join(" → ")}
            {order.coveredStages.length > 1 && " — received pieces move through every stage automatically."}
            {order.finishedGoodsWarehouse && <> Finished goods land in {order.finishedGoodsWarehouse.name}.</>} Costs are frozen at
            issue and don&apos;t change if the Style/Design cost is edited later.
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Stage</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Cost Source</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-500">Rate / pc</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-500">Qty</th>
                  <th className="px-4 py-2 text-right font-medium text-zinc-500">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {order.coveredStages.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">{s.productionStage.name}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {COST_SOURCE_LABELS[s.defaultSource]}
                      {s.defaultRate !== null && <> (₹{Number(s.defaultRate)})</>}
                      {s.isOverridden && <span className="ml-1 text-amber-600">· overridden for this job work</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-800 dark:text-zinc-200">₹{Number(s.rate)}</td>
                    <td className="px-4 py-2 text-right text-zinc-800 dark:text-zinc-200">{Number(s.quantity)}</td>
                    <td className="px-4 py-2 text-right text-zinc-800 dark:text-zinc-200">{money(s.amount)}</td>
                  </tr>
                ))}
                {(order.extraCharges ?? []).map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200" colSpan={4}>
                      Extra: {x.costType}
                      {x.description && <span className="text-zinc-500"> — {x.description}</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-800 dark:text-zinc-200">{money(x.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-zinc-50 text-sm dark:bg-zinc-900">
                <tr>
                  <td className="px-4 py-1.5 text-zinc-500" colSpan={4}>Stage-wise Job Work Cost</td>
                  <td className="px-4 py-1.5 text-right font-medium">{money(order.stageCostTotal)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-1.5 text-zinc-500" colSpan={4}>Extra Cost</td>
                  <td className="px-4 py-1.5 text-right font-medium">{money(order.extraCostTotal)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-1.5 font-semibold text-zinc-800 dark:text-zinc-100" colSpan={4}>Total Job Work Cost</td>
                  <td className="px-4 py-1.5 text-right font-semibold">{money(order.totalCost)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {order.materials.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Materials Issued</h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Material</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Quantity</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {order.materials.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{m.product.styleName}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{m.quantity} {m.uom.code}</td>
                    <td className="px-4 py-2 text-zinc-500">{m.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Receipt History</h2>
        {order.receipts.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing received back yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Receipt #</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Date</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Received</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Rejected</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Damaged</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Status</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {order.receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{r.receiptNumber}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{formatDate(r.receivedDate)}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{r.receivedQuantity}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{r.rejectedQuantity}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{r.damagedQuantity}</td>
                    <td className="px-4 py-2 text-zinc-500">{r.status}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <a
                          href={`/api/v1/job-work-orders/${order.id}/receipts/${r.id}/slip`}
                          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Slip
                        </a>
                        {r.status === "COMPLETED" && (
                          <button type="button" onClick={() => setReverseTarget(r)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                            Reverse
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showReceive} onClose={() => setShowReceive(false)} title="Receive Job-Work">
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">Pending on this job-work order: {order.metrics.pendingQuantity} {order.uom.code}</p>
          <FormField label="Received Date" htmlFor="receivedDate" required>
            <input id="receivedDate" type="date" required value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Received" htmlFor="receivedQty">
              <input id="receivedQty" type="number" min={0} step="0.0001" value={receivedQty} onChange={(e) => setReceivedQty(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Rejected" htmlFor="rejectedQty">
              <input id="rejectedQty" type="number" min={0} step="0.0001" value={rejectedQty} onChange={(e) => setRejectedQty(e.target.value)} className={textInputClass()} />
            </FormField>
            <FormField label="Damaged" htmlFor="damagedQty">
              <input id="damagedQty" type="number" min={0} step="0.0001" value={damagedQty} onChange={(e) => setDamagedQty(e.target.value)} className={textInputClass()} />
            </FormField>
          </div>
          <FormField label="Remarks" htmlFor="receiveRemarks">
            <input id="receiveRemarks" value={receiveRemarks} onChange={(e) => setReceiveRemarks(e.target.value)} className={textInputClass()} />
          </FormField>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowReceive(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button type="button" onClick={submitReceive} disabled={isBusy} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              {isBusy ? "Saving…" : "Record Receipt"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!reverseTarget} onClose={() => setReverseTarget(null)} title="Reverse Receipt">
        {reverseTarget && (
          <div className="space-y-4">
            <FormField label="Reason" htmlFor="reverseReason" required>
              <input id="reverseReason" required value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className={textInputClass()} />
            </FormField>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReverseTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button type="button" onClick={submitReverse} disabled={isBusy || !reverseReason} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60">
                {isBusy ? "Saving…" : "Reverse"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirmCancel}
        title="Cancel this job-work order?"
        message="This cannot be undone. Cancellation is blocked once any receipt has been recorded."
        confirmLabel="Cancel Job-Work Order"
        isDangerous
        onConfirm={confirmCancelAction}
        onCancel={() => setConfirmCancel(false)}
      />
      <Modal open={showForward} onClose={() => setShowForward(false)} title={`Move to ${tracking?.nextStage?.name ?? "next stage"}`}>
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Moves received pieces from {tracking?.receivedAtStage.name} ({tracking?.receivingJobOrder?.jobNumber}) to {tracking?.nextStage?.name}.
            Available: <strong>{tracking?.availableForNextStage}</strong> {order.uom.code}.
          </p>
          <FormField label="Quantity" htmlFor="forwardQty" required>
            <input
              id="forwardQty"
              type="number"
              min={1}
              max={tracking?.availableForNextStage}
              step={1}
              value={forwardQty}
              onChange={(e) => setForwardQty(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          {Number(forwardQty) > (tracking?.availableForNextStage ?? 0) && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Cannot move more than the {tracking?.availableForNextStage} pieces available at {tracking?.receivedAtStage.name}.
            </p>
          )}
          {nextIsFinal && (
            <FormField label="Finished Goods Warehouse" htmlFor="forwardFgWarehouseId" required>
              <select id="forwardFgWarehouseId" value={forwardFgWarehouseId} onChange={(e) => setForwardFgWarehouseId(e.target.value)} className={textInputClass()}>
                <option value="">— Select —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForward(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitForward}
              disabled={
                isBusy ||
                !forwardQty ||
                Number(forwardQty) <= 0 ||
                Number(forwardQty) > (tracking?.availableForNextStage ?? 0) ||
                (nextIsFinal && !forwardFgWarehouseId)
              }
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isBusy ? "Saving…" : "Move"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

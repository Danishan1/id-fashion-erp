"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { MaterialPlannedVsIssuedPanel } from "./MaterialPlannedVsIssuedPanel";
import { MaterialRequirementPreview } from "./MaterialRequirementPreview";
import {
  LotMaterialReadinessPanel,
  WorkerAssignmentRowsEditor,
  newWorkerRow,
  validateWorkerRows,
  workerRowsToPayload,
  type LotMaterialReadiness,
  type WorkerRowDraft,
} from "./LotStartFields";
import { StageTimelinePanel } from "./StageTimelinePanel";
import {
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
  LOT_STATUS_LABELS,
  PROGRESS_STATUS_BADGE_CLASS,
  PROGRESS_STATUS_LABELS,
} from "./statusLabels";

type ProductionOrderStatus = keyof typeof STATUS_LABELS;
type LotStatus = keyof typeof LOT_STATUS_LABELS;
type ProgressStatus = keyof typeof PROGRESS_STATUS_LABELS;

interface LotRow {
  id: string;
  lotNumber: string;
  quantity: string;
  status: LotStatus;
  uom: { id: string; code: string };
  currentStage: { id: string; name: string } | null;
}

interface SalesOrderContext {
  orderedTotal: number;
  otherCommitted: number;
  remaining: number;
}

interface LotProgressRow {
  lotId: string;
  lotNumber: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  status: string;
}

interface ProductionProgress {
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  balanceQuantity: number;
  overProductionQuantity: number;
  progressPercent: number;
  progressStatus: ProgressStatus;
  lots: LotProgressRow[];
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: ProductionOrderStatus;
  statusBeforeHold: ProductionOrderStatus | null;
  plannedQuantity: string;
  productId: string;
  salesOrderItemId: string | null;
  salesOrderContext: SalesOrderContext | null;
  progress: ProductionProgress;
  lots: LotRow[];
  quantityChanges?: Array<{
    id: string;
    previousQuantity: string;
    addedQuantity: string;
    newQuantity: string;
    reason: string | null;
    createdAt: string;
    createdBy: { fullName: string };
  }>;
}

interface UnitOption {
  id: string;
  code: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface VariantBreakdownSuggestionRow {
  productVariantId: string;
  colorName: string;
  sizeName: string;
  skuCode: string;
  orderedQuantity: number | null;
  alreadyInLots: number;
  remaining: number | null;
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

const STATUS_HELP: Record<ProductionOrderStatus, string> = {
  PLANNED: "Not yet started — generate a material request, then add lots to begin production.",
  MATERIAL_ALLOCATED: "Materials are being organized. Add lots to begin production.",
  IN_PROGRESS: "Production is underway. Track each lot's own progress below.",
  ON_HOLD: "Paused. Resume to go back to exactly where this was.",
  CANCELLED: "This production order was cancelled.",
  CLOSED: "Every lot is complete. This order is closed.",
};

export function ProductionOrderWorkflowPanel({
  productionOrderId,
  initialOrder,
  openExtraOnLoad = false,
}: {
  productionOrderId: string;
  initialOrder: OrderDetail;
  /** Opened from the "Sale Order already has a production order → YES" prompt. */
  openExtraOnLoad?: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | { title: string; message: string; onConfirm: () => Promise<void> }>(null);

  const [showAddLot, setShowAddLot] = useState(false);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [lotQuantity, setLotQuantity] = useState("");
  const [lotUomId, setLotUomId] = useState("");
  const [variantSuggestions, setVariantSuggestions] = useState<VariantBreakdownSuggestionRow[]>([]);
  const [variantQtyById, setVariantQtyById] = useState<Record<string, string>>({});
  const [lotWorkers, setLotWorkers] = useState<WorkerRowDraft[]>(() => [newWorkerRow()]);
  const [lotReadiness, setLotReadiness] = useState<LotMaterialReadiness | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const [showExtra, setShowExtra] = useState(openExtraOnLoad);
  const [extraQty, setExtraQty] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [timelineKey, setTimelineKey] = useState(0);

  const [showGenerateMr, setShowGenerateMr] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [mrWarehouseId, setMrWarehouseId] = useState("");
  const [mrResult, setMrResult] = useState<string | null>(null);

  const [splitLotTarget, setSplitLotTarget] = useState<LotRow | null>(null);
  const [splitChildren, setSplitChildren] = useState<string[]>(["", ""]);

  const [selectedLotIds, setSelectedLotIds] = useState<Set<string>>(new Set());

  const [showEditQuantity, setShowEditQuantity] = useState(false);
  const [editQuantity, setEditQuantity] = useState("");

  useEffect(() => {
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/warehouses?pageSize=200")
      .then((res) => res.json())
      .then((body) => setWarehouses(body.data ?? []));
  }, []);

  // Fetches the size/color picker's own suggested quantities fresh every
  // time the Add Lot modal opens — never trusted stale from a prior open,
  // since sibling lots' own already-claimed quantities can have changed.
  useEffect(() => {
    if (!showAddLot) return;
    fetch(`/api/v1/production-orders/${productionOrderId}/variant-breakdown-suggestions`)
      .then((res) => res.json())
      .then((body) => {
        const rows: VariantBreakdownSuggestionRow[] = body.data ?? [];
        setVariantSuggestions(rows);
        const initial: Record<string, string> = {};
        for (const r of rows) {
          if (r.remaining !== null && r.remaining > 0) initial[r.productVariantId] = String(r.remaining);
        }
        setVariantQtyById(initial);
      });
  }, [showAddLot, productionOrderId]);

  const breakdownTotal = Object.values(variantQtyById).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const hasVariantOptions = variantSuggestions.length > 0;

  const refresh = async () => {
    const res = await fetch(`/api/v1/production-orders/${productionOrderId}`);
    const body = await res.json();
    if (res.ok) setOrder(body.data);
    setTimelineKey((k) => k + 1);
  };

  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    const res = await action();
    if (!res.ok) {
      setError(await parseErrorMessage(res, fallbackError));
      setIsBusy(false);
      return false;
    }
    await refresh();
    setIsBusy(false);
    return true;
  };

  const transitionTo = (status: "ON_HOLD" | "CANCELLED" | "CLOSED") =>
    run(
      () =>
        fetch(`/api/v1/production-orders/${productionOrderId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      "Failed to change status."
    );

  const resumeFromHold = () =>
    run(() => fetch(`/api/v1/production-orders/${productionOrderId}/resume`, { method: "POST" }), "Failed to resume.");

  const addLotQuantity = hasVariantOptions ? breakdownTotal : Number(lotQuantity) || 0;
  const lotWorkerError = validateWorkerRows(lotWorkers, addLotQuantity);

  const openAddLot = () => {
    setModalError(null);
    setLotWorkers([newWorkerRow()]);
    setLotReadiness(null);
    setShowAddLot(true);
  };

  // Errors from a modal action show inside that modal, not behind it.
  const runInModal = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setModalError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setModalError(await parseErrorMessage(res, fallbackError));
        return false;
      }
      await refresh();
      return true;
    } catch {
      setModalError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const submitExtra = async () => {
    const ok = await runInModal(
      () =>
        fetch(`/api/v1/production-orders/${productionOrderId}/extra-quantity`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toast-success": "Extra production quantity added." },
          body: JSON.stringify({ extraQuantity: Number(extraQty), reason: extraReason || undefined }),
        }),
      "Failed to add extra quantity."
    );
    if (ok) {
      setShowExtra(false);
      setExtraQty("");
      setExtraReason("");
    }
  };

  const submitAddLot = async () => {
    const quantity = addLotQuantity;
    const variantBreakdown = hasVariantOptions
      ? Object.entries(variantQtyById)
          .filter(([, v]) => Number(v) > 0)
          .map(([productVariantId, v]) => ({ productVariantId, quantity: Number(v) }))
      : undefined;
    const ok = await runInModal(
      () =>
        fetch(`/api/v1/production-orders/${productionOrderId}/lots`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-toast-success": "Lot created and started at the first stage." },
          body: JSON.stringify({
            quantity,
            uomId: lotUomId,
            cuttingAssignments: workerRowsToPayload(lotWorkers),
            ...(variantBreakdown ? { variantBreakdown } : {}),
          }),
        }),
      "Failed to create this lot."
    );
    if (ok) {
      setShowAddLot(false);
      setLotWorkers([newWorkerRow()]);
      setLotQuantity("");
      setLotUomId("");
      setVariantSuggestions([]);
      setVariantQtyById({});
    }
  };

  const submitGenerateMr = async () => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/production-orders/${productionOrderId}/material-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ warehouseId: mrWarehouseId }),
    });
    setIsBusy(false);
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to generate a material request."));
      return;
    }
    const { data } = await res.json();
    setMrResult(data.requestNumber);
  };

  const submitEditQuantity = async () => {
    const ok = await run(
      () =>
        fetch(`/api/v1/production-orders/${productionOrderId}/quantity`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plannedQuantity: Number(editQuantity) }),
        }),
      "Failed to update quantity."
    );
    if (ok) setShowEditQuantity(false);
  };

  const submitSplit = async () => {
    if (!splitLotTarget) return;
    const children = splitChildren.filter((q) => q).map((q) => ({ quantity: Number(q) }));
    const ok = await run(
      () =>
        fetch(`/api/v1/lots/${splitLotTarget.id}/split`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ children }),
        }),
      "Failed to split this lot."
    );
    if (ok) {
      setSplitLotTarget(null);
      setSplitChildren(["", ""]);
    }
  };

  const toggleLotSelected = (id: string) => {
    setSelectedLotIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mergeSelected = async () => {
    const ok = await run(
      () =>
        fetch("/api/v1/lots/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentLotIds: [...selectedLotIds] }),
        }),
      "Failed to merge these lots."
    );
    if (ok) setSelectedLotIds(new Set());
  };

  const canAct = order.status !== "CANCELLED" && order.status !== "CLOSED";
  const allLotsDone = order.lots.length > 0 && order.lots.every((l) => l.status === "COMPLETED" || l.status === "CANCELLED");
  // Quantity is only ever editable before any real production activity —
  // once a Lot exists, everything derived from the original plannedQuantity
  // (Material Requests, JobOrders) would silently go stale against a later
  // change, same guard the server enforces (see updateProductionOrderQuantity).
  const canEditQuantity = canAct && order.lots.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[order.status]}`}>
          {STATUS_LABELS[order.status]}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${PROGRESS_STATUS_BADGE_CLASS[order.progress.progressStatus]}`}>
          {PROGRESS_STATUS_LABELS[order.progress.progressStatus]}
        </span>
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {order.status === "ON_HOLD" && order.statusBeforeHold
          ? `On hold from ${STATUS_LABELS[order.statusBeforeHold]}.`
          : STATUS_HELP[order.status]}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Production Summary</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {order.salesOrderContext && (
            <SummaryStat label="Sales Order Qty" value={order.salesOrderContext.orderedTotal} />
          )}
          <SummaryStat label="Planned Production Qty" value={order.progress.plannedQuantity} />
          <SummaryStat label="Produced Qty" value={order.progress.producedQuantity} tone="positive" />
          <SummaryStat label="Rejected Qty" value={order.progress.rejectedQuantity} tone={order.progress.rejectedQuantity > 0 ? "negative" : undefined} />
          <SummaryStat label="Balance Qty" value={order.progress.balanceQuantity} />
          {order.progress.overProductionQuantity > 0 && (
            <SummaryStat label="Over Production Qty" value={order.progress.overProductionQuantity} tone="attention" />
          )}
        </dl>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
            <span>Progress</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{order.progress.progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full ${order.progress.overProductionQuantity > 0 ? "bg-purple-500" : "bg-indigo-500"}`}
              style={{ width: `${Math.min(100, order.progress.progressPercent)}%` }}
            />
          </div>
        </div>

        {order.salesOrderContext && (
          <p className="mt-3 text-xs text-zinc-400">
            Sales Order Qty is fixed and never changed by this Production Order.
            {order.salesOrderContext.otherCommitted > 0 &&
              ` Planned on other Production Order(s) against the same Sales Order line: ${order.salesOrderContext.otherCommitted}.`}
          </p>
        )}
      </div>

      <MaterialRequirementPreview
        productId={order.productId}
        quantity={Number(order.plannedQuantity)}
        salesOrderItemId={order.salesOrderItemId || undefined}
      />

      <MaterialPlannedVsIssuedPanel productionOrderId={productionOrderId} />

      <StageTimelinePanel kind="productionOrder" id={productionOrderId} refreshKey={timelineKey} />

      {order.quantityChanges && order.quantityChanges.length > 0 && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Extra Production History</h2>
          <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            {order.quantityChanges.map((c) => (
              <li key={c.id}>
                {new Date(c.createdAt).toLocaleString("en-IN")} — <strong>+{Number(c.addedQuantity)}</strong> by {c.createdBy.fullName} (planned{" "}
                {Number(c.previousQuantity)} → {Number(c.newQuantity)}){c.reason ? ` · ${c.reason}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>
        {canAct && order.status !== "ON_HOLD" && (
          <div className="flex flex-wrap gap-2">
            {canEditQuantity && (
              <ActionButton
                label="Edit Quantity"
                onClick={() => {
                  setEditQuantity(order.plannedQuantity);
                  setShowEditQuantity(true);
                }}
                isBusy={isBusy}
                variant="secondary"
              />
            )}
            <ActionButton label="Generate Material Request" onClick={() => setShowGenerateMr(true)} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Add Lot" onClick={openAddLot} isBusy={isBusy} />
            {order.lots.length > 0 && (
              <ActionButton
                label="Add Extra Quantity"
                onClick={() => {
                  setModalError(null);
                  setShowExtra(true);
                }}
                isBusy={isBusy}
                variant="secondary"
              />
            )}
            {selectedLotIds.size >= 2 && (
              <ActionButton label={`Merge ${selectedLotIds.size} Selected Lots`} onClick={mergeSelected} isBusy={isBusy} variant="secondary" />
            )}
            {allLotsDone && <ActionButton label="Close Order" onClick={() => transitionTo("CLOSED")} isBusy={isBusy} variant="secondary" />}
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton
              label="Cancel Order"
              onClick={() =>
                setConfirmAction({
                  title: "Cancel this production order?",
                  message: "Blocked once any lot has real production activity.",
                  onConfirm: () => transitionTo("CANCELLED").then(() => {}),
                })
              }
              isBusy={isBusy}
              variant="danger"
            />
          </div>
        )}
        {order.status === "ON_HOLD" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={`Resume to ${order.statusBeforeHold ? STATUS_LABELS[order.statusBeforeHold] : ""}`}
              onClick={resumeFromHold}
              isBusy={isBusy}
            />
            <ActionButton
              label="Cancel Order"
              onClick={() =>
                setConfirmAction({
                  title: "Cancel this production order?",
                  message: "Blocked once any lot has real production activity.",
                  onConfirm: () => transitionTo("CANCELLED").then(() => {}),
                })
              }
              isBusy={isBusy}
              variant="danger"
            />
          </div>
        )}
        {!canAct && <p className="text-sm text-zinc-500">No actions available.</p>}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Lots</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-2 font-medium"></th>
                <th className="py-1 pr-3 font-medium">Lot Number</th>
                <th className="py-1 pr-3 font-medium">Planned</th>
                <th className="py-1 pr-3 font-medium">Produced</th>
                <th className="py-1 pr-3 font-medium">Rejected</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Current Stage</th>
                <th className="py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {order.lots.map((lot) => {
                const progress = order.progress.lots.find((l) => l.lotId === lot.id);
                return (
                  <tr key={lot.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-2">
                      {(lot.status === "PLANNED" || lot.status === "IN_PROGRESS") && (
                        <input type="checkbox" checked={selectedLotIds.has(lot.id)} onChange={() => toggleLotSelected(lot.id)} />
                      )}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      <Link href={`/production-orders/${productionOrderId}/lots/${lot.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {lot.lotNumber}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {lot.quantity} {lot.uom.code}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{progress ? `${progress.producedQuantity} ${lot.uom.code}` : "—"}</td>
                    <td className={`py-2 pr-3 ${progress && progress.rejectedQuantity > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-700 dark:text-zinc-200"}`}>
                      {progress ? `${progress.rejectedQuantity} ${lot.uom.code}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{LOT_STATUS_LABELS[lot.status] ?? lot.status}</td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{lot.currentStage?.name ?? "—"}</td>
                    <td className="py-2 text-right">
                      {(lot.status === "PLANNED" || lot.status === "IN_PROGRESS") && (
                        <button
                          type="button"
                          onClick={() => {
                            setSplitLotTarget(lot);
                            setSplitChildren(["", ""]);
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                        >
                          Split
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {order.lots.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-sm text-zinc-500">
                    No lots yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmAction && (
        <ConfirmModal
          open
          title={confirmAction.title}
          message={confirmAction.message}
          isDangerous
          isBusy={isBusy}
          onConfirm={async () => {
            await confirmAction.onConfirm();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <Modal open={showEditQuantity} onClose={() => setShowEditQuantity(false)} title="Edit Production Order Quantity">
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This can be more or less than the Sales Order quantity — the Sales Order itself never changes. Material
            requirement and estimated cost below recalculate as you type.
          </p>
          <FormField label="Planned Quantity" htmlFor="editQuantity" required>
            <input
              id="editQuantity"
              type="number"
              min={0}
              step="1"
              value={editQuantity}
              onChange={(e) => setEditQuantity(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          {order.productId && (
            <MaterialRequirementPreview
              productId={order.productId}
              quantity={Number(editQuantity) || 0}
              salesOrderItemId={order.salesOrderItemId || undefined}
            />
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowEditQuantity(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitEditQuantity}
              disabled={isBusy || !editQuantity || Number(editQuantity) <= 0}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isBusy ? "Saving…" : "Save Quantity"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showExtra} onClose={() => setShowExtra(false)} title="Add Extra Production Quantity" maxWidthClass="max-w-lg">
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Adds quantity to this production order (the same Sale Order line keeps one production order). Allowed only once
            the assigned quantity is fully processed.
          </p>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <SummaryStat label="Assigned Qty" value={order.progress.plannedQuantity} />
            <SummaryStat label="Completed Qty" value={order.progress.producedQuantity} tone="positive" />
            <SummaryStat label="Rejected / Damaged" value={order.progress.rejectedQuantity} />
          </dl>
          {order.progress.producedQuantity + order.progress.rejectedQuantity < order.progress.plannedQuantity && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              Completed quantity is not equal to assigned quantity. Extra production cannot be created until the assigned
              quantity is completed.
            </p>
          )}
          <FormField label="Extra Quantity" htmlFor="extraQty" required>
            <input
              id="extraQty"
              type="number"
              min={1}
              step={1}
              value={extraQty}
              onChange={(e) => setExtraQty(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Reason" htmlFor="extraReason">
            <input id="extraReason" value={extraReason} onChange={(e) => setExtraReason(e.target.value)} className={textInputClass()} />
          </FormField>
          {extraQty && Number(extraQty) > 0 && (
            <p className="text-xs text-zinc-500">
              Planned quantity will become {order.progress.plannedQuantity + Number(extraQty)}. Generate a material request for
              the extra pieces, then add a lot for them.
            </p>
          )}
          {modalError && <p className="text-sm text-red-600 dark:text-red-400">{modalError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowExtra(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitExtra}
              disabled={isBusy || !extraQty || Number(extraQty) <= 0}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isBusy ? "Saving…" : "Add Extra Quantity"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showAddLot} onClose={() => setShowAddLot(false)} title="Add Lot" maxWidthClass="max-w-2xl">
        <div className="space-y-4">
          {hasVariantOptions ? (
            <div>
              <p className="mb-2 text-xs text-zinc-500">
                Size/color mix for this lot — shown on the lot&apos;s own page and on the Stage Transfer Slip so a
                worker at any stage knows exactly what they&apos;re handling.
                {order.salesOrderItemId && " Pre-filled from what's still remaining on the linked Sales Order line."}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="px-2 py-1.5 font-medium">Color</th>
                      <th className="px-2 py-1.5 font-medium">Size</th>
                      {order.salesOrderItemId && <th className="px-2 py-1.5 text-right font-medium">Remaining</th>}
                      <th className="px-2 py-1.5 text-right font-medium">Qty for this lot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {variantSuggestions.map((v) => (
                      <tr key={v.productVariantId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200">{v.colorName}</td>
                        <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200">{v.sizeName}</td>
                        {order.salesOrderItemId && (
                          <td className="px-2 py-1.5 text-right text-zinc-500">{v.remaining}</td>
                        )}
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.0001"
                            value={variantQtyById[v.productVariantId] ?? ""}
                            onChange={(e) => setVariantQtyById((prev) => ({ ...prev, [v.productVariantId]: e.target.value }))}
                            className="w-24 rounded border border-zinc-300 px-2 py-1 text-right text-sm dark:border-zinc-700 dark:bg-zinc-950"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">Total Quantity: {breakdownTotal}</p>
            </div>
          ) : (
            <FormField label="Quantity" htmlFor="lotQuantity" required>
              <input
                id="lotQuantity"
                type="number"
                min={0}
                step="0.0001"
                value={lotQuantity}
                onChange={(e) => setLotQuantity(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          )}
          <FormField label="Unit" htmlFor="lotUomId" required>
            <select id="lotUomId" value={lotUomId} onChange={(e) => setLotUomId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
          </FormField>
          <p className="text-xs text-zinc-500">
            The lot starts at the first stage (Cutting) as soon as it is created, so assign the cutting worker(s) now.
            Material must already be issued for every piece.
          </p>
          <WorkerAssignmentRowsEditor rows={lotWorkers} onChange={setLotWorkers} stageName="Cutting" />
          {addLotQuantity > 0 && lotWorkerError && <p className="text-xs text-red-600 dark:text-red-400">{lotWorkerError}</p>}
          <LotMaterialReadinessPanel productionOrderId={productionOrderId} newLotPieces={addLotQuantity} onReadinessChange={setLotReadiness} />
          {modalError && <p className="text-sm text-red-600 dark:text-red-400">{modalError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAddLot(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitAddLot}
              disabled={isBusy || !lotUomId || addLotQuantity <= 0 || !!lotWorkerError || !lotReadiness?.ready}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isBusy ? "Saving…" : "Add Lot"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showGenerateMr}
        onClose={() => {
          setShowGenerateMr(false);
          setMrResult(null);
        }}
        title="Generate Material Request"
      >
        <div className="space-y-4">
          {!mrResult ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Explodes this order&apos;s BOM against the planned quantity and raises a Material Request for whatever&apos;s
                short in stock.
              </p>
              <FormField label="Issue From (Warehouse)" htmlFor="mrWarehouseId" required>
                <SearchableSelect
                  id="mrWarehouseId"
                  required
                  value={mrWarehouseId}
                  onChange={setMrWarehouseId}
                  options={warehouses.map((w) => ({ id: w.id, label: w.name }))}
                  placeholder="Search warehouse…"
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowGenerateMr(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitGenerateMr}
                  disabled={isBusy || !mrWarehouseId}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isBusy ? "Generating…" : "Generate"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-green-600 dark:text-green-400">
                Created{" "}
                <Link href={`/material-requests`} className="font-medium underline">
                  {mrResult}
                </Link>
                .
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowGenerateMr(false);
                    setMrResult(null);
                  }}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!splitLotTarget} onClose={() => setSplitLotTarget(null)} title="Split Lot">
        {splitLotTarget && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {splitLotTarget.lotNumber} — {splitLotTarget.quantity} {splitLotTarget.uom.code}. Child quantities must sum to
              exactly this amount.
            </p>
            {splitChildren.map((qty, i) => (
              <FormField key={i} label={`Child ${i + 1} Quantity`} htmlFor={`split-${i}`}>
                <input
                  id={`split-${i}`}
                  type="number"
                  min={0}
                  step="0.0001"
                  value={qty}
                  onChange={(e) =>
                    setSplitChildren((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  className={textInputClass()}
                />
              </FormField>
            ))}
            <button
              type="button"
              onClick={() => setSplitChildren((prev) => [...prev, ""])}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              + Add another child lot
            </button>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSplitLotTarget(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSplit}
                disabled={isBusy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Split"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative" | "attention";
}) {
  const toneClass =
    tone === "positive"
      ? "text-green-600 dark:text-green-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : tone === "attention"
          ? "text-purple-600 dark:text-purple-400"
          : "text-zinc-900 dark:text-zinc-50";

  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`text-base font-semibold ${toneClass}`}>{value}</dd>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  isBusy,
  disabled,
  variant = "primary",
}: {
  label: string;
  onClick: () => void;
  isBusy: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const variantClass =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy || disabled}
      className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50 ${variantClass}`}
    >
      {label}
    </button>
  );
}

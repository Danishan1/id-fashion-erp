"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { MaterialRequirementPreview } from "./MaterialRequirementPreview";
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
}

interface UnitOption {
  id: string;
  code: string;
}

interface WarehouseOption {
  id: string;
  name: string;
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
}: {
  productionOrderId: string;
  initialOrder: OrderDetail;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | { title: string; message: string; onConfirm: () => Promise<void> }>(null);

  const [showAddLot, setShowAddLot] = useState(false);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [lotQuantity, setLotQuantity] = useState("");
  const [lotUomId, setLotUomId] = useState("");

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

  const refresh = async () => {
    const res = await fetch(`/api/v1/production-orders/${productionOrderId}`);
    const body = await res.json();
    if (res.ok) setOrder(body.data);
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

  const submitAddLot = async () => {
    const ok = await run(
      () =>
        fetch(`/api/v1/production-orders/${productionOrderId}/lots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: Number(lotQuantity), uomId: lotUomId }),
        }),
      "Failed to create this lot."
    );
    if (ok) {
      setShowAddLot(false);
      setLotQuantity("");
      setLotUomId("");
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

      <MaterialRequirementPreview productId={order.productId} quantity={Number(order.plannedQuantity)} />

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
            <ActionButton label="Add Lot" onClick={() => setShowAddLot(true)} isBusy={isBusy} />
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
          {order.productId && <MaterialRequirementPreview productId={order.productId} quantity={Number(editQuantity) || 0} />}
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

      <Modal open={showAddLot} onClose={() => setShowAddLot(false)} title="Add Lot">
        <div className="space-y-4">
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
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowAddLot(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitAddLot}
              disabled={isBusy || !lotQuantity || !lotUomId}
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
                <select id="mrWarehouseId" value={mrWarehouseId} onChange={(e) => setMrWarehouseId(e.target.value)} className={textInputClass()}>
                  <option value="">— Select —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
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

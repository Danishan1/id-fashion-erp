"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { formatCurrency } from "@/lib/currency";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "./statusLabels";

type SalesOrderStatus = keyof typeof STATUS_LABELS;

interface Person {
  id: string;
  fullName: string;
}

interface VariantRef {
  id: string;
  skuCode: string;
  color: { name: string };
  size: { name: string };
}

interface BreakdownRow {
  id: string;
  orderedQuantity: number;
  productVariant: VariantRef;
}

interface SampleRequestRef {
  id: string;
  requestNumber: string;
  status: string;
  customer: { name: string } | null;
}

interface ProductionOrderSummaryRow {
  id: string;
  orderNumber: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  progressStatus: string;
}

interface ItemProductionSummary {
  orderedTotal: number;
  totalPlanned: number;
  totalProduced: number;
  totalRejected: number;
  remainingProduction: number;
  overPlannedVsOrdered: number;
  productionOrders: ProductionOrderSummaryRow[];
}

interface ItemRow {
  id: string;
  unitPrice: string;
  notes: string | null;
  product: { id: string; styleName: string; styleCode: string; designNumber: string | null };
  sampleRequest: SampleRequestRef | null;
  breakdown: BreakdownRow[];
  productionSummary?: ItemProductionSummary;
}

interface AttachmentRow {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: Person;
  contextLabel: string | null;
}

interface SalesOrderDetail {
  id: string;
  status: SalesOrderStatus;
  statusBeforeHold: SalesOrderStatus | null;
  currencyCode: string;
  totalAmount: string;
  requestedBy: Person;
  customer: { id: string; name: string };
  items: ItemRow[];
}

const STATUS_HELP: Record<SalesOrderStatus, string> = {
  DRAFT: "Not yet confirmed. Review the style lines below, then confirm to move this into production planning.",
  CONFIRMED: "Confirmed. This order is authorized to proceed — Production Order creation lands in a later phase.",
  IN_PRODUCTION: "In production.",
  PARTIALLY_DISPATCHED: "Partially dispatched.",
  DISPATCHED: "Dispatched.",
  INVOICED: "Invoiced.",
  CLOSED: "Closed.",
  ON_HOLD: "Paused. Resume to go back to exactly where this was, or cancel it.",
  CANCELLED: "This sales order was cancelled.",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function SalesOrderWorkflowPanel({
  salesOrderId,
  initialOrder,
}: {
  salesOrderId: string;
  initialOrder: SalesOrderDetail;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [needsOverride, setNeedsOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  // <input type="file"> is uncontrolled — remounting via key is what actually
  // clears its displayed filename after a successful upload (see Sampling's
  // identical fix for the same underlying issue).
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/sales-orders/${salesOrderId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/sales-orders/${salesOrderId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [salesOrderId]);

  const refresh = async () => {
    const res = await fetch(`/api/v1/sales-orders/${salesOrderId}`);
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

  const confirmOrder = async (useOverride: boolean) => {
    const ok = await run(
      () =>
        fetch(`/api/v1/sales-orders/${salesOrderId}/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrideReason: useOverride ? overrideReason : undefined }),
        }),
      "Failed to confirm this order."
    );
    if (ok) {
      setNeedsOverride(false);
      setOverrideReason("");
    } else if (!useOverride) {
      setNeedsOverride(true);
    }
  };

  const transitionTo = (status: "ON_HOLD" | "CANCELLED") =>
    run(
      () =>
        fetch(`/api/v1/sales-orders/${salesOrderId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      "Failed to change status."
    );

  const resumeFromHold = () =>
    run(() => fetch(`/api/v1/sales-orders/${salesOrderId}/resume`, { method: "POST" }), "Failed to resume.");

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/sales-orders/${salesOrderId}/attachments`, { method: "POST", body: formData });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to upload the file."));
      setIsBusy(false);
      return;
    }

    setUploadFile(null);
    setUploadInputKey((k) => k + 1);
    await fetchAttachments();
    setIsBusy(false);
  };

  const deleteAttachment = async (attachmentId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sales-orders/attachments/${attachmentId}`, { method: "DELETE" });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to delete the file."));
      setIsBusy(false);
      return;
    }

    await fetchAttachments();
    setIsBusy(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[order.status]}`}>
          {STATUS_LABELS[order.status]}
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
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>

        {order.status === "DRAFT" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Confirm" onClick={() => confirmOrder(false)} isBusy={isBusy} />
              <EditLink salesOrderId={salesOrderId} />
              <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
            </div>
            {needsOverride && (
              <div className="max-w-md space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
                <FormField label="Management override reason" htmlFor="overrideReason">
                  <input
                    id="overrideReason"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Why confirm without full sample approval?"
                    className={textInputClass()}
                  />
                </FormField>
                <ActionButton
                  label="Confirm Anyway (Override)"
                  onClick={() => confirmOrder(true)}
                  isBusy={isBusy}
                  disabled={!overrideReason}
                  variant="secondary"
                />
              </div>
            )}
          </div>
        )}

        {order.status === "CONFIRMED" && (
          <div className="flex flex-wrap gap-2">
            <EditLink salesOrderId={salesOrderId} />
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {order.status === "ON_HOLD" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={`Resume to ${order.statusBeforeHold ? STATUS_LABELS[order.statusBeforeHold] : ""}`}
              onClick={resumeFromHold}
              isBusy={isBusy}
            />
            <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {(order.status === "CANCELLED" || order.status === "IN_PRODUCTION") && (
          <p className="text-sm text-zinc-500">No actions available.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Style Lines</h2>
        <div className="space-y-3">
          {order.items.map((item) => (
            <div key={item.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {item.product.styleName}{" "}
                  <span className="text-xs text-zinc-400">
                    ({item.product.styleCode}
                    {item.product.designNumber ? ` · Design: ${item.product.designNumber}` : ""})
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {order.currencyCode} {formatCurrency(item.unitPrice)} / pc
                </p>
              </div>
              {item.sampleRequest && (
                <p className="mt-1 text-xs text-zinc-500">
                  Linked sample: {item.sampleRequest.requestNumber}
                  {item.sampleRequest.customer && item.sampleRequest.customer.name !== order.customer.name && (
                    <span className="text-zinc-400"> (Customer: {item.sampleRequest.customer.name})</span>
                  )}{" "}
                  —{" "}
                  <span
                    className={item.sampleRequest.status === "APPROVED" ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}
                  >
                    {item.sampleRequest.status.replace(/_/g, " ")}
                  </span>
                </p>
              )}
              {item.notes && <p className="mt-1 text-xs text-zinc-500">{item.notes}</p>}

              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-1 pr-3 font-medium">Color</th>
                    <th className="py-1 pr-3 font-medium">Size</th>
                    <th className="py-1 font-medium">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {item.breakdown.map((b) => (
                    <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{b.productVariant.color.name}</td>
                      <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{b.productVariant.size.name}</td>
                      <td className="py-1 text-zinc-700 dark:text-zinc-200">{b.orderedQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {item.productionSummary && item.productionSummary.productionOrders.length > 0 && (
                <div className="mt-3 rounded-md border border-zinc-100 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-200">Production Summary</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <span className="text-zinc-500">Total Planned: </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">{item.productionSummary.totalPlanned}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Total Produced: </span>
                      <span className="font-medium text-green-600 dark:text-green-400">{item.productionSummary.totalProduced}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Total Rejected: </span>
                      <span
                        className={
                          item.productionSummary.totalRejected > 0
                            ? "font-medium text-red-600 dark:text-red-400"
                            : "font-medium text-zinc-900 dark:text-zinc-50"
                        }
                      >
                        {item.productionSummary.totalRejected}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Remaining: </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">{item.productionSummary.remainingProduction}</span>
                    </div>
                  </div>
                  {item.productionSummary.overPlannedVsOrdered > 0 && (
                    <p className="mt-2 font-medium text-purple-600 dark:text-purple-400">
                      Planning exceeds the ordered quantity by {item.productionSummary.overPlannedVsOrdered} — the Sales Order
                      quantity itself is unaffected.
                    </p>
                  )}
                  <table className="mt-2 w-full">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="py-1 pr-3 font-medium">Production Order</th>
                        <th className="py-1 pr-3 font-medium">Planned</th>
                        <th className="py-1 pr-3 font-medium">Produced</th>
                        <th className="py-1 pr-3 font-medium">Rejected</th>
                        <th className="py-1 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.productionSummary.productionOrders.map((po) => (
                        <tr key={po.id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-3">
                            <Link href={`/production-orders/${po.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                              {po.orderNumber}
                            </Link>
                          </td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{po.plannedQuantity}</td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{po.producedQuantity}</td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{po.rejectedQuantity}</td>
                          <td className="py-1 text-zinc-700 dark:text-zinc-200">{po.progressStatus.replace(/_/g, " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Order Amount: {order.currencyCode} {formatCurrency(order.totalAmount)}
        </p>
      </div>

      {/* PO copies, buyer reference images, etc. — same shared attachment
          infrastructure as Sampling, just a different relatedModule. */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attachments</h2>
        <div className="space-y-2">
          {attachments.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div>
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(a)}
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {a.fileName}
                </button>
                <p className="text-xs text-zinc-400">
                  {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName}
                  {a.contextLabel && (
                    <>
                      {" · "}
                      <span className="font-medium text-zinc-500 dark:text-zinc-400">
                        {STATUS_LABELS[a.contextLabel as SalesOrderStatus] ?? a.contextLabel}
                      </span>
                    </>
                  )}
                  {" · "}
                  {new Date(a.uploadedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deleteAttachment(a.id)}
                disabled={isBusy}
                className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            key={uploadInputKey}
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-600 dark:text-zinc-300"
          />
          <ActionButton label="Upload" onClick={uploadAttachment} isBusy={isBusy} disabled={!uploadFile} />
        </div>
        <p className="mt-1 text-xs text-zinc-400">JPEG, PNG, WEBP, PDF, Word, or Excel — up to 20 MB.</p>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/sales-orders/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/sales-orders/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}
    </div>
  );
}

function EditLink({ salesOrderId }: { salesOrderId: string }) {
  return (
    <Link
      href={`/sales-orders/${salesOrderId}/edit`}
      className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      Edit
    </Link>
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

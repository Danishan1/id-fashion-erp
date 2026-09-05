"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { formatCurrency } from "@/lib/currency";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "./statusLabels";

type PurchaseOrderStatus = keyof typeof STATUS_LABELS;

interface Person {
  id: string;
  fullName: string;
}

interface ItemRow {
  id: string;
  orderedQuantity: string;
  receivedQuantity: string;
  unitPrice: string;
  notes: string | null;
  product: { id: string; styleName: string; styleCode: string; materialCategory: string | null };
  uom: { id: string; code: string };
  color: { id: string; name: string; hexValue: string | null } | null;
  dye: { id: string; name: string; pantone: string | null } | null;
  materialRequestItem: { id: string; materialRequest: { id: string; requestNumber: string } } | null;
}

function formatShade(item: ItemRow): string {
  const parts: string[] = [];
  if (item.color) parts.push(item.color.name);
  if (item.dye) parts.push(item.dye.pantone ? `${item.dye.name} (${item.dye.pantone})` : item.dye.name);
  return parts.length > 0 ? parts.join(" / ") : "—";
}

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  status: string;
  receivedBy: Person;
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

interface PurchaseOrderDetail {
  id: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  statusBeforeHold: PurchaseOrderStatus | null;
  currencyCode: string;
  totalAmount: string;
  requestedBy: Person;
  supplier: { id: string; name: string };
  items: ItemRow[];
  receipts: ReceiptRow[];
}

const STATUS_HELP: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Not yet approved. Review the line items, then approve to send it forward.",
  APPROVED: "Approved. Mark it sent once the supplier has been informed.",
  SENT_TO_SUPPLIER: "Sent to the supplier. Record a Goods Receipt as shipments arrive.",
  PARTIALLY_RECEIVED: "Some lines are still short of their ordered quantity. Record another Goods Receipt as more arrives.",
  FULLY_RECEIVED: "Every line has been fully received. Close this order once nothing further is expected.",
  CLOSED: "Closed.",
  ON_HOLD: "Paused. Resume to go back to exactly where this was, or cancel it.",
  CANCELLED: "This purchase order was cancelled.",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function PurchaseOrderWorkflowPanel({
  purchaseOrderId,
  initialOrder,
}: {
  purchaseOrderId: string;
  initialOrder: PurchaseOrderDetail;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Whoever clicked "Generate Purchase Orders" is recorded as requestedBy on
  // this PO, not the original requester — this traceability line is what
  // gives a reviewer visibility into the original Material Request instead
  // of rubber-stamping a PO blind to where its shortfall came from.
  const originatingRequest = order.items.find((i) => i.materialRequestItem)?.materialRequestItem?.materialRequest;

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/purchase-orders/${purchaseOrderId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/purchase-orders/${purchaseOrderId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [purchaseOrderId]);

  const refresh = async () => {
    const res = await fetch(`/api/v1/purchase-orders/${purchaseOrderId}`);
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

  const approve = () => run(() => fetch(`/api/v1/purchase-orders/${purchaseOrderId}/approve`, { method: "POST" }), "Failed to approve this order.");
  const sendToSupplier = () => run(() => fetch(`/api/v1/purchase-orders/${purchaseOrderId}/send`, { method: "POST" }), "Failed to mark this order as sent.");
  const closeOrder = () => run(() => fetch(`/api/v1/purchase-orders/${purchaseOrderId}/close`, { method: "POST" }), "Failed to close this order.");
  const transitionTo = (status: "ON_HOLD" | "CANCELLED") =>
    run(
      () =>
        fetch(`/api/v1/purchase-orders/${purchaseOrderId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      "Failed to change status."
    );
  const resumeFromHold = () =>
    run(() => fetch(`/api/v1/purchase-orders/${purchaseOrderId}/resume`, { method: "POST" }), "Failed to resume.");

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/purchase-orders/${purchaseOrderId}/attachments`, { method: "POST", body: formData });

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
    const res = await fetch(`/api/v1/purchase-orders/attachments/${attachmentId}`, { method: "DELETE" });

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

      {originatingRequest && (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Originated from Material Request{" "}
          <Link
            href={`/material-requests/${originatingRequest.id}`}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {originatingRequest.requestNumber}
          </Link>
        </p>
      )}

      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {order.status === "ON_HOLD" && order.statusBeforeHold
          ? `On hold from ${STATUS_LABELS[order.statusBeforeHold]}.`
          : STATUS_HELP[order.status]}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>

        {order.status === "DRAFT" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Approve" onClick={approve} isBusy={isBusy} />
            <EditLink purchaseOrderId={purchaseOrderId} />
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {order.status === "APPROVED" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Mark Sent to Supplier" onClick={sendToSupplier} isBusy={isBusy} />
            <EditLink purchaseOrderId={purchaseOrderId} />
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {(order.status === "SENT_TO_SUPPLIER" || order.status === "PARTIALLY_RECEIVED") && (
          <div className="flex flex-wrap gap-2">
            <ReceiveGoodsLink purchaseOrderId={purchaseOrderId} />
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Cancel Order" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {order.status === "FULLY_RECEIVED" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Close Order" onClick={closeOrder} isBusy={isBusy} />
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

        {(order.status === "CLOSED" || order.status === "CANCELLED") && (
          <p className="text-sm text-zinc-500">No actions available.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1 pr-3 font-medium">Material</th>
              <th className="py-1 pr-3 font-medium">Color / Shade</th>
              <th className="py-1 pr-3 font-medium">Unit</th>
              <th className="py-1 pr-3 font-medium">Ordered</th>
              <th className="py-1 pr-3 font-medium">Received</th>
              <th className="py-1 font-medium">Unit Price</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                  {item.product.styleName}{" "}
                  <span className="text-xs text-zinc-400">({item.product.styleCode})</span>
                  {item.product.materialCategory === "FABRIC" && (
                    <span className="ml-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                      Fabric
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                  {item.color?.hexValue ? (
                    <span
                      className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-zinc-300 align-middle"
                      style={{ backgroundColor: item.color.hexValue }}
                    />
                  ) : null}
                  {formatShade(item)}
                </td>
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{item.uom.code}</td>
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{item.orderedQuantity}</td>
                <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{item.receivedQuantity}</td>
                <td className="py-2 text-zinc-700 dark:text-zinc-200">
                  {order.currencyCode} {formatCurrency(item.unitPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Order Amount: {order.currencyCode} {formatCurrency(order.totalAmount)}
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Goods Receipts</h2>
        {order.receipts.length === 0 && <p className="text-sm text-zinc-500">No shipments received yet.</p>}
        <div className="space-y-2">
          {order.receipts.map((r) => (
            <Link
              key={r.id}
              href={`/goods-receipts/${r.id}`}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            >
              <span className="font-medium text-indigo-600 dark:text-indigo-400">{r.receiptNumber}</span>
              <span className="text-xs text-zinc-500">
                <ClientDateTime value={r.receivedDate} mode="date" /> · {r.receivedBy.fullName} · {r.status.replace(/_/g, " ")}
              </span>
            </Link>
          ))}
        </div>
      </div>

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
                        {STATUS_LABELS[a.contextLabel as PurchaseOrderStatus] ?? a.contextLabel}
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
        <p className="mt-1 text-xs text-zinc-400">Supplier quotations, purchase confirmations, etc.</p>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/purchase-orders/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/purchase-orders/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}
    </div>
  );
}

function EditLink({ purchaseOrderId }: { purchaseOrderId: string }) {
  return (
    <Link
      href={`/purchase-orders/${purchaseOrderId}/edit`}
      className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      Edit
    </Link>
  );
}

function ReceiveGoodsLink({ purchaseOrderId }: { purchaseOrderId: string }) {
  return (
    <Link
      href={`/purchase-orders/${purchaseOrderId}/receive`}
      className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >
      Record Goods Receipt
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

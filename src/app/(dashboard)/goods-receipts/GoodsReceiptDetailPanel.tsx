"use client";

import { useEffect, useState } from "react";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "./statusLabels";

interface Person {
  id: string;
  fullName: string;
}

interface FabricAttr {
  id: string;
  name: string;
}

interface RollRow {
  id: string;
  rollNumber: string;
  rollQuantity: string;
  remainingQuantity: string;
  batchNo: string | null;
  status: string;
  gsm: FabricAttr | null;
  dye: FabricAttr | null;
  weaveType: FabricAttr | null;
  width: FabricAttr | null;
  composition: FabricAttr | null;
}

interface ItemRow {
  id: string;
  receivedQuantity: string;
  reversedQuantity: string;
  notes: string | null;
  product: { styleName: string; styleCode: string };
  uom: { code: string };
  warehouse: { name: string };
  warehouseLocation: { code: string } | null;
  rolls: RollRow[];
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

interface GoodsReceiptDetail {
  id: string;
  receiptNumber: string;
  status: keyof typeof STATUS_LABELS;
  receivedDate: string;
  receivedBy: Person;
  purchaseOrder: { id: string; orderNumber: string };
  items: ItemRow[];
}

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function GoodsReceiptDetailPanel({
  goodsReceiptId,
  initialReceipt,
}: {
  goodsReceiptId: string;
  initialReceipt: GoodsReceiptDetail;
}) {
  const [receipt, setReceipt] = useState(initialReceipt);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Keyed by itemId, or `${itemId}:${rollId}` for a roll-scoped reversal.
  const [reversingKey, setReversingKey] = useState<string | null>(null);
  const [reverseQty, setReverseQty] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancelForm, setShowCancelForm] = useState(false);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/goods-receipts/${goodsReceiptId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/goods-receipts/${goodsReceiptId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [goodsReceiptId]);

  const refresh = async () => {
    const res = await fetch(`/api/v1/goods-receipts/${goodsReceiptId}`);
    const body = await res.json();
    if (res.ok) setReceipt(body.data);
  };

  const submitReverse = async (itemId: string, fabricRollId?: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/goods-receipts/${goodsReceiptId}/items/${itemId}/reverse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: Number(reverseQty), reason: reverseReason, fabricRollId }),
    });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to reverse this quantity."));
      setIsBusy(false);
      return;
    }

    setReversingKey(null);
    setReverseQty("");
    setReverseReason("");
    await refresh();
    setIsBusy(false);
  };

  const submitCancel = async () => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/goods-receipts/${goodsReceiptId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: cancelReason }),
    });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to cancel this receipt."));
      setIsBusy(false);
      return;
    }

    setShowCancelForm(false);
    setCancelReason("");
    await refresh();
    setIsBusy(false);
  };

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/goods-receipts/${goodsReceiptId}/attachments`, { method: "POST", body: formData });

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
    const res = await fetch(`/api/v1/goods-receipts/attachments/${attachmentId}`, { method: "DELETE" });

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

  const reverseForm = (itemId: string, fabricRollId: string | undefined, max: number) => (
    <div className="mt-2 max-w-sm space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
      <FormField label={`Quantity to reverse (max ${max})`} htmlFor="reverseQty">
        <input
          id="reverseQty"
          type="number"
          min={0}
          max={max}
          step="0.0001"
          value={reverseQty}
          onChange={(e) => setReverseQty(e.target.value)}
          className={textInputClass()}
        />
      </FormField>
      <FormField label="Reason" htmlFor="reverseReason">
        <input
          id="reverseReason"
          value={reverseReason}
          onChange={(e) => setReverseReason(e.target.value)}
          placeholder="e.g. damaged on arrival, data-entry correction"
          className={textInputClass()}
        />
      </FormField>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isBusy || !reverseQty || !reverseReason}
          onClick={() => submitReverse(itemId, fabricRollId)}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          Confirm Reversal
        </button>
        <button
          type="button"
          onClick={() => setReversingKey(null)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[receipt.status]}`}>
          {STATUS_LABELS[receipt.status] ?? receipt.status}
        </span>
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="space-y-4">
        {receipt.items.map((item) => {
          const lineRemaining = Number(item.receivedQuantity) - Number(item.reversedQuantity);
          return (
            <div key={item.id} className="space-y-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {item.product.styleName} <span className="text-xs text-zinc-400">({item.product.styleCode})</span>
                </p>
                <p className="text-xs text-zinc-500">
                  {item.receivedQuantity} {item.uom.code} received
                  {Number(item.reversedQuantity) > 0 && ` · ${item.reversedQuantity} reversed`} · {item.warehouse.name}
                  {item.warehouseLocation ? ` (${item.warehouseLocation.code})` : ""}
                </p>
              </div>

              {item.rolls.length === 0 ? (
                <div>
                  {receipt.status !== "CANCELLED" && lineRemaining > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setReversingKey(item.id);
                        setReverseQty("");
                        setReverseReason("");
                      }}
                      className="text-xs font-medium text-red-600 hover:text-red-500"
                    >
                      Reverse
                    </button>
                  )}
                  {reversingKey === item.id && reverseForm(item.id, undefined, lineRemaining)}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-1 pr-3 font-medium">Roll #</th>
                      <th className="py-1 pr-3 font-medium">Qty</th>
                      <th className="py-1 pr-3 font-medium">Remaining</th>
                      <th className="py-1 pr-3 font-medium">Batch</th>
                      <th className="py-1 pr-3 font-medium">Attributes</th>
                      <th className="py-1 pr-3 font-medium">Status</th>
                      <th className="py-1 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.rolls.map((roll) => (
                      <tr key={roll.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{roll.rollNumber}</td>
                        <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{roll.rollQuantity}</td>
                        <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{roll.remainingQuantity}</td>
                        <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{roll.batchNo ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-zinc-500">
                          {[roll.gsm?.name, roll.dye?.name, roll.weaveType?.name, roll.width?.name, roll.composition?.name]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-700 dark:text-zinc-200">{roll.status.replace(/_/g, " ")}</td>
                        <td className="py-1.5">
                          {receipt.status !== "CANCELLED" && Number(roll.remainingQuantity) > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setReversingKey(`${item.id}:${roll.id}`);
                                setReverseQty("");
                                setReverseReason("");
                              }}
                              className="text-xs font-medium text-red-600 hover:text-red-500"
                            >
                              Reverse
                            </button>
                          )}
                          {reversingKey === `${item.id}:${roll.id}` &&
                            reverseForm(item.id, roll.id, Number(roll.remainingQuantity))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {receipt.status !== "CANCELLED" && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          {!showCancelForm ? (
            <button
              type="button"
              onClick={() => setShowCancelForm(true)}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
            >
              Cancel Entire Receipt
            </button>
          ) : (
            <div className="max-w-sm space-y-2">
              <FormField label="Reason" htmlFor="cancelReason">
                <input
                  id="cancelReason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isBusy || !cancelReason}
                  onClick={submitCancel}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                >
                  Confirm Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setShowCancelForm(false)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
                >
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

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
                  {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName} · {new Date(a.uploadedAt).toLocaleString()}
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
          <button
            type="button"
            onClick={uploadAttachment}
            disabled={isBusy || !uploadFile}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Upload
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-400">Delivery challans, packing lists, etc.</p>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/goods-receipts/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/goods-receipts/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}
    </div>
  );
}

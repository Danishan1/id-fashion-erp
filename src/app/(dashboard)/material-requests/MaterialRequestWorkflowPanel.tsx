"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "./statusLabels";
import { REQUEST_TYPE_BADGE_CLASS, REQUEST_TYPE_LABELS } from "./requestTypeLabels";
import { MaterialRequestTimeline } from "./MaterialRequestTimeline";

type MaterialRequestStatus = keyof typeof STATUS_LABELS;

interface Person {
  id: string;
  fullName: string;
}

interface LinkedPurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  orderedQuantity: string;
  purchaseOrder: { id: string; orderNumber: string; status: string };
}

interface LocationOption {
  id: string;
  code: string;
  materialCategory: string | null;
  isActive: boolean;
}

interface LineRow {
  id: string;
  requestedQuantity: string;
  issuedQuantity: string;
  purchaseReceivedQuantity: string;
  remainingQuantity: number;
  purchaseOrderedQuantity: number;
  availableToOrderQuantity: number;
  availableStockQuantity: number;
  damageReason: string | null;
  remarks: string | null;
  material: { id: string; styleName: string; styleCode: string; materialCategory: string | null };
  color: { id: string; name: string; hexValue: string | null } | null;
  dye: { id: string; name: string; pantone: string | null } | null;
  uom: { id: string; code: string };
  purchaseOrderItems: LinkedPurchaseOrderItem[];
  /** Most recent pick location — traceability only, see the schema's own comment. */
  warehouseLocation: { id: string; code: string } | null;
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

interface MaterialRequestDetail {
  id: string;
  requestNumber: string;
  requestType: keyof typeof REQUEST_TYPE_LABELS;
  status: MaterialRequestStatus;
  statusBeforeHold: MaterialRequestStatus | null;
  purpose: string | null;
  remarks: string | null;
  department: { id: string; name: string } | null;
  warehouse: { id: string; name: string };
  salesOrder: { id: string; orderNumber: string } | null;
  bom: { id: string; productId: string } | null;
  originalMaterialRequest: { id: string; requestNumber: string } | null;
  requestedBy: Person;
  requiresPurchaseAction: boolean;
  lines: LineRow[];
}

interface SupplierOption {
  id: string;
  name: string;
}

const STATUS_HELP: Record<MaterialRequestStatus, string> = {
  OPEN: "Issue whatever is available from stock. What's left over can optionally be escalated to Purchasing.",
  PARTIALLY_FULFILLED: "Some lines are fully covered (issued or escalated). Keep issuing the rest, or close this once nothing further is needed.",
  FULFILLED: "Every line has been fully issued or escalated to a purchase order.",
  CLOSED: "Closed.",
  ON_HOLD: "Paused. Resume to go back to exactly where this was, or cancel it.",
  CANCELLED: "This material request was cancelled.",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return { message: body?.error?.message ?? fallback, details: body?.error?.details ?? null };
}

export function MaterialRequestWorkflowPanel({
  materialRequestId,
  initialRequest,
}: {
  materialRequestId: string;
  initialRequest: MaterialRequestDetail;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [confirmAction, setConfirmAction] = useState<
    null | { title: string; message: string; isDangerous?: boolean; onConfirm: () => Promise<void> }
  >(null);

  const [issuingLine, setIssuingLine] = useState<LineRow | null>(null);
  const [issueQty, setIssueQty] = useState("");
  const [issueLocationId, setIssueLocationId] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const [showGenerate, setShowGenerate] = useState(false);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  useEffect(() => {
    fetch(`/api/v1/material-requests/${materialRequestId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [materialRequestId]);

  // The request's own warehouse never changes across this panel's lifetime,
  // so this only needs to run once — scoped to that warehouse's locations
  // for the Issue modal's optional Location picker.
  useEffect(() => {
    fetch(`/api/v1/warehouses/${request.warehouse.id}/locations`)
      .then((res) => res.json())
      .then((body) => setLocations((body.data ?? []).filter((l: LocationOption) => l.isActive)))
      .catch(() => setLocations([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/material-requests/${materialRequestId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  const refresh = async () => {
    const res = await fetch(`/api/v1/material-requests/${materialRequestId}`);
    const body = await res.json();
    if (res.ok) setRequest(body.data);
  };

  const run = async (action: () => Promise<Response>, fallbackError: string) => {
    setIsBusy(true);
    setError(null);
    const res = await action();
    if (!res.ok) {
      const { message } = await parseErrorMessage(res, fallbackError);
      setError(message);
      setIsBusy(false);
      return false;
    }
    await refresh();
    setIsBusy(false);
    return true;
  };

  const closeRequest = () =>
    run(() => fetch(`/api/v1/material-requests/${materialRequestId}/close`, { method: "POST" }), "Failed to close this request.");
  const transitionTo = (status: "ON_HOLD" | "CANCELLED") =>
    run(
      () =>
        fetch(`/api/v1/material-requests/${materialRequestId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      "Failed to change status."
    );
  const resumeFromHold = () =>
    run(() => fetch(`/api/v1/material-requests/${materialRequestId}/resume`, { method: "POST" }), "Failed to resume.");

  const submitIssue = async () => {
    if (!issuingLine) return;
    const ok = await run(
      () =>
        fetch(`/api/v1/material-requests/lines/${issuingLine.id}/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueQuantity: Number(issueQty), warehouseLocationId: issueLocationId || undefined }),
        }),
      "Failed to issue this line."
    );
    if (ok) setIssuingLine(null);
  };

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/material-requests/${materialRequestId}/attachments`, { method: "POST", body: formData });
    if (!res.ok) {
      const { message } = await parseErrorMessage(res, "Failed to upload the file.");
      setError(message);
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
    const res = await fetch(`/api/v1/material-requests/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const { message } = await parseErrorMessage(res, "Failed to delete the file.");
      setError(message);
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

  const canAct = request.status !== "CANCELLED" && request.status !== "CLOSED" && request.status !== "FULFILLED";
  const canIssue = canAct && request.status !== "ON_HOLD";
  const hasShortfallCandidates = request.lines.some((l) => l.availableToOrderQuantity > 0);
  // Matches the edit page's own real-state guard, applied per line — a line
  // is locked once anything has actually been issued or escalated against
  // it, but that never blocks editing a different, still-untouched line on
  // the same request (e.g. a PARTIALLY_FULFILLED request can still have
  // editable lines).
  const hasEditableLine = request.lines.some((l) => Number(l.issuedQuantity) <= 0 && l.purchaseOrderItems.length === 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[request.status]}`}>
          {STATUS_LABELS[request.status]}
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${REQUEST_TYPE_BADGE_CLASS[request.requestType]}`}>
          {REQUEST_TYPE_LABELS[request.requestType]}
        </span>
        {request.requiresPurchaseAction && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            Purchase Required
          </span>
        )}
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        {request.status === "ON_HOLD" && request.statusBeforeHold
          ? `On hold from ${STATUS_LABELS[request.statusBeforeHold]}.`
          : STATUS_HELP[request.status]}
      </p>

      <div className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
        {request.salesOrder && (
          <p>
            Sales Order:{" "}
            <Link href={`/sales-orders/${request.salesOrder.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              {request.salesOrder.orderNumber}
            </Link>
          </p>
        )}
        {request.bom && (
          <p>
            BOM:{" "}
            <Link href={`/bom-mrp/${request.bom.productId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
              View BOM
            </Link>
          </p>
        )}
        {request.originalMaterialRequest && (
          <p>
            Damage replacement for:{" "}
            <Link
              href={`/material-requests/${request.originalMaterialRequest.id}`}
              className="text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {request.originalMaterialRequest.requestNumber}
            </Link>
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>

        {(request.status === "OPEN" || request.status === "PARTIALLY_FULFILLED") && (
          <div className="flex flex-wrap gap-2">
            {hasShortfallCandidates && (
              <ActionButton label="Generate Purchase Order(s)" onClick={() => setShowGenerate(true)} isBusy={isBusy} variant="secondary" />
            )}
            {hasEditableLine && <EditLink materialRequestId={materialRequestId} />}
            {request.status === "PARTIALLY_FULFILLED" && (
              <ActionButton label="Close Request" onClick={closeRequest} isBusy={isBusy} variant="secondary" />
            )}
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton
              label="Cancel Request"
              onClick={() =>
                setConfirmAction({
                  title: "Cancel this material request?",
                  message: "This cannot be undone. Blocked once anything has already been issued or escalated.",
                  isDangerous: true,
                  onConfirm: () => transitionTo("CANCELLED").then(() => {}),
                })
              }
              isBusy={isBusy}
              variant="danger"
            />
          </div>
        )}

        {request.status === "ON_HOLD" && (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label={`Resume to ${request.statusBeforeHold ? STATUS_LABELS[request.statusBeforeHold] : ""}`}
              onClick={resumeFromHold}
              isBusy={isBusy}
            />
            <ActionButton
              label="Cancel Request"
              onClick={() =>
                setConfirmAction({
                  title: "Cancel this material request?",
                  message: "This cannot be undone. Blocked once anything has already been issued or escalated.",
                  isDangerous: true,
                  onConfirm: () => transitionTo("CANCELLED").then(() => {}),
                })
              }
              isBusy={isBusy}
              variant="danger"
            />
          </div>
        )}

        {(request.status === "CLOSED" || request.status === "CANCELLED" || request.status === "FULFILLED") && (
          <p className="text-sm text-zinc-500">No actions available.</p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Line Items</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1 pr-3 font-medium">Material</th>
                <th className="py-1 pr-3 font-medium">Color / Shade</th>
                <th className="py-1 pr-3 font-medium">Requested</th>
                <th className="py-1 pr-3 font-medium">Available Stock</th>
                <th className="py-1 pr-3 font-medium">Issued</th>
                <th className="py-1 pr-3 font-medium">Location</th>
                <th className="py-1 pr-3 font-medium">Purchase-Ordered</th>
                <th className="py-1 pr-3 font-medium">Purchase-Received</th>
                <th className="py-1 pr-3 font-medium">Remaining</th>
                {request.requestType === "DAMAGE_REPLACEMENT" && <th className="py-1 pr-3 font-medium">Damage Reason</th>}
                <th className="py-1 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {request.lines.map((line) => {
                const activePoItems = line.purchaseOrderItems.filter((p) => p.purchaseOrder.status !== "CANCELLED");
                return (
                  <tr key={line.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.material.styleName} <span className="text-xs text-zinc-400">({line.material.styleCode})</span>
                      {activePoItems.map((poi) => (
                        <Link
                          key={poi.id}
                          href={`/purchase-orders/${poi.purchaseOrderId}`}
                          className="ml-2 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          view {poi.purchaseOrder.orderNumber}
                        </Link>
                      ))}
                    </td>
                    <td className="py-2 pr-3 text-xs text-zinc-500">
                      {line.color?.name ?? "—"}
                      {line.dye ? ` / ${line.dye.name}${line.dye.pantone ? ` (${line.dye.pantone})` : ""}` : ""}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.requestedQuantity} {line.uom.code}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.availableStockQuantity} {line.uom.code}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.issuedQuantity} {line.uom.code}
                    </td>
                    <td className="py-2 pr-3 text-zinc-500">{line.warehouseLocation?.code ?? "—"}</td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.purchaseOrderedQuantity > 0 ? `${line.purchaseOrderedQuantity} ${line.uom.code}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {Number(line.purchaseReceivedQuantity) > 0 ? `${line.purchaseReceivedQuantity} ${line.uom.code}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                      {line.remainingQuantity > 0 ? `${line.remainingQuantity} ${line.uom.code}` : "—"}
                    </td>
                    {request.requestType === "DAMAGE_REPLACEMENT" && (
                      <td className="py-2 pr-3 text-xs text-zinc-500">{line.damageReason ?? "—"}</td>
                    )}
                    <td className="py-2 text-right">
                      {canIssue && line.remainingQuantity > 0 && (
                        <button
                          type="button"
                          disabled={line.availableStockQuantity <= 0}
                          title={line.availableStockQuantity <= 0 ? "No stock available at this warehouse yet" : undefined}
                          onClick={() => {
                            setIssuingLine(line);
                            // Pre-fill with whatever's actually issuable, not
                            // just what's still requested — never suggest a
                            // quantity the warehouse doesn't have on hand.
                            setIssueQty(String(Math.min(line.remainingQuantity, line.availableStockQuantity)));
                            setIssueLocationId("");
                            setError(null);
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:text-zinc-400 dark:disabled:text-zinc-600 dark:disabled:hover:text-zinc-600"
                        >
                          Issue
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attachments</h2>
        <div className="space-y-2">
          {attachments.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
              <div>
                <button type="button" onClick={() => setPreviewAttachment(a)} className="font-medium text-indigo-600 hover:text-indigo-500">
                  {a.fileName}
                </button>
                <p className="text-xs text-zinc-400">
                  {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName}
                  {a.contextLabel && (
                    <>
                      {" · "}
                      <span className="font-medium text-zinc-500 dark:text-zinc-400">
                        {STATUS_LABELS[a.contextLabel as MaterialRequestStatus] ?? a.contextLabel}
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
          <input key={uploadInputKey} type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm text-zinc-600 dark:text-zinc-300" />
          <ActionButton label="Upload" onClick={uploadAttachment} isBusy={isBusy} disabled={!uploadFile} />
        </div>
      </div>

      <MaterialRequestTimeline materialRequestId={materialRequestId} />

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/material-requests/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/material-requests/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}

      {confirmAction && (
        <ConfirmModal
          open
          title={confirmAction.title}
          message={confirmAction.message}
          isDangerous={confirmAction.isDangerous}
          isBusy={isBusy}
          onConfirm={async () => {
            await confirmAction.onConfirm();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      <Modal open={!!issuingLine} onClose={() => setIssuingLine(null)} title="Issue Material">
        {issuingLine && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {issuingLine.material.styleName} — {issuingLine.remainingQuantity} {issuingLine.uom.code} remaining ·{" "}
              {issuingLine.availableStockQuantity} {issuingLine.uom.code} in stock at {request.warehouse.name}
            </p>
            <FormField label="Issue Quantity" htmlFor="issueQty" required>
              <input
                id="issueQty"
                type="number"
                min={0}
                // Capped by whichever is smaller — the request's own
                // remaining need, or what's actually on hand. Issuing more
                // than physical stock exists would drive the ledger
                // negative; the server's own guard is the real backstop,
                // this just stops the mistake from being enterable at all.
                max={Math.min(issuingLine.remainingQuantity, issuingLine.availableStockQuantity)}
                step="0.0001"
                value={issueQty}
                onChange={(e) => {
                  const cap = Math.min(issuingLine.remainingQuantity, issuingLine.availableStockQuantity);
                  const next = Number(e.target.value);
                  setIssueQty(e.target.value !== "" && Number.isFinite(next) && next > cap ? String(cap) : e.target.value);
                }}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Location (optional)" htmlFor="issueLocationId">
              {(() => {
                // Only offer locations that actually make sense for this
                // material — general-purpose locations (no category tag) or
                // ones tagged for this exact material category. A location
                // tagged for a different category is no longer even
                // selectable here, rather than just warned about after the
                // fact once picked.
                const matchingLocations = locations.filter(
                  (l) => !l.materialCategory || !issuingLine.material.materialCategory || l.materialCategory === issuingLine.material.materialCategory
                );
                return (
                  <select
                    id="issueLocationId"
                    value={issueLocationId}
                    onChange={(e) => setIssueLocationId(e.target.value)}
                    className={textInputClass()}
                  >
                    <option value="">— No specific location —</option>
                    {matchingLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code}
                        {l.materialCategory ? ` (${formatCategoryLabel(l.materialCategory)})` : ""}
                      </option>
                    ))}
                  </select>
                );
              })()}
            </FormField>

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIssuingLine(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={isBusy || !(Number(issueQty) > 0)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Issue"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {showGenerate && (
        <GeneratePurchaseOrdersModal
          materialRequestId={materialRequestId}
          onClose={() => setShowGenerate(false)}
          onDone={async () => {
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function EditLink({ materialRequestId }: { materialRequestId: string }) {
  return (
    <Link
      href={`/material-requests/${materialRequestId}/edit`}
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

interface ReviewLine {
  materialRequestItemId: string;
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  requestedQuantity: number;
  availableStockQuantity: number;
  issuedQuantity: number;
  remainingQuantity: number;
  purchaseOrderedQuantity: number;
  suggestedPurchaseQty: number;
  defaultSupplierId: string | null;
  suggestedUnitPrice: number | null;
}

interface ReviewRowState {
  included: boolean;
  purchaseQuantity: string;
  supplierId: string;
  unitPrice: string;
}

function GeneratePurchaseOrdersModal({
  materialRequestId,
  onClose,
  onDone,
}: {
  materialRequestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [reviewLines, setReviewLines] = useState<ReviewLine[] | null>(null);
  const [rowState, setRowState] = useState<Record<string, ReviewRowState>>({});
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [results, setResults] = useState<Array<{ supplierId: string; status: string; orderNumber?: string; message?: string }> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
    fetch(`/api/v1/material-requests/${materialRequestId}/generate-purchase-orders`)
      .then((res) => res.json())
      .then((body) => {
        const lines: ReviewLine[] = body.data ?? [];
        setReviewLines(lines);
        setRowState(
          Object.fromEntries(
            lines.map((l) => [
              l.materialRequestItemId,
              {
                included: true,
                purchaseQuantity: String(l.suggestedPurchaseQty),
                supplierId: l.defaultSupplierId ?? "",
                unitPrice: l.suggestedUnitPrice !== null ? String(l.suggestedUnitPrice) : "",
              },
            ])
          )
        );
      });
  }, [materialRequestId]);

  const updateRow = (id: string, patch: Partial<ReviewRowState>) =>
    setRowState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const attemptGenerate = async () => {
    if (!reviewLines) return;
    const submitLines = reviewLines
      .filter((l) => rowState[l.materialRequestItemId]?.included)
      .map((l) => ({
        materialRequestItemId: l.materialRequestItemId,
        purchaseQuantity: Number(rowState[l.materialRequestItemId].purchaseQuantity),
        supplierId: rowState[l.materialRequestItemId].supplierId,
        unitPrice: Number(rowState[l.materialRequestItemId].unitPrice),
      }));

    if (submitLines.length === 0) {
      setError("Select at least one line to purchase.");
      return;
    }
    if (submitLines.some((l) => !l.supplierId)) {
      setError("Pick a supplier for every included line.");
      return;
    }
    if (submitLines.some((l) => !(l.purchaseQuantity > 0))) {
      setError("Purchase quantity must be greater than 0 for every included line.");
      return;
    }
    if (submitLines.some((l) => !(l.unitPrice > 0))) {
      setError("Unit price must be greater than 0 for every included line.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    const res = await fetch(`/api/v1/material-requests/${materialRequestId}/generate-purchase-orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: submitLines, expectedDeliveryDate: expectedDeliveryDate || undefined }),
    });
    setIsSubmitting(false);

    if (!res.ok) {
      const { message } = await parseErrorMessage(res, "Failed to generate purchase orders.");
      setError(message);
      return;
    }

    const body = await res.json();
    setResults(body.data.results);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Generate Purchase Order(s)" maxWidthClass="max-w-3xl">
      <div className="space-y-4">
        {!reviewLines && <p className="text-sm text-zinc-500">Loading…</p>}

        {reviewLines && !results && (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Review each line below. Purchase Qty is pre-filled with the suggested shortfall but can be freely
              changed — it is never forced to match the shortfall exactly (e.g. to meet a supplier&apos;s MOQ).
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-1 pr-2 font-medium"></th>
                    <th className="py-1 pr-2 font-medium">Material</th>
                    <th className="py-1 pr-2 font-medium">Requested</th>
                    <th className="py-1 pr-2 font-medium">Stock</th>
                    <th className="py-1 pr-2 font-medium">Issued</th>
                    <th className="py-1 pr-2 font-medium">Remaining</th>
                    <th className="py-1 pr-2 font-medium">Suggested PO</th>
                    <th className="py-1 pr-2 font-medium">Purchase Qty</th>
                    <th className="py-1 pr-2 font-medium">Unit Price</th>
                    <th className="py-1 font-medium">Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewLines.map((l) => {
                    const row = rowState[l.materialRequestItemId];
                    if (!row) return null;
                    return (
                      <tr key={l.materialRequestItemId} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(e) => updateRow(l.materialRequestItemId, { included: e.target.checked })}
                          />
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.materialName} <span className="text-xs text-zinc-400">({l.materialCode})</span>
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.requestedQuantity} {l.uomCode}
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.availableStockQuantity} {l.uomCode}
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.issuedQuantity} {l.uomCode}
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.remainingQuantity} {l.uomCode}
                        </td>
                        <td className="py-2 pr-2 text-zinc-700 dark:text-zinc-200">
                          {l.suggestedPurchaseQty} {l.uomCode}
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            min={0}
                            step="0.0001"
                            disabled={!row.included}
                            value={row.purchaseQuantity}
                            onChange={(e) => updateRow(l.materialRequestItemId, { purchaseQuantity: e.target.value })}
                            className={`${textInputClass()} w-24`}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            disabled={!row.included}
                            value={row.unitPrice}
                            onChange={(e) => updateRow(l.materialRequestItemId, { unitPrice: e.target.value })}
                            className={`${textInputClass()} w-24`}
                          />
                        </td>
                        <td className="py-2">
                          <select
                            disabled={!row.included}
                            value={row.supplierId}
                            onChange={(e) => updateRow(l.materialRequestItemId, { supplierId: e.target.value })}
                            className={`${textInputClass()} w-40`}
                          >
                            <option value="">Pick a supplier…</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                  {reviewLines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-4 text-center text-sm text-zinc-500">
                        Nothing left to escalate — every line is already fully issued or covered by an existing order.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {reviewLines.length > 0 && (
              <FormField label="Expected Delivery Date (optional, applies to every order created here)" htmlFor="expectedDeliveryDate">
                <input
                  id="expectedDeliveryDate"
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className={textInputClass()}
                />
              </FormField>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              {reviewLines.length > 0 && (
                <button
                  type="button"
                  onClick={attemptGenerate}
                  disabled={isSubmitting}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                >
                  {isSubmitting ? "Generating…" : "Generate"}
                </button>
              )}
            </div>
          </>
        )}

        {results && (
          <>
            <div className="space-y-1">
              {results.length === 0 && <p className="text-sm text-zinc-500">Nothing left to escalate.</p>}
              {results.map((r, i) => (
                <p key={i} className="text-sm">
                  {r.status === "success" ? (
                    <span className="text-green-600 dark:text-green-400">Created {r.orderNumber}</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">Failed — {r.message}</span>
                  )}
                </p>
              ))}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

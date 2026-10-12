"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarcodeScanInput } from "@/components/ui/BarcodeScanInput";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { Barcode } from "@/components/ui/Barcode";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { ClientDateTime } from "@/components/ui/ClientDateTime";

interface DispatchItemRow {
  id: string;
  productId: string;
  dispatchedQuantity: number;
  regularDispatchQuantity: number;
  extraDispatchQuantity: number;
  extraDispatchReason: string | null;
  extraDispatchRemarks: string | null;
  product: { styleName: string; styleCode: string };
}

const EXTRA_DISPATCH_REASON_LABELS: Record<string, string> = {
  CUSTOMER_REQUEST: "Customer Request",
  REPLACEMENT: "Replacement",
  FREE_FOC: "Free / FOC",
  SAMPLE: "Sample",
  PROMOTIONAL: "Promotional",
  PACKING_ADJUSTMENT: "Packing Adjustment",
  OTHER: "Other",
};

interface VariantRef {
  id: string;
  color: { name: string };
  size: { name: string };
}

interface CartonItemRow {
  id: string;
  dispatchItemId: string;
  productVariantId: string | null;
  quantity: number;
  productVariant: VariantRef | null;
}

interface CartonRow {
  id: string;
  cartonNumber: number;
  totalQuantity: number;
  items: CartonItemRow[];
}

interface Person {
  fullName: string;
}

interface AttachmentRow {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: Person;
}

interface DispatchDetail {
  id: string;
  dispatchNumber: string;
  status: "DRAFT" | "PACKED" | "DISPATCHED" | "DELIVERED" | "ON_HOLD" | "CANCELLED";
  statusBeforeHold: string | null;
  dispatchDate: string;
  deliveryAddress: string;
  transporterName: string | null;
  vehicleNumber: string | null;
  trackingNumber: string | null;
  forwarder: { id: string; code: string; name: string; type: string; phone: string | null; contactPerson: string | null } | null;
  lrNumber: string | null;
  awbNumber: string | null;
  driverDetails: string | null;
  // Decimal.toJSON() serializes to a STRING, not a number — the page passes
  // this object through JSON.parse(JSON.stringify(...)), so it arrives here
  // exactly as that round-trip produces it, same convention documented
  // project-wide for every other Decimal field crossing the RSC boundary.
  freightCharges: string | null;
  expectedDeliveryDate: string | null;
  shipmentRemarks: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  receivedByName: string | null;
  salesOrder: { id: string; orderNumber: string };
  customer: { name: string };
  warehouse: { code: string; name: string };
  requestedBy: { fullName: string };
  items: DispatchItemRow[];
  cartons: CartonRow[];
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  PACKED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  DISPATCHED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400",
  DELIVERED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  ON_HOLD: "bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

interface DraftCartonItem {
  dispatchItemId: string;
  productVariantId: string;
  quantity: string;
}
interface DraftCarton {
  items: DraftCartonItem[];
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DispatchWorkflowPanel({ dispatch }: { dispatch: DispatchDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
  const [receivedByName, setReceivedByName] = useState("");
  // Barcode Management & Scanning System, Phase 1 (2026-09-29) — scanning
  // every carton before "Mark Packed" is optional, not mandatory: leaving
  // this empty sends no scannedCartonIds at all, matching the plain
  // one-click behavior this button has always had. Scanning even one carton
  // switches the button over to sending the scanned set, so the server's own
  // cross-check (every real carton scanned exactly once) applies.
  const [scannedCartonIds, setScannedCartonIds] = useState<string[]>([]);
  const [cartonScanMessage, setCartonScanMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const editable = dispatch.status === "DRAFT" || dispatch.status === "PACKED";

  const [cartons, setCartons] = useState<DraftCarton[]>(() =>
    dispatch.cartons.map((c) => ({
      items: c.items.map((i) => ({
        dispatchItemId: i.dispatchItemId,
        productVariantId: i.productVariantId ?? "",
        quantity: String(i.quantity),
      })),
    }))
  );
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, VariantRef[]>>({});

  useEffect(() => {
    const productIds = [...new Set(dispatch.items.map((i) => i.productId))];
    Promise.all(
      productIds.map((id) =>
        fetch(`/api/v1/products/${id}`)
          .then((res) => res.json())
          .then((body) => [id, body.data?.variants ?? []] as const)
      )
    ).then((entries) => setVariantsByProduct(Object.fromEntries(entries)));
  }, [dispatch.items]);

  const packedByItemId = new Map<string, number>();
  for (const carton of cartons) {
    for (const item of carton.items) {
      const qty = Number(item.quantity) || 0;
      packedByItemId.set(item.dispatchItemId, (packedByItemId.get(item.dispatchItemId) ?? 0) + qty);
    }
  }

  const addCarton = () => setCartons((prev) => [...prev, { items: [] }]);
  const removeCarton = (cartonIndex: number) => setCartons((prev) => prev.filter((_, i) => i !== cartonIndex));
  const addLine = (cartonIndex: number) =>
    setCartons((prev) =>
      prev.map((c, i) =>
        i === cartonIndex ? { items: [...c.items, { dispatchItemId: "", productVariantId: "", quantity: "" }] } : c
      )
    );
  const removeLine = (cartonIndex: number, lineIndex: number) =>
    setCartons((prev) => prev.map((c, i) => (i === cartonIndex ? { items: c.items.filter((_, j) => j !== lineIndex) } : c)));
  const updateLine = (cartonIndex: number, lineIndex: number, patch: Partial<DraftCartonItem>) =>
    setCartons((prev) =>
      prev.map((c, i) =>
        i === cartonIndex ? { items: c.items.map((line, j) => (j === lineIndex ? { ...line, ...patch } : line)) } : c
      )
    );

  const saveCartons = async () => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/dispatches/${dispatch.id}/cartons`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartons: cartons
          .filter((c) => c.items.length > 0)
          .map((c) => ({
            items: c.items
              .filter((i) => i.dispatchItemId && Number(i.quantity) > 0)
              .map((i) => ({
                dispatchItemId: i.dispatchItemId,
                productVariantId: i.productVariantId || undefined,
                quantity: Number(i.quantity),
              })),
          })),
      }),
    });
    setIsBusy(false);
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to save cartons."));
      return;
    }
    router.refresh();
  };

  const runAction = async (url: string, body?: unknown) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setIsBusy(false);
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Action failed."));
      return false;
    }
    router.refresh();
    return true;
  };

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  useEffect(() => {
    fetch(`/api/v1/dispatches/${dispatch.id}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [dispatch.id]);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/dispatches/${dispatch.id}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/dispatches/${dispatch.id}/attachments`, { method: "POST", body: formData });
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
    const res = await fetch(`/api/v1/dispatches/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to delete the file."));
      setIsBusy(false);
      return;
    }
    await fetchAttachments();
    setIsBusy(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[dispatch.status] ?? ""}`}>
          {dispatch.status}
        </span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Order:{" "}
          <Link href={`/sales-orders/${dispatch.salesOrder.id}`} className="text-indigo-600 hover:text-indigo-500">
            {dispatch.salesOrder.orderNumber}
          </Link>
        </span>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Customer</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.customer.name}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Warehouse</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {dispatch.warehouse.code} — {dispatch.warehouse.name}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Dispatch Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.dispatchDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Requested By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.requestedBy.fullName}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Delivery Address</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.deliveryAddress}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Transporter</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {dispatch.transporterName ?? "—"} {dispatch.vehicleNumber ? `(${dispatch.vehicleNumber})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Tracking No.</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.trackingNumber ?? "—"}</dd>
        </div>
        {dispatch.forwarder && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Forwarder</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {dispatch.forwarder.name} ({dispatch.forwarder.code})
              {(dispatch.forwarder.contactPerson || dispatch.forwarder.phone) && (
                <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  {dispatch.forwarder.contactPerson}
                  {dispatch.forwarder.contactPerson && dispatch.forwarder.phone && " · "}
                  {dispatch.forwarder.phone}
                </span>
              )}
            </dd>
          </div>
        )}
        {(dispatch.lrNumber || dispatch.awbNumber) && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">LR / AWB No.</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              {[dispatch.lrNumber, dispatch.awbNumber].filter(Boolean).join(" / ") || "—"}
            </dd>
          </div>
        )}
        {dispatch.driverDetails && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Driver Details</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.driverDetails}</dd>
          </div>
        )}
        {dispatch.freightCharges != null && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Freight Charges</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(dispatch.freightCharges).toFixed(2)}</dd>
          </div>
        )}
        {dispatch.expectedDeliveryDate && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Expected Delivery Date</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.expectedDeliveryDate.slice(0, 10)}</dd>
          </div>
        )}
        {dispatch.shipmentRemarks && (
          <div className="sm:col-span-2">
            <dt className="text-zinc-500 dark:text-zinc-400">Shipment Remarks</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">{dispatch.shipmentRemarks}</dd>
          </div>
        )}
        {dispatch.dispatchedAt && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Dispatched At</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              <ClientDateTime value={dispatch.dispatchedAt} />
            </dd>
          </div>
        )}
        {dispatch.deliveredAt && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Delivered At</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-50">
              <ClientDateTime value={dispatch.deliveredAt} /> {dispatch.receivedByName ? `— ${dispatch.receivedByName}` : ""}
            </dd>
          </div>
        )}
      </dl>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Items</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="px-3 py-2 font-medium">Style</th>
                <th className="px-3 py-2 font-medium">Total Qty</th>
                <th className="px-3 py-2 font-medium">Regular</th>
                <th className="px-3 py-2 font-medium">Extra</th>
                <th className="px-3 py-2 font-medium">Extra Reason</th>
                <th className="px-3 py-2 font-medium">Packed</th>
              </tr>
            </thead>
            <tbody>
              {dispatch.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    {item.product.styleCode} — {item.product.styleName}
                  </td>
                  <td className="px-3 py-2">{item.dispatchedQuantity}</td>
                  <td className="px-3 py-2">{item.regularDispatchQuantity}</td>
                  <td className={`px-3 py-2 ${item.extraDispatchQuantity > 0 ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-400"}`}>
                    {item.extraDispatchQuantity}
                  </td>
                  <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                    {item.extraDispatchQuantity > 0
                      ? `${EXTRA_DISPATCH_REASON_LABELS[item.extraDispatchReason ?? ""] ?? item.extraDispatchReason ?? "—"}${
                          item.extraDispatchRemarks ? ` — ${item.extraDispatchRemarks}` : ""
                        }`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{packedByItemId.get(item.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dispatch.items.some((i) => i.extraDispatchQuantity > 0) && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            This dispatch includes Extra Dispatch Quantity — the Extra portion is never counted toward the Sales
            Order&apos;s own fulfillment, only toward Finished-Goods stock consumption.
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Cartons</h2>
        {editable ? (
          <div className="space-y-3">
            {cartons.map((carton, cartonIndex) => (
              <div key={cartonIndex} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Carton {cartonIndex + 1}</p>
                  <button type="button" onClick={() => removeCarton(cartonIndex)} className="text-xs text-red-600 hover:text-red-500">
                    Remove Carton
                  </button>
                </div>
                <div className="space-y-2">
                  {carton.items.map((line, lineIndex) => {
                    const variants = line.dispatchItemId ? variantsByProduct[dispatch.items.find((i) => i.id === line.dispatchItemId)?.productId ?? ""] ?? [] : [];
                    return (
                      <div key={lineIndex} className="grid grid-cols-4 gap-2">
                        <select
                          value={line.dispatchItemId}
                          onChange={(e) => updateLine(cartonIndex, lineIndex, { dispatchItemId: e.target.value, productVariantId: "" })}
                          className={textInputClass()}
                        >
                          <option value="">— Style —</option>
                          {dispatch.items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.product.styleCode}
                            </option>
                          ))}
                        </select>
                        <select
                          value={line.productVariantId}
                          onChange={(e) => updateLine(cartonIndex, lineIndex, { productVariantId: e.target.value })}
                          disabled={variants.length === 0}
                          className={textInputClass()}
                        >
                          <option value="">— No specific variant —</option>
                          {variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.color.name} / {v.size.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => updateLine(cartonIndex, lineIndex, { quantity: e.target.value })}
                          className={textInputClass()}
                        />
                        <button type="button" onClick={() => removeLine(cartonIndex, lineIndex)} className="text-xs text-red-600 hover:text-red-500">
                          Remove Line
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => addLine(cartonIndex)} className="text-xs font-medium text-indigo-600 hover:text-indigo-500">
                    + Add Line
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-3">
              <button type="button" onClick={addCarton} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                + Add Carton
              </button>
              <button
                type="button"
                onClick={saveCartons}
                disabled={isBusy}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                Save Cartons
              </button>
            </div>
          </div>
        ) : dispatch.cartons.length === 0 ? (
          <p className="text-sm text-zinc-500">No cartons were recorded.</p>
        ) : (
          <div className="space-y-4">
            {dispatch.status === "DRAFT" && (
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Scan cartons before Mark Packed (optional)
                </p>
                <BarcodeScanInput
                  placeholder="Scan a carton label…"
                  autoFocus={false}
                  onResolve={(outcome) => {
                    if (!outcome.ok) {
                      setCartonScanMessage({ ok: false, text: outcome.message });
                      return;
                    }
                    const { data } = outcome;
                    if (data.entityType !== "CARTON") {
                      setCartonScanMessage({ ok: false, text: "That barcode is not a carton." });
                      return;
                    }
                    if (!dispatch.cartons.some((c) => c.id === data.entityId)) {
                      setCartonScanMessage({ ok: false, text: "That carton does not belong to this dispatch." });
                      return;
                    }
                    if (scannedCartonIds.includes(data.entityId)) {
                      setCartonScanMessage({ ok: false, text: "This carton was already scanned." });
                      return;
                    }
                    setScannedCartonIds((prev) => [...prev, data.entityId]);
                    setCartonScanMessage({ ok: true, text: `Scanned: ${data.code}` });
                  }}
                />
                {cartonScanMessage && (
                  <p className={`mt-1 text-xs ${cartonScanMessage.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {cartonScanMessage.text}
                  </p>
                )}
                {scannedCartonIds.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Scanned {scannedCartonIds.length} of {dispatch.cartons.length} carton(s).
                  </p>
                )}
              </div>
            )}
            {dispatch.cartons.map((carton) => (
              <div key={carton.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Carton {carton.cartonNumber} — {carton.totalQuantity} pcs
                    {scannedCartonIds.includes(carton.id) && (
                      <span className="ml-2 text-xs font-normal text-green-700 dark:text-green-400">✓ Scanned</span>
                    )}
                  </p>
                  <Barcode value={`${dispatch.dispatchNumber}-C${carton.cartonNumber}`} height={40} />
                </div>
                <ul className="text-sm text-zinc-600 dark:text-zinc-300">
                  {carton.items.map((item) => {
                    const dispatchItem = dispatch.items.find((i) => i.id === item.dispatchItemId);
                    return (
                      <li key={item.id}>
                        {dispatchItem?.product.styleCode}
                        {item.productVariant ? ` — ${item.productVariant.color.name}/${item.productVariant.size.name}` : ""}: {item.quantity}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {dispatch.status === "DRAFT" && (
          <>
            <Link href={`/dispatch/${dispatch.id}/edit`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200">
              Edit
            </Link>
            <button
              onClick={() =>
                runAction(
                  `/api/v1/dispatches/${dispatch.id}/pack`,
                  scannedCartonIds.length > 0 ? { scannedCartonIds } : undefined
                )
              }
              disabled={isBusy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Mark Packed
            </button>
            <button onClick={() => runAction(`/api/v1/dispatches/${dispatch.id}/hold`)} disabled={isBusy} className="rounded-md border border-orange-300 px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-400">
              Hold
            </button>
            <button onClick={() => setShowCancelConfirm(true)} disabled={isBusy} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400">
              Cancel
            </button>
          </>
        )}
        {dispatch.status === "PACKED" && (
          <>
            <Link href={`/dispatch/${dispatch.id}/edit`} className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200">
              Edit
            </Link>
            <button onClick={() => runAction(`/api/v1/dispatches/${dispatch.id}/confirm`)} disabled={isBusy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              Confirm Dispatch
            </button>
            <button onClick={() => runAction(`/api/v1/dispatches/${dispatch.id}/hold`)} disabled={isBusy} className="rounded-md border border-orange-300 px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-400">
              Hold
            </button>
            <button onClick={() => setShowCancelConfirm(true)} disabled={isBusy} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400">
              Cancel
            </button>
          </>
        )}
        {dispatch.status === "DISPATCHED" && (
          <button onClick={() => setShowDeliverConfirm(true)} disabled={isBusy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
            Mark Delivered
          </button>
        )}
        {dispatch.status === "ON_HOLD" && (
          <>
            <button onClick={() => runAction(`/api/v1/dispatches/${dispatch.id}/resume`)} disabled={isBusy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
              Resume to {dispatch.statusBeforeHold}
            </button>
            <button onClick={() => setShowCancelConfirm(true)} disabled={isBusy} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400">
              Cancel
            </button>
          </>
        )}
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
                  {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName} · {new Date(a.uploadedAt).toLocaleString()}
                </p>
              </div>
              <button type="button" onClick={() => deleteAttachment(a.id)} disabled={isBusy} className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50">
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input key={uploadInputKey} type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm text-zinc-600 dark:text-zinc-300" />
          <button type="button" onClick={uploadAttachment} disabled={isBusy || !uploadFile} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200">
            Upload
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-400">Delivery challan or proof-of-delivery photo — up to 20 MB.</p>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/dispatches/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/dispatches/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel dispatch?"
        message="This dispatch will be cancelled."
        confirmLabel="Cancel Dispatch"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/dispatches/${dispatch.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showDeliverConfirm} onClose={() => setShowDeliverConfirm(false)} title="Mark as delivered?">
        <div className="space-y-4">
          <FormField label="Received By (optional)" htmlFor="receivedByName">
            <input
              id="receivedByName"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowDeliverConfirm(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                const ok = await runAction(`/api/v1/dispatches/${dispatch.id}/deliver`, { receivedByName: receivedByName || undefined });
                if (ok) setShowDeliverConfirm(false);
              }}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Mark Delivered
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

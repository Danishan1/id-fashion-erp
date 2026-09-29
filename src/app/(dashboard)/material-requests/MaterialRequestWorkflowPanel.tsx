"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarcodeScanInput } from "@/components/ui/BarcodeScanInput";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { dedupePriceOptions, type PurchaseHistoryEntry } from "@/lib/price-history";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "./statusLabels";
import { REQUEST_TYPE_BADGE_CLASS, REQUEST_TYPE_LABELS } from "./requestTypeLabels";
import { MaterialRequestTimeline } from "./MaterialRequestTimeline";
import { MaterialSubstitutionsSection } from "./MaterialSubstitutionsSection";

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

interface RollOption {
  id: string;
  rollNumber: string;
  remainingQuantity: string;
  dye: { id: string; name: string; pantone: string | null } | null;
  gsm: { id: string; name: string } | null;
  composition: { id: string; name: string } | null;
}

interface OtherWarehouseStockRow {
  warehouseId: string;
  warehouseName: string;
  totalQuantity: number;
  rolls: Array<{
    id: string;
    rollNumber: string;
    remainingQuantity: number;
    dye: { name: string; pantone: string | null } | null;
    gsm: { name: string } | null;
    composition: { name: string } | null;
  }>;
}

function formatRollLabel(r: { rollNumber: string; dye: { name: string; pantone: string | null } | null; gsm: { name: string } | null; composition: { name: string } | null }) {
  return [
    r.dye ? `${r.dye.name}${r.dye.pantone ? ` (${r.dye.pantone})` : ""}` : `Roll ${r.rollNumber} — no shade recorded`,
    r.gsm?.name,
    r.composition?.name,
  ]
    .filter(Boolean)
    .join(" · ");
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
  // Additional/Damage Material Request approval (Phase 7) — null for an
  // ordinary PRODUCTION_REQUIREMENT request (no gate at all); only a
  // DAMAGE_REPLACEMENT request is ever created with a real value here.
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
  approvedBy: Person | null;
  approvalRemark: string | null;
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

  const [showRejectApproval, setShowRejectApproval] = useState(false);
  const [rejectApprovalRemark, setRejectApprovalRemark] = useState("");

  // Material Substitution — propose a stock-driven alternative for a line
  // (Phase 5/6/9 of the Effective BOM work). `autoApprove` submits through
  // the combined propose-approve-issue endpoint for an authorized user; a
  // regular Store/Warehouse User leaves it unchecked and the resulting
  // record sits PENDING until a Production Manager/Supervisor decides it
  // elsewhere (see MaterialSubstitutionsSection below).
  const [substitutingLine, setSubstitutingLine] = useState<LineRow | null>(null);
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [substituteMaterialId, setSubstituteMaterialId] = useState("");
  const [substituteQuantity, setSubstituteQuantity] = useState("");
  const [substituteReason, setSubstituteReason] = useState<"ORIGINAL_MATERIAL_NOT_AVAILABLE" | "QUALITY_ISSUE" | "OTHER">(
    "ORIGINAL_MATERIAL_NOT_AVAILABLE"
  );
  const [substituteRemarks, setSubstituteRemarks] = useState("");
  const [substituteAutoApprove, setSubstituteAutoApprove] = useState(false);

  const [confirmAction, setConfirmAction] = useState<
    null | { title: string; message: string; isDangerous?: boolean; onConfirm: () => Promise<void> }
  >(null);

  const [issuingLine, setIssuingLine] = useState<LineRow | null>(null);
  const [issueQty, setIssueQty] = useState("");
  const [issueLocationId, setIssueLocationId] = useState("");
  // "Issue Extra" manual override (2026-09-15, widened to every request
  // type 2026-09-22, explicit user request) — real production floors, not
  // just sample-making, routinely need slightly more material than the
  // planned/BOM quantity (e.g. for wastage). A reason is required whenever
  // the entered quantity genuinely exceeds what remains — enforced
  // server-side, this is just the matching UI. Physical stock is still
  // never overridable — the cap below always floors at real availability.
  const [issueExtra, setIssueExtra] = useState(false);
  const [issueExtraReason, setIssueExtraReason] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);
  // Color/shade-wise stock breakdown for the line currently being issued —
  // only ever populated for a FABRIC material (see fetch below); a
  // non-fabric line's `availableRolls` stays empty and the picker simply
  // doesn't render, falling back to the existing flat-total Issue flow.
  const [availableRolls, setAvailableRolls] = useState<RollOption[]>([]);
  // Roll id -> qty-to-issue string. A roll only actually participates in
  // the issue when its entry is a real positive number -- there's no
  // separate "selected" boolean, the quantity itself is the selection,
  // matching the same convention Goods Receipt's own roll table already
  // uses. Multiple rolls (multiple Color/Shade/GSM/Composition
  // combinations) can be issued together in one action.
  const [rollQuantities, setRollQuantities] = useState<Record<string, string>>({});
  const [rollsLoading, setRollsLoading] = useState(false);
  // Barcode Management & Scanning System, Phase 1 (2026-09-29) — scanning a
  // Fabric Roll's own label here is purely a shortcut into the existing
  // rollQuantities state this table already writes; it never bypasses the
  // roll table's own real availability data (a scan for a roll not present
  // in THIS line's own availableRolls is a clean error, not silently
  // accepted).
  const [rollScanMessage, setRollScanMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // "Change Warehouse" (2026-09-16) — offered inline in the Issue modal
  // whenever the request's own warehouse has nothing, populated only from
  // warehouses getOtherWarehouseStockForLine already confirmed have real
  // stock. "" means "issuing from the request's own warehouse, as normal".
  const [issueAltWarehouses, setIssueAltWarehouses] = useState<OtherWarehouseStockRow[] | null>(null);
  const [issueAltWarehousesLoading, setIssueAltWarehousesLoading] = useState(false);
  const [issueWarehouseId, setIssueWarehouseId] = useState("");

  const [showGenerate, setShowGenerate] = useState(false);

  // "Other Warehouse Stock" — self-fetches on open, mirroring this project's
  // established self-fetch-on-open modal convention (Supplier↔Material
  // catalog, etc.). Surfaced next to a line whose own Available Stock reads
  // 0, so a merchandiser can see whether the material simply doesn't exist
  // yet or is genuinely sitting at a different warehouse, and jump straight
  // into a Stock Transfer to correct it.
  const [otherWarehouseLine, setOtherWarehouseLine] = useState<LineRow | null>(null);
  const [otherWarehouseStock, setOtherWarehouseStock] = useState<OtherWarehouseStockRow[] | null>(null);
  const [otherWarehouseLoading, setOtherWarehouseLoading] = useState(false);

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

  useEffect(() => {
    if (!substitutingLine) return;
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
  }, [substitutingLine]);

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

  // Additional/Damage Material Request approval (Phase 7) — reuses
  // production.approve server-side; a coarse client-side guard isn't needed
  // here since the buttons only render at all once approvalStatus is
  // genuinely PENDING, and a denied attempt just surfaces the API's own
  // clean PERMISSION_DENIED message via the existing `run()` error path.
  const decideApproval = (decision: "approve" | "reject", approvalRemark: string) =>
    run(
      () =>
        fetch(`/api/v1/material-requests/${materialRequestId}/${decision}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalRemark: approvalRemark || null }),
        }),
      `Failed to ${decision} this request.`
    );

  const submitIssue = async () => {
    if (!issuingLine) return;
    const rollEntries = Object.entries(rollQuantities).filter(([, qty]) => Number(qty) > 0);

    if (rollEntries.length === 0) {
      // Non-fabric, or a fabric material with no roll-level stock recorded
      // at this warehouse -- the original single flat-quantity call,
      // completely unchanged.
      const ok = await run(
        () =>
          fetch(`/api/v1/material-requests/lines/${issuingLine.id}/issue`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              issueQuantity: Number(issueQty),
              warehouseLocationId: issueLocationId || undefined,
              fabricRollId: undefined,
              extraReason: issueExtra ? issueExtraReason || undefined : undefined,
              issueWarehouseId: issueWarehouseId || undefined,
            }),
          }),
        "Failed to issue this line."
      );
      if (ok) setIssuingLine(null);
      return;
    }

    // Multiple rolls/shades selected -- one call per roll, sequentially, so
    // each one re-validates against the real, latest server state rather
    // than a single client-side snapshot. A failure partway through never
    // loses the rolls that already succeeded: they're cleared from the form
    // so a retry only ever resubmits what's still actually outstanding,
    // matching the "Generate Purchase Order(s)" modal's own per-group
    // tracked-result discipline.
    setIsBusy(true);
    setError(null);
    const failures: string[] = [];
    const succeededRollIds: string[] = [];
    for (const [rollId, qty] of rollEntries) {
      const roll = availableRolls.find((r) => r.id === rollId);
      const res = await fetch(`/api/v1/material-requests/lines/${issuingLine.id}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueQuantity: Number(qty),
          warehouseLocationId: issueLocationId || undefined,
          fabricRollId: rollId,
          extraReason: issueExtra ? issueExtraReason || undefined : undefined,
          issueWarehouseId: issueWarehouseId || undefined,
        }),
      });
      if (res.ok) {
        succeededRollIds.push(rollId);
      } else {
        const { message } = await parseErrorMessage(res, "Failed to issue this roll.");
        failures.push(`${roll ? formatRollLabel(roll) : rollId}: ${message}`);
      }
    }
    await refresh();
    setIsBusy(false);

    if (failures.length > 0) {
      setRollQuantities((prev) => {
        const next = { ...prev };
        succeededRollIds.forEach((id) => delete next[id]);
        return next;
      });
      setError(`${succeededRollIds.length} of ${rollEntries.length} issued successfully. Failed: ${failures.join("; ")}`);
      const url = issueWarehouseId
        ? `/api/v1/material-requests/lines/${issuingLine.id}/available-rolls?warehouseId=${issueWarehouseId}`
        : `/api/v1/material-requests/lines/${issuingLine.id}/available-rolls`;
      setRollsLoading(true);
      fetch(url)
        .then((res) => res.json())
        .then((body) => setAvailableRolls(body.data ?? []))
        .finally(() => setRollsLoading(false));
    } else {
      setIssuingLine(null);
    }
  };

  const submitSubstitute = async () => {
    if (!substitutingLine) return;
    const endpoint = substituteAutoApprove
      ? `/api/v1/material-requests/lines/${substitutingLine.id}/substitutions/propose-approve-issue`
      : `/api/v1/material-requests/lines/${substitutingLine.id}/substitutions`;
    const ok = await run(
      () =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            substituteMaterialId,
            quantity: Number(substituteQuantity),
            uomId: substitutingLine.uom.id,
            reason: substituteReason,
            remarks: substituteRemarks || undefined,
            autoApprove: substituteAutoApprove,
          }),
        }),
      "Failed to propose this substitution."
    );
    if (ok) {
      setSubstitutingLine(null);
      setSubstituteMaterialId("");
      setSubstituteQuantity("");
      setSubstituteRemarks("");
      setSubstituteAutoApprove(false);
    }
  };

  // "Change Warehouse" inside the Issue modal — re-scopes the roll picker
  // (for a FABRIC material) to whichever warehouse was just picked, exactly
  // like the mount-time fetch above but keyed on the chosen warehouse
  // instead of the request's own.
  const selectIssueWarehouse = (warehouseId: string) => {
    if (!issuingLine) return;
    setIssueWarehouseId(warehouseId);
    setRollQuantities({});
    setIssueQty("");
    if (issuingLine.material.materialCategory === "FABRIC") {
      setRollsLoading(true);
      setAvailableRolls([]);
      const url = warehouseId
        ? `/api/v1/material-requests/lines/${issuingLine.id}/available-rolls?warehouseId=${warehouseId}`
        : `/api/v1/material-requests/lines/${issuingLine.id}/available-rolls`;
      fetch(url)
        .then((res) => res.json())
        .then((body) => setAvailableRolls(body.data ?? []))
        .finally(() => setRollsLoading(false));
    }
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
  // A DAMAGE_REPLACEMENT request still awaiting (or refused) approval can't
  // be issued against at all — see assertNotPendingApproval server-side.
  const canIssue = canAct && request.status !== "ON_HOLD" && request.approvalStatus !== "PENDING" && request.approvalStatus !== "REJECTED";
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
        {request.approvalStatus === "PENDING" && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            Pending Approval
          </span>
        )}
        {request.approvalStatus === "APPROVED" && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-500/10 dark:text-green-300">
            Approved
          </span>
        )}
        {request.approvalStatus === "REJECTED" && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
            Rejected
          </span>
        )}
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      {request.approvalStatus === "PENDING" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-3 text-sm text-amber-800 dark:text-amber-200">
            This is an additional/damage material request — nothing can be issued against it until it&apos;s approved.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton label="Approve Request" onClick={() => decideApproval("approve", "")} isBusy={isBusy} />
            <ActionButton
              label="Reject Request"
              onClick={() => {
                setRejectApprovalRemark("");
                setShowRejectApproval(true);
              }}
              isBusy={isBusy}
              variant="danger"
            />
          </div>
        </div>
      )}
      {request.approvalStatus === "REJECTED" && request.approvalRemark && (
        <p className="text-sm text-red-600 dark:text-red-400">Rejected: {request.approvalRemark}</p>
      )}

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
                      {line.availableStockQuantity <= 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setOtherWarehouseLine(line);
                            setOtherWarehouseStock(null);
                            setOtherWarehouseLoading(true);
                            fetch(`/api/v1/material-requests/lines/${line.id}/other-warehouse-stock`)
                              .then((res) => res.json())
                              .then((body) => setOtherWarehouseStock(body.data ?? []))
                              .finally(() => setOtherWarehouseLoading(false));
                          }}
                          className="ml-2 block text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                        >
                          Check other warehouses
                        </button>
                      )}
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
                          // Never pre-emptively blocked on zero stock any
                          // more (2026-09-16) — the modal itself now offers a
                          // real "Change Warehouse" fallback for exactly that
                          // case, so there's always something useful to do
                          // inside it even when this warehouse has nothing.
                          onClick={() => {
                            setIssuingLine(line);
                            setIssueLocationId("");
                            setRollQuantities({});
                            setIssueExtra(false);
                            setIssueExtraReason("");
                            setError(null);
                            setIssueWarehouseId("");
                            setIssueAltWarehouses(null);
                            if (line.availableStockQuantity <= 0) {
                              setIssueAltWarehousesLoading(true);
                              fetch(`/api/v1/material-requests/lines/${line.id}/other-warehouse-stock`)
                                .then((res) => res.json())
                                .then((body) => setIssueAltWarehouses(body.data ?? []))
                                .finally(() => setIssueAltWarehousesLoading(false));
                            }
                            if (line.material.materialCategory === "FABRIC") {
                              // Real cap depends on which roll/shade gets
                              // picked below, not the line's own flat
                              // (possibly stale-for-this-shade) number —
                              // start empty rather than pre-filling a
                              // quantity that might not even be issuable.
                              setIssueQty("");
                              setRollsLoading(true);
                              setAvailableRolls([]);
                              fetch(`/api/v1/material-requests/lines/${line.id}/available-rolls`)
                                .then((res) => res.json())
                                .then((body) => setAvailableRolls(body.data ?? []))
                                .finally(() => setRollsLoading(false));
                            } else {
                              // Pre-fill with whatever's actually issuable,
                              // not just what's still requested — never
                              // suggest a quantity the warehouse doesn't
                              // have on hand.
                              setIssueQty(String(Math.min(line.remainingQuantity, line.availableStockQuantity)));
                              setAvailableRolls([]);
                            }
                          }}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:text-zinc-400 dark:disabled:text-zinc-600 dark:disabled:hover:text-zinc-600"
                        >
                          Issue
                        </button>
                      )}
                      {canIssue && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubstitutingLine(line);
                            setSubstituteMaterialId("");
                            setSubstituteQuantity("");
                            setSubstituteReason("ORIGINAL_MATERIAL_NOT_AVAILABLE");
                            setSubstituteRemarks("");
                            setSubstituteAutoApprove(false);
                            setError(null);
                          }}
                          className="ml-3 text-xs font-medium text-amber-700 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                          Substitute
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

      <MaterialSubstitutionsSection lineIds={request.lines.map((l) => l.id)} />

      <MaterialRequestTimeline
        materialRequestId={materialRequestId}
        lines={request.lines.map((l) => ({ id: l.id, uomCode: l.uom.code }))}
      />

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

      <Modal open={showRejectApproval} onClose={() => setShowRejectApproval(false)} title="Reject This Request">
        <div className="space-y-4">
          <FormField label="Reason (optional)" htmlFor="rejectApprovalRemark">
            <textarea
              id="rejectApprovalRemark"
              rows={3}
              value={rejectApprovalRemark}
              onChange={(e) => setRejectApprovalRemark(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRejectApproval(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await decideApproval("reject", rejectApprovalRemark);
                if (ok) setShowRejectApproval(false);
              }}
              disabled={isBusy}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {isBusy ? "Saving…" : "Reject"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!substitutingLine} onClose={() => setSubstitutingLine(null)} title="Propose Substitute Material">
        {substitutingLine && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Requesting <span className="font-medium">{substitutingLine.material.styleName}</span> ({substitutingLine.material.styleCode}
              ). This does not change what the Effective BOM requires — it records an acceptable alternative, with a full
              audit trail, for when the original material genuinely isn&apos;t available.
            </p>
            <FormField label="Substitute Material" htmlFor="substituteMaterialId" required>
              <MaterialPicker
                id="substituteMaterialId"
                materials={materials.filter((m) => m.id !== substitutingLine.material.id)}
                value={substituteMaterialId}
                onChange={setSubstituteMaterialId}
                required
              />
            </FormField>
            <FormField label={`Quantity (${substitutingLine.uom.code})`} htmlFor="substituteQuantity" required>
              <input
                id="substituteQuantity"
                type="number"
                min={0}
                step="0.0001"
                value={substituteQuantity}
                onChange={(e) => setSubstituteQuantity(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Reason" htmlFor="substituteReason" required>
              <select
                id="substituteReason"
                value={substituteReason}
                onChange={(e) => setSubstituteReason(e.target.value as typeof substituteReason)}
                className={textInputClass()}
              >
                <option value="ORIGINAL_MATERIAL_NOT_AVAILABLE">Original material not available</option>
                <option value="QUALITY_ISSUE">Quality issue with original material</option>
                <option value="OTHER">Other</option>
              </select>
            </FormField>
            <FormField label="Remarks (optional)" htmlFor="substituteRemarks">
              <textarea
                id="substituteRemarks"
                rows={2}
                value={substituteRemarks}
                onChange={(e) => setSubstituteRemarks(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input type="checkbox" checked={substituteAutoApprove} onChange={(e) => setSubstituteAutoApprove(e.target.checked)} />
              I&apos;m authorized to approve this myself — approve and issue it immediately
            </label>
            {!substituteAutoApprove && (
              <p className="text-xs text-zinc-500">
                Without this, the substitution is recorded as Pending — a Production Manager/Supervisor must approve it
                before anything is issued.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubstitutingLine(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitSubstitute}
                disabled={isBusy || !substituteMaterialId || !substituteQuantity || Number(substituteQuantity) <= 0}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : substituteAutoApprove ? "Approve & Issue" : "Propose"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!issuingLine}
        onClose={() => setIssuingLine(null)}
        title="Issue Material"
        maxWidthClass="max-w-[70vw]"
      >
        {issuingLine && (() => {
          const isFabric = issuingLine.material.materialCategory === "FABRIC";
          // The sum of every roll's own entered qty -- with multiple rolls
          // selectable, there's no single "the chosen roll" any more; each
          // roll's own <input> is already capped at that roll's own
          // remainingQuantity (see the table below), so this is the real
          // total about to be issued in fabric-with-rolls mode.
          const totalRollQty = availableRolls.reduce((sum, r) => sum + (Number(rollQuantities[r.id]) || 0), 0);
          // Which warehouse this issue is actually about to come out of —
          // the request's own by default, or whichever alternate the
          // "Change Warehouse" picker below has selected.
          const activeWarehouseName = issueWarehouseId
            ? (issueAltWarehouses?.find((w) => w.warehouseId === issueWarehouseId)?.warehouseName ?? "the selected warehouse")
            : request.warehouse.name;
          // The flat total for a non-fabric material, or a fabric material
          // with no roll-level stock — the request's own line figure when
          // still on the request's own warehouse, or the picked alternate
          // warehouse's own total once "Change Warehouse" is used.
          const flatAvailable = issueWarehouseId
            ? (issueAltWarehouses?.find((w) => w.warehouseId === issueWarehouseId)?.totalQuantity ?? 0)
            : issuingLine.availableStockQuantity;
          // The real ceiling for a FABRIC material with roll-level stock is
          // the flat ledger total — each individual roll's own <input> is
          // already capped at that specific roll's own remainingQuantity
          // (below), so summing several rolls can never itself exceed real
          // physical stock; this is only the second, whole-material floor.
          //
          // Capped at the flat total, not just the rolls' own numbers —
          // FabricRoll.remainingQuantity and the real StockBalance ledger
          // can drift out of sync (confirmed live on real data: a roll can
          // still show more "remaining" than the warehouse's actual balance,
          // left over from before rolls were kept in sync with every issue).
          // The server's own floor guard checks the real StockBalance, not
          // the roll — trusting the roll alone here would let the UI offer
          // a quantity that looks fine but fails after clicking Issue.
          const effectiveAvailable = flatAvailable;
          // Confirmed 2026-09-22: no longer scoped to any one request type —
          // real over-issue needs (wastage, minor rounding, etc.) happen on
          // ordinary Production Requirement/Damage Replacement lines too,
          // not just Sampling ones.
          const canIssueExtra = true;
          // With "Issue Extra" checked, the only real ceiling left is
          // physical stock — the planned/requested quantity is deliberately
          // no longer a hard cap, matching the confirmed override design.
          const cap = issueExtra && canIssueExtra ? effectiveAvailable : Math.min(issuingLine.remainingQuantity, effectiveAvailable);
          const mustPickRoll = isFabric && availableRolls.length > 0 && totalRollQty <= 0;
          // The real quantity about to be issued — the summed rolls in
          // fabric-with-rolls mode (Issue Quantity itself becomes a
          // read-only mirror of this below), the free-typed field otherwise.
          const effectiveIssueQty = isFabric && availableRolls.length > 0 ? totalRollQty : Number(issueQty);
          const isOverPlanned = effectiveIssueQty > issuingLine.remainingQuantity;
          const needsExtraReason = issueExtra && isOverPlanned && !issueExtraReason.trim();
          const overCap = effectiveIssueQty > cap;

          return (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {issuingLine.material.styleName} — {issuingLine.remainingQuantity} {issuingLine.uom.code} remaining
              {!isFabric && (
                <>
                  {" "}
                  · {flatAvailable} {issuingLine.uom.code} in stock at {activeWarehouseName}
                </>
              )}
            </p>

            {issuingLine.availableStockQuantity <= 0 && (
              <FormField label="Change Warehouse (optional)" htmlFor="issueWarehouseId">
                {issueAltWarehousesLoading ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking every other warehouse for real stock…</p>
                ) : issueAltWarehouses?.length === 0 ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    No stock of this material exists at any other warehouse either.
                  </p>
                ) : (
                  <>
                    <select
                      id="issueWarehouseId"
                      value={issueWarehouseId}
                      onChange={(e) => selectIssueWarehouse(e.target.value)}
                      className={textInputClass()}
                    >
                      <option value="">{request.warehouse.name} (this request&apos;s own warehouse — 0 available)</option>
                      {issueAltWarehouses?.map((w) => (
                        <option key={w.warehouseId} value={w.warehouseId}>
                          {w.warehouseName} — {w.totalQuantity} {issuingLine.uom.code} available
                        </option>
                      ))}
                    </select>
                    {issueWarehouseId && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Issuing from {activeWarehouseName} instead of {request.warehouse.name} — this request&apos;s own stated
                        warehouse.
                      </p>
                    )}
                  </>
                )}
              </FormField>
            )}

            {isFabric && (
              <FormField label="Color / Shade / GSM / Composition" htmlFor="issueRoll" required={availableRolls.length > 0}>
                {rollsLoading ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking available colors…</p>
                ) : availableRolls.length === 0 ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    No roll-level stock recorded for this material at {activeWarehouseName} — this will issue against the
                    general stock total instead ({flatAvailable} {issuingLine.uom.code} available).
                  </p>
                ) : (
                  // A checked-quantity table, not a single-pick dropdown —
                  // several colors/shades can be issued together in one
                  // action; a roll with a blank/zero qty simply isn't part
                  // of this issue.
                  <>
                    <div className="mb-2">
                      <BarcodeScanInput
                        placeholder="Scan a Fabric Roll label to fill its quantity…"
                        autoFocus={false}
                        onResolve={(outcome) => {
                          if (!outcome.ok) {
                            setRollScanMessage({ ok: false, text: outcome.message });
                            return;
                          }
                          const { data } = outcome;
                          if (data.entityType !== "FABRIC_ROLL") {
                            setRollScanMessage({ ok: false, text: "That barcode is not a Fabric Roll." });
                            return;
                          }
                          const roll = availableRolls.find((r) => r.id === data.entityId);
                          if (!roll) {
                            setRollScanMessage({ ok: false, text: "That roll is not available for this material/warehouse." });
                            return;
                          }
                          setRollQuantities((prev) => ({ ...prev, [roll.id]: roll.remainingQuantity }));
                          setRollScanMessage({ ok: true, text: `Filled ${formatRollLabel(roll)} — ${roll.remainingQuantity} ${issuingLine.uom.code}.` });
                        }}
                      />
                      {rollScanMessage && (
                        <p className={`mt-1 text-xs ${rollScanMessage.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {rollScanMessage.text}
                        </p>
                      )}
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
                          <th className="py-1.5 pl-2 pr-2 font-medium">Color / Shade / GSM / Composition</th>
                          <th className="py-1.5 pr-2 font-medium">Available</th>
                          <th className="py-1.5 pr-2 font-medium">Qty to Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {availableRolls.map((r) => {
                          const remaining = Number(r.remainingQuantity);
                          const qty = rollQuantities[r.id] ?? "";
                          return (
                            <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                              <td className="py-1.5 pl-2 pr-2">{formatRollLabel(r)}</td>
                              <td className="py-1.5 pr-2 text-zinc-500">
                                {r.remainingQuantity} {issuingLine.uom.code}
                              </td>
                              <td className="py-1.5 pr-2">
                                <input
                                  type="number"
                                  min={0}
                                  max={remaining}
                                  step="0.0001"
                                  value={qty}
                                  onChange={(e) => {
                                    const next = Number(e.target.value);
                                    const clamped =
                                      e.target.value !== "" && Number.isFinite(next) && next > remaining
                                        ? String(remaining)
                                        : e.target.value;
                                    setRollQuantities((prev) => ({ ...prev, [r.id]: clamped }));
                                  }}
                                  className={`${textInputClass()} w-24`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </>
                )}
              </FormField>
            )}

            <FormField label="Issue Quantity" htmlFor="issueQty" required>
              <input
                id="issueQty"
                type="number"
                min={0}
                // Capped by whichever is smaller — the request's own
                // remaining need, or what's actually on hand. In
                // fabric-with-rolls mode this field is a read-only mirror of
                // the roll table's own summed quantities above (each roll's
                // own input is what's actually editable there); otherwise
                // it's the original free-typed field, unchanged.
                disabled={mustPickRoll || (isFabric && availableRolls.length > 0)}
                max={cap}
                step="0.0001"
                value={isFabric && availableRolls.length > 0 ? String(totalRollQty) : issueQty}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setIssueQty(e.target.value !== "" && Number.isFinite(next) && next > cap ? String(cap) : e.target.value);
                }}
                className={textInputClass()}
              />
              {isFabric && availableRolls.length > 0 && overCap && (
                <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                  Total ({totalRollQty} {issuingLine.uom.code}) exceeds what can be issued right now ({cap} {issuingLine.uom.code}) —
                  reduce one or more roll quantities above.
                </p>
              )}
            </FormField>

            {canIssueExtra && (
              <div className="space-y-2 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={issueExtra}
                    onChange={(e) => {
                      setIssueExtra(e.target.checked);
                      if (!e.target.checked) setIssueExtraReason("");
                    }}
                  />
                  Issue extra (beyond the {issuingLine.remainingQuantity} {issuingLine.uom.code} planned)
                </label>
                {issueExtra && (
                  <FormField label="Reason" htmlFor="issueExtraReason" required={isOverPlanned}>
                    <input
                      id="issueExtraReason"
                      value={issueExtraReason}
                      onChange={(e) => setIssueExtraReason(e.target.value)}
                      placeholder="e.g. extra wastage during sample cutting"
                      className={textInputClass()}
                    />
                  </FormField>
                )}
              </div>
            )}

            {!issueWarehouseId && (
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
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIssuingLine(null)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={isBusy || mustPickRoll || needsExtraReason || overCap || !(effectiveIssueQty > 0)}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
              >
                {isBusy ? "Saving…" : "Issue"}
              </button>
            </div>
          </div>
          );
        })()}
      </Modal>

      <Modal open={!!otherWarehouseLine} onClose={() => setOtherWarehouseLine(null)} title="Other Warehouse Stock">
        {otherWarehouseLine && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {otherWarehouseLine.material.styleName} — 0 {otherWarehouseLine.uom.code} available at {request.warehouse.name}. Real
              stock elsewhere:
            </p>

            {otherWarehouseLoading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking every other warehouse…</p>}

            {!otherWarehouseLoading && otherWarehouseStock?.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No stock of this material exists at any other warehouse either.
              </p>
            )}

            {!otherWarehouseLoading && otherWarehouseStock && otherWarehouseStock.length > 0 && (
              <div className="space-y-3">
                {otherWarehouseStock.map((w) => (
                  <div key={w.warehouseId} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {w.warehouseName} — {w.totalQuantity} {otherWarehouseLine.uom.code}
                      </p>
                      <Link
                        href={`/inventory/stock-movements/new?movementType=TRANSFER&materialId=${otherWarehouseLine.material.id}&fromWarehouseId=${w.warehouseId}&toWarehouseId=${request.warehouse.id}`}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Transfer to {request.warehouse.name}
                      </Link>
                    </div>
                    {w.rolls.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                        {w.rolls.map((r) => (
                          <li key={r.id}>
                            {formatRollLabel(r)} — {r.remainingQuantity} {otherWarehouseLine.uom.code}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOtherWarehouseLine(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Close
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

  // "Purchase History" — self-fetches on open, last 1 year, per material
  // line — a decision aid for picking today's rate/supplier before
  // generating the new order.
  const [historyLine, setHistoryLine] = useState<ReviewLine | null>(null);
  const [history, setHistory] = useState<PurchaseHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Unit Price suggestions, one real historical entry per <option> — the
  // input stays a genuinely free-typed number (nothing forces picking one),
  // but every real price actually paid in the last year is one click away
  // via the browser's own native datalist dropdown.
  const [priceOptionsByMaterialId, setPriceOptionsByMaterialId] = useState<Record<string, PurchaseHistoryEntry[]>>({});

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

        const materialIds = [...new Set(lines.map((l) => l.materialId))];
        Promise.all(
          materialIds.map((materialId) =>
            fetch(`/api/v1/materials/${materialId}/rate-history?sinceDays=365`)
              .then((res) => res.json())
              .then((historyBody) => [materialId, historyBody.data?.history ?? []] as const)
          )
        ).then((entries) => setPriceOptionsByMaterialId(Object.fromEntries(entries)));
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
    <>
    <Modal open onClose={onClose} title="Generate Purchase Order(s)" maxWidthClass="max-w-6xl">
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
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryLine(l);
                              setHistory(null);
                              setHistoryLoading(true);
                              fetch(`/api/v1/materials/${l.materialId}/rate-history?sinceDays=365`)
                                .then((res) => res.json())
                                .then((body) => setHistory(body.data?.history ?? []))
                                .finally(() => setHistoryLoading(false));
                            }}
                            className="ml-2 block text-xs font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                          >
                            Purchase History
                          </button>
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
                            onChange={(e) => {
                              const unitPrice = e.target.value;
                              const patch: Partial<ReviewRowState> = { unitPrice };
                              // Picking one of the real historical prices from the
                              // datalist below also carries over the supplier that
                              // price was actually paid to — a genuinely free-typed
                              // price (not matching any real history entry) leaves
                              // the supplier exactly as it was, never cleared.
                              const matched = dedupePriceOptions(priceOptionsByMaterialId[l.materialId] ?? []).find(
                                (h) => String(h.unitPrice) === unitPrice
                              );
                              if (matched) patch.supplierId = matched.supplierId;
                              updateRow(l.materialRequestItemId, patch);
                            }}
                            // A real datalist, not a forced picker — the
                            // field stays freely typeable; when the last
                            // year has real purchase history for this
                            // material, every distinct price actually paid
                            // is one native-dropdown click away instead.
                            list={`price-history-${l.materialId}`}
                            className={`${textInputClass()} w-24`}
                          />
                          <datalist id={`price-history-${l.materialId}`}>
                            {dedupePriceOptions(priceOptionsByMaterialId[l.materialId] ?? []).map((h) => (
                              <option key={h.id} value={h.unitPrice} label={`${h.supplierName} — ${new Date(h.receivedDate).toLocaleDateString()}`} />
                            ))}
                          </datalist>
                        </td>
                        <td className="py-2">
                          <div className="w-40">
                            <SearchableSelect
                              disabled={!row.included}
                              value={row.supplierId}
                              onChange={(supplierId) => updateRow(l.materialRequestItemId, { supplierId })}
                              options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
                              placeholder="Search supplier…"
                              emptyOptionLabel="Pick a supplier…"
                            />
                          </div>
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

    <Modal open={!!historyLine} onClose={() => setHistoryLine(null)} title="Purchase History (Last 1 Year)">
      {historyLine && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {historyLine.materialName} <span className="text-xs text-zinc-400">({historyLine.materialCode})</span>
          </p>

          {historyLoading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}

          {!historyLoading && history?.length === 0 && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No purchases of this material in the last year.</p>
          )}

          {!historyLoading && history && history.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-1 pr-3 font-medium">Supplier</th>
                    <th className="py-1 pr-3 font-medium">Rate</th>
                    <th className="py-1 pr-3 font-medium">Received Date</th>
                    <th className="py-1 font-medium">Order / Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{h.supplierName}</td>
                      <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">{h.unitPrice}</td>
                      <td className="py-2 pr-3 text-zinc-700 dark:text-zinc-200">
                        {new Date(h.receivedDate).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-xs text-zinc-500">
                        {h.orderNumber} · {h.receiptNumber}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setHistoryLine(null)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
    </>
  );
}

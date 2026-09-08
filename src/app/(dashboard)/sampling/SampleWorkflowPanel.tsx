"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { MaterialPicker } from "@/components/ui/MaterialPicker";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useSubmoduleVisibility } from "@/lib/use-submodule-visibility";
import { STATUS_BADGE_CLASS, STATUS_LABELS } from "./statusLabels";

type SampleStatus = keyof typeof STATUS_LABELS;

interface Person {
  id: string;
  fullName: string;
}

interface SampleMaterialRow {
  id: string;
  plannedQuantity: string;
  notes: string | null;
  damagedQuantity: string | null;
  damageReason: string | null;
  // Decimal fields serialize as strings over the API (Prisma Decimal -> JSON)
  // — a "has this been set" check must use !== null, never truthy, same
  // documented landmine as damagedQuantity above.
  rate: string | null;
  gstPercentage: string | null;
  material: { id: string; styleName: string; styleCode: string };
  uom: { id: string; code: string } | null;
  color: { id: string; name: string; hexValue: string | null } | null;
  dye: { id: string; name: string; pantone: string | null } | null;
}

interface RateHistoryEntry {
  id: string;
  purchaseOrderItemId: string;
  unitPrice: number;
  receivedDate: string;
  receiptNumber: string;
  orderNumber: string;
  supplierName: string;
}

interface SampleOtherChargeRow {
  id: string;
  costHead: "PROCESS" | "FABRICATION" | "OTHER";
  description: string;
  amount: string;
  notes: string | null;
}

interface SampleApprovalRow {
  id: string;
  decision: "APPROVED" | "REJECTED" | "REVISION_REQUESTED";
  customerContactName: string | null;
  customerContactPhone: string | null;
  decisionNotes: string | null;
  decidedAt: string;
  decidedBy: Person;
}

interface SampleVersionRow {
  id: string;
  versionNumber: number;
  status: string;
  techPackNotes: string | null;
  estimatedCostPerUnit: string | null;
  // Costing rollup — all Decimal fields serialize as strings, use !== null.
  marginPercent: string | null;
  commissionPercent: string | null;
  freightAmount: string | null;
  costSubtotal: string | null;
  finalTotal: string | null;
  isCostingLocked: boolean;
  costingLockedAt: string | null;
  costingLockedBy: Person | null;
  createdAt: string;
  createdBy: Person;
  materials: SampleMaterialRow[];
  otherCharges: SampleOtherChargeRow[];
  approvals: SampleApprovalRow[];
}

interface SampleCommentRow {
  id: string;
  body: string;
  createdAt: string;
  author: Person;
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

interface SampleRequestDetail {
  id: string;
  status: SampleStatus;
  statusBeforeHold: SampleStatus | null;
  currentVersionNumber: number;
  styleName: string | null;
  color: string | null;
  productId: string | null;
  buyer: { name: string; contactPerson: string | null; phone: string | null } | null;
  versions: SampleVersionRow[];
  comments: SampleCommentRow[];
}

interface Option {
  id: string;
  name?: string;
  styleName?: string;
  code?: string;
}

interface MaterialOption extends Option {
  styleName: string;
  styleCode: string;
  baseUom?: { id: string; code: string } | null;
  materialCategory: string | null;
}

interface DyeOption {
  id: string;
  name: string;
  pantone: string | null;
}

/** The main happy-path stages, shown as a step tracker so it's visible at a glance where a request stands. */
const MAIN_STEPS: { key: SampleStatus; label: string }[] = [
  { key: "REQUESTED", label: "Requested" },
  { key: "TECH_PACK_READY", label: "Tech Pack" },
  { key: "IN_DEVELOPMENT", label: "Development" },
  { key: "INTERNAL_QC", label: "Internal QC" },
  { key: "SUBMITTED_TO_CUSTOMER", label: "With Customer" },
  { key: "APPROVED", label: "Approved" },
];

const STATUS_HELP: Record<SampleStatus, string> = {
  DRAFT: "This request hasn't been logged yet.",
  REQUESTED: "Logged and numbered. Add the tech pack below to create version 1 and start development.",
  TECH_PACK_READY: "Tech pack is in. Start development to begin making the physical sample.",
  IN_DEVELOPMENT: "The physical sample is being made. Once it's ready, send it for internal QC.",
  INTERNAL_QC: "Internal quality check in progress — pass it on to the customer, or send it back for more work.",
  SUBMITTED_TO_CUSTOMER: "Waiting on the customer. Record their decision below as soon as you hear back.",
  CUSTOMER_FEEDBACK_RECEIVED: "Recording the customer's decision…",
  REVISION_REQUESTED: "The customer asked for changes. Start a revision below — it becomes version " +
    "2 (or the next number) and picks up right where version 1 left off.",
  APPROVED: "Approved by the customer. This sample can now be referenced by a Sales Order (once that phase exists).",
  REJECTED: "Rejected by the customer. This request is closed — start a new Sample Request if needed.",
  ON_HOLD: "Paused. Resume to go back to exactly where this was, or cancel it.",
  CANCELLED: "This sample request was cancelled.",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

export function SampleWorkflowPanel({ sampleRequestId, initialRequest }: { sampleRequestId: string; initialRequest: SampleRequestDetail }) {
  const isVisible = useSubmoduleVisibility();
  const [request, setRequest] = useState(initialRequest);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [materialColors, setMaterialColors] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [versionNotes, setVersionNotes] = useState("");
  const [versionCost, setVersionCost] = useState("");
  const [versionFile, setVersionFile] = useState<File | null>(null);

  // Add/Edit Material — one Modal covers both modes, same "nullable target"
  // shape already used by Add/Edit Other Charge below: editMaterialTarget
  // null + addMaterialModalVersionId set means "add"; editMaterialTarget set
  // means "edit that row's own core fields" (its version is implied by the
  // row itself, so addMaterialModalVersionId is left null in that mode).
  const [addMaterialModalVersionId, setAddMaterialModalVersionId] = useState<string | null>(null);
  const [editMaterialTarget, setEditMaterialTarget] = useState<SampleMaterialRow | null>(null);
  const [materialId, setMaterialId] = useState("");
  const [materialQty, setMaterialQty] = useState("");
  const [materialUomId, setMaterialUomId] = useState("");
  const [materialColorId, setMaterialColorId] = useState("");
  const [materialDyes, setMaterialDyes] = useState<DyeOption[]>([]);
  const [materialDyeId, setMaterialDyeId] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");

  // Customer Decision (Approval/Rejection confirmation) — small focused
  // action, shown in a Modal rather than an always-visible form.
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState(false);
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | "REVISION_REQUESTED">("APPROVED");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [customerContactName, setCustomerContactName] = useState("");
  const [customerContactPhone, setCustomerContactPhone] = useState("");

  // Comments — the thread stays visible on the page; only composing a new
  // one opens a Modal.
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");

  const [categories, setCategories] = useState<Option[]>([]);
  const [seasons, setSeasons] = useState<Option[]>([]);
  const [convertStyleCode, setConvertStyleCode] = useState("");
  const [convertStyleName, setConvertStyleName] = useState(initialRequest.styleName ?? "");
  const [convertCategoryId, setConvertCategoryId] = useState("");
  const [convertSeasonId, setConvertSeasonId] = useState("");

  const [isEditingColor, setIsEditingColor] = useState(false);
  const [colorDraft, setColorDraft] = useState(initialRequest.color ?? "");

  // Report/Edit Damage — small focused CRUD on one existing material line.
  const [damageModalTarget, setDamageModalTarget] = useState<SampleMaterialRow | null>(null);
  const [damageQtyDraft, setDamageQtyDraft] = useState("");
  const [damageReasonDraft, setDamageReasonDraft] = useState("");

  // Set/Edit Rate+GST — same shape, on one existing material line.
  const [rateModalTarget, setRateModalTarget] = useState<SampleMaterialRow | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [gstDraft, setGstDraft] = useState("");
  // Real purchase-rate suggestions for whichever material/shade the Rate
  // modal is currently open for — fetched fresh per open, never persisted.
  const [rateHistory, setRateHistory] = useState<RateHistoryEntry[]>([]);
  const [rateHistoryFallback, setRateHistoryFallback] = useState<number | null>(null);
  const [isLoadingRateHistory, setIsLoadingRateHistory] = useState(false);

  // Add/Edit Other Charge — one Modal covers both modes: charge === null is
  // "add", charge set is "edit", so there's one set of draft fields instead
  // of a duplicated add-vs-edit pair.
  const [chargeModal, setChargeModal] = useState<{ versionId: string; charge: SampleOtherChargeRow | null } | null>(null);
  const [chargeCostHead, setChargeCostHead] = useState<SampleOtherChargeRow["costHead"]>("PROCESS");
  const [chargeDescription, setChargeDescription] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");

  // Edit Costing (margin/commission/freight/manual estimate) — the read-only
  // Cost Subtotal/Final Total overview stays inline on the page; only this
  // small edit form is a Modal.
  const [costingModalVersionId, setCostingModalVersionId] = useState<string | null>(null);
  const [marginDraft, setMarginDraft] = useState("");
  const [commissionDraft, setCommissionDraft] = useState("");
  const [freightDraft, setFreightDraft] = useState("");
  const [manualEstimateDraft, setManualEstimateDraft] = useState("");

  // Deleting a charge or an attachment is permanent (a real DB delete, and
  // for attachments the file is removed from disk too — neither is
  // recoverable through the app), so both go through this same confirmation
  // step rather than firing on a single click.
  const [deleteChargeTarget, setDeleteChargeTarget] = useState<SampleOtherChargeRow | null>(null);
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] = useState<AttachmentRow | null>(null);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/sampling/${sampleRequestId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/sampling/${sampleRequestId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [sampleRequestId]);

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/units?pageSize=200")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/colors?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterialColors(body.data ?? []));
    fetch("/api/v1/fabric-dyes")
      .then((res) => res.json())
      .then((body) => setMaterialDyes(body.data ?? []));
    fetch("/api/v1/categories?pageSize=200")
      .then((res) => res.json())
      .then((body) => setCategories(body.data ?? []));
    fetch("/api/v1/seasons?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSeasons(body.data ?? []));
    fetch("/api/v1/products/next-code")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.code) setConvertStyleCode(body.data.code);
      });
  }, []);

  const refresh = async () => {
    const res = await fetch(`/api/v1/sampling/${sampleRequestId}`);
    const body = await res.json();
    if (res.ok) setRequest(body.data);
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

  const transitionTo = (status: SampleStatus) =>
    run(
      () =>
        fetch(`/api/v1/sampling/${sampleRequestId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      "Failed to change status."
    );

  const resumeFromHold = () =>
    run(() => fetch(`/api/v1/sampling/${sampleRequestId}/resume`, { method: "POST" }), "Failed to resume.");

  const saveColor = () =>
    run(
      () =>
        fetch(`/api/v1/sampling/${sampleRequestId}/color`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ color: colorDraft || undefined }),
        }),
      "Failed to update color."
    ).then(() => setIsEditingColor(false));

  const addVersion = async () => {
    const payload: Record<string, unknown> = {};
    if (versionNotes) payload.techPackNotes = versionNotes;
    if (versionCost) payload.estimatedCostPerUnit = Number(versionCost);

    const ok = await run(
      () =>
        fetch(`/api/v1/sampling/${sampleRequestId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      "Failed to save version."
    );
    if (!ok) return;

    // Uploaded right alongside the tech pack notes/version, rather than
    // requiring a second, separate trip to the Attachments section below —
    // the file still lands as an ordinary sample-request-level attachment
    // (this project's own established scope for attachments, see the
    // Attachments section's own comment), just started from this one form.
    if (versionFile) {
      setIsBusy(true);
      const formData = new FormData();
      formData.append("file", versionFile);
      const uploadRes = await fetch(`/api/v1/sampling/${sampleRequestId}/attachments`, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        setError(await parseErrorMessage(uploadRes, "Version was saved, but the attachment failed to upload — you can upload it again below."));
      } else {
        await fetchAttachments();
      }
      setIsBusy(false);
    }

    setVersionNotes("");
    setVersionCost("");
    setVersionFile(null);
  };

  const openAddMaterialModal = (versionId: string) => {
    setEditMaterialTarget(null);
    setMaterialId("");
    setMaterialQty("");
    setMaterialUomId("");
    setMaterialColorId("");
    setMaterialDyeId("");
    setMaterialNotes("");
    setAddMaterialModalVersionId(versionId);
  };

  const openEditMaterialModal = (m: SampleMaterialRow) => {
    setAddMaterialModalVersionId(null);
    setMaterialId(m.material.id);
    setMaterialQty(m.plannedQuantity);
    setMaterialUomId(m.uom?.id ?? "");
    setMaterialColorId(m.color?.id ?? "");
    setMaterialDyeId(m.dye?.id ?? "");
    setMaterialNotes(m.notes ?? "");
    setEditMaterialTarget(m);
  };

  const closeMaterialModal = () => {
    setAddMaterialModalVersionId(null);
    setEditMaterialTarget(null);
  };

  const submitMaterial = () => {
    const payload = {
      materialId,
      plannedQuantity: Number(materialQty),
      uomId: materialUomId || undefined,
      colorId: materialColorId || undefined,
      dyeId: materialDyeId || undefined,
      notes: materialNotes || undefined,
    };

    if (editMaterialTarget) {
      run(
        () =>
          fetch(`/api/v1/sampling/materials/${editMaterialTarget.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }),
        "Failed to save this material line."
      ).then((ok) => {
        if (ok) closeMaterialModal();
      });
      return;
    }

    if (!addMaterialModalVersionId) return;
    run(
      () =>
        fetch(`/api/v1/sampling/versions/${addMaterialModalVersionId}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      "Failed to add material."
    ).then((ok) => {
      if (ok) closeMaterialModal();
    });
  };

  const openDamageModal = (m: SampleMaterialRow) => {
    setDamageModalTarget(m);
    setDamageQtyDraft(m.damagedQuantity ?? "");
    setDamageReasonDraft(m.damageReason ?? "");
  };

  const saveDamage = () => {
    if (!damageModalTarget) return;
    run(
      () =>
        fetch(`/api/v1/sampling/materials/${damageModalTarget.id}/damage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            damagedQuantity: Number(damageQtyDraft || 0),
            damageReason: damageReasonDraft || undefined,
          }),
        }),
      "Failed to record damage/wastage."
    ).then((ok) => {
      if (ok) setDamageModalTarget(null);
    });
  };

  const openRateModal = (m: SampleMaterialRow) => {
    setRateModalTarget(m);
    setRateDraft(m.rate ?? "");
    setGstDraft(m.gstPercentage ?? "");
    setRateHistory([]);
    setRateHistoryFallback(null);

    const params = new URLSearchParams();
    if (m.color) params.set("colorId", m.color.id);
    if (m.dye) params.set("dyeId", m.dye.id);
    setIsLoadingRateHistory(true);
    fetch(`/api/v1/materials/${m.material.id}/rate-history?${params.toString()}`)
      .then((res) => res.json())
      .then((body) => {
        const history: RateHistoryEntry[] = body.data?.history ?? [];
        const fallbackUnitCost: number | null = body.data?.fallbackUnitCost ?? null;
        setRateHistory(history);
        setRateHistoryFallback(fallbackUnitCost);

        // Only ever auto-fill an EMPTY rate — never silently overwrite a
        // rate this material already has recorded.
        if (m.rate === null) {
          if (history.length === 1) setRateDraft(String(history[0].unitPrice));
          else if (history.length === 0 && fallbackUnitCost !== null) setRateDraft(String(fallbackUnitCost));
        }
      })
      .finally(() => setIsLoadingRateHistory(false));
  };

  const saveRate = () => {
    if (!rateModalTarget) return;
    run(
      () =>
        fetch(`/api/v1/sampling/materials/${rateModalTarget.id}/costing`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rate: rateDraft === "" ? null : Number(rateDraft),
            gstPercentage: gstDraft === "" ? null : Number(gstDraft),
          }),
        }),
      "Failed to save the rate."
    ).then((ok) => {
      if (ok) setRateModalTarget(null);
    });
  };

  const openAddChargeModal = (versionId: string) => {
    setChargeCostHead("PROCESS");
    setChargeDescription("");
    setChargeAmount("");
    setChargeModal({ versionId, charge: null });
  };

  const openEditChargeModal = (versionId: string, charge: SampleOtherChargeRow) => {
    setChargeCostHead(charge.costHead);
    setChargeDescription(charge.description);
    setChargeAmount(charge.amount);
    setChargeModal({ versionId, charge });
  };

  const saveCharge = () => {
    if (!chargeModal) return;
    const payload = { costHead: chargeCostHead, description: chargeDescription, amount: Number(chargeAmount) };
    const request = chargeModal.charge
      ? fetch(`/api/v1/sampling/charges/${chargeModal.charge.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : fetch(`/api/v1/sampling/versions/${chargeModal.versionId}/charges`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

    run(() => request, chargeModal.charge ? "Failed to save the charge." : "Failed to add the charge.").then((ok) => {
      if (ok) setChargeModal(null);
    });
  };

  const confirmDeleteCharge = () => {
    if (!deleteChargeTarget) return;
    // Always closes when the request settles, success or failure — ConfirmModal
    // has no error display of its own, and leaving it open would hide the page's
    // error banner behind the modal backdrop.
    run(
      () => fetch(`/api/v1/sampling/charges/${deleteChargeTarget.id}`, { method: "DELETE" }),
      "Failed to delete the charge."
    ).then(() => setDeleteChargeTarget(null));
  };

  const openCostingModal = (versionId: string) => {
    setMarginDraft("");
    setCommissionDraft("");
    setFreightDraft("");
    setManualEstimateDraft("");
    setCostingModalVersionId(versionId);
  };

  const saveCostingSummary = () => {
    if (!costingModalVersionId) return;
    run(() => {
      const payload: Record<string, unknown> = {};
      if (marginDraft !== "") payload.marginPercent = Number(marginDraft);
      if (commissionDraft !== "") payload.commissionPercent = Number(commissionDraft);
      if (freightDraft !== "") payload.freightAmount = Number(freightDraft);
      if (manualEstimateDraft !== "") payload.estimatedCostPerUnit = Number(manualEstimateDraft);
      return fetch(`/api/v1/sampling/versions/${costingModalVersionId}/costing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }, "Failed to save costing.").then((ok) => {
      if (ok) setCostingModalVersionId(null);
    });
  };

  const lockCosting = (versionId: string) =>
    run(() => fetch(`/api/v1/sampling/versions/${versionId}/costing/lock`, { method: "POST" }), "Failed to lock costing.");

  const unlockCosting = (versionId: string) =>
    run(() => fetch(`/api/v1/sampling/versions/${versionId}/costing/unlock`, { method: "POST" }), "Failed to unlock costing.");

  const openDecisionModal = () => {
    setDecision("APPROVED");
    setDecisionNotes("");
    // Defaults from the request's own linked Buyer — editable afterwards,
    // since the person who actually calls back with the decision may not
    // be the Buyer master's own saved contact.
    setCustomerContactName(request.buyer?.contactPerson || request.buyer?.name || "");
    setCustomerContactPhone(request.buyer?.phone || "");
    setIsDecisionModalOpen(true);
  };

  const recordDecision = () => {
    if (!latestVersion) return;
    run(
      () =>
        fetch(`/api/v1/sampling/versions/${latestVersion.id}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision,
            customerContactName: customerContactName || undefined,
            customerContactPhone: customerContactPhone || undefined,
            decisionNotes: decisionNotes || undefined,
          }),
        }),
      "Failed to record the customer's decision."
    ).then((ok) => {
      if (ok) setIsDecisionModalOpen(false);
    });
  };

  const openCommentModal = () => {
    setCommentBody("");
    setIsCommentModalOpen(true);
  };

  const addComment = () =>
    run(
      () =>
        fetch(`/api/v1/sampling/${sampleRequestId}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: commentBody }),
        }),
      "Failed to add comment."
    ).then((ok) => {
      if (ok) setIsCommentModalOpen(false);
    });

  const convertToStyle = () =>
    run(
      () =>
        fetch(`/api/v1/sampling/${sampleRequestId}/convert-to-style`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            styleCode: convertStyleCode,
            styleName: convertStyleName,
            categoryId: convertCategoryId || undefined,
            seasonId: convertSeasonId || undefined,
          }),
        }),
      "Failed to convert this sample into a Style."
    );

  const openUploadModal = () => {
    setUploadFile(null);
    setIsUploadModalOpen(true);
  };

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/sampling/${sampleRequestId}/attachments`, { method: "POST", body: formData });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to upload the file."));
      setIsBusy(false);
      return;
    }

    setUploadFile(null);
    setIsUploadModalOpen(false);
    await fetchAttachments();
    setIsBusy(false);
  };

  const confirmDeleteAttachment = async () => {
    if (!deleteAttachmentTarget) return;
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/sampling/attachments/${deleteAttachmentTarget.id}`, { method: "DELETE" });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to delete the file."));
    } else {
      await fetchAttachments();
    }
    // Always closes when the request settles — same reasoning as
    // confirmDeleteCharge above.
    setDeleteAttachmentTarget(null);
    setIsBusy(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const latestVersion = request.versions[0];
  const isNonTerminal = !["APPROVED", "REJECTED", "CANCELLED"].includes(request.status);

  // The step tracker shows the main happy path; ON_HOLD/REVISION_REQUESTED/
  // REJECTED sit "at" the step they branched from (marked done, not current)
  // so it's obvious the request hasn't silently reset — an explanatory banner
  // below explains the exception instead.
  const isException = (["ON_HOLD", "REVISION_REQUESTED", "REJECTED", "CANCELLED"] as SampleStatus[]).includes(request.status);
  const effectiveStepStatus: SampleStatus =
    request.status === "ON_HOLD" && request.statusBeforeHold
      ? request.statusBeforeHold
      : request.status === "REVISION_REQUESTED" || request.status === "REJECTED"
        ? "SUBMITTED_TO_CUSTOMER"
        : request.status;
  const stepIndex = MAIN_STEPS.findIndex((s) => s.key === effectiveStepStatus);

  const costingModalVersion = request.versions.find((v) => v.id === costingModalVersionId) ?? null;
  const costingModalHasPricedData =
    costingModalVersion !== null &&
    (costingModalVersion.materials.some((m) => m.rate !== null) || costingModalVersion.otherCharges.length > 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[request.status]}`}>
          {STATUS_LABELS[request.status]}
        </span>
        {isBusy && <span className="text-xs text-zinc-400">Saving…</span>}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-zinc-700 dark:text-zinc-200">Color:</span>
        {isEditingColor ? (
          <>
            <input
              value={colorDraft}
              onChange={(e) => setColorDraft(e.target.value)}
              placeholder="e.g. Navy Blue"
              autoFocus
              className={`${textInputClass()} max-w-[200px]`}
            />
            <button
              type="button"
              onClick={saveColor}
              disabled={isBusy}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setColorDraft(request.color ?? "");
                setIsEditingColor(false);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-400"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="text-zinc-600 dark:text-zinc-300">{request.color || "Not specified yet"}</span>
            <button
              type="button"
              onClick={() => setIsEditingColor(true)}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              Edit
            </button>
          </>
        )}
      </div>

      {stepIndex >= 0 && (
        <div className="flex flex-wrap items-center gap-y-2">
          {MAIN_STEPS.map((step, i) => {
            const isPast = i < stepIndex || (i === stepIndex && isException);
            const isCurrent = i === stepIndex && !isException;
            return (
              <div key={step.key} className="flex items-center">
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                    isPast
                      ? "bg-green-600 text-white"
                      : isCurrent
                        ? "bg-indigo-600 text-white"
                        : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                  }`}
                >
                  {isPast ? "✓" : i + 1}
                </div>
                <span className={`ml-1.5 text-xs ${isCurrent ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-500"}`}>
                  {step.label}
                </span>
                {i < MAIN_STEPS.length - 1 && <div className="mx-2 h-px w-6 bg-zinc-300 dark:bg-zinc-700" />}
              </div>
            );
          })}
        </div>
      )}

      <p className={`text-sm ${isException ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-300"}`}>
        {STATUS_HELP[request.status]}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* Status-specific actions */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Actions</h2>

        {request.status === "REQUESTED" && (
          <VersionForm
            title="Mark tech pack ready — this creates version 1"
            notes={versionNotes}
            setNotes={setVersionNotes}
            cost={versionCost}
            setCost={setVersionCost}
            file={versionFile}
            setFile={setVersionFile}
            onSubmit={addVersion}
            isBusy={isBusy}
            submitLabel="Save Version 1"
          />
        )}

        {request.status === "TECH_PACK_READY" && (
          <ActionButton label="Start Development" onClick={() => transitionTo("IN_DEVELOPMENT")} isBusy={isBusy} />
        )}

        {request.status === "IN_DEVELOPMENT" && (
          <ActionButton label="Send to Internal QC" onClick={() => transitionTo("INTERNAL_QC")} isBusy={isBusy} />
        )}

        {request.status === "INTERNAL_QC" && (
          <div className="flex gap-3">
            <ActionButton label="Submit to Customer" onClick={() => transitionTo("SUBMITTED_TO_CUSTOMER")} isBusy={isBusy} />
            <ActionButton
              label="Send Back to Development"
              onClick={() => transitionTo("IN_DEVELOPMENT")}
              isBusy={isBusy}
              variant="secondary"
            />
          </div>
        )}

        {request.status === "SUBMITTED_TO_CUSTOMER" && !latestVersion && (
          <p className="text-sm text-red-600 dark:text-red-400">
            This request has no version to decide on — that shouldn&apos;t be possible. Put it on hold, then contact support.
          </p>
        )}

        {request.status === "SUBMITTED_TO_CUSTOMER" && latestVersion && (
          <ActionButton label="Record Customer Decision" onClick={openDecisionModal} isBusy={isBusy} />
        )}

        {request.status === "REVISION_REQUESTED" && (
          <VersionForm
            title={`Start revision — this creates version ${request.currentVersionNumber + 1}`}
            notes={versionNotes}
            setNotes={setVersionNotes}
            cost={versionCost}
            setCost={setVersionCost}
            file={versionFile}
            setFile={setVersionFile}
            onSubmit={addVersion}
            isBusy={isBusy}
            submitLabel="Save Revision"
          />
        )}

        {request.status === "ON_HOLD" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              On hold from <span className="font-medium">{request.statusBeforeHold ? STATUS_LABELS[request.statusBeforeHold] : "—"}</span>.
              Resuming picks up from exactly there.
            </p>
            <ActionButton label={`Resume to ${request.statusBeforeHold ? STATUS_LABELS[request.statusBeforeHold] : ""}`} onClick={resumeFromHold} isBusy={isBusy} />
          </div>
        )}

        {isNonTerminal && request.status !== "ON_HOLD" && (
          <div className="mt-4 flex gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <ActionButton label="Put On Hold" onClick={() => transitionTo("ON_HOLD")} isBusy={isBusy} variant="secondary" />
            <ActionButton label="Cancel Request" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}
        {request.status === "ON_HOLD" && (
          <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <ActionButton label="Cancel Request" onClick={() => transitionTo("CANCELLED")} isBusy={isBusy} variant="danger" />
          </div>
        )}

        {!isNonTerminal && <p className="text-sm text-zinc-500">This sample request is in a final state.</p>}
      </div>

      {/* Convert to Style — only once approved, and only if this wasn't already
          sampling an existing style. One-way action that creates a permanent
          Product/Style master, substantial enough to stay a page section
          rather than a small-CRUD modal. */}
      {request.status === "APPROVED" && !request.productId && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-500/5">
          <h2 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Convert to Style</h2>
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-300">
            This sample was approved and isn&apos;t linked to an existing Style yet. Create the permanent Style master
            now, or leave it for later — this sample stays Approved either way.
          </p>
          <div className="grid max-w-xl grid-cols-2 gap-4">
            <FormField label="Style Code" htmlFor="convertStyleCode" required>
              <input
                id="convertStyleCode"
                value={convertStyleCode}
                onChange={(e) => setConvertStyleCode(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Style Name" htmlFor="convertStyleName" required>
              <input
                id="convertStyleName"
                value={convertStyleName}
                onChange={(e) => setConvertStyleName(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Category" htmlFor="convertCategoryId">
              <select
                id="convertCategoryId"
                value={convertCategoryId}
                onChange={(e) => setConvertCategoryId(e.target.value)}
                className={textInputClass()}
              >
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Season" htmlFor="convertSeasonId">
              <select
                id="convertSeasonId"
                value={convertSeasonId}
                onChange={(e) => setConvertSeasonId(e.target.value)}
                className={textInputClass()}
              >
                <option value="">— None —</option>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div className="mt-3">
            <ActionButton
              label="Create Style"
              onClick={convertToStyle}
              isBusy={isBusy}
              disabled={!convertStyleCode.trim() || !convertStyleName.trim()}
            />
          </div>
        </div>
      )}

      {request.status === "APPROVED" && request.productId && (
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            This sample is linked to a Style master —{" "}
            <a href={`/masters/products/${request.productId}`} className="font-medium text-indigo-600 hover:text-indigo-500">
              open it to add Color × Size variants
            </a>
            .
          </p>
        </div>
      )}

      {/* Attachments — tech pack files, artwork, measurement sheets. Kept at the
          sample level (not per-version) to avoid over-complicating the model;
          uploaded/deleted dates make it easy to tell which round a file belongs to.
          The list stays visible on the page; uploading a new one opens a Modal. */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attachments</h2>
          <ActionButton label="Upload Attachment" onClick={openUploadModal} isBusy={isBusy} variant="secondary" />
        </div>
        <div className="mt-3 space-y-2">
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
                        {STATUS_LABELS[a.contextLabel as SampleStatus] ?? a.contextLabel}
                      </span>
                    </>
                  )}
                  {" · "}
                  {new Date(a.uploadedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteAttachmentTarget(a)}
                disabled={isBusy}
                className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Version timeline */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Versions</h2>
        {request.versions.length === 0 && <p className="text-sm text-zinc-500">No versions yet.</p>}
        <div className="space-y-4">
          {request.versions.map((version) => {
            const isLatest = version.versionNumber === request.currentVersionNumber;
            const canAddMaterial = isLatest && ["TECH_PACK_READY", "IN_DEVELOPMENT"].includes(request.status);
            // Costing is never gated by the sample's own status — only by
            // whether this version's costing itself is locked or superseded
            // (a superseded version's costing is already permanently frozen
            // by that status alone, same invariant the server enforces).
            const canEditCosting = version.status !== "SUPERSEDED" && !version.isCostingLocked;
            const versionHasPricedData =
              version.materials.some((m) => m.rate !== null) || version.otherCharges.length > 0;
            return (
              <div key={version.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Version {version.versionNumber} — {version.status}
                  </p>
                  <p className="text-xs text-zinc-500">
                    by {version.createdBy.fullName} on {formatDate(version.createdAt)}
                  </p>
                </div>
                {version.techPackNotes && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{version.techPackNotes}</p>}
                {version.estimatedCostPerUnit && (
                  <p className="mt-1 text-xs text-zinc-500">
                    Estimated cost/unit: {version.estimatedCostPerUnit}
                    {versionHasPricedData ? " (computed from the costing sheet below)" : ""}
                  </p>
                )}

                {version.materials.length > 0 && (
                  <table className="mt-3 w-full text-xs">
                    <thead>
                      <tr className="text-left text-zinc-500">
                        <th className="py-1 pr-3 font-medium">Material</th>
                        <th className="py-1 pr-3 font-medium">Color</th>
                        <th className="py-1 pr-3 font-medium">Shade / Pantone</th>
                        <th className="py-1 pr-3 font-medium">Quantity</th>
                        <th className="py-1 pr-3 font-medium">Unit</th>
                        <th className="py-1 pr-3 font-medium">Rate / GST %</th>
                        <th className="py-1 pr-3 font-medium">Damaged / Wasted</th>
                        {canAddMaterial && <th className="py-1 font-medium">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {version.materials.map((m) => (
                        <tr key={m.id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{m.material.styleName}</td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">
                            {m.color ? (
                              <span className="flex items-center gap-1.5">
                                {m.color.hexValue && (
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-600"
                                    style={{ backgroundColor: m.color.hexValue }}
                                  />
                                )}
                                {m.color.name}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">
                            {m.dye ? `${m.dye.name}${m.dye.pantone ? ` (${m.dye.pantone})` : ""}` : "—"}
                          </td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{m.plannedQuantity}</td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{m.uom?.code ?? "—"}</td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">
                            {m.rate !== null ? (
                              <span className="flex items-center gap-1.5">
                                <span>
                                  {m.rate}
                                  {m.gstPercentage !== null ? ` (+${m.gstPercentage}% GST)` : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openRateModal(m)}
                                  className="font-medium text-indigo-600 hover:text-indigo-500"
                                >
                                  Edit
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openRateModal(m)}
                                className="font-medium text-indigo-600 hover:text-indigo-500"
                              >
                                Set rate
                              </button>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">
                            {m.damagedQuantity !== null ? (
                              <span className="flex items-center gap-1.5">
                                <span className="text-amber-600 dark:text-amber-400">
                                  {m.damagedQuantity} {m.uom?.code ?? ""}
                                  {m.damageReason ? ` — ${m.damageReason}` : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openDamageModal(m)}
                                  className="font-medium text-indigo-600 hover:text-indigo-500"
                                >
                                  Edit
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openDamageModal(m)}
                                className="font-medium text-indigo-600 hover:text-indigo-500"
                              >
                                Report damage
                              </button>
                            )}
                          </td>
                          {canAddMaterial && (
                            <td className="py-1 text-zinc-700 dark:text-zinc-200">
                              <button
                                type="button"
                                onClick={() => openEditMaterialModal(m)}
                                className="font-medium text-indigo-600 hover:text-indigo-500"
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {canAddMaterial && (
                  <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <ActionButton label="+ Add Material" onClick={() => openAddMaterialModal(version.id)} isBusy={isBusy} variant="secondary" />
                  </div>
                )}

                {/* Other Charges — non-material costing lines (labor/process/
                    overhead). Plain CRUD, no merge-key semantics — a
                    duplicate charge is just user error the merchandiser
                    edits/deletes directly. */}
                <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Other Charges</p>
                    {canEditCosting && (
                      <ActionButton label="+ Add Charge" onClick={() => openAddChargeModal(version.id)} isBusy={isBusy} variant="secondary" />
                    )}
                  </div>
                  {version.otherCharges.length > 0 && (
                    <table className="mt-2 w-full text-xs">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="py-1 pr-3 font-medium">Cost Head</th>
                          <th className="py-1 pr-3 font-medium">Description</th>
                          <th className="py-1 pr-3 font-medium">Amount</th>
                          <th className="py-1 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {version.otherCharges.map((c) => (
                          <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{formatCategoryLabel(c.costHead)}</td>
                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{c.description}</td>
                            <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{c.amount}</td>
                            <td className="py-1 text-right">
                              {canEditCosting && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditChargeModal(version.id, c)}
                                    className="mr-2 font-medium text-indigo-600 hover:text-indigo-500"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteChargeTarget(c)}
                                    disabled={isBusy}
                                    className="font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
                                  >
                                    Remove
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Costing overview — hardcoded formula (materialCost +
                    otherCharges -> subtotal -> +margin% -> +commission% ->
                    +freight -> finalTotal), base currency only. Never a gate
                    on the sample's own status/workflow. The read-only summary
                    stays inline on the page; editing margin/commission/
                    freight/manual-estimate is a small-CRUD action in a Modal. */}
                <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Costing</p>
                    {version.isCostingLocked && (
                      <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        Locked{version.costingLockedBy ? ` by ${version.costingLockedBy.fullName}` : ""}
                      </span>
                    )}
                  </div>
                  <dl className="mt-1 grid grid-cols-5 gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <div>
                      <dt className="text-zinc-400">Cost Subtotal</dt>
                      <dd>{version.costSubtotal ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Margin %</dt>
                      <dd>{version.marginPercent ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Commission %</dt>
                      <dd>{version.commissionPercent ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Freight</dt>
                      <dd>{version.freightAmount ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Final Total</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-50">{version.finalTotal ?? "—"}</dd>
                    </div>
                  </dl>

                  <div className="mt-2 flex gap-2">
                    {canEditCosting && (
                      <>
                        <ActionButton label="Edit Costing" onClick={() => openCostingModal(version.id)} isBusy={isBusy} variant="secondary" />
                        <ActionButton label="Lock Costing" onClick={() => lockCosting(version.id)} isBusy={isBusy} variant="secondary" />
                      </>
                    )}
                    {!canEditCosting && version.isCostingLocked && version.status !== "SUPERSEDED" && (
                      <ActionButton label="Unlock Costing" onClick={() => unlockCosting(version.id)} isBusy={isBusy} variant="secondary" />
                    )}
                  </div>
                </div>

                {version.approvals.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    {version.approvals.map((a) => (
                      <p key={a.id} className="text-xs text-zinc-600 dark:text-zinc-300">
                        <span className="font-medium">{a.decision.replace("_", " ")}</span> by {a.decidedBy.fullName} on{" "}
                        {formatDate(a.decidedAt)}
                        {a.customerContactName ? ` — contact: ${a.customerContactName}` : ""}
                        {a.customerContactPhone ? ` (${a.customerContactPhone})` : ""}
                        {a.decisionNotes ? ` — "${a.decisionNotes}"` : ""}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Comments — the thread stays visible on the page; composing a new one opens a Modal. */}
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Comments</h2>
          <ActionButton label="Add Comment" onClick={openCommentModal} isBusy={isBusy} variant="secondary" />
        </div>
        <div className="mt-3 space-y-2">
          {request.comments.length === 0 && <p className="text-sm text-zinc-500">No comments yet.</p>}
          {request.comments.map((c) => (
            <div key={c.id} className="rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800">
              <p className="text-zinc-700 dark:text-zinc-200">{c.body}</p>
              <p className="mt-1 text-xs text-zinc-400">
                {c.author.fullName} — {formatDateTime(c.createdAt)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/sampling/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/sampling/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}

      {/* Add Material */}
      <Modal
        open={addMaterialModalVersionId !== null || editMaterialTarget !== null}
        onClose={closeMaterialModal}
        title={editMaterialTarget ? `Edit Material — ${editMaterialTarget.material.styleName}` : "Add Material"}
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-3">
          <FormField label="Material" htmlFor="modalMaterialId" required>
            <MaterialPicker
              id="modalMaterialId"
              required
              materials={materials}
              value={materialId}
              onChange={(value) => {
                setMaterialId(value);
                // Default the Unit to the material's own base UOM — the
                // dropdown stays editable in case this line genuinely
                // needs a different unit than the master default.
                const selected = materials.find((m) => m.id === value);
                setMaterialUomId(selected?.baseUom?.id ?? "");
              }}
            />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Quantity" htmlFor="modalMaterialQty" required>
              <input
                id="modalMaterialQty"
                type="number"
                min={0}
                step="0.0001"
                value={materialQty}
                onChange={(e) => setMaterialQty(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Unit" htmlFor="modalMaterialUom">
              <select id="modalMaterialUom" value={materialUomId} onChange={(e) => setMaterialUomId(e.target.value)} className={textInputClass()}>
                <option value="">— Unit —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Color" htmlFor="modalMaterialColor">
              <select id="modalMaterialColor" value={materialColorId} onChange={(e) => setMaterialColorId(e.target.value)} className={textInputClass()}>
                <option value="">— Optional —</option>
                {materialColors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {isVisible("FABRIC_DYE") && (
            <FormField label="Shade / Pantone (optional)" htmlFor="modalMaterialDye">
              <select id="modalMaterialDye" value={materialDyeId} onChange={(e) => setMaterialDyeId(e.target.value)} className={textInputClass()}>
                <option value="">— None —</option>
                {materialDyes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.pantone ? ` (${d.pantone})` : ""}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="Notes (optional)" htmlFor="modalMaterialNotes">
            <input
              id="modalMaterialNotes"
              value={materialNotes}
              onChange={(e) => setMaterialNotes(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={closeMaterialModal} isBusy={false} variant="secondary" />
            <ActionButton
              label={editMaterialTarget ? "Save Changes" : "Add Material"}
              onClick={submitMaterial}
              isBusy={isBusy}
              disabled={!materialId || !materialQty}
            />
          </div>
        </div>
      </Modal>

      {/* Set/Edit Rate + GST */}
      <Modal open={rateModalTarget !== null} onClose={() => setRateModalTarget(null)} title={`Rate — ${rateModalTarget?.material.styleName ?? ""}`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Rate" htmlFor="modalRate" required>
              <input
                id="modalRate"
                type="number"
                min={0}
                step="0.01"
                autoFocus
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="GST %" htmlFor="modalGst">
              <input
                id="modalGst"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={gstDraft}
                onChange={(e) => setGstDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          </div>

          {isLoadingRateHistory && <p className="text-xs text-zinc-400">Checking purchase history…</p>}

          {!isLoadingRateHistory && rateHistory.length > 1 && (
            <FormField label="Suggested rate (from purchase history)" htmlFor="modalRateSuggestion">
              <select
                id="modalRateSuggestion"
                value=""
                onChange={(e) => {
                  if (e.target.value) setRateDraft(e.target.value);
                }}
                className={textInputClass()}
              >
                <option value="">— Pick a past rate to use —</option>
                {rateHistory.map((h) => (
                  <option key={h.id} value={h.unitPrice}>
                    ₹{h.unitPrice} — {h.supplierName} — {formatDate(h.receivedDate)} ({h.orderNumber})
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {!isLoadingRateHistory && rateHistory.length === 1 && (
            <p className="text-xs text-zinc-500">
              {rateModalTarget?.rate === null ? "Rate auto-filled from" : "Matches"} the only past purchase of this material{rateModalTarget?.color || rateModalTarget?.dye ? " in this shade" : ""}: {rateHistory[0].supplierName} on{" "}
              {formatDate(rateHistory[0].receivedDate)} ({rateHistory[0].orderNumber}).
            </p>
          )}

          {!isLoadingRateHistory && rateHistory.length === 0 && rateHistoryFallback !== null && (
            <p className="text-xs text-zinc-500">
              No purchase history{rateModalTarget?.color || rateModalTarget?.dye ? " for this shade" : ""}
              {rateModalTarget?.rate === null ? " — rate auto-filled from this material's default cost (Masters → Materials)." : " — this material's default cost (Masters → Materials) is available above."}
            </p>
          )}

          {!isLoadingRateHistory && rateHistory.length === 0 && rateHistoryFallback === null && (
            <p className="text-xs text-zinc-500">
              No purchase history{rateModalTarget?.color || rateModalTarget?.dye ? " for this shade" : ""} and no default cost set for this material — enter the rate manually.
            </p>
          )}

          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setRateModalTarget(null)} isBusy={false} variant="secondary" />
            <ActionButton label="Save Rate" onClick={saveRate} isBusy={isBusy} />
          </div>
        </div>
      </Modal>

      {/* Report/Edit Damage */}
      <Modal open={damageModalTarget !== null} onClose={() => setDamageModalTarget(null)} title={`Damage / Wastage — ${damageModalTarget?.material.styleName ?? ""}`}>
        <div className="space-y-3">
          <FormField label="Damaged / Wasted Quantity" htmlFor="modalDamageQty" required>
            <input
              id="modalDamageQty"
              type="number"
              min={0}
              step="0.0001"
              autoFocus
              value={damageQtyDraft}
              onChange={(e) => setDamageQtyDraft(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Reason" htmlFor="modalDamageReason">
            <input id="modalDamageReason" value={damageReasonDraft} onChange={(e) => setDamageReasonDraft(e.target.value)} className={textInputClass()} />
          </FormField>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setDamageModalTarget(null)} isBusy={false} variant="secondary" />
            <ActionButton label="Save" onClick={saveDamage} isBusy={isBusy} disabled={!damageQtyDraft} />
          </div>
        </div>
      </Modal>

      {/* Add/Edit Other Charge */}
      <Modal open={chargeModal !== null} onClose={() => setChargeModal(null)} title={chargeModal?.charge ? "Edit Charge" : "Add Charge"}>
        <div className="space-y-3">
          <FormField label="Cost Head" htmlFor="modalChargeCostHead">
            <select
              id="modalChargeCostHead"
              value={chargeCostHead}
              onChange={(e) => setChargeCostHead(e.target.value as SampleOtherChargeRow["costHead"])}
              className={textInputClass()}
            >
              <option value="PROCESS">Process</option>
              <option value="FABRICATION">Fabrication</option>
              <option value="OTHER">Other</option>
            </select>
          </FormField>
          <FormField label="Description" htmlFor="modalChargeDescription" required>
            <input
              id="modalChargeDescription"
              autoFocus
              value={chargeDescription}
              onChange={(e) => setChargeDescription(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Amount" htmlFor="modalChargeAmount" required>
            <input
              id="modalChargeAmount"
              type="number"
              min={0}
              step="0.01"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setChargeModal(null)} isBusy={false} variant="secondary" />
            <ActionButton
              label={chargeModal?.charge ? "Save Charge" : "Add Charge"}
              onClick={saveCharge}
              isBusy={isBusy}
              disabled={!chargeDescription || !chargeAmount}
            />
          </div>
        </div>
      </Modal>

      {/* Edit Costing (margin/commission/freight/manual estimate) */}
      <Modal open={costingModalVersionId !== null} onClose={() => setCostingModalVersionId(null)} title="Edit Costing">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Margin %" htmlFor="modalMargin">
              <input
                id="modalMargin"
                type="number"
                min={0}
                step="0.01"
                autoFocus
                placeholder={costingModalVersion?.marginPercent ?? "0"}
                value={marginDraft}
                onChange={(e) => setMarginDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Commission %" htmlFor="modalCommission">
              <input
                id="modalCommission"
                type="number"
                min={0}
                step="0.01"
                placeholder={costingModalVersion?.commissionPercent ?? "0"}
                value={commissionDraft}
                onChange={(e) => setCommissionDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Freight" htmlFor="modalFreight">
              <input
                id="modalFreight"
                type="number"
                min={0}
                step="0.01"
                placeholder={costingModalVersion?.freightAmount ?? "0"}
                value={freightDraft}
                onChange={(e) => setFreightDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          </div>
          {/* Manual cost/unit only matters while nothing is priced yet — once
              a material has a rate or a charge exists, estimatedCostPerUnit
              is computed and a manual value would just be ignored server-side. */}
          {!costingModalHasPricedData && (
            <FormField label="Manual Cost/Unit" htmlFor="modalManualEstimate">
              <input
                id="modalManualEstimate"
                type="number"
                min={0}
                step="0.01"
                placeholder={costingModalVersion?.estimatedCostPerUnit ?? "0"}
                value={manualEstimateDraft}
                onChange={(e) => setManualEstimateDraft(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          )}
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setCostingModalVersionId(null)} isBusy={false} variant="secondary" />
            <ActionButton label="Save Costing" onClick={saveCostingSummary} isBusy={isBusy} />
          </div>
        </div>
      </Modal>

      {/* Approval/Rejection confirmation — the customer's decision */}
      <Modal open={isDecisionModalOpen} onClose={() => setIsDecisionModalOpen(false)} title="Record Customer Decision">
        <div className="space-y-3">
          <FormField label="Customer Decision" htmlFor="modalDecision" required>
            <select
              id="modalDecision"
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
              className={textInputClass()}
            >
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="REVISION_REQUESTED">Revision Requested</option>
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Customer Contact Name" htmlFor="modalContactName">
              <input
                id="modalContactName"
                value={customerContactName}
                onChange={(e) => setCustomerContactName(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
            <FormField label="Customer Phone" htmlFor="modalContactPhone">
              <input
                id="modalContactPhone"
                value={customerContactPhone}
                onChange={(e) => setCustomerContactPhone(e.target.value)}
                className={textInputClass()}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="modalDecisionNotes">
            <textarea
              id="modalDecisionNotes"
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              rows={2}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setIsDecisionModalOpen(false)} isBusy={false} variant="secondary" />
            <ActionButton label="Record Decision" onClick={recordDecision} isBusy={isBusy} />
          </div>
        </div>
      </Modal>

      {/* Add Comment */}
      <Modal open={isCommentModalOpen} onClose={() => setIsCommentModalOpen(false)} title="Add Comment">
        <div className="space-y-3">
          <FormField label="Comment" htmlFor="modalCommentBody" required>
            <textarea
              id="modalCommentBody"
              autoFocus
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setIsCommentModalOpen(false)} isBusy={false} variant="secondary" />
            <ActionButton label="Post" onClick={addComment} isBusy={isBusy} disabled={!commentBody.trim()} />
          </div>
        </div>
      </Modal>

      {/* Upload Attachment */}
      <Modal open={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} title="Upload Attachment">
        <div className="space-y-3">
          <input
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-600 dark:text-zinc-300"
          />
          <p className="text-xs text-zinc-400">JPEG, PNG, WEBP, PDF, Word, or Excel — up to 20 MB.</p>
          <div className="flex gap-3">
            <ActionButton label="Cancel" onClick={() => setIsUploadModalOpen(false)} isBusy={false} variant="secondary" />
            <ActionButton label="Upload" onClick={uploadAttachment} isBusy={isBusy} disabled={!uploadFile} />
          </div>
        </div>
      </Modal>

      {/* Deleting a charge or an attachment is a real, permanent delete — no
          soft-delete column on either table, and an attachment's file is
          also removed from disk — so both are confirmed before firing. */}
      <ConfirmModal
        open={deleteChargeTarget !== null}
        title="Remove this charge?"
        message={`"${deleteChargeTarget?.description ?? ""}" (${deleteChargeTarget?.amount ?? ""}) will be permanently deleted and the costing total recalculated. This cannot be undone.`}
        confirmLabel="Remove"
        isDangerous
        isBusy={isBusy}
        onConfirm={confirmDeleteCharge}
        onCancel={() => setDeleteChargeTarget(null)}
      />
      <ConfirmModal
        open={deleteAttachmentTarget !== null}
        title="Remove this attachment?"
        message={`"${deleteAttachmentTarget?.fileName ?? ""}" will be permanently deleted, including the stored file. This cannot be undone.`}
        confirmLabel="Remove"
        isDangerous
        isBusy={isBusy}
        onConfirm={confirmDeleteAttachment}
        onCancel={() => setDeleteAttachmentTarget(null)}
      />
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

function VersionForm({
  title,
  notes,
  setNotes,
  cost,
  setCost,
  file,
  setFile,
  onSubmit,
  isBusy,
  submitLabel,
}: {
  title: string;
  notes: string;
  setNotes: (v: string) => void;
  cost: string;
  setCost: (v: string) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  onSubmit: () => void;
  isBusy: boolean;
  submitLabel: string;
}) {
  return (
    <div className="max-w-md space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{title}</p>
      <FormField label="Tech Pack Notes" htmlFor="techPackNotes">
        <textarea id="techPackNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={textInputClass()} />
      </FormField>
      <FormField label="Estimated Cost / Unit" htmlFor="estimatedCost">
        <input
          id="estimatedCost"
          type="number"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className={textInputClass()}
        />
      </FormField>
      <FormField label="Attach Tech Pack File (optional)" htmlFor="versionFile">
        <input
          id="versionFile"
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-600 dark:text-zinc-300"
        />
        {file && <p className="mt-1 text-xs text-zinc-400">Selected: {file.name}</p>}
      </FormField>
      <ActionButton label={submitLabel} onClick={onSubmit} isBusy={isBusy} />
    </div>
  );
}

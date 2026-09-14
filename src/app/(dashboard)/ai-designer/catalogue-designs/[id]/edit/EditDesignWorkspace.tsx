"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import type { EditMode } from "@/modules/ai-designer/ai-designer.schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiDesignerImageRow {
  id: string;
  generationId: string;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  createdAt: string;
}

type ApprovalStatus = "DRAFT" | "AI_MODIFIED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

interface CurrentVersion {
  id: string;
  versionNumber: number;
  currentImageId: string;
  changeSummary: string | null;
  approvalStatus: ApprovalStatus;
  approvedByUserId: string | null;
  approvedAt: string | null;
  aiPromptId: string | null;
  technicalChangesJson: Record<string, string> | null;
  currentImage: AiDesignerImageRow;
}

interface ProjectData {
  id: string;
  projectNumber: string;
  projectName: string;
  productCategory: string | null;
  currentVersion: CurrentVersion | null;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  changeSummary: string | null;
  approvalStatus: ApprovalStatus;
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: string | null;
  aiPrompt: { id: string; promptText: string } | null;
  technicalChangesJson: Record<string, string> | null;
  createdBy: { id: string; fullName: string };
  createdAt: string;
  currentImage: AiDesignerImageRow;
}

interface PreviewBatch {
  generationId: string;
  images: AiDesignerImageRow[];
}

// ---------------------------------------------------------------------------
// Left-sidebar edit-category vocabulary — a cross-cutting taxonomy of
// EDIT TARGETS (Fabric/Color/Print/...), deliberately a different axis from
// the Product Design step's own garment-CATEGORY-keyed attribute catalog
// (Masters -> AI Design -> Product Design) — see the investigation this
// workspace was scoped from. Selecting a leaf item here only sets which
// human-readable label feeds the AI prompt (Quick Edit's "Feature"); it is
// NOT a real pixel-space region selector — no image masking exists anywhere
// in this codebase (confirmed before building this), so a leaf item is a
// labeled edit target, not a drawn/clicked area of the photo.
// ---------------------------------------------------------------------------

const EDIT_CATEGORIES: { group: string; items: string[] }[] = [
  { group: "Garment Structure", items: ["Garment Type", "Silhouette", "Fit", "Length", "Proportion", "Front Shape", "Back Shape"] },
  { group: "Fabric", items: ["Fabric Type", "Composition", "GSM", "Weave / Knit", "Width", "Stretch", "Texture", "Finish"] },
  { group: "Color", items: ["Body Color", "Secondary Color", "Contrast Color", "Custom Color"] },
  { group: "Print", items: ["Print Type", "Artwork", "Placement", "Scale", "Repeat Pattern", "Print Colors", "Print Technique"] },
  { group: "Embroidery", items: ["Artwork", "Placement", "Size", "Thread Color", "Embroidery Type", "Density"] },
  { group: "Neck / Collar", items: ["Neck Shape", "Collar Type", "Collar Height", "Collar Width", "Rib", "Binding", "Interlining"] },
  { group: "Sleeve", items: ["Sleeve Type", "Sleeve Length", "Sleeve Volume", "Cuff Type", "Cuff Width", "Opening"] },
  { group: "Pocket", items: ["Pocket Type", "Position", "Size", "Quantity", "Flap", "Zip"] },
  { group: "Closure", items: ["Button", "Zipper", "Snap", "Hook", "Velcro", "Placket", "Closure Position"] },
  { group: "Trims & Accessories", items: ["Button", "Zip", "Lace", "Tape", "Cord", "Buckle", "Elastic", "Rivet", "Patch"] },
  { group: "Branding", items: ["Logo", "Embroidery Logo", "Patch", "Badge", "Heat Transfer", "Main Label", "Branding Placement"] },
  { group: "Stitching", items: ["Seam Type", "Stitch Type", "SPI", "Top Stitch", "Contrast Stitch"] },
  { group: "Wash & Finish", items: ["Garment Wash", "Enzyme Wash", "Stone Wash", "Acid Wash", "Fade", "Distress", "Coating"] },
  { group: "Measurements", items: ["Chest", "Waist", "Hip", "Garment Length", "Sleeve Length", "Shoulder"] },
  { group: "Construction", items: ["Seam", "Panel", "Dart", "Pleat", "Gathering", "Yoke", "Facing", "Lining"] },
  { group: "Design Details", items: ["Ruffle", "Frill", "Cut-out", "Piping", "Binding", "Appliqué", "Patchwork"] },
];

const STATUS_BADGE: Record<ApprovalStatus, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  AI_MODIFIED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  UNDER_REVIEW: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  DRAFT: "Draft",
  AI_MODIFIED: "AI Modified",
  UNDER_REVIEW: "Under Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

// A manufacturing-impact hint is shown per edit category — deliberately a
// static, honest note (no calculated severity, no fabricated numbers, no
// real downstream write) since AI Designer has zero real connection to the
// BOM/Costing/Tech Pack modules — see this workspace's own scoping decision.
const IMPACT_HINTS: Record<string, string> = {
  Fabric: "Fabric changes typically affect the Bill of Materials, costing, and any generated Tech Pack — review those manually after applying.",
  "Trims & Accessories": "Trim changes typically affect the Bill of Materials and costing — review those manually after applying.",
  Closure: "Closure changes typically affect the Bill of Materials and costing — review those manually after applying.",
  Branding: "Branding/label changes typically affect the Bill of Materials and packaging specs — review those manually after applying.",
  Measurements: "Measurement changes typically affect the Tech Pack's grading chart — regenerate the Tech Pack after applying.",
  Construction: "Construction changes typically affect the Tech Pack's construction callouts — regenerate the Tech Pack after applying.",
};

function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

function downloadUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download`;
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EditDesignWorkspace({ projectId, initialProject }: { projectId: string; initialProject: ProjectData }) {
  const [project, setProject] = useState<ProjectData>(initialProject);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [preview, setPreview] = useState<PreviewBatch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [applyImageId, setApplyImageId] = useState<string | null>(null);
  const [compareImageId, setCompareImageId] = useState<string | null>(null);
  const [lightboxAttachmentId, setLightboxAttachmentId] = useState<string | null>(null);

  // Left sidebar
  const [leftOpen, setLeftOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);

  // Right panel — edit form
  const [rightOpen, setRightOpen] = useState(true);
  const [editMode, setEditMode] = useState<EditMode>("QUICK");
  const [currentValue, setCurrentValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [techRows, setTechRows] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [freeform, setFreeform] = useState("");
  const [imageCount, setImageCount] = useState(1);

  // Center canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Bottom area
  const [bottomTab, setBottomTab] = useState<"variations" | "compare" | "versions">("variations");

  function run(key: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(key);
    fn()
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."))
      .finally(() => setBusy(null));
  }

  async function refreshProject() {
    const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}`));
    setProject(body.data);
  }

  async function refreshVersions() {
    const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/versions`));
    setVersions(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-designer/projects/${projectId}/versions`)
      .then(parseJson)
      .then((body) => setVersions(body.data ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentImage = project.currentVersion?.currentImage ?? null;
  const hasUnsavedEdit =
    (editMode === "QUICK" && (currentValue.trim() || newValue.trim())) ||
    (editMode === "TECHNICAL" && techRows.some((r) => r.key.trim() && r.value.trim())) ||
    (editMode === "AI_PROMPT" && freeform.trim());

  function resetEditForm() {
    setCurrentValue("");
    setNewValue("");
    setTechRows([{ key: "", value: "" }]);
    setFreeform("");
  }

  function selectCategoryItem(group: string, item: string) {
    setActiveGroup(group);
    setActiveItem(item);
    setCurrentValue("");
    setNewValue("");
  }

  function toggleGroup(group: string) {
    setExpandedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  function generatePreview() {
    if (!activeItem && editMode !== "AI_PROMPT") {
      setError("Choose an edit category on the left first.");
      return;
    }
    const featureLabel = editMode === "AI_PROMPT" ? activeItem ?? "Custom Instruction" : activeItem!;
    const technicalFields =
      editMode === "TECHNICAL"
        ? Object.fromEntries(techRows.filter((r) => r.key.trim() && r.value.trim()).map((r) => [r.key.trim(), r.value.trim()]))
        : undefined;

    run("preview", async () => {
      const body = await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: editMode,
            featureLabel,
            currentValue: editMode === "QUICK" ? currentValue : undefined,
            newValue: editMode === "QUICK" ? newValue : undefined,
            technicalFields,
            freeformInstructions: editMode === "AI_PROMPT" ? freeform : editMode === "QUICK" ? undefined : freeform || undefined,
            imageCount,
          }),
        })
      );
      setPreview({ generationId: body.data.generation.id, images: body.data.images });
      setBottomTab("variations");
      resetEditForm();
    });
  }

  function confirmApply(imageId: string) {
    run("apply", async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/images/${imageId}/apply-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        })
      );
      setApplyImageId(null);
      setPreview(null);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      await Promise.all([refreshProject(), refreshVersions()]);
      setBottomTab("versions");
    });
  }

  function rejectPreviewImage(imageId: string) {
    run(`reject-${imageId}`, async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/images/${imageId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "REJECT" }),
        })
      );
      setPreview((prev) => (prev ? { ...prev, images: prev.images.map((img) => (img.id === imageId ? { ...img, decision: "REJECTED" } : img)) } : prev));
    });
  }

  function decideVersion(action: "approve" | "reject") {
    run(action, async () => {
      await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/versions/${action}`, { method: "POST" }));
      setConfirmAction(null);
      await Promise.all([refreshProject(), refreshVersions()]);
    });
  }

  // Canvas zoom/pan
  function onCanvasMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return;
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
  }
  function onCanvasMouseMove(e: React.MouseEvent) {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  }
  function onCanvasMouseUp() {
    dragState.current = null;
    setIsDragging(false);
  }

  const compareVersion = versions.find((v) => v.currentImage.id === compareImageId);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`/ai-designer/catalogue-designs/${projectId}`} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            ← Back
          </Link>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{project.projectName}</span>
          <span className="text-zinc-400">{project.projectNumber}</span>
          {project.productCategory && <span className="text-zinc-400">· {project.productCategory}</span>}
          {project.currentVersion && (
            <>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                V{project.currentVersion.versionNumber}
              </span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[project.currentVersion.approvalStatus]}`}>
                {STATUS_LABEL[project.currentVersion.approvalStatus]}
              </span>
            </>
          )}
          {hasUnsavedEdit && <span className="text-xs text-amber-600 dark:text-amber-400">● Unsaved edit in progress</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!!busy || project.currentVersion?.approvalStatus === "APPROVED"}
            onClick={() => setConfirmAction("approve")}
            className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950"
          >
            Approve Design
          </button>
          <button
            type="button"
            disabled={!!busy || project.currentVersion?.approvalStatus === "REJECTED"}
            onClick={() => setConfirmAction("reject")}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Reject Design
          </button>
          <a
            href={`/api/v1/ai-designer/projects/${projectId}/export?format=png`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Export
          </a>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">{error}</div>
      )}

      {/* Main 3-column area */}
      <div className="flex min-h-0 flex-1">
        {/* Left sidebar */}
        {leftOpen ? (
          <div className="w-64 shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Edit Categories</span>
              <button type="button" onClick={() => setLeftOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
                ◀
              </button>
            </div>
            {EDIT_CATEGORIES.map(({ group, items }) => (
              <div key={group} className="border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {group}
                  <span className="text-zinc-400">{expandedGroups[group] ? "−" : "+"}</span>
                </button>
                {expandedGroups[group] && (
                  <div className="pb-1">
                    {items.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => selectCategoryItem(group, item)}
                        className={`block w-full px-5 py-1 text-left text-xs ${
                          activeGroup === group && activeItem === item
                            ? "bg-indigo-100 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLeftOpen(true)}
            className="w-6 shrink-0 border-r border-zinc-200 bg-zinc-50 text-xs text-zinc-400 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          >
            ▶
          </button>
        )}

        {/* Center canvas */}
        <div className="flex min-w-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
          <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="rounded border px-2 py-0.5 text-xs">
              Zoom In
            </button>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} className="rounded border px-2 py-0.5 text-xs">
              Zoom Out
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="rounded border px-2 py-0.5 text-xs"
            >
              Fit to Screen
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="rounded border px-2 py-0.5 text-xs"
            >
              Reset View
            </button>
            <span className="ml-auto text-xs text-zinc-400">{Math.round(zoom * 100)}%</span>
          </div>
          <div
            className="flex flex-1 items-center justify-center overflow-hidden"
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
            style={{ cursor: zoom > 1 ? "grab" : "default" }}
          >
            {currentImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl(currentImage.imageAttachmentId)}
                alt={project.projectName}
                draggable={false}
                className="max-h-full max-w-full select-none object-contain"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: isDragging ? "none" : "transform 0.1s" }}
              />
            ) : (
              <p className="text-sm text-zinc-400">No design generated yet.</p>
            )}
          </div>

          {/* Bottom area */}
          <div className="h-64 shrink-0 overflow-y-auto border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex border-b border-zinc-200 dark:border-zinc-800">
              {(["variations", "compare", "versions"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setBottomTab(tab)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${
                    bottomTab === tab
                      ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-400"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {tab === "variations" ? `AI Variations${preview ? ` (${preview.images.length})` : ""}` : tab}
                </button>
              ))}
            </div>

            {bottomTab === "variations" && (
              <div className="p-3">
                {!preview && <p className="text-xs text-zinc-400">Generate a preview from the right panel to see variations here.</p>}
                {preview && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded border border-zinc-200 p-1 text-center dark:border-zinc-800">
                      <p className="mb-1 text-[10px] font-medium text-zinc-500">Original</p>
                      {currentImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(currentImage.imageAttachmentId)}
                          alt="Original"
                          onClick={() => setLightboxAttachmentId(currentImage.imageAttachmentId)}
                          className="mx-auto h-28 w-full cursor-zoom-in rounded object-contain bg-white"
                        />
                      )}
                    </div>
                    {preview.images.map((img, i) => (
                      <div key={img.id} className="rounded border border-zinc-200 p-1 text-center dark:border-zinc-800">
                        <p className="mb-1 text-[10px] font-medium text-zinc-500">Variation {String.fromCharCode(65 + i)}</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imageUrl(img.imageAttachmentId)}
                          alt={`Variation ${i + 1}`}
                          onClick={() => setLightboxAttachmentId(img.imageAttachmentId)}
                          className="mx-auto h-28 w-full cursor-zoom-in rounded object-contain bg-white"
                        />
                        {img.decision === "PENDING" && (
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => setApplyImageId(img.id)}
                              className="flex-1 rounded bg-indigo-600 px-1 py-0.5 text-[10px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                            >
                              Select &amp; Apply
                            </button>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => rejectPreviewImage(img.id)}
                              className="rounded border px-1 py-0.5 text-[10px] disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {img.decision !== "PENDING" && (
                          <p className={`mt-1 text-[10px] font-medium ${img.decision === "SELECTED" ? "text-green-600" : "text-zinc-400"}`}>
                            {img.decision === "SELECTED" ? "Applied" : "Rejected"}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {bottomTab === "compare" && (
              <div className="p-3">
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">Compare current design against:</span>
                  <select
                    value={compareImageId ?? ""}
                    onChange={(e) => setCompareImageId(e.target.value || null)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <option value="">Select a version…</option>
                    {versions
                      .filter((v) => v.currentImage.id !== currentImage?.id)
                      .map((v) => (
                        <option key={v.id} value={v.currentImage.id}>
                          V{v.versionNumber} — {v.changeSummary ?? "No description"}
                        </option>
                      ))}
                  </select>
                </div>
                {compareVersion ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <p className="mb-1 text-[10px] font-medium text-zinc-500">
                        V{compareVersion.versionNumber} — {compareVersion.changeSummary ?? "No description"}
                      </p>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl(compareVersion.currentImage.imageAttachmentId)}
                        alt="Before"
                        onClick={() => setLightboxAttachmentId(compareVersion.currentImage.imageAttachmentId)}
                        className="mx-auto h-40 w-full cursor-zoom-in rounded border object-contain bg-white"
                      />
                    </div>
                    <div className="text-center">
                      <p className="mb-1 text-[10px] font-medium text-zinc-500">
                        Current — V{project.currentVersion?.versionNumber}
                      </p>
                      {currentImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageUrl(currentImage.imageAttachmentId)}
                          alt="After"
                          onClick={() => setLightboxAttachmentId(currentImage.imageAttachmentId)}
                          className="mx-auto h-40 w-full cursor-zoom-in rounded border object-contain bg-white"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">Pick a prior version above for a side-by-side before/after comparison.</p>
                )}
              </div>
            )}

            {bottomTab === "versions" && (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {versions.length === 0 && <p className="p-3 text-xs text-zinc-400">No versions yet.</p>}
                {versions.map((v) => (
                  <div key={v.id} className="flex items-start gap-3 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(v.currentImage.imageAttachmentId)}
                      alt={`Version ${v.versionNumber}`}
                      onClick={() => setLightboxAttachmentId(v.currentImage.imageAttachmentId)}
                      className="h-14 w-14 shrink-0 cursor-zoom-in rounded border object-cover bg-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold">V{v.versionNumber}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[v.approvalStatus]}`}>{STATUS_LABEL[v.approvalStatus]}</span>
                        {v.id === project.currentVersion?.id && <span className="text-[10px] text-indigo-500">● current</span>}
                      </div>
                      <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{v.changeSummary ?? "Initial design."}</p>
                      <p className="text-[10px] text-zinc-400">
                        {v.createdBy.fullName} · {new Date(v.createdAt).toLocaleString()}
                        {v.approvedBy && ` · Approved by ${v.approvedBy.fullName}`}
                      </p>
                      {v.aiPrompt && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[10px] text-zinc-400">AI Prompt</summary>
                          <p className="whitespace-pre-wrap text-[10px] text-zinc-500">{v.aiPrompt.promptText}</p>
                        </details>
                      )}
                      {v.technicalChangesJson && Object.keys(v.technicalChangesJson).length > 0 && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[10px] text-zinc-400">Technical Changes</summary>
                          <ul className="text-[10px] text-zinc-500">
                            {Object.entries(v.technicalChangesJson).map(([k, val]) => (
                              <li key={k}>
                                {k}: {val}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setCompareImageId(v.currentImage.id);
                        setBottomTab("compare");
                      }}
                      className="shrink-0 text-[10px] text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Compare
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right panel — contextual property editor */}
        {rightOpen ? (
          <div className="w-80 shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Edit</span>
              <button type="button" onClick={() => setRightOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
                ▶
              </button>
            </div>

            <p className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
              {activeItem ? (
                <>
                  Editing: <span className="font-medium">{activeGroup} → {activeItem}</span>
                </>
              ) : (
                "Choose a category on the left, or switch to AI Prompt mode for a free-text instruction."
              )}
            </p>

            {activeGroup && IMPACT_HINTS[activeGroup] && (
              <p className="mb-3 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                {IMPACT_HINTS[activeGroup]}
              </p>
            )}

            <div className="mb-3 flex gap-1 rounded bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900">
              {(["QUICK", "TECHNICAL", "AI_PROMPT"] as EditMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEditMode(m)}
                  className={`flex-1 rounded px-2 py-1 font-medium ${
                    editMode === m ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-400" : "text-zinc-500"
                  }`}
                >
                  {m === "QUICK" ? "Quick Edit" : m === "TECHNICAL" ? "Technical Edit" : "AI Prompt"}
                </button>
              ))}
            </div>

            {editMode === "QUICK" && (
              <div className="space-y-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">Current Value</label>
                  <input
                    value={currentValue}
                    onChange={(e) => setCurrentValue(e.target.value)}
                    placeholder="e.g. Round Neck"
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">New Requirement</label>
                  <input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="e.g. Mandarin Collar"
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">Additional Instructions (optional)</label>
                  <textarea
                    value={freeform}
                    onChange={(e) => setFreeform(e.target.value)}
                    rows={2}
                    className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              </div>
            )}

            {editMode === "TECHNICAL" && (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-500">Add exact manufacturing parameters — reflected in the new version&apos;s design specification data.</p>
                {techRows.map((row, i) => (
                  <div key={i} className="flex gap-1">
                    <input
                      value={row.key}
                      onChange={(e) => setTechRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
                      placeholder="Parameter (e.g. Collar Type)"
                      className="w-1/2 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <input
                      value={row.value}
                      onChange={(e) => setTechRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))}
                      placeholder="Value (e.g. Mandarin)"
                      className="w-1/2 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTechRows((rows) => [...rows, { key: "", value: "" }])}
                  className="text-[10px] text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  + Add parameter
                </button>
              </div>
            )}

            {editMode === "AI_PROMPT" && (
              <div>
                <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">Describe the design change you want…</label>
                <textarea
                  value={freeform}
                  onChange={(e) => setFreeform(e.target.value)}
                  rows={5}
                  placeholder='e.g. "Change the round neck into a mandarin collar." / "Reduce sleeve length by 2 cm."'
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            )}

            <div className="mt-3">
              <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">Variations to generate</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setImageCount(n)}
                    className={`flex-1 rounded border px-2 py-1 text-xs ${
                      imageCount === n ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={busy === "preview"}
              onClick={generatePreview}
              className="mt-3 w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy === "preview" ? "Generating preview…" : "Generate Preview"}
            </button>
            {busy === "preview" && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">This can take up to a minute. Nothing is applied until you review and select a result below.</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRightOpen(true)}
            className="w-6 shrink-0 border-l border-zinc-200 bg-white text-xs text-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          >
            ◀
          </button>
        )}
      </div>

      <ConfirmModal
        open={applyImageId !== null}
        title="Apply This Variation?"
        message="This will become the new current design (a new version). The other previewed variations will be marked rejected. This does not change any real BOM, Costing, or Tech Pack records — review those manually if needed."
        confirmLabel="Apply as New Version"
        isBusy={busy === "apply"}
        onConfirm={() => applyImageId && confirmApply(applyImageId)}
        onCancel={() => setApplyImageId(null)}
      />

      <ConfirmModal
        open={confirmAction !== null}
        title={confirmAction === "approve" ? "Approve Design?" : "Reject Design?"}
        message={
          confirmAction === "approve"
            ? "Marks the current version as Approved for this project's design status."
            : "Marks the current version as Rejected — this does not delete or revert anything."
        }
        confirmLabel={confirmAction === "approve" ? "Approve" : "Reject"}
        isDangerous={confirmAction === "reject"}
        isBusy={busy === confirmAction}
        onConfirm={() => confirmAction && decideVersion(confirmAction)}
        onCancel={() => setConfirmAction(null)}
      />

      {lightboxAttachmentId && (
        <FilePreviewModal
          key={lightboxAttachmentId}
          open={lightboxAttachmentId !== null}
          onClose={() => setLightboxAttachmentId(null)}
          previewUrl={imageUrl(lightboxAttachmentId)}
          downloadUrl={downloadUrl(lightboxAttachmentId)}
          fileName={`${project.projectNumber}.png`}
          mimeType="image/png"
        />
      )}
    </div>
  );
}

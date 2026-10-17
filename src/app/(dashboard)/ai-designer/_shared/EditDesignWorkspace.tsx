"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { toast } from "@/components/ui/Toast";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { MaskCanvas, type MaskCanvasHandle } from "@/components/ui/MaskCanvas";
import { PEN_COLORS, SketchPenCanvas, type SketchPenCanvasHandle } from "@/components/ui/SketchPenCanvas";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import type { EditMode } from "@/modules/ai-designer/ai-designer.schema";
import type { DesignAttributeDef } from "@/core/ai-designer/catalogs/design-attribute-catalog";
import { DesignOptionImage } from "@/core/ai-designer/catalogs/design-icon-catalog";
import { SKETCH_STRUCTURE_OPTIONS } from "@/core/ai-designer/catalogs/sketch-structure-catalog";
import { useAiDesignerDisplayMode } from "@/lib/use-ai-designer-display-mode";

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
  embellishmentMotifAttachmentId: string | null;
  sketchImageAttachmentId?: string | null;
  sourceImageAttachmentId?: string | null;
  designSource?: string | null;
  fabricImageAttachmentId?: string | null;
  fabricName?: string | null;
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

/** Sentinel activeGroup value for a click on the dynamic Design Attributes section — see matchedDesignAttr below. */
const DESIGN_ATTRIBUTES_GROUP = "Design Attributes";

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

/**
 * The sidebar's primary, always-visible section is no longer a hand-picked
 * 5-group subset of EDIT_CATEGORIES matched by group NAME — it's rendered
 * directly, dynamically, from designAttributes (the project's own
 * productCategory's real Product Design attribute list — Masters -> AI
 * Design -> Product Design). This is what makes it genuinely dynamic per
 * the explicit ask: an admin adding a new attribute (e.g. "Waist Add-On")
 * or a new option's reference photo in Masters shows up here immediately,
 * with zero code change — every attribute the category has gets its own
 * image-picker entry, not just a fixed 5. matchedDesignAttr below matches
 * by the clicked item's own LABEL against designAttributes directly, not
 * through this now-removed group-name indirection.
 *
 * EDIT_CATEGORIES (the free-text edit-target taxonomy) is unchanged and
 * still fully available under "More Categories (Advanced)" — for edit
 * targets that genuinely have no Product Design attribute (Fabric,
 * Stitching, Wash & Finish, Branding, …), plain text remains the only way
 * to describe the change, same as before.
 */

const EMBELLISHMENT_TYPE_LABELS: Record<string, string> = {
  DIGITAL_APPLIQUE: "Digital Applique",
  EMBROIDERY: "Embroidery",
  SEQUIN_WORK: "Sequin Work",
  LACE_TRIM: "Lace Trim",
  BEADWORK: "Beadwork",
  PATCHWORK: "Patchwork",
};

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

interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  bottomCollapsed: boolean;
}
const LAYOUT_STORAGE_KEY = "ai-designer.edit.layout.v1";
const DEFAULT_LAYOUT: PanelLayout = { leftWidth: 256, rightWidth: 320, bottomHeight: 176, bottomCollapsed: false };
/** Height of the bottom panel's tab bar — what stays visible when it is collapsed. */
const BOTTOM_TAB_BAR_PX = 37;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

function clampZoom(z: number) {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 100) / 100;
}

function clampLayout(l: PanelLayout, centerHeight?: number): PanelLayout {
  const maxBottom = centerHeight ? Math.max(120, centerHeight * 0.75) : 640;
  return {
    leftWidth: Math.round(Math.min(480, Math.max(180, Number(l.leftWidth) || DEFAULT_LAYOUT.leftWidth))),
    rightWidth: Math.round(Math.min(560, Math.max(260, Number(l.rightWidth) || DEFAULT_LAYOUT.rightWidth))),
    bottomHeight: Math.round(Math.min(maxBottom, Math.max(80, Number(l.bottomHeight) || DEFAULT_LAYOUT.bottomHeight))),
    bottomCollapsed: Boolean(l.bottomCollapsed),
  };
}

const SKETCH_QUICK_INSTRUCTIONS = [
  "Add front button placket with contrast topstitching",
  "Change to raglan sleeves with 2-inch rib cuffs",
  "Convert to tiered gathered skirt with ruffle hem",
  "Add patch pockets on chest and waist",
  "Show back view with yoke and center box pleat",
  "Change to sweetheart neckline with princess seams",
  "Lower neckline by 3 cm and add Peter Pan collar",
  "Add delicate waist belt loops and fabric tie belt",
];

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

export function EditDesignWorkspace({
  projectId,
  initialProject,
  basePath = "/ai-designer/catalogue-designs",
  initialEditFrom = "SKETCH",
}: {
  projectId: string;
  initialProject: ProjectData;
  /** Same reasoning as AiDesignerWorkflowPanel's own basePath — lets this workspace serve both /catalogue-designs and /sketch-to-garment. */
  basePath?: string;
  /** "Edit Garment" / "Edit Sketch" buttons open the editor already in that mode (default Sketch). */
  initialEditFrom?: "SKETCH" | "GARMENT";
}) {
  const [project, setProject] = useState<ProjectData>(initialProject);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [preview, setPreview] = useState<PreviewBatch | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [applyImageId, setApplyImageId] = useState<string | null>(null);
  const [compareImageId, setCompareImageId] = useState<string | null>(null);
  const [lightboxAttachmentId, setLightboxAttachmentId] = useState<string | null>(null);

  // Edit mode: default is SKETCH per user requirement: "give option to edit from sketch and default option is sketch"
  const [editFrom, setEditFrom] = useState<"SKETCH" | "GARMENT">(initialEditFrom);

  // Through Sketch Edit Form state
  const [sketchInstruction, setSketchInstruction] = useState("");
  const [sketchStructuralFields, setSketchStructuralFields] = useState<Record<string, string>>({});
  const [sketchViewAngle, setSketchViewAngle] = useState<"FRONT" | "BACK" | "BOTH">("FRONT");
  const [sketchGenerateGarment, setSketchGenerateGarment] = useState(true);
  const [sketchImageCount, setSketchImageCount] = useState<number>(1);
  // How the sketch is edited: one-click construction options (default), the pen, or a description.
  const [sketchTool, setSketchTool] = useState<"OPTIONS" | "PEN" | "DESCRIBE">("OPTIONS");
  // Construction options already applied to the sketch, and the sketches before each apply (for Undo).
  const [sketchHistory, setSketchHistory] = useState<{ attachmentId: string; applied: Record<string, string> }[]>([]);
  const [constructionFlats, setConstructionFlats] = useState<Record<string, string>>({});
  const penCanvasRef = useRef<SketchPenCanvasHandle>(null);
  const [penHasStrokes, setPenHasStrokes] = useState(false);

  // Left sidebar — the 5 visual-picker groups start expanded (the intended
  // "first thing you see"), everything else stays collapsed under
  // "More Categories" until the user explicitly asks for it.
  const [leftOpen, setLeftOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<string | null>(null);

  // Right panel — edit form
  const [rightOpen, setRightOpen] = useState(true);
  // Widened beyond EditMode (the real /edit endpoint's own mode enum) to also
  // cover the Embellishments tab (its own apply-embellishments endpoint, no
  // preview/select step) and Draw & Describe / "MASK" (its own multipart
  // /mask-edit endpoint) — neither is ever sent as-is to the generic /edit
  // call; generatePreview() guards against both.
  const [editMode, setEditMode] = useState<EditMode | "EMBELLISHMENTS" | "MASK">("AI_PROMPT");
  const [currentValue, setCurrentValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [techRows, setTechRows] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [freeform, setFreeform] = useState("");
  const [imageCount, setImageCount] = useState(1);
  // Draw & Describe — the canvas owns its own strokes internally; this
  // component only needs to know whether anything has been drawn yet (to
  // enable/disable Generate Preview) and the free-text instruction that
  // goes with it.
  const maskCanvasRef = useRef<MaskCanvasHandle>(null);
  const [maskHasStrokes, setMaskHasStrokes] = useState(false);
  const [maskInstruction, setMaskInstruction] = useState("");
  // Which side(s) of the garment an edit's regenerated image should show —
  // user-requested (2026-09-22). Defaults to FRONT, treated by the prompt
  // layer as "no change requested" so every pre-existing edit keeps working
  // exactly as before.
  const [viewAngle, setViewAngle] = useState<"FRONT" | "BACK" | "BOTH">("FRONT");
  const [embellishmentType, setEmbellishmentType] = useState<string>("DIGITAL_APPLIQUE");
  const [embellishmentInstructions, setEmbellishmentInstructions] = useState("");

  // Product Design's own real, per-company attribute catalog (Masters -> AI
  // Design -> Product Design) — the sidebar's primary "Design Attributes"
  // section is rendered directly from this list (dynamic — an admin-added
  // attribute or option photo shows up here with zero code change), and the
  // QUICK Edit "New Requirement" field shows its real reference images.
  const [designAttributes, setDesignAttributes] = useState<DesignAttributeDef[]>([]);
  const [optionReferenceImages, setOptionReferenceImages] = useState<Record<string, string>>({});
  // Attribute LABEL -> picked value, accumulated across every Design
  // Attribute the user visits (not just the currently-focused one) -- this
  // is what lets picking a value for e.g. Length, then also Sleeve, then
  // Neckline all stay staged together instead of each new pick silently
  // discarding the previous one (a real reported bug: switching categories
  // used to reset the single shared newValue field). Generate Preview sends
  // every staged pick together as one combined TECHNICAL edit.
  const [designAttrSelections, setDesignAttrSelections] = useState<Record<string, string>>({});
  const designDisplayMode = useAiDesignerDisplayMode();

  // Center canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Bottom area
  const [bottomTab, setBottomTab] = useState<"variations" | "compare" | "versions">("variations");

  // Panel sizes, resizable with the cursor (drag handles) and remembered per browser.
  const [layout, setLayout] = useState<PanelLayout>(DEFAULT_LAYOUT);
  const layoutAtDragStart = useRef<PanelLayout>(DEFAULT_LAYOUT);
  const centerColumnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore of a browser-only preference after hydration
      if (saved && typeof saved === "object") setLayout((prev) => clampLayout({ ...prev, ...saved }));
    } catch {
      /* ignore a corrupt saved layout */
    }
  }, []);
  function updateLayout(patch: Partial<PanelLayout>) {
    setLayout((prev) => {
      const next = clampLayout({ ...prev, ...patch }, centerColumnRef.current?.clientHeight);
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Full screen: hides the app header/sidebar so the design box gets the whole window. Esc exits.
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Ctrl/⌘ + mouse wheel over the design box zooms in/out (native listener: React's wheel handler is passive).
  useEffect(() => {
    const el = centerColumnRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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

  // Restores a genuinely successful, still-PENDING edit generation on page
  // load/re-navigation — a real, confirmed-live bug fixed here: `preview`
  // used to only ever be set by the generation call that just completed,
  // with nothing to repopulate it afterward, so an edit that worked
  // perfectly could sit PENDING in the database while a reload made it
  // look like it had silently failed.
  useEffect(() => {
    fetch(`/api/v1/ai-designer/projects/${projectId}/edit-preview`)
      .then(parseJson)
      .then((body) => {
        if (body.data) {
          setPreview({ generationId: body.data.generationId, images: body.data.images });
          setBottomTab("variations");
        }
      })
      .catch(() => {});
  }, [projectId, project.currentVersion?.currentImageId]);

  useEffect(() => {
    const category = project.productCategory;
    if (!category) return;
    fetch(`/api/v1/ai-designer/product-design-attributes/effective?category=${encodeURIComponent(category)}`)
      .then((r) => r.json())
      .then((body) => setDesignAttributes(body.data ?? []))
      .catch(() => setDesignAttributes([]));
  }, [project.productCategory]);

  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes/reference-images")
      .then((r) => r.json())
      .then((body) => {
        const map: Record<string, string> = {};
        for (const row of body.data ?? []) {
          if (row.attachmentId) map[row.optionValue] = row.attachmentId;
        }
        setOptionReferenceImages(map);
      })
      .catch(() => setOptionReferenceImages({}));
  }, []);

  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes/reference-images?variant=CAD_FLAT")
      .then((r) => r.json())
      .then((body) => {
        const map: Record<string, string> = {};
        for (const row of body.data ?? []) {
          if (row.attachmentId) map[row.optionValue] = row.attachmentId;
        }
        setConstructionFlats(map);
      })
      .catch(() => setConstructionFlats({}));
  }, []);

  const currentImage = project.currentVersion?.currentImage ?? null;
  const activeSketchAttachmentId =
    project.sketchImageAttachmentId ||
    (project.designSource === "SKETCH" ? project.sourceImageAttachmentId : null) ||
    null;

  const hasUnsavedEdit =
    editFrom === "SKETCH"
      ? Boolean((sketchTool === "PEN" && penHasStrokes) || (sketchTool !== "OPTIONS" && sketchInstruction.trim()))
      : (editMode === "QUICK" && (currentValue.trim() || newValue.trim() || Object.keys(designAttrSelections).length > 0)) ||
        (editMode === "TECHNICAL" && techRows.some((r) => r.key.trim() && r.value.trim())) ||
        (editMode === "AI_PROMPT" && freeform.trim()) ||
        (editMode === "MASK" && (maskHasStrokes || maskInstruction.trim()));

  function resetEditForm() {
    setCurrentValue("");
    setNewValue("");
    setTechRows([{ key: "", value: "" }]);
    setFreeform("");
    setDesignAttrSelections({});
    setMaskInstruction("");
    setSketchInstruction("");
    setSketchStructuralFields({});
    maskCanvasRef.current?.clear();
    penCanvasRef.current?.clear();
  }

  async function generateSketchForCurrentProject() {
    run("generate-sketch", async () => {
      const body = await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/generate-sketch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewAngle: sketchViewAngle }),
        })
      );
      await Promise.all([refreshProject(), refreshVersions()]);
      if (body.data?.images && body.data.images.length > 0) {
        setPreview({ generationId: body.data.generation.id, images: body.data.images });
        setBottomTab("variations");
      }
    });
  }

  async function executeThroughSketchEdit() {
    run("sketch-edit", async () => {
      const usePen = sketchTool === "PEN";
      const payload = {
        instruction: sketchInstruction.trim() || undefined,
        viewAngle: sketchViewAngle,
        imageCount: sketchImageCount,
        generateGarment: sketchGenerateGarment,
        sketchImageAttachmentId: activeSketchAttachmentId || undefined,
      };

      let request: RequestInit;
      if (usePen) {
        const markup = await penCanvasRef.current?.exportMarkup();
        if (!markup) throw new Error("Draw your change on the sketch with the pen first.");
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        form.append("markup", markup, "sketch-pen-markup.png");
        request = { method: "POST", body: form };
      } else {
        request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
      }

      const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-edit`, request));
      if (usePen) penCanvasRef.current?.clear();
      setPreview({ generationId: body.data.generation.id, images: body.data.images });
      setBottomTab("variations");
      await Promise.all([refreshProject(), refreshVersions()]);
    });
  }

  /**
   * One click on a construction option (e.g. A-Line) applies it to the CAD
   * sketch straight away; the updated sketch becomes the working sketch and
   * shows on the canvas. The previous sketch is remembered for Undo.
   */
  function applyConstructionOption(category: string, value: string) {
    if (busy) return;
    const previousSketch = activeSketchAttachmentId;
    run(`apply-option:${value}`, async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            structuralFields: { [category]: value },
            viewAngle: "BOTH",
            imageCount: 1,
            generateGarment: false,
            sketchImageAttachmentId: previousSketch || undefined,
          }),
        })
      );
      if (previousSketch) setSketchHistory((h) => [...h, { attachmentId: previousSketch, applied: sketchStructuralFields }]);
      setSketchStructuralFields((prev) => ({ ...prev, [category]: value }));
      await Promise.all([refreshProject(), refreshVersions()]);
    });
  }

  /** Renders the garment from the edited working sketch, as a new version — garment and sketch match again. */
  function applySketchToGarment() {
    run("sketch-to-garment", async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/working-sketch/apply-to-garment`, { method: "POST" })
      );
      setSketchHistory([]);
      setSketchStructuralFields({});
      await Promise.all([refreshProject(), refreshVersions()]);
      setBottomTab("versions");
    });
  }

  function undoConstructionOption() {
    const last = sketchHistory[sketchHistory.length - 1];
    if (!last || busy) return;
    run("undo-option", async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/working-sketch`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentId: last.attachmentId }),
        })
      );
      setSketchHistory((h) => h.slice(0, -1));
      setSketchStructuralFields(last.applied);
      await refreshProject();
    });
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

  function renderCategoryGroup(group: string, items: string[]) {
    return (
      <div key={group} className="border-t border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => toggleGroup(group)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span>{group}</span>
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
    );
  }

  function generatePreview() {
    if (editMode === "EMBELLISHMENTS" || editMode === "MASK") return; // each has its own generate action — see applyEmbellishmentsAction()/generateMaskPreview()
    const stagedDesignAttrs = Object.keys(designAttrSelections).length > 0;
    if (!activeItem && editMode !== "AI_PROMPT" && !stagedDesignAttrs) {
      setError("Choose an edit category on the left first.");
      return;
    }

    // One or more Design Attributes were picked (via the image grid or its
    // text input) — always sent together as a single combined TECHNICAL
    // edit, even if only one was picked, so every staged change is applied
    // in the same generation rather than only whichever was clicked last.
    const useDesignAttrSelections = editMode === "QUICK" && stagedDesignAttrs;
    const effectiveMode = useDesignAttrSelections ? "TECHNICAL" : editMode;
    const featureLabel = useDesignAttrSelections
      ? Object.keys(designAttrSelections).join(", ")
      : editMode === "AI_PROMPT"
        ? (activeItem ?? "Custom Instruction")
        : activeItem!;
    const technicalFields = useDesignAttrSelections
      ? designAttrSelections
      : editMode === "TECHNICAL"
        ? Object.fromEntries(techRows.filter((r) => r.key.trim() && r.value.trim()).map((r) => [r.key.trim(), r.value.trim()]))
        : undefined;

    run("preview", async () => {
      const body = await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: effectiveMode,
            featureLabel,
            currentValue: effectiveMode === "QUICK" ? currentValue : undefined,
            newValue: effectiveMode === "QUICK" ? newValue : undefined,
            technicalFields,
            freeformInstructions: effectiveMode === "AI_PROMPT" ? freeform : effectiveMode === "QUICK" ? undefined : freeform || undefined,
            imageCount,
            viewAngle,
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
      const body = await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/images/${imageId}/apply-edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        })
      );
      if (body.data?.sketchError) {
        toast.warning(`The garment was updated, but its sketch could not be generated: ${body.data.sketchError}. Use "Re-generate" on the sketch.`);
      }
      setSketchHistory([]);
      setSketchStructuralFields({});
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

  /**
   * Embellishments applies directly — same real apply-embellishments action
   * the main wizard's own Embellishments step uses (motif image composited
   * onto the current design, or a text-only embroidery/applique edit), with
   * no preview/select step of its own (unlike QUICK/TECHNICAL/AI_PROMPT,
   * which always land in the AI Variations tab first). A successful call
   * already bumped the version server-side, so this just reflects that.
   */
  function applyEmbellishmentsAction() {
    run("apply-embellishments", async () => {
      await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/apply-embellishments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embellishmentType, instructions: embellishmentInstructions }),
        })
      );
      setEmbellishmentInstructions("");
      await Promise.all([refreshProject(), refreshVersions()]);
      setBottomTab("versions");
    });
  }

  /**
   * Draw & Describe — exports the pencil-drawn mask from the canvas, then
   * posts it (multipart, alongside the instruction text) to the dedicated
   * /mask-edit endpoint. Lands in the same PENDING "AI Variations" review
   * queue as every other edit mode — Select & Apply / Reject below already
   * works unchanged for these images too.
   */
  function generateMaskPreview() {
    if (!maskHasStrokes || !maskInstruction.trim()) {
      setError("Draw on the area you want to change, and describe the change.");
      return;
    }
    run("preview", async () => {
      const maskBlob = await maskCanvasRef.current?.exportMask();
      if (!maskBlob) {
        setError("Draw on the area you want to change first.");
        return;
      }
      const formData = new FormData();
      formData.append("mask", maskBlob, "mask.png");
      formData.append("instruction", maskInstruction.trim());
      formData.append("imageCount", String(imageCount));
      const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/mask-edit`, { method: "POST", body: formData }));
      setPreview({ generationId: body.data.generation.id, images: body.data.images });
      setBottomTab("variations");
      resetEditForm();
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
  const matchedDesignAttr =
    activeGroup === DESIGN_ATTRIBUTES_GROUP ? designAttributes.find((a) => a.label === activeItem) : undefined;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-white dark:bg-zinc-950"
          : "flex h-[calc(100vh-4rem)] flex-col overflow-hidden"
      }
    >
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href={`${basePath}/${projectId}`} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
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

        {/* Edit source toggle: Default is Sketch */}
        <div className="flex items-center rounded-xl border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setEditFrom("SKETCH")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
              editFrom === "SKETCH"
                ? "bg-white text-violet-700 shadow-sm dark:bg-zinc-800 dark:text-violet-300"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            }`}
          >
            <span>✏️ Edit from Sketch</span>
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Default</span>
          </button>
          <button
            type="button"
            onClick={() => setEditFrom("GARMENT")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
              editFrom === "GARMENT"
                ? "bg-white text-violet-700 shadow-sm dark:bg-zinc-800 dark:text-violet-300"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
            }`}
          >
            <span>👗 Edit from Garment</span>
          </button>
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
        {/* Left sidebar — garment editing only (sketch construction options live in the right panel) */}
        {editFrom !== "GARMENT" ? null : leftOpen ? (
          <div
            className="shrink-0 overflow-y-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
            style={{ width: layout.leftWidth }}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Edit Categories
              </span>
              <button type="button" onClick={() => setLeftOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
                ◀
              </button>
            </div>

            <>
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">🖼️ Design Attributes</p>
                {designAttributes.length === 0 ? (
                  <p className="px-3 pb-2 text-[10px] leading-snug text-zinc-500">
                    {project.productCategory
                      ? "No visual design attributes configured for this style's category yet — add some in Masters → AI Design → Product Design."
                      : "This project has no product category set, so no visual design attributes are available."}
                  </p>
                ) : (
                  <div className="pb-1">
                    {designAttributes.map((attr) => {
                      const picked = designAttrSelections[attr.label];
                      return (
                        <button
                          key={attr.key}
                          type="button"
                          onClick={() => selectCategoryItem(DESIGN_ATTRIBUTES_GROUP, attr.label)}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs ${
                            activeGroup === DESIGN_ATTRIBUTES_GROUP && activeItem === attr.label
                              ? "bg-indigo-100 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <span>{attr.label}</span>
                          {picked && <span className="truncate text-[9px] font-normal text-green-600 dark:text-green-400">✓ {picked}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="border-t border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    More Categories (Advanced)
                    <span className="text-zinc-400">{advancedOpen ? "−" : "+"}</span>
                  </button>
                  {advancedOpen && (
                    <>
                      <p className="px-3 pb-1 text-[10px] leading-snug text-zinc-500">
                        Manufacturing-level details (fabric, stitching, trims, …) — plain text fields, no reference images.
                      </p>
                      {EDIT_CATEGORIES.map(({ group, items }) => renderCategoryGroup(group, items))}
                    </>
                  )}
                </div>
            </>
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

        {editFrom === "GARMENT" && leftOpen && (
          <ResizeHandle
            direction="col"
            title="Drag to resize the left panel"
            onDragStart={() => (layoutAtDragStart.current = layout)}
            onDrag={(dx) => updateLayout({ leftWidth: layoutAtDragStart.current.leftWidth + dx })}
          />
        )}

        {/* Center canvas */}
        <div ref={centerColumnRef} className="flex min-w-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
          <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              title="Zoom out (Ctrl + scroll down)"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => clampZoom(z - 0.25))}
              className="h-6 w-6 shrink-0 rounded border border-zinc-300 text-sm leading-none text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              −
            </button>
            <input
              type="range"
              min={MIN_ZOOM * 100}
              max={MAX_ZOOM * 100}
              step={5}
              value={Math.round(zoom * 100)}
              onChange={(e) => setZoom(clampZoom(Number(e.target.value) / 100))}
              aria-label="Design size"
              title="Drag to make the design bigger or smaller"
              className="w-24 min-w-16 shrink accent-violet-600"
            />
            <button
              type="button"
              title="Zoom in (Ctrl + scroll up)"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => clampZoom(z + 0.25))}
              className="h-6 w-6 shrink-0 rounded border border-zinc-300 text-sm leading-none text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              +
            </button>
            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-zinc-500">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              title="Fit the whole design in the box"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              Fit
            </button>
            <span className="hidden text-[10px] text-zinc-400 2xl:inline">Ctrl + scroll to zoom · drag panel edges to resize</span>
            <button
              type="button"
              onClick={() => setFullscreen((f) => !f)}
              title={fullscreen ? "Exit full screen (Esc)" : "Full screen — use the whole window for the design"}
              className="ml-auto shrink-0 rounded border border-violet-300 px-1.5 py-0.5 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
            >
              {fullscreen ? "✕ Exit" : "⛶ Full Screen"}
            </button>
          </div>
          {editMode === "MASK" && currentImage && editFrom === "GARMENT" ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              <MaskCanvas
                ref={maskCanvasRef}
                imageUrl={imageUrl(currentImage.imageAttachmentId)}
                disabled={busy === "preview"}
                onStrokesChange={setMaskHasStrokes}
              />
            </div>
          ) : editFrom === "SKETCH" && sketchTool === "PEN" && activeSketchAttachmentId ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SketchPenCanvas
                key={activeSketchAttachmentId}
                ref={penCanvasRef}
                imageUrl={imageUrl(activeSketchAttachmentId)}
                disabled={busy === "sketch-edit"}
                onStrokesChange={setPenHasStrokes}
                zoom={zoom}
              />
            </div>
          ) : (
            <div
              className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
              style={{ cursor: zoom > 1 ? "grab" : "default" }}
            >
              {editFrom === "SKETCH" ? (
                activeSketchAttachmentId ? (
                  <div className="relative flex h-full w-full items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl(activeSketchAttachmentId)}
                      alt="Technical Flat Sketch"
                      draggable={false}
                      className="max-h-full max-w-full select-none object-contain p-4"
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: isDragging ? "none" : "transform 0.1s" }}
                    />
                    {busy?.startsWith("apply-option:") && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-zinc-950/70">
                        <div className="rounded-xl bg-white px-4 py-3 text-center text-sm font-semibold text-violet-700 shadow-lg dark:bg-zinc-900 dark:text-violet-300">
                          ✨ Applying {busy.slice("apply-option:".length)} to the sketch…
                        </div>
                      </div>
                    )}
                    <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-md backdrop-blur dark:bg-zinc-900/95 dark:text-violet-300">
                      <span>✏️ CAD Technical Flat Sketch</span>
                      <button
                        type="button"
                        onClick={generateSketchForCurrentProject}
                        disabled={Boolean(busy)}
                        className="ml-2 rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                      >
                        {busy === "generate-sketch" ? "Generating…" : "Re-generate"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex max-w-md flex-col items-center rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                    <span className="text-4xl">📐</span>
                    <h3 className="mt-3 text-base font-bold text-zinc-900 dark:text-zinc-100">No CAD Technical Sketch Yet</h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Generate a production-ready 2D CAD flat sketch with seamlines, topstitching, and construction darts from this garment to edit structural elements.
                    </p>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={generateSketchForCurrentProject}
                      className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-xs font-semibold text-white shadow hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === "generate-sketch" ? "✨ Generating CAD flat sketch…" : "✨ Generate CAD Flat Sketch"}
                    </button>
                  </div>
                )
              ) : currentImage ? (
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
          )}

          <ResizeHandle
            direction="row"
            title="Drag to resize the variations panel · double-click to collapse/restore"
            onDragStart={() => {
              layoutAtDragStart.current = layout.bottomCollapsed
                ? { ...layout, bottomHeight: BOTTOM_TAB_BAR_PX }
                : layout;
            }}
            onDrag={(dy) => {
              const h = layoutAtDragStart.current.bottomHeight - dy;
              // Dragging below the minimum snaps the panel shut to just its tab bar.
              updateLayout(h < 64 ? { bottomCollapsed: true } : { bottomCollapsed: false, bottomHeight: h });
            }}
            onDoubleClick={() => updateLayout({ bottomCollapsed: !layout.bottomCollapsed })}
          />

          {/* Bottom area */}
          <div
            className="shrink-0 overflow-y-auto bg-white dark:bg-zinc-900"
            style={{ height: layout.bottomCollapsed ? BOTTOM_TAB_BAR_PX : layout.bottomHeight }}
          >
            <div className="sticky top-0 z-10 flex items-center border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              {(["variations", "compare", "versions"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setBottomTab(tab);
                    if (layout.bottomCollapsed) updateLayout({ bottomCollapsed: false });
                  }}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${
                    bottomTab === tab
                      ? "border-b-2 border-indigo-600 text-indigo-700 dark:text-indigo-400"
                      : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {tab === "variations" ? `AI Variations${preview ? ` (${preview.images.length})` : ""}` : tab}
                </button>
              ))}
              <button
                type="button"
                onClick={() => updateLayout({ bottomCollapsed: !layout.bottomCollapsed })}
                title={layout.bottomCollapsed ? "Show panel" : "Hide panel — more room for the design"}
                className="ml-auto px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                {layout.bottomCollapsed ? "▲ Show" : "▼ Hide"}
              </button>
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
        {rightOpen && (
          <ResizeHandle
            direction="col"
            title="Drag to resize the right panel"
            onDragStart={() => (layoutAtDragStart.current = layout)}
            onDrag={(dx) => updateLayout({ rightWidth: layoutAtDragStart.current.rightWidth - dx })}
          />
        )}
        {rightOpen ? (
          <div
            className="shrink-0 overflow-y-auto border-l border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
            style={{ width: layout.rightWidth }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {editFrom === "SKETCH" ? "Through Sketch Edit" : "Edit Design"}
              </span>
              <button type="button" onClick={() => setRightOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
                ▶
              </button>
            </div>

            {editFrom === "SKETCH" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3.5 dark:border-violet-900 dark:from-violet-950/40 dark:to-fuchsia-950/30">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-violet-800 dark:text-violet-200">
                    <span>✏️</span>
                    <span>Through Sketch Edit Form</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                    Modify 2D CAD technical flat lines, seamlines, neckline, sleeves, and garment structure directly on the manufacturing flat.
                  </p>
                </div>

                {/* Edit method: draw with pen vs. describe */}
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                  {(
                    [
                      { value: "OPTIONS", label: "📐 Options" },
                      { value: "PEN", label: "🖊 Draw" },
                      { value: "DESCRIBE", label: "📝 Describe" },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSketchTool(value)}
                      className={`rounded-lg py-1.5 text-xs font-semibold transition ${
                        sketchTool === value
                          ? "bg-white text-violet-700 shadow-sm dark:bg-zinc-800 dark:text-violet-300"
                          : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {sketchTool === "PEN" && (
                  <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Pen markup key</span>
                    <div className="flex items-start gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PEN_COLORS.ADD }} />
                      <span>
                        <b>Red — Add / Change.</b> Draw the new line where you want it: neckline, collar, yoke, seam, dart, pocket,
                        placket, slit or hem. A red line drawn over an old line replaces it.
                      </span>
                    </div>
                    <div className="flex items-start gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PEN_COLORS.REMOVE }} />
                      <span>
                        <b>Blue — Remove.</b> Scribble over any seam, pocket or detail to delete it.
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      Rough strokes are fine — AI straightens and smooths them into clean CAD lines, and mirrors symmetric changes
                      (armholes, side seams, princess seams) to both sides. Hold Shift for a straight line.
                    </p>
                    {!activeSketchAttachmentId && (
                      <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        Generate the CAD flat sketch first — then draw on it.
                      </p>
                    )}
                  </div>
                )}

                {/* Construction options: one click applies the option to the sketch */}
                {sketchTool === "OPTIONS" && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        📐 Construction Architecture
                      </span>
                      <button
                        type="button"
                        onClick={undoConstructionOption}
                        disabled={sketchHistory.length === 0 || Boolean(busy)}
                        className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
                      >
                        {busy === "undo-option" ? "Undoing…" : "↶ Undo"}
                      </button>
                    </div>
                    <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                      Click an option to apply it to the sketch — the updated sketch shows on the canvas.
                    </p>

                    {SKETCH_STRUCTURE_OPTIONS.map((cat) => {
                      const applied = sketchStructuralFields[cat.category];
                      return (
                        <div key={cat.category} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                          <div className="flex items-center justify-between pb-1.5">
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                              <span>{cat.icon}</span>
                              <span>{cat.label}</span>
                            </span>
                            {applied && <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">✓ {applied}</span>}
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {cat.options.map((opt) => {
                              const isApplied = applied === opt;
                              const isApplying = busy === `apply-option:${opt}`;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  title={isApplied ? `${opt} is applied` : `Apply ${opt} to the sketch`}
                                  disabled={Boolean(busy) || isApplied}
                                  onClick={() => applyConstructionOption(cat.category, opt)}
                                  className={`flex flex-col items-center gap-1 rounded-lg border p-1 text-center transition disabled:cursor-not-allowed ${
                                    isApplied
                                      ? "border-violet-600 bg-violet-50 ring-1 ring-violet-300 dark:bg-violet-950/40"
                                      : "border-zinc-200 bg-white hover:border-violet-400 hover:shadow-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800"
                                  }`}
                                >
                                  <span className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded bg-white">
                                    <DesignOptionImage
                                      value={opt}
                                      variant="CAD_FLAT"
                                      overrideAttachmentId={constructionFlats[opt]}
                                      className="h-14 w-full object-contain"
                                    />
                                    {isApplying && (
                                      <span className="absolute inset-0 flex items-center justify-center bg-white/80 text-[10px] font-semibold text-violet-700">
                                        Applying…
                                      </span>
                                    )}
                                  </span>
                                  <span
                                    className={`line-clamp-2 text-[10px] font-medium leading-tight ${
                                      isApplied ? "text-violet-700 dark:text-violet-300" : "text-zinc-700 dark:text-zinc-300"
                                    }`}
                                  >
                                    {opt}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={applySketchToGarment}
                      disabled={Boolean(busy) || Object.keys(sketchStructuralFields).length === 0}
                      className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-2.5 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === "sketch-to-garment" ? "✨ Updating garment from sketch…" : "👗 Apply Sketch to Garment"}
                    </button>
                    <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                      Renders the garment photo from the edited sketch as a new version, so the garment and sketch match. Then approve it.
                    </p>
                  </div>
                )}

                {sketchTool !== "OPTIONS" && (
                <>
                {/* Natural language modification prompt */}
                <div className="rounded-xl border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                  <label className="mb-1 block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {sketchTool === "PEN" ? "✨ Notes on your markup (optional)" : "✨ Sketch Instructions & Notes"}
                  </label>
                  <textarea
                    value={sketchInstruction}
                    onChange={(e) => setSketchInstruction(e.target.value)}
                    rows={3}
                    placeholder={
                      sketchTool === "PEN"
                        ? "e.g. Red curve = new sweetheart neckline. Pocket is a welt pocket with 0.6cm topstitch."
                        : "e.g. Add 2cm topstitching along placket, lower armhole depth by 1.5cm, and add back princess seams."
                    }
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-800 focus:border-violet-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {SKETCH_QUICK_INSTRUCTIONS.map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        onClick={() =>
                          setSketchInstruction((prev) => (prev.trim() ? `${prev.trim()} ${hint}.` : `${hint}.`))
                        }
                        className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[9px] text-zinc-600 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                      >
                        + {hint}
                      </button>
                    ))}
                  </div>
                </div>

                {/* View angle */}
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    CAD View Angle
                  </label>
                  <div className="flex gap-1">
                    {(
                      [
                        { value: "FRONT", label: "Front Flat" },
                        { value: "BACK", label: "Back Flat" },
                        { value: "BOTH", label: "Front & Back" },
                      ] as const
                    ).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSketchViewAngle(value)}
                        className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition ${
                          sketchViewAngle === value
                            ? "border-violet-600 bg-violet-600 text-white shadow-sm"
                            : "border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Render matching garment checkbox */}
                <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-2.5 dark:border-violet-900/40 dark:bg-violet-950/20">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sketchGenerateGarment}
                      onChange={(e) => setSketchGenerateGarment(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                    />
                    <div>
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        👗 Also render realistic garment
                      </span>
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        Automatically renders the photorealistic garment dressed in project fabric matching the edited CAD sketch.
                      </p>
                    </div>
                  </label>
                </div>

                {/* Variations count */}
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Variations to Generate
                  </label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setSketchImageCount(n)}
                        className={`flex-1 rounded-lg border py-1 text-xs font-semibold ${
                          sketchImageCount === n
                            ? "border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"
                            : "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Generate button */}
                <button
                  type="button"
                  disabled={
                    busy === "sketch-edit" ||
                    (sketchTool === "PEN"
                      ? !penHasStrokes || !activeSketchAttachmentId
                      : !sketchInstruction.trim())
                  }
                  onClick={executeThroughSketchEdit}
                  className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-2.5 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy === "sketch-edit"
                    ? "✨ Generating from Sketch…"
                    : sketchTool === "PEN"
                      ? "✨ Apply Pen Markup"
                      : "✨ Generate from Sketch"}
                </button>
                {busy === "sketch-edit" && (
                  <p className="text-center text-[10px] text-amber-600 dark:text-amber-400">
                    Generating technical sketch and garment variations. Candidates appear in AI Variations below.
                  </p>
                )}
                </>
                )}
              </div>
            ) : (
              <div>
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

                <div className="mb-3 flex flex-wrap gap-1 rounded bg-zinc-100 p-0.5 text-xs dark:bg-zinc-900">
                  {(["QUICK", "TECHNICAL", "AI_PROMPT", "MASK", "EMBELLISHMENTS"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setEditMode(m)}
                      className={`flex-1 rounded px-2 py-1 font-medium ${
                        editMode === m ? "bg-white text-indigo-700 shadow-sm dark:bg-zinc-800 dark:text-indigo-400" : "text-zinc-500"
                      }`}
                    >
                      {m === "QUICK"
                        ? "Quick Edit"
                        : m === "TECHNICAL"
                          ? "Technical Edit"
                          : m === "AI_PROMPT"
                            ? "AI Prompt"
                            : m === "MASK"
                              ? "Draw & Describe"
                              : "Embellishments"}
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
                      {matchedDesignAttr && (
                        <div className="mb-1.5 grid grid-cols-3 gap-1.5">
                          {matchedDesignAttr.options.map((opt) => {
                            const selected = designAttrSelections[matchedDesignAttr.label] === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setDesignAttrSelections((prev) => ({ ...prev, [matchedDesignAttr.label]: opt }))}
                                className={`flex flex-col items-center gap-1 rounded border px-1 py-1.5 text-center transition ${
                                  selected
                                    ? "border-indigo-600 bg-indigo-600 text-white"
                                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
                                }`}
                              >
                                {designDisplayMode === "CLIPART" && (
                                  <DesignOptionImage value={opt} overrideAttachmentId={optionReferenceImages[opt]} />
                                )}
                                <span className="text-[10px] leading-tight">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <input
                        value={matchedDesignAttr ? (designAttrSelections[matchedDesignAttr.label] ?? "") : newValue}
                        onChange={(e) => {
                          if (matchedDesignAttr) {
                            const label = matchedDesignAttr.label;
                            const v = e.target.value;
                            setDesignAttrSelections((prev) => {
                              const next = { ...prev };
                              if (v.trim()) next[label] = v;
                              else delete next[label];
                              return next;
                            });
                          } else {
                            setNewValue(e.target.value);
                          }
                        }}
                        placeholder="e.g. Mandarin Collar"
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>
                    {Object.keys(designAttrSelections).length > 0 && (
                      <div>
                        <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">
                          Selected Changes ({Object.keys(designAttrSelections).length}) — all applied together
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(designAttrSelections).map(([label, value]) => (
                            <span
                              key={label}
                              className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                            >
                              {label}: {value}
                              <button
                                type="button"
                                onClick={() =>
                                  setDesignAttrSelections((prev) => {
                                    const next = { ...prev };
                                    delete next[label];
                                    return next;
                                  })
                                }
                                className="text-indigo-500 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200"
                                aria-label={`Remove ${label}`}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
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
                  <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-3 dark:border-violet-900 dark:from-violet-950/30 dark:to-fuchsia-950/20">
                    <label className="mb-1 block text-xs font-semibold text-violet-800 dark:text-violet-300">✨ Describe the design change you want</label>
                    <textarea
                      value={freeform}
                      onChange={(e) => setFreeform(e.target.value)}
                      rows={5}
                      placeholder='e.g. "Change the round neck into a mandarin collar." / "Reduce sleeve length by 2 cm."'
                      className="w-full rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-sm shadow-inner focus:border-violet-500 focus:outline-none dark:border-violet-800 dark:bg-zinc-900"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[
                        "Make the sleeves puffed",
                        "Add a gold embroidered border at the hem",
                        "Change to a V-neckline",
                        "Make it floor length",
                        "Add a matching belt at the waist",
                        "Add delicate lace trim",
                      ].map((example) => (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setFreeform((prev) => (prev.trim() ? `${prev.trim()} ${example}.` : `${example}.`))}
                          className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] text-violet-700 transition hover:bg-violet-100 dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300"
                        >
                          + {example}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {editMode === "MASK" && (
                  <div className="space-y-3">
                    <p className="text-[10px] text-zinc-500">
                      Draw directly on the design (center panel) to highlight the exact area you want changed, then describe
                      the change below — the AI only touches the area you drew.
                    </p>

                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">What should change in the drawn area?</label>
                      <textarea
                        value={maskInstruction}
                        onChange={(e) => setMaskInstruction(e.target.value)}
                        rows={4}
                        placeholder='e.g. "Add a row of pearl buttons here." / "Change this panel to a lace fabric."'
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>

                    <div>
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
                      disabled={busy === "preview" || !maskHasStrokes || !maskInstruction.trim()}
                      onClick={generateMaskPreview}
                      className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {busy === "preview" ? "Generating preview…" : "Generate Preview"}
                    </button>
                    {busy === "preview" && (
                      <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">This can take up to a minute. Nothing is applied until you review and select a result below.</p>
                    )}
                  </div>
                )}

                {editMode === "EMBELLISHMENTS" && (
                  <div className="space-y-3">
                    <p className="text-[10px] text-zinc-500">
                      Add a digital applique or embroidery embellishment to the current design — upload a motif reference
                      photo, describe how it should be applied, or both. Applies directly as a new version (no preview step).
                    </p>

                    <div>
                      <p className="mb-1 text-[10px] font-medium text-zinc-500">Embellishment Type</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(EMBELLISHMENT_TYPE_LABELS).map(([type, label]) => (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={embellishmentType === type}
                            onClick={() => setEmbellishmentType(type)}
                            className={`rounded border px-2 py-1 text-[10px] ${
                              embellishmentType === type
                                ? "border-indigo-600 bg-indigo-600 text-white"
                                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-1 text-[10px] font-medium text-zinc-500">Embroidery / Applique Motif (optional)</p>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="block w-full text-[10px]"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const formData = new FormData();
                          formData.append("file", file);
                          run("upload-embellishment-motif", async () => {
                            await parseJson(
                              await fetch(`/api/v1/ai-designer/projects/${projectId}/embellishment-motif`, { method: "POST", body: formData })
                            );
                            await refreshProject();
                          });
                          e.target.value = "";
                        }}
                      />
                      {project.embellishmentMotifAttachmentId && (
                        <div className="mt-2 flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imageUrl(project.embellishmentMotifAttachmentId)}
                            alt="Embellishment motif reference"
                            className="h-14 w-14 rounded border object-cover"
                          />
                          <button
                            type="button"
                            className="text-[10px] text-red-600 hover:underline"
                            onClick={() =>
                              run("delete-embellishment-motif", async () => {
                                await parseJson(
                                  await fetch(`/api/v1/ai-designer/projects/${projectId}/embellishment-motif`, { method: "DELETE" })
                                );
                                await refreshProject();
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">Embellishment Instructions</label>
                      <textarea
                        value={embellishmentInstructions}
                        onChange={(e) => setEmbellishmentInstructions(e.target.value)}
                        rows={3}
                        placeholder='e.g. "Add intricate embroidery on the sleeves and neckline". Leave empty to use a sensible default.'
                        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={
                        busy === "apply-embellishments" ||
                        (!project.embellishmentMotifAttachmentId && !embellishmentInstructions.trim())
                      }
                      onClick={applyEmbellishmentsAction}
                      className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {busy === "apply-embellishments" ? "Applying…" : "Apply Embellishments"}
                    </button>
                  </div>
                )}

                {editMode !== "EMBELLISHMENTS" && editMode !== "MASK" && (
                  <>
                    <div className="mt-3">
                      <label className="mb-0.5 block text-[10px] font-medium text-zinc-500">View</label>
                      <div className="flex gap-1">
                        {(
                          [
                            { value: "FRONT", label: "Front" },
                            { value: "BACK", label: "Back" },
                            { value: "BOTH", label: "Both" },
                          ] as const
                        ).map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setViewAngle(value)}
                            className={`flex-1 rounded border px-2 py-1 text-xs ${
                              viewAngle === value
                                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                                : "border-zinc-300 dark:border-zinc-700"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

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
                  </>
                )}
              </div>
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
        message="This will become the new current design (a new version), with the garment photo and its CAD sketch updated together. The other previewed variations will be marked rejected. This does not change any real BOM, Costing, or Tech Pack records — review those manually if needed."
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

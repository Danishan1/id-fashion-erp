import sharp from "sharp";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { deleteAttachment, getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiConfigMissingError, getAiTextProvider } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { analyzeFabric } from "@/core/ai-designer/fabric-analysis/analyze";
import { buildUserText, PROMPT_VERSION as FABRIC_PROMPT_VERSION } from "@/core/ai-designer/fabric-analysis/prompt";
import { generateProductSuggestions } from "@/core/ai-designer/product-suggestions/generate";
import { PROMPT_VERSION as PRODUCT_SUGGESTIONS_PROMPT_VERSION } from "@/core/ai-designer/product-suggestions/prompt";
import type { ProductSuggestionsResponse } from "@/core/ai-designer/product-suggestions/schema";
import { analyzeSketch } from "@/core/ai-designer/sketch-analysis/analyze";
import { PROMPT_VERSION as SKETCH_PROMPT_VERSION } from "@/core/ai-designer/sketch-analysis/prompt";
import { flattenToObservations as flattenSketchObservations } from "@/core/ai-designer/sketch-analysis/schema";
import { SKETCH_FEATURE_LABELS, SKETCH_TO_DESIGN_ATTRIBUTE_KEYS, type SketchFeatureKey } from "@/core/ai-designer/sketch-analysis/feature-registry";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { hasProviderForCapability, runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import { buildMaskEditPrompt, MASK_EDIT_PROMPT_VERSION, runMaskEditGeneration } from "@/core/ai/image-generation/mask-edit";
import {
  buildEmbellishmentPrompt,
  buildGenerationPrompt,
  buildSecondFabricPrompt,
  buildSketchGenerationPrompt,
  buildWorkspaceEditPrompt,
  PROMPT_VERSION as GENERATION_PROMPT_VERSION,
  type SketchGenerationOverride,
} from "@/core/ai-designer/image-generation/prompt";
import type { TechPackSpecItem, TechPackAnalysisForPdfV2, TechPackDocumentPageImage } from "@/core/ai-designer/export/tech-pack-pdf";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";
import { isValidAgeGroup, isValidProductCategory, TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { ProductRepository } from "@/modules/products/product.repository";
import type { ListQuery } from "@/lib/list-query";
import {
  generateGarmentAnalysisPart1,
  generateGarmentAnalysisPart2,
  generateGarmentAnalysisPart3,
  generateGarmentAnalysisPart4,
} from "@/core/ai-designer/tech-pack/generate";
import type { TechPackDesignContext } from "@/core/ai-designer/tech-pack/prompt";
import { buildTechnicalFlatPrompt } from "@/core/ai/technical-development/prompt";
import { formatDocDate, getCompanyHeaderLines } from "@/core/documents/company-header";
import {
  ARTWORK_ITEM_EDITABLE_FIELDS,
  ASSUMPTION_TEXT_FIELDS,
  BOM_ITEM_EDITABLE_FIELDS,
  CLOSURE_EDITABLE_FIELDS,
  CONFIDENCE_STATUSES,
  CONSTRUCTION_EDITABLE_FIELDS,
  FABRIC_MATERIAL_EDITABLE_FIELDS,
  IDENTIFICATION_EDITABLE_FIELDS,
  MEASUREMENT_POINT_EDITABLE_FIELDS,
  PART1_SCALAR_FIELDS,
  PART2_SCALAR_FIELDS,
  PART3_SCALAR_FIELDS,
  PART3_STATUS_FIELDS,
  PART4_SCALAR_FIELDS,
  PHOTO_PAGE_NUMBERS,
  PRODUCTION_INSTRUCTION_EDITABLE_FIELDS,
  QC_CHECKPOINT_EDITABLE_FIELDS,
  REFERENCE_IMAGE_NEEDED_EDITABLE_FIELDS,
  SEAM_CALLOUT_TEXT_FIELDS,
  STANDARD_SIZES,
  SUGGESTED_COLORWAY_EDITABLE_FIELDS,
  TECH_PACK_PAGE_DEFINITIONS,
  VISIBLE_COLOR_EDITABLE_FIELDS,
  type GarmentAnalysis,
} from "@/core/ai-designer/tech-pack/schema";
import {
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerProjectRepository,
  AiDesignerProjectPieceRepository,
  AiDesignerPromptRepository,
  AiDesignerVersionRepository,
  AiDesignerTechPackRepository,
  AiDesignerSketchAnalysisRepository,
  AiDesignerSketchObservationRepository,
  AiDesignerSketchAnalysisRunRepository,
} from "./ai-designer.repository";
import type {
  ApplyEditVariationInput,
  ApplyEmbellishmentsInput,
  ApplyProductSuggestionInput,
  ApplySecondFabricInput,
  CreateProjectInput,
  DecideImageInput,
  ExportFormat,
  GenerateDesignInput,
  GenerateEditPreviewInput,
  ReplaceProjectPiecesInput,
  SaveWizardSelectionsInput,
  SelectExistingFabricInput,
  SetSketchObservationLockInput,
  UpdateBrandNameInput,
  UpdateFabricFieldInput,
  UpdateLogoPositionInput,
  UpdateSketchObservationInput,
  UpdateTechPackFieldInput,
} from "./ai-designer.schema";
import { AiDesignerProjectStatus, type AiDesignerCreationMode, type AiDesignerProject, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface UploadableFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * Own resumable-wizard step order — mirrors the *shape* of AiGarmentProject's
 * step machinery, not shared code (confirmed separate module). MULTI_FABRIC
 * and TECH_PACK are both optional/skippable steps -- nothing downstream
 * requires either to be completed, so a project that never uses them simply
 * never marks them complete (this only affects the display-only "current
 * step" highlight, not navigation, which is entirely user-driven via each
 * step's own Next button — see AiDesignerWorkflowPanel.tsx).
 *
 * SKETCH-only steps (2026-09-20) — Sketch / Drawing → Garment adds two steps
 * (UPLOAD_SKETCH, SKETCH_ANALYSIS) before every other step, which is reused
 * completely unchanged for either mode. stepsForCreationMode() mirrors the
 * exact precedent already proven in AI Garment Flow's own
 * stepsForSourceType() — a STANDARD-mode project's own array is byte-
 * identical to before, so every existing call site is unaffected once it
 * passes STANDARD explicitly.
 */
const SKETCH_ONLY_STEPS = ["UPLOAD_SKETCH", "SKETCH_ANALYSIS"] as const;
const STANDARD_STEPS = [
  "FABRIC_SELECTION",
  "FABRIC_ANALYSIS",
  "PRODUCT_SUGGESTIONS",
  // TARGET_CUSTOMER hidden for now, per explicit request — createProject()
  // defaults every project to UNISEX instead, so Age Group's own per-
  // customer option list, and Product Category/Set Pieces' category list,
  // always have real values even with the manual picker gone; a later
  // Product Suggestion can still override it (see saveWizardSelections).
  "AGE_GROUP",
  // PRODUCT_CATEGORY is kept in this array (unlike TARGET_CUSTOMER above) —
  // a SET-mode project's "Set Pieces" editor renders on this exact step slot
  // and must keep working (see AiDesignerWorkflowPanel.tsx). Only the
  // SINGLE-mode manual category-chip picker is hidden, per explicit request;
  // createProject() marks this step already-complete at creation for a
  // SINGLE-mode project specifically, so it behaves exactly like a removed
  // step there (never blocks Generate, never shows as a dead "current" step
  // with no visible UI) while staying a real, interactive step for SET mode.
  "PRODUCT_CATEGORY",
  // PRODUCT_DESIGN hidden for now, per explicit request — designSelectionsJson
  // data survives (still writable via saveWizardSelections, still read by the
  // Generate Design prompt and the sketch-mode "Design Modifications" summary),
  // step removed from the wizard entirely. Same precedent as MODEL below:
  // removing it from this array is what makes TypeScript flag every
  // remaining reference for cleanup.
  // MODEL hidden for now, per explicit request — column data survives,
  // step removed from the wizard entirely (removing it from this array is
  // what makes TypeScript flag every remaining reference for cleanup).
  "ENVIRONMENT",
  "GENERATE",
  "MULTI_FABRIC",
  // EMBELLISHMENTS hidden from the main wizard for now, per explicit request
  // — the real feature (motif upload + AI apply) is unchanged and still
  // fully reachable from the Edit Design workspace instead (its own
  // Embellishments tab, a completely separate/local concept there, not tied
  // to this step-order array at all).
  "EDIT",
  "BRANDING",
  "TECH_PACK",
  "EXPORT",
] as const;
/** @deprecated kept for any external import; prefer stepsForCreationMode("STANDARD"). */
export const WIZARD_STEP_ORDER = STANDARD_STEPS;
export type WizardStep = (typeof STANDARD_STEPS)[number] | (typeof SKETCH_ONLY_STEPS)[number];

export function stepsForCreationMode(mode: AiDesignerCreationMode): readonly WizardStep[] {
  return mode === "SKETCH" ? [...SKETCH_ONLY_STEPS, ...STANDARD_STEPS] : STANDARD_STEPS;
}

function markStepsComplete(existing: string[], steps: WizardStep[], mode: AiDesignerCreationMode): string[] {
  const order = stepsForCreationMode(mode);
  const set = new Set(existing);
  for (const step of steps) set.add(step);
  return order.filter((s) => set.has(s));
}

function computeCurrentStep(completedSteps: string[], mode: AiDesignerCreationMode): WizardStep {
  const order = stepsForCreationMode(mode);
  return order.find((s) => !completedSteps.includes(s)) ?? order[order.length - 1];
}

const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;

/**
 * Tech Pack's own, much longer freshness window — a full run is now a
 * sequential chain of up to 10 real AI calls (1 vision + 2 text + 7 image
 * generations), which can legitimately take several minutes, unlike every
 * other single-call AI Designer action gated by RUN_FRESHNESS_WINDOW_MS
 * above. Kept as a separate constant rather than widening the shared one, so
 * the shorter window still applies correctly everywhere else.
 */
const TECH_PACK_RUN_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

function errorCategoryForAi(err: unknown): string {
  if (err instanceof AiConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof AiServiceError) return err.category;
  if (err instanceof AiInvalidResponseError) return "NO_STRUCTURED_RESPONSE";
  return "UNKNOWN";
}

function mapAiError(err: unknown): never {
  if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
    throw new BusinessRuleError("AI_SERVICE_ERROR", err.message);
  }
  throw err;
}

function normalizeImageMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/webp") return "image/webp";
  throw new BusinessRuleError(
    "VALIDATION_ERROR",
    `Unsupported fabric image type "${mimeType}" — upload a JPG, PNG, or WEBP image.`
  );
}

async function getOwnedProject(companyId: string, id: string) {
  const project = await AiDesignerProjectRepository.findAnyById(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id });
  return project;
}

async function assertNoActiveRun(projectId: string, promptType: "FABRIC_ANALYSIS" | "PRODUCT_SUGGESTIONS" | "IMAGE_GENERATE" | "IMAGE_EDIT") {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await AiDesignerPromptRepository.findActiveSince(projectId, promptType, freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An AI request is already in progress for this project.", {
      promptId: active.id,
    });
  }
}

async function assertNoActiveSketchAnalysisRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await AiDesignerSketchAnalysisRunRepository.findActiveSince(projectId, freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A sketch analysis is already in progress for this project.", {
      runId: active.id,
    });
  }
}

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

const VALID_AI_DESIGNER_PROJECT_STATUSES = new Set<string>(Object.values(AiDesignerProjectStatus));

export async function listProjects(companyId: string, query: ListQuery, creationMode?: AiDesignerCreationMode) {
  const where: Prisma.AiDesignerProjectWhereInput = {
    companyId,
    ...(creationMode ? { creationMode } : {}),
    ...(query.search ? { projectName: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_AI_DESIGNER_PROJECT_STATUSES.has(query.status)
      ? { status: query.status as AiDesignerProjectStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    AiDesignerProjectRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    AiDesignerProjectRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getProjectById(companyId: string, id: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id });
  return project;
}

// ---------------------------------------------------------------------------
// Step 1 — Fabric Selection
// ---------------------------------------------------------------------------

export async function createProject(actor: ActorContext, input: CreateProjectInput) {
  const projectNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "AI_DESIGNER_PROJECT",
  });

  const project = await AiDesignerProjectRepository.create({
    companyId: actor.companyId,
    projectNumber,
    projectName: input.projectName,
    status: "DRAFT",
    creationMode: input.creationMode,
    projectMode: input.projectMode,
    currentStep: stepsForCreationMode(input.creationMode)[0],
    // A SINGLE-mode project has no interactive use for the PRODUCT_CATEGORY
    // step slot (its manual chip picker is hidden — see STANDARD_STEPS
    // above), so it starts already-complete; a SET-mode project still needs
    // it real and incomplete until Set Pieces are actually added
    // (replaceProjectPieces marks it complete once pieces.length > 0).
    completedSteps: input.projectMode === "SET" ? [] : ["PRODUCT_CATEGORY"],
    // Target Customer's manual picker is hidden from the wizard (see
    // STANDARD_STEPS above) — every project silently starts as UNISEX so
    // Age Group/Category option lists always have real values; a later
    // Product Suggestion can still override this (saveWizardSelections).
    targetCustomer: "UNISEX",
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: project.id,
    action: "CREATE",
    newValues: { projectNumber: project.projectNumber, projectName: project.projectName },
  });

  return project;
}

// ---------------------------------------------------------------------------
// SKETCH mode only — Upload Sketch / Sketch Analysis
// (see stepsForCreationMode("SKETCH") above; these steps never appear, and
// these functions are never called, for a STANDARD-mode project.)
// ---------------------------------------------------------------------------

export async function uploadSketchImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "SKETCH_IMAGE");

  // Replacing the sketch marks any existing analysis STALE — the same
  // "replacing the reference image invalidates its analysis" rule already
  // proven for Fabric Analysis / Reference Analysis / Replicate Design's own
  // DNA analysis, so a later Generate call can never silently read an
  // analysis of a sketch that's no longer the one actually uploaded.
  await AiDesignerSketchAnalysisRepository.markStale(projectId);

  const completedSteps = markStepsComplete(project.completedSteps, ["UPLOAD_SKETCH"], project.creationMode);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    sketchImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { sketchImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteSketchImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.sketchImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded sketch to delete.");
  }

  await deleteAttachment(actor, project.sketchImageAttachmentId);
  await AiDesignerSketchAnalysisRepository.markStale(projectId);

  const updated = await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { sketchImageAttachmentId: project.sketchImageAttachmentId },
    newValues: { sketchImageAttachmentId: null },
  });

  return updated;
}

export async function runSketchAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!project.sketchImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a sketch/drawing before running Sketch Analysis.");
  }
  await assertNoActiveSketchAnalysisRun(projectId);

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.sketchImageAttachmentId);
  const mediaType = normalizeImageMediaType(attachment.mimeType);

  const runRow = await AiDesignerSketchAnalysisRunRepository.create({
    companyId: actor.companyId,
    projectId,
    sketchAttachmentId: project.sketchImageAttachmentId,
    provider: getAiTextProvider(),
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    promptVersion: SKETCH_PROMPT_VERSION,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeSketch({ imageBuffer: buffer, imageMediaType: mediaType });

    const observations = flattenSketchObservations(result.data).map((o) => ({
      featureKey: o.featureKey,
      aiObservation: o.aiObservation,
      aiConfidence: o.aiConfidence,
      approvedObservation: o.aiObservation,
      userEdited: false,
      isLocked: true,
    }));

    const analysis = await AiDesignerSketchAnalysisRepository.upsertWithObservations(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        sketchAttachmentId: project.sketchImageAttachmentId,
        status: "AI_ANALYSED",
        promptVersion: SKETCH_PROMPT_VERSION,
        provider: getAiTextProvider(),
        model: result.model,
        rawResponseJson: result.rawResponse as Prisma.InputJsonValue,
        sketchAnalysisSummary: result.data.sketchAnalysisSummary,
        createdByUserId: actor.userId,
      },
      observations
    );

    await AiDesignerSketchAnalysisRunRepository.markSuccess(runRow.id, analysis.id);

    const completedSteps = markStepsComplete(project.completedSteps, ["SKETCH_ANALYSIS"], project.creationMode);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps, project.creationMode) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_designer_sketch_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { status: "AI_ANALYSED" },
    });

    return analysis;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerSketchAnalysisRunRepository.markFailed(runRow.id, category, message);
    mapAiError(err);
  }
}

export async function getSketchAnalysis(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerSketchAnalysisRepository.findByProjectId(projectId);
}

export async function updateSketchObservation(actor: ActorContext, observationId: string, input: UpdateSketchObservationInput) {
  const observation = await AiDesignerSketchObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sketch observation not found.", { id: observationId });
  }

  const updated = await AiDesignerSketchObservationRepository.update(observationId, {
    approvedObservation: input.approvedObservation,
    userEdited: true,
  });

  // Editing any observation on an already-approved analysis pushes it back
  // to review — same "never let an approved state silently drift"
  // discipline already established elsewhere in this codebase.
  if (observation.analysis.status === "APPROVED") {
    await AiDesignerSketchAnalysisRepository.update(observation.analysisId, { status: "UNDER_REVIEW" });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_designer_sketch_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation },
    newValues: { approvedObservation: input.approvedObservation },
  });

  return updated;
}

export async function resetSketchObservationToAi(actor: ActorContext, observationId: string) {
  const observation = await AiDesignerSketchObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sketch observation not found.", { id: observationId });
  }

  return AiDesignerSketchObservationRepository.update(observationId, {
    approvedObservation: observation.aiObservation,
    userEdited: false,
  });
}

/** Lock toggle has no re-approval side effect, unlike an actual value edit — it only changes whether Generate treats this observation as a hard constraint. */
export async function setSketchObservationLock(actor: ActorContext, observationId: string, input: SetSketchObservationLockInput) {
  const observation = await AiDesignerSketchObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Sketch observation not found.", { id: observationId });
  }

  return AiDesignerSketchObservationRepository.update(observationId, { isLocked: input.isLocked });
}

export async function approveSketchAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const analysis = await AiDesignerSketchAnalysisRepository.findByProjectId(projectId);
  if (!analysis) throw new BusinessRuleError("NOT_FOUND", "This project has no Sketch Analysis to approve yet.");
  if (analysis.status !== "AI_ANALYSED" && analysis.status !== "UNDER_REVIEW") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve an analysis in status "${analysis.status}".`);
  }

  await AiDesignerSketchAnalysisRepository.approveAllObservations(analysis.id, actor.userId);

  const completedSteps = markStepsComplete(project.completedSteps, ["SKETCH_ANALYSIS"], project.creationMode);
  await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps, project.creationMode) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_designer_sketch_analyses",
    recordId: analysis.id,
    action: "UPDATE",
    newValues: { status: "APPROVED" },
  });

  return AiDesignerSketchAnalysisRepository.findByProjectId(projectId);
}

/**
 * Compares each locked sketch observation against the project's own
 * Product Design selections (see SKETCH_TO_DESIGN_ATTRIBUTE_KEYS) — a
 * selection differing from the sketch's own value for a mapped feature is
 * treated as an intentional override (the spec's own explicit example: the
 * sketch shows a round neck, the user picks V-neck → preserve everything
 * else, change only the neckline). A sketch feature with no mapped Product
 * Design attribute always stays preserved from the sketch (the safe
 * default). Exported for the Design Summary UI to render the same list.
 */
export function detectDesignOverrides(
  observations: { featureKey: string; approvedObservation: string; isLocked: boolean }[],
  designSelections: Record<string, string> | null | undefined
): { overrides: SketchGenerationOverride[]; overriddenFeatureKeys: Set<string> } {
  const overrides: SketchGenerationOverride[] = [];
  const overriddenFeatureKeys = new Set<string>();
  const selections = designSelections ?? {};

  for (const obs of observations) {
    if (!obs.isLocked) continue;
    const attributeKeys = SKETCH_TO_DESIGN_ATTRIBUTE_KEYS[obs.featureKey as SketchFeatureKey];
    if (!attributeKeys) continue;
    for (const attrKey of attributeKeys) {
      const selectedValue = selections[attrKey];
      if (selectedValue && selectedValue.trim().length > 0) {
        overrides.push({
          featureLabel: SKETCH_FEATURE_LABELS[obs.featureKey as SketchFeatureKey] ?? obs.featureKey,
          sketchValue: obs.approvedObservation,
          selectedValue,
        });
        overriddenFeatureKeys.add(obs.featureKey);
        break;
      }
    }
  }

  return { overrides, overriddenFeatureKeys };
}

/** Auto-fills only what's genuinely on the real Fabric Master row (Name/Code/Supplier) — GSM/Composition/Width/Color etc. stay blank/user-editable, matching the confirmed real-schema gap. */
export async function selectExistingFabric(actor: ActorContext, projectId: string, input: SelectExistingFabricInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const material = await ProductRepository.findMaterialById(actor.companyId, input.fabricProductId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Fabric not found in the Fabric Master.", { id: input.fabricProductId });

  // Deliberately does NOT clear fabricImageAttachmentId. The real Fabric
  // Master (Product) carries no photo of its own (confirmed by schema
  // inspection — only Name/Code/Supplier/unit cost exist there), so picking
  // an existing fabric's metadata and uploading/attaching its real photo are
  // two independent actions that must be able to coexist — generation
  // requires the real photo regardless of where the metadata came from (see
  // assertReadyToGenerate). fabricSource is only set here if it hasn't
  // already been set by an earlier upload, so it always reflects whichever
  // fabric action happened first, not whichever happened most recently.
  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_SELECTION"], project.creationMode);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "EXISTING",
    fabricProductId: material.id,
    fabricName: material.styleName,
    fabricCode: material.styleCode,
    fabricSupplierId: material.defaultSupplierId,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "EXISTING", fabricProductId: material.id },
  });

  return updated;
}

export async function uploadFabricImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "FABRIC_IMAGE");

  // Deliberately does NOT clear fabricProductId/fabricSupplierId — a user
  // may have already picked an existing fabric's metadata (Name/Code/
  // Supplier) and is now separately attaching its real photo, which
  // generation actually requires (see assertReadyToGenerate). fabricSource
  // is only set here if this is the first fabric action taken on the
  // project, matching selectExistingFabric's own symmetric rule.
  const project = await getOwnedProject(actor.companyId, projectId);
  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_SELECTION"], project.creationMode);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "UPLOADED",
    fabricImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "UPLOADED", fabricImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteFabricImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded fabric image to delete.");
  }

  await deleteAttachment(actor, project.fabricImageAttachmentId);

  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricImageAttachmentId: null,
    fabricSource: project.fabricProductId ? "EXISTING" : null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { fabricImageAttachmentId: project.fabricImageAttachmentId },
    newValues: { fabricImageAttachmentId: null },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Step 2 — Analyze Fabric with AI
// ---------------------------------------------------------------------------

export async function runFabricAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This project has no fabric photo to analyze — pick \"Upload Fabric Image\" in Step 1, or fill in the fabric fields below manually."
    );
  }
  await assertNoActiveRun(projectId, "FABRIC_ANALYSIS");

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId);
  const mediaType = normalizeImageMediaType(attachment.mimeType);

  const projectContext = {
    productCategory: project.productCategory,
    targetCustomerLabel: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : null,
  };
  const userText = buildUserText(projectContext);

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "FABRIC_ANALYSIS",
    promptVersion: FABRIC_PROMPT_VERSION,
    specJson: projectContext,
    promptText: userText,
    provider: getAiTextProvider(),
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeFabric({ imageBuffer: buffer, imageMediaType: mediaType, projectContext });

    const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_ANALYSIS"], project.creationMode);
    const updated = await AiDesignerProjectRepository.update(projectId, {
      fabricName: result.data.fabricName,
      fabricComposition: result.data.composition,
      fabricGsm: result.data.gsm,
      fabricWidth: result.data.width,
      fabricWeave: result.data.weave,
      fabricStretch: result.data.stretch,
      fabricOpacity: result.data.opacity,
      fabricTexture: result.data.texture,
      fabricPatternType: result.data.patternType,
      fabricPrintType: result.data.printType,
      fabricSuitableSeason: result.data.suitableSeason,
      fabricRecommendedGarments: result.data.recommendedGarments,
      completedSteps,
      currentStep: computeCurrentStep(completedSteps, project.creationMode),
    });

    await AiDesignerPromptRepository.markSuccess(promptRow.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_prompts",
      recordId: promptRow.id,
      action: "CREATE",
      newValues: { promptType: "FABRIC_ANALYSIS", status: "SUCCESS" },
    });

    return updated;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerPromptRepository.markFailed(promptRow.id, category, message);
    mapAiError(err);
  }
}

export async function updateFabricAnalysisField(actor: ActorContext, projectId: string, input: UpdateFabricFieldInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const updated = await AiDesignerProjectRepository.update(projectId, { [input.field]: input.value });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { [input.field]: (project as unknown as Record<string, unknown>)[input.field] },
    newValues: { [input.field]: input.value },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Step 2b — AI Product Suggestions. Mirrors runFabricAnalysis()'s own
// pattern exactly: a single text-only AI call, no separate table, the
// generic AiDesignerPrompt row as its own audit/concurrency-guard, the
// whole result JSON replaced on each re-run. Optional/skippable — a user
// can always fall back to picking Target Customer/Age Group/Product
// Category/Environment manually below without ever running this.
// ---------------------------------------------------------------------------

export async function runProductSuggestions(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!project.fabricName) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This project has no fabric characteristics yet — run \"Analyze Fabric With AI\" (or fill in the fabric fields manually) first."
    );
  }
  await assertNoActiveRun(projectId, "PRODUCT_SUGGESTIONS");

  const fabricContext = {
    fabricName: project.fabricName,
    composition: project.fabricComposition,
    gsm: project.fabricGsm,
    width: project.fabricWidth,
    weave: project.fabricWeave,
    stretch: project.fabricStretch,
    opacity: project.fabricOpacity,
    texture: project.fabricTexture,
    patternType: project.fabricPatternType,
    printType: project.fabricPrintType,
    suitableSeason: project.fabricSuitableSeason,
    recommendedGarments: project.fabricRecommendedGarments,
  };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "PRODUCT_SUGGESTIONS",
    promptVersion: PRODUCT_SUGGESTIONS_PROMPT_VERSION,
    specJson: fabricContext,
    promptText: JSON.stringify(fabricContext),
    provider: getAiTextProvider(),
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateProductSuggestions(fabricContext);

    const completedSteps = markStepsComplete(project.completedSteps, ["PRODUCT_SUGGESTIONS"], project.creationMode);
    const updated = await AiDesignerProjectRepository.update(projectId, {
      productSuggestionsJson: result.data as unknown as Prisma.InputJsonValue,
      completedSteps,
      currentStep: computeCurrentStep(completedSteps, project.creationMode),
    });

    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, "anthropic", result.model);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_prompts",
      recordId: promptRow.id,
      action: "CREATE",
      newValues: { promptType: "PRODUCT_SUGGESTIONS", status: "SUCCESS" },
    });

    return updated;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerPromptRepository.markFailed(promptRow.id, category, message);
    mapAiError(err);
  }
}

export async function getProductSuggestions(companyId: string, projectId: string): Promise<ProductSuggestionsResponse | null> {
  const project = await getOwnedProject(companyId, projectId);
  return (project.productSuggestionsJson as unknown as ProductSuggestionsResponse | null) ?? null;
}

/**
 * Explicit "Skip this step" for AI Product Suggestions — this step was
 * already navigable-past via the wizard's own unconditional Next button (no
 * hard gate anywhere requires it), but skipping that way never marked it
 * complete, so its stepper checkmark stayed permanently unchecked even after
 * a deliberate skip, which read as "still required." This marks it complete
 * with no AI call and no other side effect, purely a completedSteps write —
 * a real suggestion run (runProductSuggestions) still marks it complete on
 * its own too, so calling this after suggestions already exist is a harmless
 * no-op.
 */
export async function skipProductSuggestions(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const completedSteps = markStepsComplete(project.completedSteps, ["PRODUCT_SUGGESTIONS"], project.creationMode);
  return AiDesignerProjectRepository.update(projectId, {
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });
}

/**
 * The literal "click a suggested product -> 3 designs appear" action.
 * Deliberately composes the two already-correct functions below rather
 * than duplicating either one's validation/generation logic — and
 * deliberately never trusts a client-submitted targetCustomer/ageGroup/
 * productCategory/environmentKey directly: it looks the exact item up by
 * position from what the AI itself actually returned, so a suggestion can
 * never be spoofed into applying a combination the AI never suggested.
 */
export async function applyProductSuggestionAndGenerate(actor: ActorContext, projectId: string, input: ApplyProductSuggestionInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const suggestions = project.productSuggestionsJson as unknown as ProductSuggestionsResponse | null;
  const group = suggestions?.groups[input.groupIndex];
  const item = group?.items[input.itemIndex];
  if (!group || !item) {
    throw new BusinessRuleError("VALIDATION_ERROR", "That suggestion could not be found — run Product Suggestions again.");
  }

  await saveWizardSelections(actor, projectId, {
    targetCustomer: group.targetCustomer,
    ageGroup: item.ageGroup,
    productCategory: item.productCategory,
    environmentKey: item.environmentKey,
  });

  const result = await generateDesign(actor, projectId, { imageCount: 3, viewAngle: "FRONT" }, {
    targetCustomer: group.targetCustomer,
    productCategory: item.productCategory,
    priorityRank: item.priorityRank,
  });

  return {
    ...result,
    // Tagged directly on the response, not derived later from stored JSON —
    // simpler, and this is the one place in the code that genuinely knows
    // these exact images came from this exact action.
    images: result.images.map((img) => ({ ...img, fromSuggestion: true })),
    appliedSuggestion: {
      targetCustomer: group.targetCustomer,
      ageGroup: item.ageGroup,
      productCategory: item.productCategory,
      environmentKey: item.environmentKey,
    },
  };
}

// ---------------------------------------------------------------------------
// Steps 3-8 — Age Group / Product Category / Design / Model / Environment
// (Target Customer's own manual step is hidden — see STANDARD_STEPS above —
// but this function's targetCustomer write stays reachable, since
// applyProductSuggestionAndGenerate() still needs to set it from a suggestion.)
// ---------------------------------------------------------------------------

export async function saveWizardSelections(actor: ActorContext, projectId: string, input: SaveWizardSelectionsInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const data: Prisma.AiDesignerProjectUncheckedUpdateInput = {};
  const touchedSteps: WizardStep[] = [];
  const effectiveCustomer = (input.targetCustomer ?? project.targetCustomer) as TargetCustomer | null;

  // Target Customer is hidden from the wizard for now — this write is kept
  // reachable (applyProductSuggestionAndGenerate() still calls it with a
  // suggestion's own targetCustomer) but no longer marks any step complete
  // ("TARGET_CUSTOMER" no longer exists in the step order).
  if (input.targetCustomer !== undefined) {
    data.targetCustomer = input.targetCustomer;
  }
  if (input.ageGroup !== undefined) {
    if (effectiveCustomer && !isValidAgeGroup(effectiveCustomer, input.ageGroup)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${input.ageGroup}" is not a valid age group for ${effectiveCustomer}.`);
    }
    data.ageGroup = input.ageGroup;
    touchedSteps.push("AGE_GROUP");
  }
  if (input.productCategory !== undefined) {
    if (effectiveCustomer && !isValidProductCategory(effectiveCustomer, input.productCategory)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${input.productCategory}" is not a valid product category for ${effectiveCustomer}.`);
    }
    data.productCategory = input.productCategory;
    touchedSteps.push("PRODUCT_CATEGORY");
  }
  // Product Design is hidden from the wizard for now — this write is kept
  // reachable (harmless, still read by generateDesign()'s own prompt and the
  // sketch-mode "Design Modifications" summary) but no longer marks any step
  // complete ("PRODUCT_DESIGN" no longer exists in the step order).
  if (input.designSelections !== undefined) {
    const existing = (project.designSelectionsJson as Record<string, string> | null) ?? {};
    data.designSelectionsJson = { ...existing, ...input.designSelections } as Prisma.InputJsonValue;
  }
  // Model is hidden from the wizard for now — these writes are kept
  // reachable (harmless, unused by any current UI) in case a direct API
  // caller or a future re-enablement still wants them, but no longer mark
  // any step complete ("MODEL" no longer exists in the step order).
  if (input.modelGender !== undefined) data.modelGender = input.modelGender;
  if (input.modelBodyType !== undefined) data.modelBodyType = input.modelBodyType;
  if (input.modelPose !== undefined) data.modelPose = input.modelPose;

  if (input.isCustomEnvironment) {
    data.isCustomEnvironment = true;
    data.environmentKey = null;
    if (input.environmentLabel !== undefined) data.environmentLabel = input.environmentLabel;
    touchedSteps.push("ENVIRONMENT");
  } else if (input.environmentKey !== undefined) {
    if (input.environmentKey) {
      const env = getEnvironmentByKey(input.environmentKey);
      if (!env) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown environment "${input.environmentKey}".`);
      data.environmentKey = env.key;
      data.environmentLabel = input.environmentLabel || env.label;
      data.isCustomEnvironment = false;
    } else {
      data.environmentKey = null;
      data.environmentLabel = input.environmentLabel ?? null;
      data.isCustomEnvironment = false;
    }
    touchedSteps.push("ENVIRONMENT");
  }

  const completedSteps = markStepsComplete(project.completedSteps, touchedSteps, project.creationMode);
  data.completedSteps = completedSteps;
  data.currentStep = computeCurrentStep(completedSteps, project.creationMode);

  const updated = await AiDesignerProjectRepository.update(projectId, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: data as Record<string, unknown>,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Multi-piece Set support (2026-09-22) — pieces are managed on the same
// PRODUCT_CATEGORY step for a SET-mode project (see AiDesignerWorkflowPanel's
// own SET branch); this doesn't itself touch completedSteps/currentStep the
// way saveWizardSelections does — the PRODUCT_CATEGORY step is marked
// complete once at least 1 piece exists, checked by the same generic
// "does the project have what Generate Design needs" logic in
// assertReadyToGenerate below, not duplicated here.
// ---------------------------------------------------------------------------

export async function listProjectPieces(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerProjectPieceRepository.findByProjectId(projectId);
}

export async function replaceProjectPieces(actor: ActorContext, projectId: string, input: ReplaceProjectPiecesInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (project.projectMode !== "SET" && input.pieces.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project is not a multi-piece Set — pieces can only be added to a Set-mode project.");
  }

  const pieces = await AiDesignerProjectPieceRepository.replaceAll(
    actor.companyId,
    projectId,
    input.pieces.map((p) => ({
      pieceLabel: p.pieceLabel.trim(),
      productCategory: p.productCategory?.trim() || null,
      designNotes: p.designNotes?.trim() || null,
    }))
  );

  const touchedSteps: WizardStep[] = pieces.length > 0 ? ["PRODUCT_CATEGORY"] : [];
  const completedSteps =
    touchedSteps.length > 0
      ? markStepsComplete(project.completedSteps, touchedSteps, project.creationMode)
      : project.completedSteps.filter((s) => s !== "PRODUCT_CATEGORY");
  await AiDesignerProjectRepository.update(projectId, {
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_project_pieces",
    recordId: projectId,
    action: "UPDATE",
    newValues: { pieceCount: pieces.length, pieces: pieces.map((p) => p.pieceLabel) },
  });

  return pieces;
}

/** Builds one combined multi-piece description for the image-generation prompt and the Tech Pack's own context, shared by generateDesign() and buildTechPackDesignContext() below. */
function buildSetPiecesDescription(pieces: { pieceLabel: string; productCategory: string | null; designNotes: string | null }[]): string {
  return pieces
    .map((p, i) => `${i + 1}. ${p.pieceLabel}${p.productCategory ? ` (${p.productCategory})` : ""}${p.designNotes ? ` — ${p.designNotes}` : ""}`)
    .join("; ");
}

// ---------------------------------------------------------------------------
// Step 9 — Generate Design
// ---------------------------------------------------------------------------

/**
 * A real fabric REFERENCE IMAGE is a hard requirement, not just fabric
 * metadata — the whole point of this fix is that generation must use the
 * actual fabric photo as a visual reference, never just its text
 * description. The real Fabric Master (Product) carries no photo of its
 * own, so picking an "existing" fabric alone is never sufficient; the user
 * must also upload/attach that fabric's real photo (Step 1's second field)
 * before Generate Design becomes available, regardless of fabricSource.
 */
function assertReadyToGenerate(project: AiDesignerProject, sketchAnalysisStatus?: string | null, pieceCount?: number) {
  const missing: string[] = [];
  if (!project.fabricImageAttachmentId) {
    missing.push("a real fabric reference photo (Step 1 — upload the actual fabric image, even if you picked an existing fabric's details)");
  }
  // Target Customer is hidden from the wizard for now, per explicit request
  // — defaults to UNISEX at project creation (createProject), so it's never
  // actually null in practice, but no longer a hard precondition even for a
  // pre-existing project created before this default existed.
  if (!project.ageGroup) missing.push("Age Group");
  if (project.projectMode === "SET") {
    if (!pieceCount) missing.push("at least one Set piece (Step 5 — add each garment piece, e.g. Kurta, Pant, Dupatta)");
  }
  // Product Category's manual picker is hidden from the wizard for now, per
  // explicit request, and is no longer a hard precondition for a SINGLE-mode
  // project (SET-mode's own Set Pieces requirement above is unaffected).
  // generateDesign()'s own prompt-building already tolerates a null
  // productCategory (`|| "Not specified"`), same as Model's precedent below.
  // Model is hidden from the wizard for now, per explicit request — no
  // longer a hard precondition. generateDesign()'s own prompt-building
  // already tolerates all-null model fields (`|| "Not specified"`).
  if (!project.environmentLabel) missing.push("Environment");

  if (project.creationMode === "SKETCH") {
    if (!project.sketchImageAttachmentId) missing.push("an uploaded sketch/drawing (Step 1)");
    if (sketchAnalysisStatus !== "APPROVED") missing.push("an approved Sketch Analysis");
  }

  if (missing.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Complete the following before generating a design: ${missing.join(", ")}.`,
      { missing }
    );
  }
}

function buildDesignSelectionsText(project: AiDesignerProject): string {
  const selections = (project.designSelectionsJson as Record<string, string> | null) ?? {};
  const entries = Object.entries(selections);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}: ${value}`).join("; ") : "Not specified";
}

function buildSpecJson(project: AiDesignerProject, sketch?: { overrides: SketchGenerationOverride[]; lockedConstraints: string[] }): Record<string, unknown> {
  return {
    ...(sketch ? { sketch } : {}),
    fabric: {
      source: project.fabricSource,
      name: project.fabricName,
      code: project.fabricCode,
      composition: project.fabricComposition,
      gsm: project.fabricGsm,
      width: project.fabricWidth,
      weave: project.fabricWeave,
      stretch: project.fabricStretch,
      opacity: project.fabricOpacity,
      texture: project.fabricTexture,
      patternType: project.fabricPatternType,
      printType: project.fabricPrintType,
      suitableSeason: project.fabricSuitableSeason,
      recommendedGarments: project.fabricRecommendedGarments,
      color: project.fabricColor,
    },
    customer: { targetCustomer: project.targetCustomer, ageGroup: project.ageGroup },
    product: { category: project.productCategory },
    design: project.designSelectionsJson ?? {},
    model: { gender: project.modelGender, bodyType: project.modelBodyType, pose: project.modelPose },
    environment: { key: project.environmentKey, label: project.environmentLabel, isCustom: project.isCustomEnvironment },
  };
}

export async function bumpVersion(
  actor: ActorContext,
  projectId: string,
  imageId: string,
  changeSummary: string,
  specJson: Record<string, unknown>,
  options?: {
    approvalStatus?: "DRAFT" | "AI_MODIFIED";
    aiPromptId?: string;
    technicalChangesJson?: Record<string, string> | null;
  }
) {
  const count = await AiDesignerVersionRepository.count(projectId);
  const version = await AiDesignerVersionRepository.create({
    companyId: actor.companyId,
    projectId,
    versionNumber: count + 1,
    currentImageId: imageId,
    changeSummary,
    designSnapshotJson: specJson as Prisma.InputJsonValue,
    approvalStatus: options?.approvalStatus ?? "DRAFT",
    aiPromptId: options?.aiPromptId,
    technicalChangesJson: (options?.technicalChangesJson ?? undefined) as Prisma.InputJsonValue | undefined,
    createdByUserId: actor.userId,
  });
  await AiDesignerProjectRepository.update(projectId, { currentVersionId: version.id });
  return version;
}

export async function generateDesign(
  actor: ActorContext,
  projectId: string,
  input: GenerateDesignInput,
  /** Set only by applyProductSuggestionAndGenerate() — recorded on specJson so the UI can tag exactly these images as AI-suggestion-driven, with zero new schema. */
  fromSuggestion?: { targetCustomer: string; productCategory: string; priorityRank: number }
) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const isSketchMode = project.creationMode === "SKETCH";
  const isSetMode = project.projectMode === "SET";

  // SKETCH mode's own analysis/observations are fetched up front — both
  // because assertReadyToGenerate() needs the real analysis status (never
  // trusted from a stale project-level flag) and because the prompt/override
  // detection below needs the approved observations themselves.
  const sketchAnalysis = isSketchMode ? await AiDesignerSketchAnalysisRepository.findByProjectId(projectId) : null;
  const setPieces = isSetMode ? await AiDesignerProjectPieceRepository.findByProjectId(projectId) : [];
  assertReadyToGenerate(project, sketchAnalysis?.status, setPieces.length);
  await assertNoActiveRun(projectId, "IMAGE_GENERATE");

  // Multi-piece Set support — a combined "N-piece set: Kurta, Pant, Dupatta"
  // productCategory + a per-piece designSelections description, in place of
  // the project's own single productCategory/designSelectionsJson fields.
  // Zero changes needed to buildGenerationPrompt() itself — both are still
  // plain strings, just composed differently when isSetMode.
  const effectiveProductCategory = isSetMode
    ? `${setPieces.length}-piece set: ${setPieces.map((p) => p.pieceLabel).join(", ")}`
    : project.productCategory || "Not specified";
  const effectiveDesignSelections = isSetMode
    ? `This is a coordinated ${setPieces.length}-piece set, worn together. ${buildSetPiecesDescription(setPieces)}`
    : buildDesignSelectionsText(project);

  // The real fabric photo, not its text description, is what makes this a
  // genuine visual reference — assertReadyToGenerate() already guarantees
  // fabricImageAttachmentId is set at this point.
  const { attachment: fabricAttachment, buffer: fabricBuffer } = await getAttachmentForDownload(
    actor.companyId,
    project.fabricImageAttachmentId!
  );

  let sketchImage: { attachment: { mimeType: string }; buffer: Buffer } | null = null;
  let sketchOverrideInfo: { overrides: SketchGenerationOverride[]; lockedConstraints: string[] } | undefined;

  if (isSketchMode) {
    // assertReadyToGenerate() already guarantees sketchImageAttachmentId is
    // set and the analysis is APPROVED at this point.
    sketchImage = await getAttachmentForDownload(actor.companyId, project.sketchImageAttachmentId!);
    const observations = sketchAnalysis!.observations;
    const { overrides, overriddenFeatureKeys } = detectDesignOverrides(observations, project.designSelectionsJson as Record<string, string> | null);
    const lockedConstraints = observations
      .filter((o) => o.isLocked && !overriddenFeatureKeys.has(o.featureKey))
      .map((o) => `${SKETCH_FEATURE_LABELS[o.featureKey as SketchFeatureKey] ?? o.featureKey}: ${o.approvedObservation}`);
    sketchOverrideInfo = { overrides, lockedConstraints };
  }

  const specJson = {
    ...buildSpecJson(project, sketchOverrideInfo),
    viewAngle: input.viewAngle,
    ...(fromSuggestion ? { fromSuggestion } : {}),
    ...(isSetMode ? { setPieces: setPieces.map((p) => ({ pieceLabel: p.pieceLabel, productCategory: p.productCategory, designNotes: p.designNotes })) } : {}),
  };
  const prompt = isSketchMode
    ? buildSketchGenerationPrompt({
        targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
        ageGroup: project.ageGroup || "Not specified",
        productCategory: project.productCategory || "Not specified",
        modelGender: project.modelGender || "Not specified",
        modelBodyType: project.modelBodyType || "Not specified",
        modelPose: project.modelPose || "Not specified",
        environment: project.environmentLabel || "Not specified",
        viewAngle: input.viewAngle,
        overrides: sketchOverrideInfo!.overrides,
        lockedConstraints: sketchOverrideInfo!.lockedConstraints,
      })
    : buildGenerationPrompt({
        targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
        ageGroup: project.ageGroup || "Not specified",
        productCategory: effectiveProductCategory,
        designSelections: effectiveDesignSelections,
        modelGender: project.modelGender || "Not specified",
        modelBodyType: project.modelBodyType || "Not specified",
        modelPose: project.modelPose || "Not specified",
        environment: project.environmentLabel || "Not specified",
        viewAngle: input.viewAngle,
      });

  // Provider/model are placeholders until a real provider is actually
  // resolved by AIProviderManager below — with automatic failover, the
  // provider that ends up serving this request can genuinely differ from
  // whichever one looks like "the" configured provider at this point, so
  // this row is corrected to the real provider/model on success (see
  // markSuccessWithProvider).
  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_GENERATE",
    promptVersion: GENERATION_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    // Routed through AIProviderManager — capability-filtered, priority-
    // sorted, with automatic failover to the next configured provider on a
    // transient failure (quota/rate-limit/timeout/outage), and a clean,
    // honest error if no configured provider currently supports the needed
    // capability at all. Never silently falls back to a text-only call — a
    // provider missing this capability throws UNSUPPORTED_OPERATION here,
    // which AIProviderManager treats as a non-failover-eligible
    // configuration problem (see its own comment), exactly the "never fake
    // fabric/sketch usage" requirement. SKETCH mode uses DESIGN_REPLICATION
    // (the sketch is the "reference image", the fabric is the "material
    // image") — the same real, already-implemented two-image primitive
    // Replicate Design's own Generate step uses, never a parallel
    // generation system.
    const result = isSketchMode
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "DESIGN_REPLICATION",
          generationContext: `AI Designer / Sketch Project ${project.projectNumber}`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.replicateWithNewMaterial) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support generating a garment from a sketch reference image.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.replicateWithNewMaterial({
              prompt,
              count: input.imageCount,
              referenceImage: { buffer: sketchImage!.buffer, mimeType: sketchImage!.attachment.mimeType },
              materialImage: { buffer: fabricBuffer, mimeType: fabricAttachment.mimeType },
            });
          },
        })
      : await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "FABRIC_REFERENCE",
          generationContext: `AI Designer / Project ${project.projectNumber}`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.generateFromFabricReference) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support generating a design from a fabric reference image — it can only do text-to-image, which cannot preserve the actual fabric photo.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.generateFromFabricReference({
              prompt,
              count: input.imageCount,
              fabricImage: { buffer: fabricBuffer, mimeType: fabricAttachment.mimeType },
            });
          },
        });

    const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "AI_DESIGNER_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `ai-designer-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "GENERATED_DESIGN_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await AiDesignerImageRepository.createMany(rows);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    if (images.length > 0) {
      await bumpVersion(actor, projectId, images[0].id, "Initial design generated.", specJson);
    }

    const completedSteps = markStepsComplete(project.completedSteps, ["GENERATE"], project.creationMode);
    await AiDesignerProjectRepository.update(projectId, {
      status: "IN_PROGRESS",
      completedSteps,
      currentStep: computeCurrentStep(completedSteps, project.creationMode),
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images };
  } catch (err) {
    // AIProviderManager already classified and logged the real per-provider
    // failure(s) into AIProviderUsage/AIFailoverLog — this local row just
    // needs the final, user-facing message for this project's own history.
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 10 — Edit Design
// ---------------------------------------------------------------------------

function changeSummaryForEdit(input: GenerateEditPreviewInput): string {
  if (input.mode === "QUICK") return `Changed ${input.featureLabel}: ${input.newValue}`;
  if (input.mode === "TECHNICAL") return `Technical edit — ${input.featureLabel}`;
  return `AI edit — ${input.featureLabel}`;
}

/**
 * Edit Design workspace, step 1 of 2 — generates 1-4 candidate images for a
 * requested change WITHOUT touching the current design at all (no version
 * bump, no currentVersionId change). The images are created PENDING, exactly
 * like the Step 9 gallery's own images, and must be explicitly applied via
 * applyEditVariation() below — this is the "AI must never immediately
 * overwrite the approved/current design; generate a preview first" rule,
 * enforced structurally rather than by convention.
 */
export async function generateEditPreview(actor: ActorContext, projectId: string, input: GenerateEditPreviewInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before editing it.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);

  // A real, confirmed-live bug fixed here: chaining edits purely from
  // image-to-image (each edit based only on the PREVIOUS edit's own output,
  // via generateVariation's single-image call) has no ground truth to check
  // fabric fidelity against — the "preserve fabric" wording in the prompt is
  // just text, unenforced by any actual image, so the fabric print/texture
  // visibly drifts further from the real original with every successive
  // edit. Fixed by re-fetching the project's own real original fabric photo
  // (always present — assertReadyToGenerate requires it before any design
  // can even be generated) and supplying it as a genuine second reference
  // image on every edit call (provider.applyFabric), the same "the image is
  // the source of truth, never text/memory alone" discipline already used
  // for the original Generate Design/Multi-Fabric calls.
  const fabricAttachmentId = project.fabricImageAttachmentId;
  // Fabric-grounded editing (applyFabric) needs a provider with MULTI_FABRIC
  // ticked. When none has it, fall back to the ordinary single-image edit
  // (IMAGE_EDIT) instead of failing — the prompt drops its fabric-reference
  // wording via hasFabricReference below.
  const fabricRef =
    fabricAttachmentId && (await hasProviderForCapability(actor.companyId, "MULTI_FABRIC"))
      ? await getAttachmentForDownload(actor.companyId, fabricAttachmentId)
      : null;

  const prompt = buildWorkspaceEditPrompt({
    mode: input.mode,
    featureLabel: input.featureLabel,
    currentValue: input.currentValue || "Not specified",
    newValue: input.newValue || null,
    technicalFields: input.technicalFields || null,
    freeformInstructions: input.freeformInstructions || null,
    hasFabricReference: !!fabricRef,
    viewAngle: input.viewAngle,
  });

  const specJson = {
    ...buildSpecJson(project),
    edit: {
      mode: input.mode,
      featureLabel: input.featureLabel,
      currentValue: input.currentValue || null,
      newValue: input.newValue || null,
      technicalFields: input.technicalFields || null,
      freeformInstructions: input.freeformInstructions || null,
      viewAngle: input.viewAngle,
    },
  };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: GENERATION_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    parentImageId: parentImage.id,
    editedFeature: input.featureLabel,
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = fabricRef
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "MULTI_FABRIC",
          generationContext: `AI Designer / Project ${project.projectNumber} / Edit (fabric-grounded)`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.applyFabric) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support editing with a fabric reference.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.applyFabric({
              prompt,
              count: input.imageCount,
              baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
              swatchImage: { buffer: fabricRef.buffer, mimeType: fabricRef.attachment.mimeType },
            });
          },
        })
      : // Defensive fallback only — assertReadyToGenerate() guarantees a real
        // fabric photo exists before any design (and therefore any edit) can
        // exist at all, so this branch should never actually run in practice.
        await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "IMAGE_EDIT",
          generationContext: `AI Designer / Project ${project.projectNumber} / Edit`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.generateVariation) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support editing an existing image.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.generateVariation({
              prompt,
              count: input.imageCount,
              parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
            });
          },
        });

    const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "AI_DESIGNER_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `ai-designer-edit-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "EDIT_PREVIEW_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await AiDesignerImageRepository.createMany(rows);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { editedFeature: input.featureLabel, mode: input.mode, imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images, prompt: promptRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

/**
 * Edit Design workspace, "Draw & Describe" tab — the mask-based sibling of
 * generateEditPreview() above, same two-step "preview first, explicit apply
 * second" contract (this only creates PENDING images; applyEditVariation()
 * below applies one exactly like any other edit-mode preview). The actual
 * prompt build + provider call is the ONE function every "Draw & Describe"
 * call in this app shares — see runMaskEditGeneration in
 * @/core/ai/image-generation/mask-edit — this function's own job is purely
 * AI-Designer-specific bookkeeping around that shared call: loading the
 * current design, validating the drawn mask actually matches it, and
 * persisting the result into this module's own Prompt/Generation/Image
 * tables (Replicate Design's own generateReplicateMaskEditPreview does the
 * identical bookkeeping against its own, separate tables).
 */
export async function generateMaskEditPreview(
  actor: ActorContext,
  projectId: string,
  input: { instruction: string; imageCount: number; maskBuffer: Buffer }
) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before editing it.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);

  const [baseMeta, maskMeta] = await Promise.all([sharp(parentBuffer).metadata(), sharp(input.maskBuffer).metadata()]);
  if (baseMeta.width !== maskMeta.width || baseMeta.height !== maskMeta.height) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "The drawn mask doesn't match the current design's image size — reload the page and draw again."
    );
  }

  const maskAttachment = await uploadAttachment(
    actor,
    "AI_DESIGNER_PROJECT",
    projectId,
    { buffer: input.maskBuffer, fileName: `ai-designer-mask-${Date.now()}.png`, mimeType: "image/png" },
    "EDIT_MASK_IMAGE"
  );

  const prompt = buildMaskEditPrompt(input.instruction);
  const specJson = {
    ...buildSpecJson(project),
    edit: { mode: "MASK", featureLabel: "Custom Area (Drawn)", newValue: input.instruction, maskAttachmentId: maskAttachment.id },
  };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: MASK_EDIT_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    parentImageId: parentImage.id,
    editedFeature: "Custom Area (Drawn)",
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runMaskEditGeneration({
      companyId: actor.companyId,
      userId: actor.userId,
      generationContext: `AI Designer / Project ${project.projectNumber} / Draw & Describe`,
      aiDesignerProjectId: projectId,
      prompt,
      imageCount: input.imageCount,
      baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
      maskImage: { buffer: input.maskBuffer, mimeType: "image/png" },
    });

    const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "AI_DESIGNER_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `ai-designer-edit-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "EDIT_PREVIEW_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await AiDesignerImageRepository.createMany(rows);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { editedFeature: "Custom Area (Drawn)", mode: "MASK", imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images, prompt: promptRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

/**
 * Edit Design workspace, step 2 of 2 — the explicit "Apply" action. Only a
 * PENDING image whose own generation was previewed from the project's
 * CURRENT design may be applied (a stale preview left over from before an
 * intervening change is rejected outright, not silently applied over the
 * wrong base) — promotes it to a real new AiDesignerVersion, marks its
 * sibling preview images REJECTED (never leaves them ambiguously PENDING),
 * and carries the originating AI prompt + any structured technical fields
 * onto the new version for the workspace's own version-history display.
 */
export async function applyEditVariation(actor: ActorContext, imageId: string, input: ApplyEditVariationInput) {
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Applying an edit as the new current design requires explicit confirmation.");
  }

  const image = await AiDesignerImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Previewed image not found.", { id: imageId });
  }
  if (image.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This preview has already been decided — generate a new preview to try again.");
  }

  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, image.projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: image.projectId });

  const generation = await AiDesignerGenerationRepository.findByIdWithPrompt(image.generationId);
  if (!generation || !project.currentVersion || generation.parentImageId !== project.currentVersion.currentImageId) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This preview is no longer based on the current design — the design has changed since it was generated. Generate a new preview instead."
    );
  }

  const siblings = await AiDesignerImageRepository.findByGenerationId(image.generationId);
  await Promise.all(
    siblings.filter((s) => s.id !== imageId && s.decision === "PENDING").map((s) => AiDesignerImageRepository.update(s.id, { decision: "REJECTED" }))
  );
  await AiDesignerImageRepository.update(imageId, { decision: "SELECTED" });

  const editSpec = (generation.prompt.specJson as { edit?: { mode?: string; featureLabel?: string; newValue?: string; technicalFields?: Record<string, string> } })
    .edit;
  // "MASK" is generateMaskEditPreview()'s own mode tag — not one of the
  // real /edit endpoint's EDIT_MODES (that request shape has no file
  // upload), so it deliberately isn't fed through changeSummaryForEdit()
  // (whose own type only knows QUICK/TECHNICAL/AI_PROMPT) — handled here
  // instead with its own one-line summary.
  const mode = (editSpec?.mode as "QUICK" | "TECHNICAL" | "AI_PROMPT" | "MASK" | undefined) ?? "QUICK";
  const changeSummary =
    mode === "MASK"
      ? `Drawn-area edit — ${editSpec?.newValue ?? "custom instruction"}`
      : changeSummaryForEdit({
          mode,
          featureLabel: editSpec?.featureLabel ?? generation.editedFeature ?? "Edit",
          newValue: editSpec?.newValue,
          imageCount: 1,
        } as GenerateEditPreviewInput);

  const version = await bumpVersion(actor, image.projectId, imageId, changeSummary, project.currentVersion.designSnapshotJson as Record<string, unknown>, {
    approvalStatus: "AI_MODIFIED",
    aiPromptId: generation.promptId,
    technicalChangesJson: mode === "TECHNICAL" ? editSpec?.technicalFields ?? null : null,
  });

  const completedSteps = markStepsComplete(project.completedSteps, ["EDIT"], project.creationMode);
  await AiDesignerProjectRepository.update(image.projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps, project.creationMode) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "CREATE",
    newValues: { versionNumber: version.versionNumber, imageId, mode },
  });

  return version;
}

/** Top-toolbar "Approve Design" — approves the project's current version. */
export async function approveCurrentVersion(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before approving it.");

  const version = await AiDesignerVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return version;
}

/** Top-toolbar "Reject Design" — the review-workflow counterpart to Approve; does not delete or revert anything, only marks the current version's own review status. */
export async function rejectCurrentVersion(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before rejecting it.");

  const version = await AiDesignerVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "REJECTED",
    approvedByUserId: null,
    approvedAt: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "REJECTED" },
  });

  return version;
}

// ---------------------------------------------------------------------------
// Step 9b — Multi-Fabric
// ---------------------------------------------------------------------------

export async function uploadSecondFabricImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "SECOND_FABRIC_IMAGE");
  const updated = await AiDesignerProjectRepository.update(projectId, { secondFabricImageAttachmentId: attachment.id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { secondFabricImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteSecondFabricImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.secondFabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no second fabric image to delete.");
  }
  await deleteAttachment(actor, project.secondFabricImageAttachmentId);
  return AiDesignerProjectRepository.update(projectId, { secondFabricImageAttachmentId: null });
}

/**
 * Applies the second fabric onto specific area(s) of the CURRENT design
 * image — a genuine two-image composition (current design + second fabric
 * swatch), reusing the exact same AiDesignerPrompt/AiDesignerGeneration/
 * AiDesignerImage/version-bump machinery Edit Design already uses (this is
 * structurally "take the existing image and modify it," just via
 * `provider.applyFabric` instead of `provider.generateVariation`, and its
 * own prompt) — deliberately reuses the `IMAGE_EDIT` promptType/gating
 * rather than adding a new enum value purely for bookkeeping, since the
 * concurrency-guard behaviour it buys (never run two concurrent
 * image-mutating calls against the same project) is exactly what's wanted
 * here too.
 */
export async function applySecondFabric(actor: ActorContext, projectId: string, input: ApplySecondFabricInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before applying a second fabric.");
  }
  if (!project.secondFabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a second fabric photo first.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);
  const { attachment: swatchAttachment, buffer: swatchBuffer } = await getAttachmentForDownload(actor.companyId, project.secondFabricImageAttachmentId);

  const prompt = buildSecondFabricPrompt(input.applyAreas);
  const areaSummary = input.applyAreas.join(", ");
  const specJson = { ...buildSpecJson(project), secondFabric: { applyAreas: input.applyAreas } };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: GENERATION_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    parentImageId: parentImage.id,
    editedFeature: `Second Fabric Application: ${areaSummary}`,
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "MULTI_FABRIC",
      generationContext: `AI Designer / Project ${project.projectNumber} / Multi-Fabric`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.applyFabric) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support applying a second fabric onto an existing design — it needs a genuine two-image composition capability.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.applyFabric({
          prompt,
          count: 1,
          baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
          swatchImage: { buffer: swatchBuffer, mimeType: swatchAttachment.mimeType },
        });
      },
    });

    const img = result.images[0];
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: img.buffer, fileName: `ai-designer-multifabric-${Date.now()}.png`, mimeType: img.mimeType },
      "GENERATED_DESIGN_IMAGE"
    );
    await AiDesignerImageRepository.createMany([
      { companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId },
    ]);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    const version = await bumpVersion(actor, projectId, images[0].id, `Applied second fabric to: ${areaSummary}`, specJson);

    const completedSteps = markStepsComplete(project.completedSteps, ["MULTI_FABRIC"], project.creationMode);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps, project.creationMode) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { secondFabricApplyAreas: input.applyAreas, versionNumber: version.versionNumber, provider: result.providerName, model: result.model },
    });

    return { generation, images, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 9c — Embellishments
// ---------------------------------------------------------------------------

export async function uploadEmbellishmentMotif(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "EMBELLISHMENT_MOTIF_IMAGE");
  const updated = await AiDesignerProjectRepository.update(projectId, { embellishmentMotifAttachmentId: attachment.id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { embellishmentMotifAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteEmbellishmentMotif(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.embellishmentMotifAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no embellishment motif image to delete.");
  }
  await deleteAttachment(actor, project.embellishmentMotifAttachmentId);
  return AiDesignerProjectRepository.update(projectId, { embellishmentMotifAttachmentId: null });
}

/**
 * Applies a digital applique/embroidery embellishment onto the CURRENT
 * design image — either a genuine two-image composition (current design +
 * uploaded motif photo, via `provider.applyFabric`, reusing the MULTI_FABRIC
 * capability since it's mechanically the same two-image-composition call as
 * Multi-Fabric's own second-fabric application) or, when no motif photo was
 * uploaded, a single-image edit driven purely by the free-text instructions
 * (via `provider.generateVariation`, reusing the IMAGE_EDIT capability the
 * same way Edit Design's own single-image edits do). Deliberately no new
 * AIProviderCapability value — both branches are mechanically identical to
 * an existing, already-gated call, just with a different prompt.
 */
export async function applyEmbellishments(actor: ActorContext, projectId: string, input: ApplyEmbellishmentsInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before applying embellishments.");
  }
  const trimmedInstructions = input.instructions?.trim() || undefined;
  if (!project.embellishmentMotifAttachmentId && !trimmedInstructions) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Upload an embroidery/applique motif image or enter embellishment instructions first."
    );
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);
  const motifRef = project.embellishmentMotifAttachmentId
    ? await getAttachmentForDownload(actor.companyId, project.embellishmentMotifAttachmentId)
    : null;

  const prompt = buildEmbellishmentPrompt(input.embellishmentType, trimmedInstructions, !!motifRef);
  const specJson = {
    ...buildSpecJson(project),
    embellishment: { embellishmentType: input.embellishmentType, instructions: trimmedInstructions ?? null },
  };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: GENERATION_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    parentImageId: parentImage.id,
    editedFeature: `Embellishment: ${input.embellishmentType}`,
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = motifRef
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "MULTI_FABRIC",
          generationContext: `AI Designer / Project ${project.projectNumber} / Embellishments`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.applyFabric) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support applying an embellishment motif onto an existing design — it needs a genuine two-image composition capability.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.applyFabric({
              prompt,
              count: 1,
              baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
              swatchImage: { buffer: motifRef.buffer, mimeType: motifRef.attachment.mimeType },
            });
          },
        })
      : await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "IMAGE_EDIT",
          generationContext: `AI Designer / Project ${project.projectNumber} / Embellishments`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.generateVariation) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support editing an existing image.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.generateVariation({
              prompt,
              count: 1,
              parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
            });
          },
        });

    const img = result.images[0];
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: img.buffer, fileName: `ai-designer-embellishment-${Date.now()}.png`, mimeType: img.mimeType },
      "GENERATED_DESIGN_IMAGE"
    );
    await AiDesignerImageRepository.createMany([
      { companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId },
    ]);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    const typeLabel = input.embellishmentType.replace(/_/g, " ");
    const changeSummary = `Applied embellishment: ${typeLabel}${trimmedInstructions ? ` — ${trimmedInstructions.slice(0, 80)}` : ""}`;
    // Embellishments is hidden from the main wizard for now, per explicit
    // request — it's still a fully real action (motif upload + AI apply,
    // unchanged), reachable from the Edit Design workspace instead, which has
    // no step/stepper concept of its own — no completedSteps write needed
    // here anymore ("EMBELLISHMENTS" no longer exists in the step order).
    const version = await bumpVersion(actor, projectId, images[0].id, changeSummary, specJson);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: {
        embellishmentType: input.embellishmentType,
        instructions: trimmedInstructions ?? null,
        versionNumber: version.versionNumber,
        provider: result.providerName,
        model: result.model,
      },
    });

    return { generation, images, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 12b — Branding (optional brand name + logo overlay). Deliberately a
// plain "settings + on-demand composite" feature, not an audited/versioned
// AI process — applyBranding() is a real sharp image composite, never an AI
// call. brandName has no stored default -- the real default (the logged-in
// company's own name) is resolved at read time in getBrandDefaults() below,
// so a later company-name change is picked up automatically. A logo has no
// default at all (no company-logo field exists anywhere in this schema).
// ---------------------------------------------------------------------------

const DEFAULT_LOGO_X_PERCENT = 70;
const DEFAULT_LOGO_Y_PERCENT = 80;
const DEFAULT_LOGO_WIDTH_PERCENT = 20;
const MIN_LOGO_WIDTH_PERCENT = 5;
const MAX_LOGO_WIDTH_PERCENT = 60;

export async function updateBrandName(actor: ActorContext, projectId: string, input: UpdateBrandNameInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const updated = await AiDesignerProjectRepository.update(projectId, { brandName: input.brandName || null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { brandName: project.brandName },
    newValues: { brandName: input.brandName || null },
  });

  return updated;
}

export async function uploadBrandLogo(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "BRAND_LOGO");

  // Only sets a default position/size the first time a logo is uploaded --
  // a re-upload replacing an existing logo keeps whatever position/size the
  // user already dialed in.
  const project = await getOwnedProject(actor.companyId, projectId);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    brandLogoAttachmentId: attachment.id,
    logoXPercent: project.logoXPercent ?? DEFAULT_LOGO_X_PERCENT,
    logoYPercent: project.logoYPercent ?? DEFAULT_LOGO_Y_PERCENT,
    logoWidthPercent: project.logoWidthPercent ?? DEFAULT_LOGO_WIDTH_PERCENT,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { brandLogoAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteBrandLogo(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.brandLogoAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded logo to delete.");
  }

  await deleteAttachment(actor, project.brandLogoAttachmentId);
  if (project.brandedImageAttachmentId) {
    await deleteAttachment(actor, project.brandedImageAttachmentId);
  }

  const updated = await AiDesignerProjectRepository.update(projectId, {
    brandLogoAttachmentId: null,
    brandedImageAttachmentId: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { brandLogoAttachmentId: project.brandLogoAttachmentId },
    newValues: { brandLogoAttachmentId: null },
  });

  return updated;
}

export async function updateLogoPosition(actor: ActorContext, projectId: string, input: UpdateLogoPositionInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.brandLogoAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a logo before setting its position.");
  }

  const updated = await AiDesignerProjectRepository.update(projectId, {
    logoXPercent: input.logoXPercent,
    logoYPercent: input.logoYPercent,
    logoWidthPercent: input.logoWidthPercent,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { logoXPercent: input.logoXPercent, logoYPercent: input.logoYPercent, logoWidthPercent: input.logoWidthPercent },
  });

  return updated;
}

/**
 * Composites the uploaded logo onto the currently selected design image at
 * the stored position/size via a real sharp() operation -- never an AI
 * call. Re-running this after the user moves/resizes the logo simply
 * replaces the prior branded output. logoXPercent/logoYPercent are clamped
 * server-side against the logo's own actual rendered width/height so the
 * composite can never place the logo partially off-canvas, regardless of
 * what the client last stored (e.g. a stale position saved before the
 * logo's own width percent was reduced).
 */
export async function applyBranding(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before applying branding.");
  }
  if (!project.brandLogoAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a logo before applying branding.");
  }

  const { buffer: designBuffer } = await getAttachmentForDownload(actor.companyId, project.currentVersion.currentImage.imageAttachmentId);
  const { buffer: logoBuffer } = await getAttachmentForDownload(actor.companyId, project.brandLogoAttachmentId);

  // sharp/libvips throws a low-level decode/encode error (not a
  // BusinessRuleError) for a structurally corrupt image file — caught here
  // and rethrown as a clean, honest message rather than a raw 500. The
  // design image is generated by this app's own pipeline and essentially
  // never corrupt; the logo is a real user upload and genuinely can be.
  let compositedBuffer: Buffer;
  try {
    const designMeta = await sharp(designBuffer).metadata();
    const designWidth = designMeta.width ?? 0;
    const designHeight = designMeta.height ?? 0;
    if (!designWidth || !designHeight) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Could not read the current design image's dimensions.");
    }

    const widthPercent = Math.min(
      MAX_LOGO_WIDTH_PERCENT,
      Math.max(MIN_LOGO_WIDTH_PERCENT, Number(project.logoWidthPercent ?? DEFAULT_LOGO_WIDTH_PERCENT))
    );
    const logoWidthPx = Math.max(1, Math.round((widthPercent / 100) * designWidth));
    const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidthPx }).png().toBuffer();
    const resizedMeta = await sharp(resizedLogo).metadata();
    const logoHeightPx = resizedMeta.height ?? logoWidthPx;

    const xPercent = Number(project.logoXPercent ?? DEFAULT_LOGO_X_PERCENT);
    const yPercent = Number(project.logoYPercent ?? DEFAULT_LOGO_Y_PERCENT);
    const maxLeft = Math.max(0, designWidth - logoWidthPx);
    const maxTop = Math.max(0, designHeight - logoHeightPx);
    const left = Math.min(maxLeft, Math.max(0, Math.round((xPercent / 100) * designWidth)));
    const top = Math.min(maxTop, Math.max(0, Math.round((yPercent / 100) * designHeight)));

    compositedBuffer = await sharp(designBuffer)
      .composite([{ input: resizedLogo, left, top }])
      .png()
      .toBuffer();
  } catch (err) {
    if (err instanceof BusinessRuleError) throw err;
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Could not process the uploaded logo image — it may be corrupt or in an unsupported format. Try a different file."
    );
  }

  if (project.brandedImageAttachmentId) {
    await deleteAttachment(actor, project.brandedImageAttachmentId);
  }

  const attachment = await uploadAttachment(
    actor,
    "AI_DESIGNER_PROJECT",
    projectId,
    { buffer: compositedBuffer, fileName: `ai-designer-branded-${Date.now()}.png`, mimeType: "image/png" },
    "BRANDED_DESIGN_IMAGE"
  );

  const completedSteps = markStepsComplete(project.completedSteps, ["BRANDING"], project.creationMode);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    brandedImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps, project.creationMode),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { brandedImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

/** Resolves the effective brand name shown/used at generation time -- never stored, so a later company-name change is picked up automatically. */
export async function getBrandDefaults(companyId: string, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  return { effectiveBrandName: project.brandName || project.company.name };
}

// ---------------------------------------------------------------------------
// Images / decisions / versions
// ---------------------------------------------------------------------------

export async function decideImage(actor: ActorContext, imageId: string, input: DecideImageInput) {
  const image = await AiDesignerImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Generated image not found.", { id: imageId });
  }
  if (input.decision === "SELECT" && !input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a design as the final visual requires explicit confirmation.");
  }

  const decision = input.decision === "SELECT" ? "SELECTED" : "REJECTED";
  const updated = await AiDesignerImageRepository.update(imageId, { decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_images",
    recordId: imageId,
    action: "UPDATE",
    oldValues: { decision: image.decision },
    newValues: { decision },
  });

  return updated;
}

/** Every generated image across every generation for this project — the Step 9 gallery's real data source, so Select/Reject state survives a page reload instead of only ever showing the most recent in-session generate/edit call. */
export async function listImages(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerImageRepository.findByProjectId(projectId);
}

/**
 * Edit Design workspace — restores the "AI Variations" tab's PENDING preview
 * on page load/re-navigation, so a genuinely successful edit generation
 * (QUICK/TECHNICAL/AI_PROMPT/MASK, all promptType IMAGE_EDIT) never looks
 * like it silently failed just because the workspace's own `preview` state
 * had nothing to seed it with before this existed. Returns null when there
 * is nothing to restore (no current image, or the most recent matching
 * generation is stale/fully decided) — the workspace then shows its normal
 * empty state exactly as before.
 */
export async function getActiveEditPreview(companyId: string, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project?.currentVersion?.currentImage) return null;
  const generation = await AiDesignerGenerationRepository.findLatestPendingEditPreview(projectId, project.currentVersion.currentImage.id);
  if (!generation) return null;
  return { generationId: generation.id, images: generation.images };
}

export async function listVersions(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerVersionRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Tech Pack — full "GARMENT TECH PACK SPEC SHEET GENERATOR" pipeline: a
// comprehensive Garment Analysis (categories A-J) rendered as a real,
// professional multi-page PDF from structured data via fixed
// @react-pdf/renderer templates. v3 (2026-09-14) removed AI-drawn PAGE
// images entirely (asking an image model to render a whole page's tables/
// text baked into one image came back as illegible pixel-noise on live
// testing) — pages that show a visual instead embed the project's own real,
// already-generated design photo (never re-uploaded). A later pass
// (see attemptGenerateTechnicalFlat) reintroduced AI image generation for a
// genuinely different, narrower purpose: ONE clean garment-only technical
// flat (front+back line art, no text/tables baked in, via the same proven
// capability already used by AI Garment Flow's own Technical Development
// process) to use as an optional, gracefully-degrading hero-image upgrade
// over the plain photo — never a whole rendered page. Also has a real
// approve/revision discipline (see
// updateTechPackField/approveTechPack/revertTechPackToOriginal below).
// ---------------------------------------------------------------------------

function buildTechPackDesignContext(
  project: AiDesignerProject & {
    sketchAnalysis?: { status: string; sketchAnalysisSummary: string | null } | null;
    pieces?: { pieceLabel: string; productCategory: string | null; designNotes: string | null }[];
  }
): TechPackDesignContext {
  // Widened (previously only name/composition/GSM) to also carry the fuller
  // fabric/model/environment detail buildSpecJson() already assembles for
  // this same project, elsewhere in this file — the AI's own construction/
  // silhouette inferences (categories B/D, which legitimately need to come
  // from the model) were previously made with unnecessarily thin context.
  const fabricDetail = [
    project.fabricWidth && `Width: ${project.fabricWidth}`,
    project.fabricWeave && `Weave: ${project.fabricWeave}`,
    project.fabricStretch && `Stretch: ${project.fabricStretch}`,
    project.fabricOpacity && `Opacity: ${project.fabricOpacity}`,
    project.fabricTexture && `Texture: ${project.fabricTexture}`,
    project.fabricPatternType && `Pattern: ${project.fabricPatternType}`,
    project.fabricPrintType && `Print: ${project.fabricPrintType}`,
    project.fabricSuitableSeason && `Suitable Season: ${project.fabricSuitableSeason}`,
    project.fabricRecommendedGarments && `Recommended Garments: ${project.fabricRecommendedGarments}`,
    project.fabricColor && `Color: ${project.fabricColor}`,
  ]
    .filter(Boolean)
    .join("; ");
  const modelDescription = [project.modelGender, project.modelBodyType, project.modelPose].filter(Boolean).join(", ");

  return {
    productCategory: project.productCategory || "Not specified",
    designSelections: buildDesignSelectionsText(project),
    fabricDescription: [project.fabricName, project.fabricComposition, project.fabricGsm].filter(Boolean).join(", ") || "Not specified",
    targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
    ageGroup: project.ageGroup || "Not specified",
    projectName: project.projectName,
    sketchDesignNote:
      project.creationMode === "SKETCH" && project.sketchAnalysis?.status === "APPROVED" && project.sketchAnalysis.sketchAnalysisSummary
        ? project.sketchAnalysis.sketchAnalysisSummary
        : undefined,
    fabricDetail: fabricDetail || undefined,
    modelDescription: modelDescription || undefined,
    environmentDescription: project.environmentLabel || undefined,
    garmentPieces:
      project.projectMode === "SET" && project.pieces && project.pieces.length > 0
        ? project.pieces.map(
            (p) => `${p.pieceLabel}${p.productCategory ? ` (${p.productCategory})` : ""}${p.designNotes ? ` — ${p.designNotes}` : ""}`
          )
        : undefined,
  };
}

/**
 * Generates a real AI technical flat (front+back CAD-style line-art) to
 * replace the plain photo as Tech Pack's hero image, reusing the exact
 * proven capability/prompt already used by AI Garment Flow's own Technical
 * Development process (`buildTechnicalFlatPrompt` — front+back view, black
 * line art, plain white background, no baked-in text) — a genuinely
 * different, much safer thing than the "AI-drawn PAGE images" v3 removed
 * from this same feature (see the doc comment above generateTechPack): this
 * generates one clean garment-only reference image, never a rendered page
 * with tables/text baked into it.
 *
 * Deliberately isolated from the Part 1/Part 2 analysis chain's own
 * all-or-nothing failure semantics — this call NEVER rejects. Any failure
 * (no configured provider, a real provider error, an upload failure)
 * resolves to null, and the tech pack still generates successfully using
 * the plain photo, exactly as it did before this feature existed.
 */
async function attemptGenerateTechnicalFlat(
  actor: ActorContext,
  project: AiDesignerProject,
  baseBuffer: Buffer,
  imageMediaType: "image/jpeg" | "image/png" | "image/webp"
): Promise<string | null> {
  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "TECHNICAL_FLAT",
      generationContext: `AI Designer / Project ${project.projectNumber} / Tech Pack`,
      aiDesignerProjectId: project.id,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.generateTechnicalFlat) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support generating a technical flat sketch.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.generateTechnicalFlat({
          prompt: buildTechnicalFlatPrompt({}),
          count: 1,
          baseImage: { buffer: baseBuffer, mimeType: imageMediaType },
        });
      },
    });

    const image = result.images[0];
    if (!image) return null;

    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      project.id,
      { buffer: image.buffer, fileName: `tech-pack-flat-${Date.now()}.png`, mimeType: image.mimeType },
      "TECH_PACK_TECHNICAL_FLAT"
    );
    return attachment.id;
  } catch {
    return null;
  }
}

async function assertNoActiveTechPackRun(projectId: string) {
  const freshSince = new Date(Date.now() - TECH_PACK_RUN_FRESHNESS_WINDOW_MS);
  const latest = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (latest && latest.status === "IN_PROGRESS" && latest.createdAt >= freshSince) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A tech pack is already being generated for this project.", {
      techPackId: latest.id,
    });
  }
}

/**
 * The full pipeline behind the user's own "GARMENT TECH PACK STRUCTURED DATA
 * GENERATOR" prompt (supplied verbatim, 2026-09-22, superseding the earlier
 * 2026-09-13 "SPEC SHEET GENERATOR" prompt — see schema.ts's own v4 doc
 * comment) — 4 real AI calls: (1) a vision call analyzes the current design
 * image into categories A-G, (2)+(3) two text calls that both only depend on
 * (1)'s output — Fabric & Materials/BOM/Measurements, and Production
 * Instructions/QC Checkpoints/Labels & Packaging/Hangtag & Barcode — run
 * CONCURRENTLY, then (4) a final text call reviews the full analysis
 * (1)+(2)+(3) together into Assumptions & Missing Data / Additional
 * Reference Images Required / Designer Notes. Deliberately all-or-nothing:
 * if any of the 4 real AI calls fails, the whole attempt is marked FAILED,
 * rather than persisting a partially-successful run — simpler to reason
 * about, and a retry is cheap (this is a manual, low-frequency action, not a
 * hot path). A fifth, independent technical-flat image call runs
 * concurrently alongside Part 1 (see attemptGenerateTechnicalFlat) — it is
 * the one call in this pipeline that is allowed to fail without failing the
 * whole run. Otherwise, zero reuse of AI Garment Flow's own, much richer
 * equivalent processes — this module stays deliberately isolated from that
 * one.
 */
export async function generateTechPack(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before creating its tech pack.");
  }
  await assertNoActiveTechPackRun(projectId);

  const techPackRow = await AiDesignerTechPackRepository.create({
    companyId: actor.companyId,
    projectId,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const designContext = buildTechPackDesignContext(project);
    const { attachment: baseAttachment, buffer: baseBuffer } = await getAttachmentForDownload(
      actor.companyId,
      project.currentVersion.currentImage.imageAttachmentId
    );
    const imageMediaType = normalizeImageMediaType(baseAttachment.mimeType);

    // The technical-flat attempt runs CONCURRENTLY with Part 1, not
    // sequentially before/after it -- it never rejects (see
    // attemptGenerateTechnicalFlat's own doc comment), so it cannot change
    // this Promise.all's own rejection behavior, which is still driven
    // entirely by Part 1 exactly as before this feature existed.
    const [technicalFlatAttachmentId, part1] = await Promise.all([
      attemptGenerateTechnicalFlat(actor, project, baseBuffer, imageMediaType),
      generateGarmentAnalysisPart1({
        ctx: designContext,
        imageBase64: baseBuffer.toString("base64"),
        imageMediaType,
      }),
    ]);
    // Parts 2 and 3 each only depend on Part 1's output, not on each other --
    // run them concurrently rather than sequentially.
    const [part2, part3] = await Promise.all([
      generateGarmentAnalysisPart2({ ctx: designContext, part1: part1.data }),
      generateGarmentAnalysisPart3({ ctx: designContext, part1: part1.data }),
    ]);
    const part4 = await generateGarmentAnalysisPart4({ ctx: designContext, part1: part1.data, part2: part2.data, part3: part3.data });

    // Pages 1/2/5 embed the project's own real design photo (the SAME
    // attachment id already on the project's current version, reused as-is
    // -- never re-uploaded). Pages 1, 2, 5, and 6 additionally carry the
    // technical-flat attachment id when one was successfully generated --
    // stored uniformly here regardless of which one the renderer actually
    // displays per page; see tech-pack-pdf.tsx's own Page 2 handling for why
    // it always prefers the plain photo over the flat (the seam callouts'
    // xPercent/yPercent were estimated against the photo, not the flat).
    const realPhotoAttachmentId = project.currentVersion.currentImage.imageAttachmentId;
    const FLAT_ELIGIBLE_PAGE_NUMBERS = [1, 2, 5, 6] as const;
    const pages = TECH_PACK_PAGE_DEFINITIONS.map((def) => ({
      pageNumber: def.pageNumber,
      pageTitle: def.title,
      imageAttachmentId: (PHOTO_PAGE_NUMBERS as readonly number[]).includes(def.pageNumber) ? realPhotoAttachmentId : null,
      technicalFlatAttachmentId: (FLAT_ELIGIBLE_PAGE_NUMBERS as readonly number[]).includes(def.pageNumber) ? technicalFlatAttachmentId : null,
    }));

    const garmentAnalysis: GarmentAnalysis = { part1: part1.data, part2: part2.data, part3: part3.data, part4: part4.data };

    const updated = await AiDesignerTechPackRepository.markSuccess(techPackRow.id, {
      garmentAnalysisJson: garmentAnalysis as unknown as Prisma.InputJsonValue,
      designerNotes: part4.data.designerNotes,
      suggestedAdditionalViews:
        part4.data.additionalReferenceImagesRequired.map((r) => `${r.viewNeeded} — ${r.reason}`).join("\n") || "None — the supplied image is sufficient.",
      pages,
    });

    const completedSteps = markStepsComplete(project.completedSteps, ["TECH_PACK"], project.creationMode);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps, project.creationMode) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_tech_packs",
      recordId: techPackRow.id,
      action: "CREATE",
      newValues: { status: "SUCCESS", bomLineCount: part2.data.bomItems.length, pageCount: pages.length },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerTechPackRepository.markFailed(techPackRow.id, message);
    mapAiError(err);
  }
}

export async function getLatestTechPack(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerTechPackRepository.findLatestByProjectId(projectId);
}

/** Downloads the latest successful Tech Pack as one combined PDF. */
export async function exportTechPackPdf(actor: ActorContext, projectId: string) {
  // findByIdWithDetails (not getOwnedProject/findAnyById, which has no
  // relation includes at all) so project.createdBy is genuinely available
  // for the letterhead's real Designer/Brand fields below.
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const techPack = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (!techPack || techPack.status !== "SUCCESS" || !techPack.garmentAnalysisJson) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a tech pack first before downloading it.");
  }

  // Per page, prefer the technical flat over the plain photo -- EXCEPT Page
  // 2, which always uses the plain photo regardless, because that is the
  // exact image the vision model analyzed when estimating each seam
  // callout's xPercent/yPercent; a flat is a separately-generated image with
  // a different framing/crop, so a pin position estimated against the photo
  // would not reliably line up if drawn on the flat instead.
  const chosenAttachmentIdByPage = new Map<number, string>();
  for (const p of techPack.pages) {
    const chosen = p.pageNumber === 2 ? p.imageAttachmentId : (p.technicalFlatAttachmentId ?? p.imageAttachmentId);
    if (chosen) chosenAttachmentIdByPage.set(p.pageNumber, chosen);
  }

  // Multiple pages typically share the SAME real attachment id (e.g. every
  // flat-eligible page reuses the one generated flat) -- fetch each distinct
  // one once rather than once per page.
  const page2AttachmentId = chosenAttachmentIdByPage.get(2);
  const distinctAttachmentIds = [...new Set(chosenAttachmentIdByPage.values())];
  const fetched = new Map<string, { imageBase64: string; imageMimeType: string }>();
  // Page 2's own real pixel dimensions -- needed so the renderer can correct
  // for `objectFit: "contain"` letterboxing when placing seam-callout pins
  // (the AI estimated xPercent/yPercent against the photo's own pixels, not
  // the fixed-size display box). Undefined (graceful, no correction applied)
  // if Page 2 has no image, or its dimensions can't be read.
  let page2ImageDimensions: { width: number; height: number } | undefined;
  for (const attachmentId of distinctAttachmentIds) {
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, attachmentId);
    fetched.set(attachmentId, { imageBase64: buffer.toString("base64"), imageMimeType: attachment.mimeType });
    if (attachmentId === page2AttachmentId) {
      try {
        const metadata = await sharp(buffer).metadata();
        if (metadata.width && metadata.height) {
          page2ImageDimensions = { width: metadata.width, height: metadata.height };
        }
      } catch {
        // A pin-position correction is a pure visual enhancement, never worth
        // failing the whole PDF download over -- falls back to the
        // uncorrected (letterboxing-unaware) pin placement, exactly as
        // before this fix.
      }
    }
  }

  const images: TechPackDocumentPageImage[] = [...chosenAttachmentIdByPage.entries()].map(([pageNumber, attachmentId]) => ({
    pageNumber,
    ...fetched.get(attachmentId)!,
  }));

  const { companyName } = await getCompanyHeaderLines(actor.companyId);
  const realStyleInfo = {
    brandName: companyName,
    styleName: project.projectName,
    styleNumber: project.projectNumber,
    category: project.productCategory ?? "Not specified",
    targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
    designerName: project.createdBy?.fullName ?? "Not specified",
    dateCreated: formatDocDate(project.createdAt),
  };

  const revisionChain = (await AiDesignerTechPackRepository.findRevisionChain(techPack.id)) ?? [];

  const { renderTechPackDocumentPdfV2 } = await import("@/core/ai-designer/export/tech-pack-pdf");
  const pdfBuffer = await renderTechPackDocumentPdfV2({
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    generatedAt: techPack.createdAt.toLocaleString(),
    analysis: techPack.garmentAnalysisJson as unknown as TechPackAnalysisForPdfV2,
    images,
    companyName,
    realStyleInfo,
    page2ImageDimensions,
    setPieces:
      project.projectMode === "SET" && project.pieces.length > 0
        ? project.pieces.map((p) => ({ pieceLabel: p.pieceLabel, productCategory: p.productCategory }))
        : undefined,
    revisionHistory: revisionChain.map((r) => ({
      revisionNumber: r.revisionNumber,
      createdAt: formatDocDate(r.createdAt),
      createdByName: r.createdBy?.fullName ?? "—",
      approvalStatus: r.approvalStatus,
      approvedAt: r.approvedAt ? formatDocDate(r.approvedAt) : null,
      approvedByName: r.approvedBy?.fullName ?? null,
    })),
  });

  return { buffer: pdfBuffer, mimeType: "application/pdf", fileName: `${project.projectNumber}-tech-pack.pdf` };
}

/** True for a `{value, status}`-shaped leaf (2026-09-22, v4) -- distinguishes it at runtime from a still-plain-string leaf, so the same read/write helpers below work uniformly across both without a second, parallel set of field-name registries per category. */
function isStatusValueLeaf(v: unknown): v is { value: string; status: string } {
  return typeof v === "object" && v !== null && typeof (v as Record<string, unknown>).value === "string" && typeof (v as Record<string, unknown>).status === "string";
}

/** Reads the current string at `container[key]`, honoring `subfield` ("value" default, or "status") when that leaf is a `{value, status}` pair -- otherwise returns the plain string as-is. */
function readLeaf(container: Record<string, unknown>, key: string, subfield: "value" | "status" | undefined): string | undefined {
  const leaf = container[key];
  if (isStatusValueLeaf(leaf)) return subfield === "status" ? leaf.status : leaf.value;
  return typeof leaf === "string" ? leaf : undefined;
}

/** Writes `value` into `container[key]`, honoring `subfield` when that leaf is a `{value, status}` pair (validating a "status" write against the shared CONFIDENCE_STATUSES enum) -- otherwise replaces the plain string in place. */
function writeLeaf(container: Record<string, unknown>, key: string, subfield: "value" | "status" | undefined, value: string): void {
  const leaf = container[key];
  if (isStatusValueLeaf(leaf)) {
    if (subfield === "status") {
      if (!(CONFIDENCE_STATUSES as readonly string[]).includes(value)) {
        throw new BusinessRuleError("VALIDATION_ERROR", `"status" must be one of: ${CONFIDENCE_STATUSES.join(", ")}.`);
      }
      (leaf as { value: string; status: string }).status = value;
    } else {
      (leaf as { value: string; status: string }).value = value;
    }
    return;
  }
  container[key] = value;
}

/**
 * Resolves a `{category, index?, field?, subfield?}` path against a real
 * `GarmentAnalysis` object and returns the CURRENT string value there (for
 * the audit log's `oldValues`), without mutating anything. Shares the exact
 * same validation as `applyTechPackFieldEdit` below (any invalid path throws
 * the identical error), by simply calling that function with a sentinel
 * write and reading the result back out immediately afterward on a
 * throwaway clone -- see the two functions together.
 */
function readTechPackFieldValue(analysis: GarmentAnalysis, input: { category: string; index?: number; field?: string; subfield?: "value" | "status" }): string | undefined {
  const { category, index, field, subfield } = input;
  const asRecord = (v: unknown) => v as unknown as Record<string, unknown>;
  try {
    switch (category) {
      case "identification":
        return readLeaf(asRecord(analysis.part1.identification), field ?? "", subfield);
      case "construction":
        return readLeaf(asRecord(analysis.part1.construction), field ?? "", subfield);
      case "closure":
        return readLeaf(asRecord(analysis.part1.closure), field ?? "", subfield);
      case "seamCallouts":
        return readLeaf(asRecord(analysis.part1.seamCallouts[index ?? -1]), field ?? "", subfield);
      case "visibleColors":
        return readLeaf(asRecord(analysis.part1.visibleColors[index ?? -1]), field ?? "", subfield);
      case "suggestedColorways":
        return readLeaf(asRecord(analysis.part1.suggestedColorways[index ?? -1]), field ?? "", subfield);
      case "artworkItems":
        return readLeaf(asRecord(analysis.part1.artworkItems[index ?? -1]), field ?? "", subfield);
      case "fabricMaterials":
        return readLeaf(asRecord(analysis.part2.fabricMaterials[index ?? -1]), field ?? "", subfield);
      case "bomItems":
        return readLeaf(asRecord(analysis.part2.bomItems[index ?? -1]), field ?? "", subfield);
      case "measurementPoints": {
        const point = analysis.part2.measurementPoints[index ?? -1];
        if (!point) return undefined;
        if (field?.startsWith("values.")) return readLeaf(asRecord(point.values), field.slice("values.".length), subfield);
        return readLeaf(asRecord(point), field ?? "", subfield);
      }
      case "productionInstructions":
        return readLeaf(asRecord(analysis.part3.productionInstructions[index ?? -1]), field ?? "", subfield);
      case "qcCheckpoints":
        return readLeaf(asRecord(analysis.part3.qcCheckpoints[index ?? -1]), field ?? "", subfield);
      case "assumptionsAndMissingData":
        return readLeaf(asRecord(analysis.part4.assumptionsAndMissingData[index ?? -1]), field ?? "", subfield);
      case "additionalReferenceImagesRequired":
        return readLeaf(asRecord(analysis.part4.additionalReferenceImagesRequired[index ?? -1]), field ?? "", subfield);
      default:
        if ((PART1_SCALAR_FIELDS as readonly string[]).includes(category)) return readLeaf(asRecord(analysis.part1), category, subfield);
        if ((PART2_SCALAR_FIELDS as readonly string[]).includes(category)) return readLeaf(asRecord(analysis.part2), category, subfield);
        if ((PART3_SCALAR_FIELDS as readonly string[]).includes(category)) return readLeaf(asRecord(analysis.part3), category, subfield);
        if ((PART3_STATUS_FIELDS as readonly string[]).includes(category)) return readLeaf(asRecord(analysis.part3), category, subfield);
        if ((PART4_SCALAR_FIELDS as readonly string[]).includes(category)) return readLeaf(asRecord(analysis.part4), category, subfield);
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Resolves a `{category, index?, field?, subfield?}` path against a mutable
 * clone of `GarmentAnalysis`, mutating the matching leaf in place with
 * `value`. Every category/field name is checked against the real known-key
 * lists exported from `tech-pack/schema.ts` -- an unknown key or
 * out-of-bounds array index is rejected outright, never silently written.
 */
function applyTechPackFieldEdit(analysis: GarmentAnalysis, input: { category: string; index?: number; field?: string; subfield?: "value" | "status"; value: string }): void {
  const { category, index, field, subfield, value } = input;
  const asRecord = (v: unknown) => v as unknown as Record<string, unknown>;

  const requireIndex = (arr: unknown[]) => {
    if (index === undefined || index < 0 || index >= arr.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${category}" requires a valid "index" (0-${arr.length - 1}).`);
    }
    return index;
  };
  const requireField = (allowed: readonly string[]) => {
    if (!field || !allowed.includes(field)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown field "${field}" for category "${category}".`);
    }
    return field;
  };

  switch (category) {
    case "identification": {
      const key = requireField(IDENTIFICATION_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part1.identification), key, subfield, value);
      return;
    }
    case "construction": {
      const key = requireField(CONSTRUCTION_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part1.construction), key, subfield, value);
      return;
    }
    case "closure": {
      const key = requireField(CLOSURE_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part1.closure), key, subfield, value);
      return;
    }
    case "seamCallouts": {
      const i = requireIndex(analysis.part1.seamCallouts);
      const item = analysis.part1.seamCallouts[i];
      if (field === "status") {
        if (!(CONFIDENCE_STATUSES as readonly string[]).includes(value)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `"status" must be one of: ${CONFIDENCE_STATUSES.join(", ")}.`);
        }
        item.status = value as (typeof CONFIDENCE_STATUSES)[number];
        return;
      }
      const key = requireField(SEAM_CALLOUT_TEXT_FIELDS);
      (item as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "visibleColors": {
      const i = requireIndex(analysis.part1.visibleColors);
      const key = requireField(VISIBLE_COLOR_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part1.visibleColors[i]), key, subfield, value);
      return;
    }
    case "suggestedColorways": {
      const i = requireIndex(analysis.part1.suggestedColorways);
      const key = requireField(SUGGESTED_COLORWAY_EDITABLE_FIELDS);
      (analysis.part1.suggestedColorways[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "artworkItems": {
      const i = requireIndex(analysis.part1.artworkItems);
      const key = requireField(ARTWORK_ITEM_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part1.artworkItems[i]), key, subfield, value);
      return;
    }
    case "fabricMaterials": {
      const i = requireIndex(analysis.part2.fabricMaterials);
      const key = requireField(FABRIC_MATERIAL_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part2.fabricMaterials[i]), key, subfield, value);
      return;
    }
    case "bomItems": {
      const i = requireIndex(analysis.part2.bomItems);
      const key = requireField(BOM_ITEM_EDITABLE_FIELDS);
      writeLeaf(asRecord(analysis.part2.bomItems[i]), key, subfield, value);
      return;
    }
    case "measurementPoints": {
      const i = requireIndex(analysis.part2.measurementPoints);
      const point = analysis.part2.measurementPoints[i];
      if (field?.startsWith("values.")) {
        const size = field.slice("values.".length);
        if (!(STANDARD_SIZES as readonly string[]).includes(size)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `Unknown size "${size}" — must be one of: ${STANDARD_SIZES.join(", ")}.`);
        }
        (point.values as unknown as Record<string, string>)[size] = value;
        return;
      }
      if (field === "status") {
        if (!(CONFIDENCE_STATUSES as readonly string[]).includes(value)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `"status" must be one of: ${CONFIDENCE_STATUSES.join(", ")}.`);
        }
        point.status = value as (typeof CONFIDENCE_STATUSES)[number];
        return;
      }
      const key = requireField(MEASUREMENT_POINT_EDITABLE_FIELDS);
      (point as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "productionInstructions": {
      const i = requireIndex(analysis.part3.productionInstructions);
      const key = requireField(PRODUCTION_INSTRUCTION_EDITABLE_FIELDS);
      (analysis.part3.productionInstructions[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "qcCheckpoints": {
      const i = requireIndex(analysis.part3.qcCheckpoints);
      const key = requireField(QC_CHECKPOINT_EDITABLE_FIELDS);
      (analysis.part3.qcCheckpoints[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "assumptionsAndMissingData": {
      const i = requireIndex(analysis.part4.assumptionsAndMissingData);
      const item = analysis.part4.assumptionsAndMissingData[i];
      if (field === "status") {
        if (!(CONFIDENCE_STATUSES as readonly string[]).includes(value)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `"status" must be one of: ${CONFIDENCE_STATUSES.join(", ")}.`);
        }
        item.status = value as (typeof CONFIDENCE_STATUSES)[number];
        return;
      }
      const key = requireField(ASSUMPTION_TEXT_FIELDS);
      (item as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "additionalReferenceImagesRequired": {
      const i = requireIndex(analysis.part4.additionalReferenceImagesRequired);
      const key = requireField(REFERENCE_IMAGE_NEEDED_EDITABLE_FIELDS);
      (analysis.part4.additionalReferenceImagesRequired[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    default: {
      // The remaining categories are plain scalar leaves directly on Part
      // 1/2/3/4 -- some are plain strings (writeLeaf replaces the whole
      // value), some are {value,status} pairs (writeLeaf honors `subfield`).
      if ((PART1_SCALAR_FIELDS as readonly string[]).includes(category)) {
        writeLeaf(asRecord(analysis.part1), category, subfield, value);
        return;
      }
      if ((PART2_SCALAR_FIELDS as readonly string[]).includes(category)) {
        writeLeaf(asRecord(analysis.part2), category, subfield, value);
        return;
      }
      if ((PART3_SCALAR_FIELDS as readonly string[]).includes(category) || (PART3_STATUS_FIELDS as readonly string[]).includes(category)) {
        writeLeaf(asRecord(analysis.part3), category, subfield, value);
        return;
      }
      if ((PART4_SCALAR_FIELDS as readonly string[]).includes(category)) {
        writeLeaf(asRecord(analysis.part4), category, subfield, value);
        return;
      }
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown tech pack category "${category}".`);
    }
  }
}

/**
 * Edits one field/row of a Tech Pack's Garment Analysis. Editing an
 * already-APPROVED tech pack never mutates it -- it forks a brand-new
 * revision row first (same real data, same real page image ids, no
 * re-upload) and applies the edit to THAT row instead, so a previously-
 * approved, previously-downloaded PDF's data always stays exactly
 * reproducible. Editing a still-DRAFT tech pack just updates it in place.
 */
export async function updateTechPackField(actor: ActorContext, projectId: string, techPackId: string, input: UpdateTechPackFieldInput) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId || !techPack.garmentAnalysisJson) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }

  let target = techPack;
  if (techPack.approvalStatus === "APPROVED") {
    target = await AiDesignerTechPackRepository.createRevision({
      id: techPack.id,
      companyId: techPack.companyId,
      projectId: techPack.projectId,
      garmentAnalysisJson: techPack.garmentAnalysisJson as Prisma.InputJsonValue,
      originalGarmentAnalysisJson: (techPack.originalGarmentAnalysisJson ?? techPack.garmentAnalysisJson) as Prisma.InputJsonValue,
      designerNotes: techPack.designerNotes,
      suggestedAdditionalViews: techPack.suggestedAdditionalViews,
      revisionNumber: techPack.revisionNumber,
      createdByUserId: actor.userId,
      pages: techPack.pages.map((p) => ({
        pageNumber: p.pageNumber,
        pageTitle: p.pageTitle,
        promptText: p.promptText,
        imageAttachmentId: p.imageAttachmentId,
        technicalFlatAttachmentId: p.technicalFlatAttachmentId,
      })),
    });
  }

  const analysis = JSON.parse(JSON.stringify(target.garmentAnalysisJson)) as GarmentAnalysis;
  const oldValue = readTechPackFieldValue(analysis, input);
  applyTechPackFieldEdit(analysis, input);

  const updated = await AiDesignerTechPackRepository.update(target.id, {
    garmentAnalysisJson: analysis as unknown as Prisma.InputJsonValue,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: target.id,
    action: "UPDATE",
    oldValues: { category: input.category, index: input.index, field: input.field, forkedFrom: target.id !== techPack.id ? techPack.id : undefined, value: oldValue },
    newValues: { category: input.category, index: input.index, field: input.field, value: input.value },
  });

  return { techPack: updated, forkedNewRevision: target.id !== techPack.id };
}

/** Approve — mirrors AiDesignerVersion's own approvalStatus/approvedByUserId/approvedAt pattern exactly. */
export async function approveTechPack(actor: ActorContext, projectId: string, techPackId: string) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }
  if (techPack.status !== "SUCCESS") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Only a successfully generated tech pack can be approved.");
  }

  await PermissionService.assert(actor.userId, "ai_designer", "approve", { createdBy: techPack.createdByUserId });

  const updated = await AiDesignerTechPackRepository.update(techPackId, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: techPackId,
    action: "UPDATE",
    oldValues: { approvalStatus: techPack.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return updated;
}

/** Discards every edit made since generation, restoring the frozen AI-original snapshot. Blocked once approved -- an approved tech pack's own data is the record; further edits fork a new revision instead (see updateTechPackField). */
export async function revertTechPackToOriginal(actor: ActorContext, projectId: string, techPackId: string) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }
  if (techPack.approvalStatus === "APPROVED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This tech pack is already approved — it cannot be reverted.");
  }
  if (!techPack.originalGarmentAnalysisJson) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No AI-generated original is available to revert to.");
  }

  const updated = await AiDesignerTechPackRepository.update(techPackId, {
    garmentAnalysisJson: techPack.originalGarmentAnalysisJson as Prisma.InputJsonValue,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: techPackId,
    action: "UPDATE",
    newValues: { revertedToOriginal: true },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Step 12 — Export
// ---------------------------------------------------------------------------

export async function exportProject(actor: ActorContext, projectId: string, format: ExportFormat) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design before exporting.");
  }

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.currentVersion.currentImage.imageAttachmentId);

  if (format === "png" || format === "jpg") {
    // The stored image's real bytes match whichever format the configured
    // image-generation provider actually returned (confirmed live: OpenAI
    // returns PNG, Cloudflare returns JPEG) — never necessarily the format
    // the user just clicked. A real conversion is required here, not just
    // relabeling the file extension, or a ".png" download could silently
    // contain JPEG bytes (or vice versa).
    const converted =
      format === "png"
        ? await sharp(buffer).png().toBuffer()
        : await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    return { buffer: converted, mimeType, fileName: `${project.projectNumber}.${format}` };
  }

  const fabricSpec: TechPackSpecItem[] = [
    { label: "Fabric Name", value: project.fabricName ?? "" },
    { label: "Code", value: project.fabricCode ?? "" },
    { label: "Composition", value: project.fabricComposition ?? "" },
    { label: "GSM", value: project.fabricGsm ?? "" },
    { label: "Width", value: project.fabricWidth ?? "" },
    { label: "Weave", value: project.fabricWeave ?? "" },
    { label: "Stretch", value: project.fabricStretch ?? "" },
    { label: "Opacity", value: project.fabricOpacity ?? "" },
    { label: "Texture", value: project.fabricTexture ?? "" },
    { label: "Pattern Type", value: project.fabricPatternType ?? "" },
    { label: "Print Type", value: project.fabricPrintType ?? "" },
    { label: "Color", value: project.fabricColor ?? "" },
  ];
  const customerProductSpec: TechPackSpecItem[] = [
    { label: "Target Customer", value: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "" },
    { label: "Age Group", value: project.ageGroup ?? "" },
    { label: "Product Category", value: project.productCategory ?? "" },
  ];
  const designSelections = (project.designSelectionsJson as Record<string, string> | null) ?? {};
  const designSpec: TechPackSpecItem[] = Object.entries(designSelections).map(([label, value]) => ({ label, value }));
  const modelEnvironmentSpec: TechPackSpecItem[] = [
    { label: "Model Gender", value: project.modelGender ?? "" },
    { label: "Body Type", value: project.modelBodyType ?? "" },
    { label: "Pose", value: project.modelPose ?? "" },
    { label: "Environment", value: project.environmentLabel ?? "" },
  ];

  // Lazy import — @react-pdf/renderer is only ever needed for this one
  // branch; loading it eagerly at module scope would drag its full
  // dependency chain into every caller of this file for no benefit.
  const { renderTechPackPdf } = await import("@/core/ai-designer/export/tech-pack-pdf");
  const pdfBuffer = await renderTechPackPdf({
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    imageBase64: buffer.toString("base64"),
    imageMimeType: attachment.mimeType,
    fabricSpec,
    customerProductSpec,
    designSpec,
    modelEnvironmentSpec,
    generatedAt: new Date().toLocaleString(),
  });

  return { buffer: pdfBuffer, mimeType: "application/pdf", fileName: `${project.projectNumber}.pdf` };
}

import sharp from "sharp";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { deleteAttachment, getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiConfigMissingError } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { analyzeReplicateDesignDna } from "@/core/ai-designer/replicate-design/dna-analysis/analyze";
import { PROMPT_VERSION as DNA_PROMPT_VERSION } from "@/core/ai-designer/replicate-design/dna-analysis/prompt";
import { flattenToObservations } from "@/core/ai-designer/replicate-design/dna-analysis/schema";
import { FEATURE_LABELS, type FeatureKey } from "@/core/ai-designer/replicate-design/dna-analysis/feature-registry";
import { generateCompatibilityCheck } from "@/core/ai-designer/replicate-design/compatibility-check/generate";
import { PROMPT_VERSION as COMPATIBILITY_PROMPT_VERSION } from "@/core/ai-designer/replicate-design/compatibility-check/prompt";
import {
  buildReplicateGenerationPrompt,
  buildReplicateWorkspaceEditPrompt,
  PROMPT_VERSION as GENERATION_PROMPT_VERSION,
} from "@/core/ai-designer/replicate-design/image-generation/prompt";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
// Tech Pack — Replicate Design's OWN dedicated copy of AI Designer's
// original "GARMENT TECH PACK SPEC SHEET GENERATOR" pipeline
// (src/core/ai-designer/replicate-design/tech-pack/*, forked verbatim
// 2026-09-14). This used to import AI Designer's own shared tech-pack/*
// files directly (a real DRY-reuse shortcut when this feature was first
// built) — forked once AI Designer's own Tech Pack was rebuilt (v3: no more
// AI-generated page images) so that rebuild wouldn't silently change this
// unrelated feature's own behavior (still generates 4 AI page images, per
// its own untouched scope). The forked files are otherwise byte-identical
// to AI Designer's pre-v3 originals.
import { generateGarmentAnalysisPart1, generateGarmentAnalysisPart2, generatePagePrompts } from "@/core/ai-designer/replicate-design/tech-pack/generate";
import type { TechPackDesignContext } from "@/core/ai-designer/replicate-design/tech-pack/prompt";
import { TECH_PACK_PAGE_DEFINITIONS, type GarmentAnalysis } from "@/core/ai-designer/replicate-design/tech-pack/schema";
import type { TechPackAnalysisForPdf, TechPackDocumentPageImage } from "@/core/ai-designer/export/tech-pack-pdf";
import { ProductRepository } from "@/modules/products/product.repository";
import type { ListQuery } from "@/lib/list-query";
import {
  ReplicateDesignCompatibilityRepository,
  ReplicateDesignCompatibilityRunRepository,
  ReplicateDesignDnaAnalysisRepository,
  ReplicateDesignDnaAnalysisRunRepository,
  ReplicateDesignDnaObservationRepository,
  ReplicateDesignGenerationRepository,
  ReplicateDesignImageRepository,
  ReplicateDesignMaterialLineRepository,
  ReplicateDesignProjectRepository,
  ReplicateDesignPromptRepository,
  ReplicateDesignTechPackRepository,
  ReplicateDesignVersionRepository,
} from "./replicate-design.repository";
import type {
  AddMaterialLineInput,
  ApplyReplicateEditVariationInput,
  CreateReplicateProjectInput,
  DecideReplicateImageInput,
  GenerateReplicateDesignInput,
  GenerateReplicateEditPreviewInput,
  ReferenceImageSlot,
  SelectReplicateFabricInput,
  SetDnaObservationLockInput,
  UpdateDnaObservationInput,
  UpdateReplicateBrandNameInput,
  UpdateReplicateLogoPositionInput,
} from "./replicate-design.schema";
import { ReplicateDesignProjectStatus, type Prisma, type ReplicateDesignProject } from "@prisma/client";

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
 * Own, wholly separate resumable-flow step order — mirrors the *shape* of
 * AiDesignerProject's own currentStep/completedSteps, never shared code (see
 * this module's own schema comment for the isolation rationale). Every step
 * is optional/skippable in the sense that navigation is entirely user-driven
 * — this only drives the display-only "current step" cursor.
 */
export const REPLICATE_STEP_ORDER = [
  "REFERENCE_UPLOAD",
  "DNA_ANALYSIS",
  "DESIGN_LOCK_REVIEW",
  "FABRIC_MATERIAL_SELECTION",
  "COMPATIBILITY_CHECK",
  "GENERATE",
  "EDIT",
  "BRANDING",
  "TECH_PACK",
] as const;
export type ReplicateStep = (typeof REPLICATE_STEP_ORDER)[number];

function markStepsComplete(existing: string[], steps: ReplicateStep[]): string[] {
  const set = new Set(existing);
  for (const step of steps) set.add(step);
  return REPLICATE_STEP_ORDER.filter((s) => set.has(s));
}

function computeCurrentStep(completedSteps: string[]): ReplicateStep {
  return REPLICATE_STEP_ORDER.find((s) => !completedSteps.includes(s)) ?? "GENERATE";
}

const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;

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
  throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported image type "${mimeType}" — upload a JPG, PNG, or WEBP image.`);
}

async function getOwnedProject(companyId: string, id: string): Promise<ReplicateDesignProject> {
  const project = await ReplicateDesignProjectRepository.findAnyById(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id });
  return project;
}

async function assertNoActiveDnaRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await ReplicateDesignDnaAnalysisRunRepository.findActiveSince(projectId, freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A Design DNA analysis is already in progress for this project.", { runId: active.id });
  }
}

async function assertNoActiveCompatibilityRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await ReplicateDesignCompatibilityRunRepository.findActiveSince(projectId, freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A compatibility check is already in progress for this project.", { runId: active.id });
  }
}

async function assertNoActiveGenerateRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await ReplicateDesignPromptRepository.findActiveSince(projectId, "IMAGE_GENERATE", freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A generation request is already in progress for this project.", { promptId: active.id });
  }
}

async function assertNoActiveEditRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await ReplicateDesignPromptRepository.findActiveSince(projectId, "IMAGE_EDIT", freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An edit request is already in progress for this project.", { promptId: active.id });
  }
}

const TECH_PACK_RUN_FRESHNESS_WINDOW_MS = RUN_FRESHNESS_WINDOW_MS;

async function assertNoActiveTechPackRun(projectId: string) {
  const freshSince = new Date(Date.now() - TECH_PACK_RUN_FRESHNESS_WINDOW_MS);
  const latest = await ReplicateDesignTechPackRepository.findLatestByProjectId(projectId);
  if (latest && latest.status === "IN_PROGRESS" && latest.createdAt >= freshSince) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A tech pack is already being generated for this project.", { techPackId: latest.id });
  }
}

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

const VALID_REPLICATE_DESIGN_PROJECT_STATUSES = new Set<string>(Object.values(ReplicateDesignProjectStatus));

export async function listReplicateProjects(companyId: string, query: ListQuery) {
  const where: Prisma.ReplicateDesignProjectWhereInput = {
    companyId,
    ...(query.search ? { projectName: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_REPLICATE_DESIGN_PROJECT_STATUSES.has(query.status)
      ? { status: query.status as ReplicateDesignProjectStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    ReplicateDesignProjectRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    ReplicateDesignProjectRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getReplicateProjectById(companyId: string, id: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id });
  return project;
}

// ---------------------------------------------------------------------------
// Step 1 — Upload Reference Garment
// ---------------------------------------------------------------------------

export async function createReplicateProject(actor: ActorContext, input: CreateReplicateProjectInput) {
  const projectNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "REPLICATE_DESIGN_PROJECT",
  });

  const project = await ReplicateDesignProjectRepository.create({
    companyId: actor.companyId,
    projectNumber,
    projectName: input.projectName,
    status: "DRAFT",
    currentStep: "REFERENCE_UPLOAD",
    completedSteps: [],
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: project.id,
    action: "CREATE",
    newValues: { projectNumber: project.projectNumber, projectName: project.projectName },
  });

  return project;
}

const SLOT_COLUMN: Record<Exclude<ReferenceImageSlot, "ADDITIONAL">, keyof ReplicateDesignProject> = {
  FRONT: "referenceFrontImageAttachmentId",
  BACK: "referenceBackImageAttachmentId",
  SIDE: "referenceSideImageAttachmentId",
  DETAIL: "referenceDetailImageAttachmentId",
};

export async function uploadReferenceImage(actor: ActorContext, projectId: string, slot: ReferenceImageSlot, file: UploadableFile) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "REPLICATE_DESIGN_PROJECT", projectId, file, slot === "ADDITIONAL" ? "REFERENCE_ADDITIONAL" : slot);

  if (slot === "ADDITIONAL") {
    return { project, attachment };
  }

  const column = SLOT_COLUMN[slot];
  const previousAttachmentId = project[column] as string | null;
  if (previousAttachmentId) {
    await deleteAttachment(actor, previousAttachmentId).catch(() => undefined);
  }

  const completedSteps = markStepsComplete(project.completedSteps, ["REFERENCE_UPLOAD"]);
  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    [column]: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  // Only the front photo is what Design DNA analysis actually runs against —
  // replacing it invalidates any existing analysis; back/side/detail photos
  // are purely reference context and don't affect the locked DNA.
  if (slot === "FRONT") {
    await ReplicateDesignDnaAnalysisRepository.markStale(projectId);
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { [column]: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteReferenceImage(actor: ActorContext, projectId: string, attachmentId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const matchingSlot = (Object.entries(SLOT_COLUMN) as [Exclude<ReferenceImageSlot, "ADDITIONAL">, keyof ReplicateDesignProject][]).find(
    ([, column]) => project[column] === attachmentId
  );

  await deleteAttachment(actor, attachmentId);

  if (matchingSlot) {
    const [slot, column] = matchingSlot;
    await ReplicateDesignProjectRepository.update(projectId, { [column]: null });
    if (slot === "FRONT") {
      await ReplicateDesignDnaAnalysisRepository.markStale(projectId);
    }
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { deletedAttachmentId: attachmentId },
  });

  return getOwnedProject(actor.companyId, projectId);
}

// ---------------------------------------------------------------------------
// Step 2/3 — AI Garment Analysis + Design Lock
// ---------------------------------------------------------------------------

export async function runDnaAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!project.referenceFrontImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a front reference garment photo before running Design DNA analysis.");
  }
  await assertNoActiveDnaRun(projectId);

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.referenceFrontImageAttachmentId);
  const mediaType = normalizeImageMediaType(attachment.mimeType);

  const runRow = await ReplicateDesignDnaAnalysisRunRepository.create({
    companyId: actor.companyId,
    projectId,
    referenceAttachmentId: project.referenceFrontImageAttachmentId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    promptVersion: DNA_PROMPT_VERSION,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeReplicateDesignDna({
      imageBuffer: buffer,
      imageMediaType: mediaType,
      projectContext: { fabricKnown: !!project.fabricSource },
    });

    const observations = flattenToObservations(result.data).map((o) => ({
      featureKey: o.featureKey,
      aiObservation: o.aiObservation,
      aiConfidence: o.aiConfidence,
      approvedObservation: o.aiObservation,
      userEdited: false,
      isLocked: true,
    }));

    const analysis = await ReplicateDesignDnaAnalysisRepository.upsertWithObservations(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        referenceAttachmentId: project.referenceFrontImageAttachmentId,
        status: "AI_ANALYSED",
        promptVersion: DNA_PROMPT_VERSION,
        provider: "anthropic",
        model: result.model,
        rawResponseJson: result.rawResponse as Prisma.InputJsonValue,
        designDnaSummary: result.data.designDnaSummary,
        createdByUserId: actor.userId,
      },
      observations
    );

    await ReplicateDesignDnaAnalysisRunRepository.markSuccess(runRow.id, analysis.id);

    const completedSteps = markStepsComplete(project.completedSteps, ["DNA_ANALYSIS"]);
    await ReplicateDesignProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "replicate_design_dna_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { status: "AI_ANALYSED" },
    });

    return analysis;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await ReplicateDesignDnaAnalysisRunRepository.markFailed(runRow.id, category, message);
    mapAiError(err);
  }
}

export async function getDnaAnalysis(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignDnaAnalysisRepository.findByProjectId(projectId);
}

export async function updateDnaObservation(actor: ActorContext, observationId: string, input: UpdateDnaObservationInput) {
  const observation = await ReplicateDesignDnaObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design DNA observation not found.", { id: observationId });
  }

  const updated = await ReplicateDesignDnaObservationRepository.update(observationId, {
    approvedObservation: input.approvedObservation,
    userEdited: true,
  });

  // Editing any observation on an already-approved analysis pushes it back
  // to review — same "never let an approved state silently drift" discipline
  // already established for the sibling AI Garment Flow module.
  if (observation.analysis.status === "APPROVED") {
    await ReplicateDesignDnaAnalysisRepository.update(observation.analysisId, { status: "UNDER_REVIEW" });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_dna_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation },
    newValues: { approvedObservation: input.approvedObservation },
  });

  return updated;
}

export async function resetDnaObservationToAi(actor: ActorContext, observationId: string) {
  const observation = await ReplicateDesignDnaObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design DNA observation not found.", { id: observationId });
  }

  return ReplicateDesignDnaObservationRepository.update(observationId, {
    approvedObservation: observation.aiObservation,
    userEdited: false,
  });
}

/** Design Lock — toggling has no re-approval side effect, unlike an actual value edit; it only changes whether generation treats this observation as a hard constraint. */
export async function setDnaObservationLock(actor: ActorContext, observationId: string, input: SetDnaObservationLockInput) {
  const observation = await ReplicateDesignDnaObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design DNA observation not found.", { id: observationId });
  }

  return ReplicateDesignDnaObservationRepository.update(observationId, { isLocked: input.isLocked });
}

export async function approveDnaAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const analysis = await ReplicateDesignDnaAnalysisRepository.findByProjectId(projectId);
  if (!analysis) throw new BusinessRuleError("NOT_FOUND", "This project has no Design DNA analysis to approve yet.");
  if (analysis.status !== "AI_ANALYSED" && analysis.status !== "UNDER_REVIEW") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve an analysis in status "${analysis.status}".`);
  }

  await ReplicateDesignDnaAnalysisRepository.approveAllObservations(analysis.id, actor.userId);

  const completedSteps = markStepsComplete(project.completedSteps, ["DESIGN_LOCK_REVIEW"]);
  await ReplicateDesignProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_dna_analyses",
    recordId: analysis.id,
    action: "UPDATE",
    newValues: { status: "APPROVED" },
  });

  return ReplicateDesignDnaAnalysisRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Step 4 — Select Company Fabric
// ---------------------------------------------------------------------------

/** Auto-fills only what's genuinely on the real Fabric Master row (Name/Code/Supplier) — same honest-gap handling as AI Designer's own selectExistingFabric(). */
export async function selectReplicateFabric(actor: ActorContext, projectId: string, input: SelectReplicateFabricInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const material = await ProductRepository.findMaterialById(actor.companyId, input.fabricProductId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Fabric not found in the Fabric Master.", { id: input.fabricProductId });

  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_MATERIAL_SELECTION"]);
  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "EXISTING",
    fabricProductId: material.id,
    fabricName: material.styleName,
    fabricCode: material.styleCode,
    fabricSupplierId: material.defaultSupplierId,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "EXISTING", fabricProductId: material.id },
  });

  return updated;
}

export async function uploadReplicateFabricImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "REPLICATE_DESIGN_PROJECT", projectId, file, "FABRIC_IMAGE");

  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_MATERIAL_SELECTION"]);
  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "UPLOADED",
    fabricImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "UPLOADED", fabricImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteReplicateFabricImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded fabric image to delete.");
  }

  await deleteAttachment(actor, project.fabricImageAttachmentId);

  return ReplicateDesignProjectRepository.update(projectId, {
    fabricImageAttachmentId: null,
    fabricSource: project.fabricProductId ? "EXISTING" : null,
  });
}

export async function addMaterialLine(actor: ActorContext, projectId: string, input: AddMaterialLineInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const material = await ProductRepository.findMaterialById(actor.companyId, input.productId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Material not found in the Raw Materials master.", { id: input.productId });

  const line = await ReplicateDesignMaterialLineRepository.create({
    companyId: actor.companyId,
    projectId,
    productId: material.id,
    role: input.role,
    quantity: input.quantity,
    uomId: input.uomId,
    notes: input.notes,
    createdByUserId: actor.userId,
  });

  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_MATERIAL_SELECTION"]);
  await ReplicateDesignProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_material_lines",
    recordId: line.id,
    action: "CREATE",
    newValues: { productId: material.id, role: input.role },
  });

  return ReplicateDesignMaterialLineRepository.findByProjectId(projectId);
}

export async function removeMaterialLine(actor: ActorContext, lineId: string) {
  const line = await ReplicateDesignMaterialLineRepository.findAnyById(actor.companyId, lineId);
  if (!line) throw new BusinessRuleError("NOT_FOUND", "Material line not found.", { id: lineId });

  await ReplicateDesignMaterialLineRepository.delete(lineId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_material_lines",
    recordId: lineId,
    action: "DELETE",
    oldValues: { productId: line.productId },
  });

  return ReplicateDesignMaterialLineRepository.findByProjectId(line.projectId);
}

export async function listMaterialLines(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignMaterialLineRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Step 5 — AI Compatibility Check
// ---------------------------------------------------------------------------

const MATERIAL_ROLE_LABELS: Record<string, string> = {
  MAIN_FABRIC: "Main Fabric",
  CONTRAST_FABRIC: "Contrast Fabric",
  LINING: "Lining",
  INTERLINING: "Interlining",
  BUTTON: "Buttons",
  ZIPPER: "Zipper",
  THREAD: "Thread",
  LABEL: "Label",
  TRIM_OTHER: "Trim",
  OTHER: "Other Material",
};

export async function runCompatibilityCheck(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const analysis = await ReplicateDesignDnaAnalysisRepository.findByProjectId(projectId);
  if (!analysis || analysis.status !== "APPROVED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve the Design DNA analysis before running a compatibility check.");
  }

  const materialLines = await ReplicateDesignMaterialLineRepository.findByProjectId(projectId);
  if (!project.fabricName && materialLines.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Select a fabric or add at least one material before running a compatibility check.");
  }
  await assertNoActiveCompatibilityRun(projectId);

  const subjects: { displayNumber: number; label: string; detail: string; materialLineId: string | null; subjectType: "FABRIC" | "MATERIAL_LINE" }[] = [];
  let displayNumber = 1;
  if (project.fabricName) {
    subjects.push({
      displayNumber: displayNumber++,
      label: `Fabric: ${project.fabricName}`,
      detail: project.fabricCode ? `Code ${project.fabricCode}` : "No further detail recorded.",
      materialLineId: null,
      subjectType: "FABRIC",
    });
  }
  for (const line of materialLines) {
    subjects.push({
      displayNumber: displayNumber++,
      label: `${MATERIAL_ROLE_LABELS[line.role] ?? line.role}: ${line.product.styleName}`,
      detail: line.notes || "No further detail recorded.",
      materialLineId: line.id,
      subjectType: "MATERIAL_LINE",
    });
  }

  const lockedObservations = analysis.observations
    .filter((o) => o.isLocked)
    .map((o) => ({ label: FEATURE_LABELS[o.featureKey as FeatureKey] ?? o.featureKey, value: o.approvedObservation }));

  const runRow = await ReplicateDesignCompatibilityRunRepository.create({
    companyId: actor.companyId,
    projectId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: COMPATIBILITY_PROMPT_VERSION,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateCompatibilityCheck({
      designDnaSummary: analysis.designDnaSummary || "Not summarized.",
      lockedObservations,
      subjects: subjects.map((s) => ({ displayNumber: s.displayNumber, label: s.label, detail: s.detail })),
    });

    // Zipped back by subjectNumber (the AI's own echoed-back ordinal), not
    // array position — the schema's own completeness check already
    // guarantees every 1..subjects.length appears exactly once, but this
    // lookup makes the mapping correct even if the model returned them out
    // of order, rather than silently trusting position.
    const resultBySubjectNumber = new Map(result.items.map((item) => [item.subjectNumber, item]));
    const items = subjects.map((s) => {
      const found = resultBySubjectNumber.get(s.displayNumber);
      if (!found) {
        // Structurally shouldn't happen given the schema's own completeness
        // check, but defensive rather than a raw "undefined" crash.
        throw new AiInvalidResponseError(`AI response is missing an assessment for subject ${s.displayNumber} (${s.label}).`);
      }
      return {
        subjectType: s.subjectType,
        materialLineId: s.materialLineId,
        aiRating: found.rating,
        aiReasoning: found.reasoning,
        aiSuggestion: found.suggestion,
      };
    });

    const check = await ReplicateDesignCompatibilityRepository.upsertWithItems(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        promptVersion: COMPATIBILITY_PROMPT_VERSION,
        provider: "anthropic",
        model: result.model,
        rawResponseJson: result.rawResponse as Prisma.InputJsonValue,
        overallSummary: result.overallSummary,
        overallRating: result.overallRating,
        overallSuggestion: result.overallSuggestion,
        createdByUserId: actor.userId,
      },
      items
    );

    await ReplicateDesignCompatibilityRunRepository.markSuccess(runRow.id, check.id);

    const completedSteps = markStepsComplete(project.completedSteps, ["COMPATIBILITY_CHECK"]);
    await ReplicateDesignProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    return check;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await ReplicateDesignCompatibilityRunRepository.markFailed(runRow.id, category, message);
    mapAiError(err);
  }
}

export async function getCompatibilityCheck(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignCompatibilityRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Step 6 — Generate Design
// ---------------------------------------------------------------------------

function buildMaterialDescription(project: ReplicateDesignProject, materialLines: Awaited<ReturnType<typeof ReplicateDesignMaterialLineRepository.findByProjectId>>): string {
  const lines: string[] = [];
  if (project.fabricName) {
    lines.push(`Fabric: ${project.fabricName}${project.fabricCode ? ` (${project.fabricCode})` : ""}`);
  }
  for (const line of materialLines) {
    lines.push(`${MATERIAL_ROLE_LABELS[line.role] ?? line.role}: ${line.product.styleName}${line.notes ? ` — ${line.notes}` : ""}`);
  }
  return lines.length > 0 ? lines.join("\n") : "Not specified.";
}

async function assertReadyToGenerate(
  project: ReplicateDesignProject,
  input: GenerateReplicateDesignInput
): Promise<{ observations: { featureKey: string; approvedObservation: string; isLocked: boolean }[] }> {
  const missing: string[] = [];
  if (!project.referenceFrontImageAttachmentId) missing.push("a front reference garment photo (Step 1)");
  if (!project.fabricImageAttachmentId) missing.push("a real fabric/material reference photo (Step 4 — upload the actual photo, even if you picked an existing fabric's details)");

  const analysis = await ReplicateDesignDnaAnalysisRepository.findByProjectId(project.id);
  if (!analysis || analysis.status !== "APPROVED") missing.push("an approved Design DNA analysis (Steps 2-3)");

  if (missing.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Complete the following before generating: ${missing.join(", ")}.`, { missing });
  }

  const check = await ReplicateDesignCompatibilityRepository.findByProjectId(project.id);
  if (!check) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Run the AI compatibility check (Step 5) before generating.");
  }
  if (check.overallRating !== "COMPATIBLE" && !input.acknowledgeCompatibilityWarning) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `The compatibility check flagged concerns (${check.overallRating}) — confirm "Continue Anyway" to proceed regardless.`,
      { overallRating: check.overallRating, overallSummary: check.overallSummary }
    );
  }

  return { observations: analysis!.observations };
}

async function bumpVersion(
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
  const count = await ReplicateDesignVersionRepository.count(projectId);
  const version = await ReplicateDesignVersionRepository.create({
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
  await ReplicateDesignProjectRepository.update(projectId, { currentVersionId: version.id });
  return version;
}

export async function generateReplicatedDesign(actor: ActorContext, projectId: string, input: GenerateReplicateDesignInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const { observations } = await assertReadyToGenerate(project, input);
  await assertNoActiveGenerateRun(projectId);

  const materialLines = await ReplicateDesignMaterialLineRepository.findByProjectId(projectId);
  const lockedConstraints = observations
    .filter((o) => o.isLocked)
    .map((o) => `${FEATURE_LABELS[o.featureKey as FeatureKey] ?? o.featureKey}: ${o.approvedObservation}`);
  const materialDescription = buildMaterialDescription(project, materialLines);

  const prompt = buildReplicateGenerationPrompt({ lockedConstraints, materialDescription });
  const specJson = {
    lockedConstraints,
    materialDescription,
    fabric: { source: project.fabricSource, name: project.fabricName, code: project.fabricCode },
  };

  const [{ buffer: referenceBuffer, attachment: referenceAttachment }, { buffer: materialBuffer, attachment: materialAttachment }] = await Promise.all([
    getAttachmentForDownload(actor.companyId, project.referenceFrontImageAttachmentId!),
    getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId!),
  ]);

  const promptRow = await ReplicateDesignPromptRepository.create({
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

  const generation = await ReplicateDesignGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "DESIGN_REPLICATION",
      generationContext: `Replicate Design / Project ${project.projectNumber}`,
      replicateDesignProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.replicateWithNewMaterial) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support Replicate Design's two-image generation — it needs an admin to enable the "Design Replication" capability on a compatible provider.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.replicateWithNewMaterial({
          prompt,
          count: input.imageCount,
          referenceImage: { buffer: referenceBuffer, mimeType: referenceAttachment.mimeType },
          materialImage: { buffer: materialBuffer, mimeType: materialAttachment.mimeType },
        });
      },
    });

    const rows: Prisma.ReplicateDesignImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "REPLICATE_DESIGN_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `replicate-design-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "GENERATED_DESIGN_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await ReplicateDesignImageRepository.createMany(rows);
    const images = await ReplicateDesignImageRepository.findByGenerationId(generation.id);

    await ReplicateDesignGenerationRepository.markSuccess(generation.id);
    await ReplicateDesignPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    if (images.length > 0) {
      await bumpVersion(actor, projectId, images[0].id, "Generated with new material.", specJson);
    }

    const completedSteps = markStepsComplete(project.completedSteps, ["GENERATE"]);
    await ReplicateDesignProjectRepository.update(projectId, {
      status: "IN_PROGRESS",
      completedSteps,
      currentStep: computeCurrentStep(completedSteps),
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "replicate_design_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await ReplicateDesignGenerationRepository.markFailed(generation.id);
    await ReplicateDesignPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

export async function decideReplicateImage(actor: ActorContext, imageId: string, input: DecideReplicateImageInput) {
  const image = await ReplicateDesignImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Generated image not found.", { id: imageId });
  }
  if (input.decision === "SELECT" && !input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a design as the final visual requires explicit confirmation.");
  }

  const decision = input.decision === "SELECT" ? "SELECTED" : "REJECTED";
  const updated = await ReplicateDesignImageRepository.update(imageId, { decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_images",
    recordId: imageId,
    action: "UPDATE",
    oldValues: { decision: image.decision },
    newValues: { decision },
  });

  return updated;
}

export async function listReplicateImages(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignImageRepository.findByProjectId(projectId);
}

export async function listReplicateVersions(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignVersionRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Edit Design — mirrors AI Designer's own Edit Design workspace exactly
// (generateEditPreview/applyEditVariation/approveCurrentVersion/
// rejectCurrentVersion in ai-designer.service.ts): a real image-to-image
// edit that changes ONE named feature of the currently generated design
// while preserving everything else, always previewed before it can become
// the new current version.
// ---------------------------------------------------------------------------

function changeSummaryForReplicateEdit(input: GenerateReplicateEditPreviewInput): string {
  if (input.mode === "QUICK") return `Changed ${input.featureLabel}: ${input.newValue}`;
  if (input.mode === "TECHNICAL") return `Technical edit — ${input.featureLabel}`;
  return `AI edit — ${input.featureLabel}`;
}

/**
 * Step, part 1 of 2 — generates 1-4 candidate images for a requested change
 * WITHOUT touching the current design at all (no version bump, no
 * currentVersionId change). Images are created PENDING and must be
 * explicitly applied via applyReplicateEditVariation() below.
 */
export async function generateReplicateEditPreview(actor: ActorContext, projectId: string, input: GenerateReplicateEditPreviewInput) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before editing it.");
  }
  await assertNoActiveEditRun(projectId);

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);

  // Same real, confirmed-live fix already applied to AI Designer's own Edit
  // Design workspace: chaining edits purely from image-to-image (each edit
  // based only on the PREVIOUS edit's own output) has no ground truth to
  // check material fidelity against, so it can visibly drift further from
  // the real material with every successive edit. Re-supplying the
  // project's own real original material/fabric photo on every edit call
  // (provider.applyFabric) closes that drift, the same "the image is the
  // source of truth, never text/memory alone" discipline used for Generate.
  const materialAttachmentId = project.fabricImageAttachmentId;
  const materialRef = materialAttachmentId ? await getAttachmentForDownload(actor.companyId, materialAttachmentId) : null;

  const prompt = buildReplicateWorkspaceEditPrompt({
    mode: input.mode,
    featureLabel: input.featureLabel,
    currentValue: input.currentValue || "Not specified",
    newValue: input.newValue || null,
    technicalFields: input.technicalFields || null,
    freeformInstructions: input.freeformInstructions || null,
    hasMaterialReference: !!materialRef,
  });

  const specJson = {
    fabric: { source: project.fabricSource, name: project.fabricName, code: project.fabricCode },
    edit: {
      mode: input.mode,
      featureLabel: input.featureLabel,
      currentValue: input.currentValue || null,
      newValue: input.newValue || null,
      technicalFields: input.technicalFields || null,
      freeformInstructions: input.freeformInstructions || null,
    },
  };

  const promptRow = await ReplicateDesignPromptRepository.create({
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

  const generation = await ReplicateDesignGenerationRepository.create({
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
    const result = materialRef
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "MULTI_FABRIC",
          generationContext: `Replicate Design / Project ${project.projectNumber} / Edit (material-grounded)`,
          replicateDesignProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.applyFabric) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support editing with a material reference.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.applyFabric({
              prompt,
              count: input.imageCount,
              baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
              swatchImage: { buffer: materialRef.buffer, mimeType: materialRef.attachment.mimeType },
            });
          },
        })
      : // Defensive fallback only — assertReadyToGenerate() guarantees a real
        // material photo exists before any design (and therefore any edit)
        // can exist at all, so this branch should never actually run.
        await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "IMAGE_EDIT",
          generationContext: `Replicate Design / Project ${project.projectNumber} / Edit`,
          replicateDesignProjectId: projectId,
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

    const rows: Prisma.ReplicateDesignImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "REPLICATE_DESIGN_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `replicate-design-edit-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "EDIT_PREVIEW_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await ReplicateDesignImageRepository.createMany(rows);
    const images = await ReplicateDesignImageRepository.findByGenerationId(generation.id);

    await ReplicateDesignGenerationRepository.markSuccess(generation.id);
    await ReplicateDesignPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "replicate_design_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { editedFeature: input.featureLabel, mode: input.mode, imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images, prompt: promptRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await ReplicateDesignGenerationRepository.markFailed(generation.id);
    await ReplicateDesignPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

/**
 * Step, part 2 of 2 — the explicit "Apply" action. Only a PENDING image
 * whose own generation was previewed from the project's CURRENT design may
 * be applied (a stale preview left over from before an intervening change
 * is rejected outright); promotes it to a real new ReplicateDesignVersion,
 * marks its sibling preview images REJECTED, and carries the originating AI
 * prompt + any structured technical fields onto the new version.
 */
export async function applyReplicateEditVariation(actor: ActorContext, imageId: string, input: ApplyReplicateEditVariationInput) {
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Applying an edit as the new current design requires explicit confirmation.");
  }

  const image = await ReplicateDesignImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Previewed image not found.", { id: imageId });
  }
  if (image.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This preview has already been decided — generate a new preview to try again.");
  }

  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, image.projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: image.projectId });

  const generation = await ReplicateDesignGenerationRepository.findByIdWithPrompt(image.generationId);
  if (!generation || !project.currentVersion || generation.parentImageId !== project.currentVersion.currentImageId) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This preview is no longer based on the current design — the design has changed since it was generated. Generate a new preview instead."
    );
  }

  const siblings = await ReplicateDesignImageRepository.findByGenerationId(image.generationId);
  await Promise.all(
    siblings.filter((s) => s.id !== imageId && s.decision === "PENDING").map((s) => ReplicateDesignImageRepository.update(s.id, { decision: "REJECTED" }))
  );
  await ReplicateDesignImageRepository.update(imageId, { decision: "SELECTED" });

  const editSpec = (generation.prompt.specJson as { edit?: { mode?: string; featureLabel?: string; newValue?: string; technicalFields?: Record<string, string> } })
    .edit;
  const mode = (editSpec?.mode as "QUICK" | "TECHNICAL" | "AI_PROMPT" | undefined) ?? "QUICK";
  const changeSummary = changeSummaryForReplicateEdit({
    mode,
    featureLabel: editSpec?.featureLabel ?? generation.editedFeature ?? "Edit",
    newValue: editSpec?.newValue,
    imageCount: 1,
  } as GenerateReplicateEditPreviewInput);

  const version = await bumpVersion(actor, image.projectId, imageId, changeSummary, project.currentVersion.designSnapshotJson as Record<string, unknown>, {
    approvalStatus: "AI_MODIFIED",
    aiPromptId: generation.promptId,
    technicalChangesJson: mode === "TECHNICAL" ? editSpec?.technicalFields ?? null : null,
  });

  const completedSteps = markStepsComplete(project.completedSteps, ["EDIT"]);
  await ReplicateDesignProjectRepository.update(image.projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_versions",
    recordId: version.id,
    action: "CREATE",
    newValues: { versionNumber: version.versionNumber, imageId, mode },
  });

  return version;
}

/** Top-toolbar "Approve Design" — approves the project's current version. */
export async function approveReplicateVersion(actor: ActorContext, projectId: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before approving it.");

  const version = await ReplicateDesignVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return version;
}

/** Top-toolbar "Reject Design" — the review-workflow counterpart to Approve; does not delete or revert anything, only marks the current version's own review status. */
export async function rejectReplicateVersion(actor: ActorContext, projectId: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before rejecting it.");

  const version = await ReplicateDesignVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "REJECTED",
    approvedByUserId: null,
    approvedAt: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "REJECTED" },
  });

  return version;
}

// ---------------------------------------------------------------------------
// Branding (optional brand name + logo overlay) — the exact same "settings +
// on-demand sharp() composite" feature as AI Designer's own applyBranding(),
// duplicated (not shared) per this module's established isolation rule.
// brandName has no stored default -- the real default (the logged-in
// company's own name) is resolved at read time in getReplicateBrandDefaults()
// below, so a later company-name change is picked up automatically. A logo
// has no default at all (no company-logo field exists anywhere in this
// schema). Entirely optional -- nothing else in this workflow requires it,
// and skipping it leaves brandedImageAttachmentId null forever with zero
// effect on Tech Pack or any other step.
// ---------------------------------------------------------------------------

const REPLICATE_DEFAULT_LOGO_X_PERCENT = 70;
const REPLICATE_DEFAULT_LOGO_Y_PERCENT = 80;
const REPLICATE_DEFAULT_LOGO_WIDTH_PERCENT = 20;
const REPLICATE_MIN_LOGO_WIDTH_PERCENT = 5;
const REPLICATE_MAX_LOGO_WIDTH_PERCENT = 60;

export async function updateReplicateBrandName(actor: ActorContext, projectId: string, input: UpdateReplicateBrandNameInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const updated = await ReplicateDesignProjectRepository.update(projectId, { brandName: input.brandName || null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { brandName: project.brandName },
    newValues: { brandName: input.brandName || null },
  });

  return updated;
}

export async function uploadReplicateBrandLogo(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "REPLICATE_DESIGN_PROJECT", projectId, file, "BRAND_LOGO");

  // Only sets a default position/size the first time a logo is uploaded --
  // a re-upload replacing an existing logo keeps whatever position/size the
  // user already dialed in.
  const project = await getOwnedProject(actor.companyId, projectId);
  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    brandLogoAttachmentId: attachment.id,
    logoXPercent: project.logoXPercent ?? REPLICATE_DEFAULT_LOGO_X_PERCENT,
    logoYPercent: project.logoYPercent ?? REPLICATE_DEFAULT_LOGO_Y_PERCENT,
    logoWidthPercent: project.logoWidthPercent ?? REPLICATE_DEFAULT_LOGO_WIDTH_PERCENT,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { brandLogoAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteReplicateBrandLogo(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.brandLogoAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded logo to delete.");
  }

  await deleteAttachment(actor, project.brandLogoAttachmentId);
  if (project.brandedImageAttachmentId) {
    await deleteAttachment(actor, project.brandedImageAttachmentId);
  }

  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    brandLogoAttachmentId: null,
    brandedImageAttachmentId: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { brandLogoAttachmentId: project.brandLogoAttachmentId },
    newValues: { brandLogoAttachmentId: null },
  });

  return updated;
}

export async function updateReplicateLogoPosition(actor: ActorContext, projectId: string, input: UpdateReplicateLogoPositionInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.brandLogoAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a logo before setting its position.");
  }

  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    logoXPercent: input.logoXPercent,
    logoYPercent: input.logoYPercent,
    logoWidthPercent: input.logoWidthPercent,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
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
 * what the client last stored.
 */
export async function applyReplicateBranding(actor: ActorContext, projectId: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
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
      REPLICATE_MAX_LOGO_WIDTH_PERCENT,
      Math.max(REPLICATE_MIN_LOGO_WIDTH_PERCENT, Number(project.logoWidthPercent ?? REPLICATE_DEFAULT_LOGO_WIDTH_PERCENT))
    );
    const logoWidthPx = Math.max(1, Math.round((widthPercent / 100) * designWidth));
    const resizedLogo = await sharp(logoBuffer).resize({ width: logoWidthPx }).png().toBuffer();
    const resizedMeta = await sharp(resizedLogo).metadata();
    const logoHeightPx = resizedMeta.height ?? logoWidthPx;

    const xPercent = Number(project.logoXPercent ?? REPLICATE_DEFAULT_LOGO_X_PERCENT);
    const yPercent = Number(project.logoYPercent ?? REPLICATE_DEFAULT_LOGO_Y_PERCENT);
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
    "REPLICATE_DESIGN_PROJECT",
    projectId,
    { buffer: compositedBuffer, fileName: `replicate-design-branded-${Date.now()}.png`, mimeType: "image/png" },
    "BRANDED_DESIGN_IMAGE"
  );

  const completedSteps = markStepsComplete(project.completedSteps, ["BRANDING"]);
  const updated = await ReplicateDesignProjectRepository.update(projectId, {
    brandedImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "replicate_design_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { brandedImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

/** Resolves the effective brand name shown/used at generation time -- never stored, so a later company-name change is picked up automatically. */
export async function getReplicateBrandDefaults(companyId: string, projectId: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
  return { effectiveBrandName: project.brandName || project.company.name };
}

// ---------------------------------------------------------------------------
// Tech Pack — reuses the exact same generic pipeline as AI Designer's own
// generateTechPack() (src/core/ai-designer/tech-pack/*), applied to
// Replicate Design's own current design. Since this module has no
// targetCustomer/ageGroup/productCategory wizard fields, the design context
// is derived from the project's own real, approved Design DNA observations
// instead — garmentCategory's own observation becomes productCategory, and
// every other observation joins into designSelections, exactly mirroring
// what actually drove the generated image.
// ---------------------------------------------------------------------------

function buildReplicateTechPackDesignContext(project: ReplicateDesignProject & { dnaAnalysis?: { observations: { featureKey: string; approvedObservation: string }[] } | null }): TechPackDesignContext {
  const observations = project.dnaAnalysis?.observations ?? [];
  const categoryObservation = observations.find((o) => o.featureKey === "garmentCategory");
  const designSelections =
    observations.length > 0
      ? observations.map((o) => `${FEATURE_LABELS[o.featureKey as FeatureKey] ?? o.featureKey}: ${o.approvedObservation}`).join("; ")
      : "Not specified";

  return {
    productCategory: categoryObservation?.approvedObservation || "Not specified",
    designSelections,
    fabricDescription: [project.fabricName, project.fabricCode].filter(Boolean).join(", ") || "Not specified",
    targetCustomer: "Not specified",
    ageGroup: "Not specified",
    projectName: project.projectName,
  };
}

async function generateReplicateTechPackPageImage(params: {
  actor: ActorContext;
  projectId: string;
  projectNumber: string;
  pageNumber: number;
  pageTitle: string;
  promptText: string;
  baseBuffer: Buffer;
  baseMimeType: string;
}) {
  try {
    const result = await runWithFailover({
      companyId: params.actor.companyId,
      userId: params.actor.userId,
      capability: "TECHNICAL_FLAT",
      generationContext: `Replicate Design / Project ${params.projectNumber} / Tech Pack Page ${params.pageNumber} (${params.pageTitle})`,
      replicateDesignProjectId: params.projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.generateTechnicalFlat) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support generating a tech-pack page image.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.generateTechnicalFlat({
          prompt: params.promptText,
          count: 1,
          baseImage: { buffer: params.baseBuffer, mimeType: params.baseMimeType },
        });
      },
    });

    const image = result.images[0];
    const attachment = await uploadAttachment(
      params.actor,
      "REPLICATE_DESIGN_PROJECT",
      params.projectId,
      { buffer: image.buffer, fileName: `replicate-design-tech-pack-page-${params.pageNumber}-${Date.now()}.png`, mimeType: image.mimeType },
      `TECH_PACK_PAGE_${params.pageNumber}`
    );
    return attachment.id;
  } catch (err) {
    if (err instanceof Error) {
      err.message = `Page ${params.pageNumber} (${params.pageTitle}): ${err.message}`;
    }
    throw err;
  }
}

/**
 * The full pipeline, identical in shape to AI Designer's own generateTechPack():
 * (1) a vision call analyzes the current design image into categories A-G,
 * (2) a text call extends that into categories H-J, (3) a text call turns
 * the complete analysis into exactly 7 page-specific image-generation
 * prompts, then (4) each of those prompts generates that page's image from
 * the same current design photo. Deliberately all-or-nothing, same as AI
 * Designer's own version.
 */
export async function generateReplicateTechPack(actor: ActorContext, projectId: string) {
  const project = await ReplicateDesignProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "Replicate Design project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before creating its tech pack.");
  }
  await assertNoActiveTechPackRun(projectId);

  const techPackRow = await ReplicateDesignTechPackRepository.create({
    companyId: actor.companyId,
    projectId,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const designContext = buildReplicateTechPackDesignContext(project);
    const { attachment: baseAttachment, buffer: baseBuffer } = await getAttachmentForDownload(
      actor.companyId,
      project.currentVersion.currentImage.imageAttachmentId
    );
    const imageMediaType = normalizeImageMediaType(baseAttachment.mimeType);

    const part1 = await generateGarmentAnalysisPart1({
      ctx: designContext,
      imageBase64: baseBuffer.toString("base64"),
      imageMediaType,
    });
    const part2 = await generateGarmentAnalysisPart2({ ctx: designContext, part1: part1.data });
    const pagePrompts = await generatePagePrompts({ ctx: designContext, part1: part1.data, part2: part2.data });

    const pages: { pageNumber: number; pageTitle: string; promptText: string; imageAttachmentId: string | null }[] = [];
    let imagePageIndex = 0;
    for (const def of TECH_PACK_PAGE_DEFINITIONS) {
      if (!def.needsImage) {
        pages.push({
          pageNumber: def.pageNumber,
          pageTitle: def.title,
          promptText: "Rendered as real typeset text/tables in the exported PDF — no AI-generated image for this page.",
          imageAttachmentId: null,
        });
        continue;
      }
      const promptText = pagePrompts.data.pagePrompts[imagePageIndex];
      imagePageIndex += 1;
      const imageAttachmentId = await generateReplicateTechPackPageImage({
        actor,
        projectId,
        projectNumber: project.projectNumber,
        pageNumber: def.pageNumber,
        pageTitle: def.title,
        promptText,
        baseBuffer,
        baseMimeType: baseAttachment.mimeType,
      });
      pages.push({ pageNumber: def.pageNumber, pageTitle: def.title, promptText, imageAttachmentId });
    }

    const garmentAnalysis: GarmentAnalysis = { part1: part1.data, part2: part2.data };

    const updated = await ReplicateDesignTechPackRepository.markSuccess(techPackRow.id, {
      garmentAnalysisJson: garmentAnalysis as unknown as Prisma.InputJsonValue,
      designerNotes: pagePrompts.data.designerNotes,
      suggestedAdditionalViews: pagePrompts.data.suggestedAdditionalViews,
      pages,
    });

    const completedSteps = markStepsComplete(project.completedSteps, ["TECH_PACK"]);
    await ReplicateDesignProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "replicate_design_tech_packs",
      recordId: techPackRow.id,
      action: "CREATE",
      newValues: { status: "SUCCESS", bomLineCount: part2.data.bomItems.length, pageCount: pages.length },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await ReplicateDesignTechPackRepository.markFailed(techPackRow.id, message);
    mapAiError(err);
  }
}

export async function getLatestReplicateTechPack(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return ReplicateDesignTechPackRepository.findLatestByProjectId(projectId);
}

/** Downloads the latest successful Tech Pack as one combined PDF — one full-bleed page per generated tech-pack page image, in page order. */
export async function exportReplicateTechPackPdf(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const techPack = await ReplicateDesignTechPackRepository.findLatestByProjectId(projectId);
  if (!techPack || techPack.status !== "SUCCESS" || !techPack.garmentAnalysisJson) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a tech pack first before downloading it.");
  }

  const images: TechPackDocumentPageImage[] = [];
  for (const page of techPack.pages) {
    if (!page.imageAttachmentId) continue;
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, page.imageAttachmentId);
    images.push({ pageNumber: page.pageNumber, imageBase64: buffer.toString("base64"), imageMimeType: attachment.mimeType });
  }

  const { renderTechPackDocumentPdf } = await import("@/core/ai-designer/export/tech-pack-pdf");
  const pdfBuffer = await renderTechPackDocumentPdf({
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    generatedAt: techPack.createdAt.toLocaleString(),
    analysis: techPack.garmentAnalysisJson as unknown as TechPackAnalysisForPdf,
    designerNotes: techPack.designerNotes ?? "",
    suggestedAdditionalViews: techPack.suggestedAdditionalViews ?? "",
    images,
  });

  return { buffer: pdfBuffer, mimeType: "application/pdf", fileName: `${project.projectNumber}-tech-pack.pdf` };
}

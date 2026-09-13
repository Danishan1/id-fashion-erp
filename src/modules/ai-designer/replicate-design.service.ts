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
import { buildReplicateGenerationPrompt, PROMPT_VERSION as GENERATION_PROMPT_VERSION } from "@/core/ai-designer/replicate-design/image-generation/prompt";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
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
  ReplicateDesignVersionRepository,
} from "./replicate-design.repository";
import type {
  AddMaterialLineInput,
  CreateReplicateProjectInput,
  DecideReplicateImageInput,
  GenerateReplicateDesignInput,
  ReferenceImageSlot,
  SelectReplicateFabricInput,
  SetDnaObservationLockInput,
  UpdateDnaObservationInput,
} from "./replicate-design.schema";
import type { Prisma, ReplicateDesignProject } from "@prisma/client";

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

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

export async function listReplicateProjects(companyId: string, query: ListQuery) {
  const where: Prisma.ReplicateDesignProjectWhereInput = {
    companyId,
    ...(query.search ? { projectName: { contains: query.search, mode: "insensitive" as const } } : {}),
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

    const items = subjects.map((s, i) => ({
      subjectType: s.subjectType,
      materialLineId: s.materialLineId,
      aiRating: result.items[i].rating,
      aiReasoning: result.items[i].reasoning,
    }));

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

async function bumpVersion(actor: ActorContext, projectId: string, imageId: string, changeSummary: string, specJson: Record<string, unknown>) {
  const count = await ReplicateDesignVersionRepository.count(projectId);
  const version = await ReplicateDesignVersionRepository.create({
    companyId: actor.companyId,
    projectId,
    versionNumber: count + 1,
    currentImageId: imageId,
    changeSummary,
    designSnapshotJson: specJson as Prisma.InputJsonValue,
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

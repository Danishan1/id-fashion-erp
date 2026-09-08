import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { logger } from "@/core/logging/logger";
import { deleteAttachment, getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import {
  analyzeFabricSwatch,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/fabric-analysis/analyze";
import { FABRIC_FEATURE_REGISTRY } from "@/core/ai/fabric-analysis/feature-registry";
import { flattenToFabricObservations } from "@/core/ai/fabric-analysis/schema";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import {
  AiGarmentFabricAnalysisRepository,
  AiGarmentFabricAnalysisRunRepository,
  AiGarmentFabricObservationRepository,
} from "./fabric-analysis.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

/** Same narrower allowlist as reference-analysis's own — a non-image file is rejected here even though the shared FileStorage layer would otherwise accept it for other modules. */
const ALLOWED_SWATCH_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// A stuck IN_PROGRESS run older than this is treated as abandoned (e.g. the
// server crashed mid-request) rather than a permanent lock — mirrors
// reference-analysis.service.ts's own RUN_FRESHNESS_WINDOW_MS exactly.
const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;

function assertNotTerminalProject(project: { status: string }) {
  if (["COMPLETED", "REJECTED", "CANCELLED"].includes(project.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This project is "${project.status}" and can no longer be changed.`, {
      status: project.status,
    });
  }
}

async function getOwnedProject(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return project;
}

export async function setFabricSwatchImage(
  actor: ActorContext,
  projectId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string }
) {
  const project = await getOwnedProject(actor.companyId, projectId);
  assertNotTerminalProject(project);

  if (!ALLOWED_SWATCH_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The image format is not supported. Upload a JPG, PNG, or WEBP file.", {
      mimeType: file.mimeType,
    });
  }

  const previousAttachmentId = project.fabricSwatchImageAttachmentId;

  const attachment = await uploadAttachment(actor, "AI_GARMENT_PROJECT", projectId, file, "FABRIC_SWATCH");

  await AiGarmentProjectRepository.update(projectId, { fabricSwatchImageAttachmentId: attachment.id });

  if (previousAttachmentId) {
    // Never silently let a stale analysis keep pointing at the replaced
    // image as if it were still valid — kept for audit, blocked from
    // further edits/approval until a fresh analysis is run.
    await AiGarmentFabricAnalysisRepository.markStale(projectId);
    await deleteAttachment(actor, previousAttachmentId).catch((err) => {
      // The old attachment row/file may already be gone (e.g. a retried
      // request) — replacing the pointer is what matters, so this never
      // blocks the user's replace action. But a genuine failure here (a
      // transient file-storage error, not just "already gone") would
      // otherwise leak an orphaned stored file with zero visibility — log
      // it so it's at least debuggable, never fully silent.
      logger.warn("Failed to delete the replaced fabric swatch image's old attachment", {
        projectId,
        previousAttachmentId,
        error: err,
      });
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { fabricSwatchImageAttachmentId: previousAttachmentId },
    newValues: { fabricSwatchImageAttachmentId: attachment.id },
  });

  return attachment;
}

export async function deleteFabricSwatchImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  assertNotTerminalProject(project);

  if (!project.fabricSwatchImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No fabric swatch image has been uploaded.");
  }

  const attachmentId = project.fabricSwatchImageAttachmentId;
  await deleteAttachment(actor, attachmentId);
  await AiGarmentProjectRepository.update(projectId, { fabricSwatchImageAttachmentId: null });
  await AiGarmentFabricAnalysisRepository.markStale(projectId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { fabricSwatchImageAttachmentId: attachmentId },
    newValues: { fabricSwatchImageAttachmentId: null },
  });
}

export async function getFabricAnalysis(companyId: string, projectId: string) {
  const project = await getOwnedProject(companyId, projectId);
  const analysis = await AiGarmentFabricAnalysisRepository.findByProjectId(project.id);
  return analysis;
}

/**
 * Runs a fresh AI analysis and fully replaces whatever analysis previously
 * existed for this project. Guarded against duplicate concurrent requests
 * via an IN_PROGRESS run row written before the AI is ever called — mirrors
 * runReferenceAnalysis()'s own reasoning exactly (a lost race still can't
 * corrupt data, since only the request that reaches persistence first
 * actually replaces the analysis).
 */
export async function runFabricAnalysis(actor: ActorContext, projectId: string) {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  assertNotTerminalProject(project);

  if (!project.fabricSwatchImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No fabric swatch image has been uploaded.");
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentFabricAnalysisRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An analysis is already in progress for this project.", {
      runId: activeRun.id,
    });
  }

  const attachment = await getAttachmentForDownload(actor.companyId, project.fabricSwatchImageAttachmentId).catch(() => null);
  if (!attachment) {
    throw new BusinessRuleError("NOT_FOUND", "The fabric swatch image could not be found.");
  }
  if (!ALLOWED_SWATCH_IMAGE_MIME_TYPES.has(attachment.attachment.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The image format is not supported. Upload a JPG, PNG, or WEBP file.");
  }
  const imageMediaType = attachment.attachment.mimeType as "image/jpeg" | "image/png" | "image/webp";

  const existingAnalysis = await AiGarmentFabricAnalysisRepository.findByProjectId(projectId);
  const nextVersion = (existingAnalysis?.analysisVersion ?? 0) + 1;

  const run = await AiGarmentFabricAnalysisRunRepository.create({
    companyId: actor.companyId,
    projectId,
    swatchAttachmentId: project.fabricSwatchImageAttachmentId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    promptVersion: PROMPT_VERSION,
    analysisVersion: nextVersion,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeFabricSwatch({
      imageBuffer: attachment.buffer,
      imageMediaType,
      projectContext: { garmentCategory: project.category?.name ?? null, targetMarket: project.targetMarket },
    });

    const observations = flattenToFabricObservations(result.data, FABRIC_FEATURE_REGISTRY);

    const analysis = await AiGarmentFabricAnalysisRepository.replaceForProject(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        swatchAttachmentId: project.fabricSwatchImageAttachmentId,
        status: "AI_ANALYSED",
        analysisVersion: nextVersion,
        promptVersion: PROMPT_VERSION,
        provider: "anthropic",
        model: result.model,
        rawResponseJson: result.rawResponse as object,
        missingInformation: result.data.missingInformation,
        fabricSummary: result.data.fabricSummary,
        createdByUserId: actor.userId,
      },
      observations.map((o) => ({
        featureKey: o.featureKey,
        aiObservation: o.aiObservation,
        aiConfidence: o.aiConfidence,
        aiManufacturingRelevance: o.aiManufacturingRelevance,
        approvedObservation: o.aiObservation,
      }))
    );

    await AiGarmentFabricAnalysisRunRepository.markSuccess(run.id, analysis.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_fabric_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { analysisVersion: analysis.analysisVersion, model: analysis.model, promptVersion: analysis.promptVersion },
    });

    return await AiGarmentFabricAnalysisRepository.findByProjectId(projectId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentFabricAnalysisRunRepository.markFailed(run.id, category, message);

    if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
      const code = err instanceof AiInvalidResponseError ? "AI_INVALID_RESPONSE" : "AI_SERVICE_ERROR";
      throw new BusinessRuleError(code, err.message);
    }
    throw err;
  }
}

function errorCategoryFor(err: unknown): string {
  if (err instanceof AiConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof AiInvalidResponseError) return "INVALID_STRUCTURED_RESPONSE";
  if (err instanceof AiServiceError) return err.category;
  return "UNKNOWN";
}

/**
 * Editing (or resetting) any observation on an APPROVED analysis pushes it
 * back to UNDER_REVIEW, requiring a fresh Approve — same discipline as
 * reference-analysis.service.ts's own bumpAnalysisStatusForEdit, applied
 * uniformly to every field rather than trying to classify which edits are
 * "material."
 */
async function bumpAnalysisStatusForEdit(analysisId: string, currentStatus: string) {
  if (currentStatus === "STALE") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This analysis is out of date because the fabric swatch image was replaced — run a fresh analysis before editing observations.",
      { status: currentStatus }
    );
  }
  if (currentStatus !== "UNDER_REVIEW") {
    await AiGarmentFabricAnalysisRepository.updateStatus(analysisId, "UNDER_REVIEW");
  }
}

export async function updateFabricObservation(actor: ActorContext, observationId: string, approvedObservation: string) {
  const observation = await AiGarmentFabricObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Observation not found.", { id: observationId });
  }

  await bumpAnalysisStatusForEdit(observation.analysisId, observation.analysis.status);

  const updated = await AiGarmentFabricObservationRepository.update(observationId, {
    approvedObservation,
    userEdited: true,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_fabric_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation, userEdited: observation.userEdited },
    newValues: { approvedObservation, userEdited: true },
  });

  return updated;
}

export async function resetFabricObservationToAi(actor: ActorContext, observationId: string) {
  const observation = await AiGarmentFabricObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Observation not found.", { id: observationId });
  }

  await bumpAnalysisStatusForEdit(observation.analysisId, observation.analysis.status);

  const updated = await AiGarmentFabricObservationRepository.update(observationId, {
    approvedObservation: observation.aiObservation,
    userEdited: false,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_fabric_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation, userEdited: observation.userEdited },
    newValues: { approvedObservation: observation.aiObservation, userEdited: false },
  });

  return updated;
}

export async function approveFabricAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const analysis = await AiGarmentFabricAnalysisRepository.findByProjectId(project.id);
  if (!analysis) {
    throw new BusinessRuleError("NOT_FOUND", "No analysis exists for this project yet.");
  }
  if (!["AI_ANALYSED", "UNDER_REVIEW"].includes(analysis.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      analysis.status === "STALE"
        ? "This analysis is out of date because the fabric swatch image was replaced — run a fresh analysis before approving."
        : `Cannot approve an analysis in "${analysis.status}" status.`,
      { status: analysis.status }
    );
  }

  const approved = await AiGarmentFabricAnalysisRepository.approveWithObservations(analysis.id, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_fabric_analyses",
    recordId: analysis.id,
    action: "APPROVE",
    oldValues: { status: analysis.status },
    newValues: { status: "APPROVED", approvedByUserId: actor.userId },
  });

  return approved;
}

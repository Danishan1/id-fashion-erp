import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { logger } from "@/core/logging/logger";
import {
  deleteAttachment,
  getAttachmentForDownload,
  uploadAttachment,
} from "@/core/attachments/AttachmentService";
import {
  analyzeReferenceGarment,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/reference-analysis/analyze";
import { FEATURE_REGISTRY } from "@/core/ai/reference-analysis/feature-registry";
import { flattenToObservations } from "@/core/ai/reference-analysis/schema";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import {
  AiGarmentReferenceAnalysisRepository,
  AiGarmentReferenceAnalysisRunRepository,
  AiGarmentReferenceObservationRepository,
} from "./reference-analysis.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

/** The brief's own explicit allowlist — narrower than FileStorage's shared allowlist (which also permits PDFs/Office docs for other modules), so a non-image file is rejected here even though the shared layer would otherwise accept it. */
const ALLOWED_REFERENCE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// A stuck IN_PROGRESS run older than this is treated as abandoned (e.g. the
// server crashed mid-request) rather than a permanent lock — comfortably
// longer than the provider's own 90s request timeout plus one retry.
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

export async function setReferenceImage(
  actor: ActorContext,
  projectId: string,
  file: { buffer: Buffer; fileName: string; mimeType: string }
) {
  const project = await getOwnedProject(actor.companyId, projectId);
  assertNotTerminalProject(project);

  if (!ALLOWED_REFERENCE_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The image format is not supported. Upload a JPG, PNG, or WEBP file.", {
      mimeType: file.mimeType,
    });
  }

  const previousAttachmentId = project.referenceImageAttachmentId;

  const attachment = await uploadAttachment(
    actor,
    "AI_GARMENT_PROJECT",
    projectId,
    file,
    "REFERENCE_IMAGE"
  );

  await AiGarmentProjectRepository.update(projectId, { referenceImageAttachmentId: attachment.id });

  if (previousAttachmentId) {
    // Never silently let a stale analysis keep pointing at the replaced
    // image as if it were still valid — kept for audit, blocked from
    // further edits/approval until a fresh analysis is run.
    await AiGarmentReferenceAnalysisRepository.markStale(projectId);
    await deleteAttachment(actor, previousAttachmentId).catch((err) => {
      // The old attachment row/file may already be gone (e.g. a retried
      // request) — replacing the pointer is what matters, so this never
      // blocks the user's replace action. But a genuine failure here (a
      // transient file-storage error, not just "already gone") would
      // otherwise leak an orphaned stored file with zero visibility — log
      // it so it's at least debuggable, never fully silent.
      logger.warn("Failed to delete the replaced reference image's old attachment", {
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
    oldValues: { referenceImageAttachmentId: previousAttachmentId },
    newValues: { referenceImageAttachmentId: attachment.id },
  });

  return attachment;
}

export async function deleteReferenceImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  assertNotTerminalProject(project);

  if (!project.referenceImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No reference image has been uploaded.");
  }

  const attachmentId = project.referenceImageAttachmentId;
  await deleteAttachment(actor, attachmentId);
  await AiGarmentProjectRepository.update(projectId, { referenceImageAttachmentId: null });
  await AiGarmentReferenceAnalysisRepository.markStale(projectId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { referenceImageAttachmentId: attachmentId },
    newValues: { referenceImageAttachmentId: null },
  });
}

export async function getReferenceAnalysis(companyId: string, projectId: string) {
  const project = await getOwnedProject(companyId, projectId);
  const analysis = await AiGarmentReferenceAnalysisRepository.findByProjectId(project.id);
  return analysis;
}

/**
 * Runs a fresh AI analysis and fully replaces whatever analysis previously
 * existed for this project. Guarded against duplicate concurrent requests
 * via an IN_PROGRESS run row written before the AI is ever called — a lost
 * race (two requests both passing the pre-check) still can't corrupt data,
 * since each writes its own run row and only the request that reaches
 * persistence first actually replaces the analysis; the loser's own run row
 * is marked SUCCESS/FAILED independently and its result is simply not the
 * one left current (mirrors this project's own "a document number drawn
 * just before a downstream check fails is never reused" accepted trade-off
 * for a manual, low-frequency action).
 */
export async function runReferenceAnalysis(actor: ActorContext, projectId: string) {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  assertNotTerminalProject(project);

  if (!project.referenceImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No reference image has been uploaded.");
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentReferenceAnalysisRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An analysis is already in progress for this project.", {
      runId: activeRun.id,
    });
  }

  const attachment = await getAttachmentForDownload(actor.companyId, project.referenceImageAttachmentId).catch(() => null);
  if (!attachment) {
    throw new BusinessRuleError("NOT_FOUND", "The reference image could not be found.");
  }
  if (!ALLOWED_REFERENCE_IMAGE_MIME_TYPES.has(attachment.attachment.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The image format is not supported. Upload a JPG, PNG, or WEBP file.");
  }
  const imageMediaType = attachment.attachment.mimeType as "image/jpeg" | "image/png" | "image/webp";

  const existingAnalysis = await AiGarmentReferenceAnalysisRepository.findByProjectId(projectId);
  const nextVersion = (existingAnalysis?.analysisVersion ?? 0) + 1;

  const run = await AiGarmentReferenceAnalysisRunRepository.create({
    companyId: actor.companyId,
    projectId,
    referenceAttachmentId: project.referenceImageAttachmentId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    promptVersion: PROMPT_VERSION,
    analysisVersion: nextVersion,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeReferenceGarment({
      imageBuffer: attachment.buffer,
      imageMediaType,
      projectContext: { garmentCategory: project.category?.name ?? null, targetMarket: project.targetMarket },
    });

    const observations = flattenToObservations(result.data, FEATURE_REGISTRY);

    const analysis = await AiGarmentReferenceAnalysisRepository.replaceForProject(
      projectId,
      {
        companyId: actor.companyId,
        projectId,
        referenceAttachmentId: project.referenceImageAttachmentId,
        status: "AI_ANALYSED",
        analysisVersion: nextVersion,
        promptVersion: PROMPT_VERSION,
        provider: "anthropic",
        model: result.model,
        rawResponseJson: result.rawResponse as object,
        constructionComplexityLevel: result.data.constructionComplexity.level,
        constructionComplexityExplanation: result.data.constructionComplexity.explanation,
        manufacturingChallenges: result.data.manufacturingChallenges,
        keyDesignLanguageFeatures: result.data.keyDesignLanguageFeatures,
        featuresForFurtherDevelopment: result.data.featuresForFurtherDevelopment,
        featuresToChangeForDifferentiation: result.data.featuresToChangeForDifferentiation,
        missingInformation: result.data.missingInformation,
        designDnaSummary: result.data.designDnaSummary,
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

    await AiGarmentReferenceAnalysisRunRepository.markSuccess(run.id, analysis.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_reference_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { analysisVersion: analysis.analysisVersion, model: analysis.model, promptVersion: analysis.promptVersion },
    });

    return await AiGarmentReferenceAnalysisRepository.findByProjectId(projectId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentReferenceAnalysisRunRepository.markFailed(run.id, category, message);

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
 * back to UNDER_REVIEW, requiring a fresh Approve — the brief's own
 * "material observation change requires reapproval" rule, applied
 * uniformly to every field rather than trying to classify which edits are
 * "material" (a distinction not concretely specified and easy to get wrong
 * in the unsafe direction).
 */
async function bumpAnalysisStatusForEdit(analysisId: string, currentStatus: string) {
  if (currentStatus === "STALE") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This analysis is out of date because the reference image was replaced — run a fresh analysis before editing observations.",
      { status: currentStatus }
    );
  }
  if (currentStatus !== "UNDER_REVIEW") {
    await AiGarmentReferenceAnalysisRepository.updateStatus(analysisId, "UNDER_REVIEW");
  }
}

export async function updateObservation(actor: ActorContext, observationId: string, approvedObservation: string) {
  const observation = await AiGarmentReferenceObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Observation not found.", { id: observationId });
  }

  await bumpAnalysisStatusForEdit(observation.analysisId, observation.analysis.status);

  const updated = await AiGarmentReferenceObservationRepository.update(observationId, {
    approvedObservation,
    userEdited: true,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_reference_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation, userEdited: observation.userEdited },
    newValues: { approvedObservation, userEdited: true },
  });

  return updated;
}

export async function resetObservationToAi(actor: ActorContext, observationId: string) {
  const observation = await AiGarmentReferenceObservationRepository.findWithAnalysisOwner(observationId);
  if (!observation || observation.analysis.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Observation not found.", { id: observationId });
  }

  await bumpAnalysisStatusForEdit(observation.analysisId, observation.analysis.status);

  const updated = await AiGarmentReferenceObservationRepository.update(observationId, {
    approvedObservation: observation.aiObservation,
    userEdited: false,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_reference_observations",
    recordId: observationId,
    action: "UPDATE",
    oldValues: { approvedObservation: observation.approvedObservation, userEdited: observation.userEdited },
    newValues: { approvedObservation: observation.aiObservation, userEdited: false },
  });

  return updated;
}

export async function approveReferenceAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const analysis = await AiGarmentReferenceAnalysisRepository.findByProjectId(project.id);
  if (!analysis) {
    throw new BusinessRuleError("NOT_FOUND", "No analysis exists for this project yet.");
  }
  if (!["AI_ANALYSED", "UNDER_REVIEW"].includes(analysis.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      analysis.status === "STALE"
        ? "This analysis is out of date because the reference image was replaced — run a fresh analysis before approving."
        : `Cannot approve an analysis in "${analysis.status}" status.`,
      { status: analysis.status }
    );
  }

  const approved = await AiGarmentReferenceAnalysisRepository.approveWithObservations(analysis.id, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_reference_analyses",
    recordId: analysis.id,
    action: "APPROVE",
    oldValues: { status: analysis.status },
    newValues: { status: "APPROVED", approvedByUserId: actor.userId },
  });

  return approved;
}

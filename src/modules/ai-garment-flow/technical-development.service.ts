import { writeAuditLog } from "@/core/audit/AuditLogger";
import { getImageGenerationProviderName } from "@/core/ai/image-generation/config";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadAttachment, getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import { getImageGenerationProvider } from "@/core/ai/image-generation/factory";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { buildTechnicalFlatPrompt, TECHNICAL_FLAT_PROMPT_VERSION } from "@/core/ai/technical-development/prompt";
import { resolveSelectedGarmentImage } from "./selected-garment-image";
import { AiGarmentFabricApplicationRepository } from "./fabric-application.repository";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import { AiGarmentTechnicalFlatRunRepository, AiGarmentTechnicalFlatRepository } from "./technical-development.repository";
import type { CreateTechnicalFlatInput, TechnicalFlatDecisionInput, ApproveTechnicalFlatInput } from "./technical-development.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6 use for their own larger/slower AI calls.
const RUN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

const CONFIGURED_PROVIDER_NAME = getImageGenerationProviderName();
const CONFIGURED_MODEL_NAME = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

function errorCategoryFor(err: unknown): string {
  if (err instanceof ImageGenConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof ImageGenerationServiceError) return err.category;
  return "UNKNOWN";
}

function mapImageGenError(err: unknown): never {
  if (err instanceof ImageGenConfigMissingError || err instanceof ImageGenerationServiceError) {
    throw new BusinessRuleError("AI_SERVICE_ERROR", err.message);
  }
  throw err;
}

/**
 * Resolves the specific garment image Technical Development should turn into
 * a flat: an approved fabric application's result (Process 6) is preferred
 * whenever one exists, since it's the more finished representation of the
 * garment — falling back to the plain selected design visual for
 * FABRIC-sourced projects, which never go through Apply Fabric at all (that
 * step doesn't exist in their own workflow — see stepsForSourceType), and
 * for a REFERENCE-sourced project that reaches this step out of the
 * intended order with no approved fabric application yet.
 */
async function resolveGarmentImageForTechnicalDevelopment(companyId: string, projectId: string) {
  const resolved = await resolveSelectedGarmentImage(companyId, projectId);
  if (resolved.project.approvedFabricApplicationId) {
    const application = await AiGarmentFabricApplicationRepository.findWithProjectOwner(resolved.project.approvedFabricApplicationId);
    if (application && application.project.companyId === companyId) {
      return { ...resolved, baseImageAttachmentId: application.resultImageAttachmentId };
    }
  }
  return resolved;
}

/**
 * Every attempt — the initial "CREATE TECHNICAL FLAT" click and any
 * "Regenerate" — funnels through this same function; only the optional
 * additionalNotes field differs. Never overwrites a prior attempt — always a
 * brand-new AiGarmentTechnicalFlat row, matching Process 6's own "keep full
 * history" discipline.
 */
export async function createTechnicalFlat(actor: ActorContext, projectId: string, input: CreateTechnicalFlatInput) {
  const { designDirectionId, baseImageAttachmentId } = await resolveGarmentImageForTechnicalDevelopment(actor.companyId, projectId);

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentTechnicalFlatRunRepository.findActiveSince(designDirectionId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A technical flat is already being generated for this design.", {
      runId: activeRun.id,
    });
  }

  const prompt = buildTechnicalFlatPrompt({ additionalNotes: input.additionalNotes });

  const run = await AiGarmentTechnicalFlatRunRepository.create({
    companyId: actor.companyId,
    projectId,
    designDirectionId,
    baseImageAttachmentId,
    additionalNotes: input.additionalNotes || null,
    provider: CONFIGURED_PROVIDER_NAME,
    model: CONFIGURED_MODEL_NAME,
    promptVersion: TECHNICAL_FLAT_PROMPT_VERSION,
    promptText: prompt,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const { attachment: baseAttachment, buffer: baseBuffer } = await getAttachmentForDownload(actor.companyId, baseImageAttachmentId);

    const provider = getImageGenerationProvider();
    if (!provider.generateTechnicalFlat) {
      throw new ImageGenerationServiceError(
        `The configured image provider ("${provider.name}") does not support generating a technical flat.`,
        "UNSUPPORTED_OPERATION"
      );
    }
    const result = await provider.generateTechnicalFlat({
      prompt,
      count: 1,
      baseImage: { buffer: baseBuffer, mimeType: baseAttachment.mimeType },
    });
    const image = result.images[0];
    if (!image) {
      throw new ImageGenerationServiceError("The image provider returned no image.", "INVALID_IMAGE_RESPONSE");
    }

    const resultAttachment = await uploadAttachment(
      actor,
      "AI_GARMENT_PROJECT",
      projectId,
      { buffer: image.buffer, fileName: `technical-flat-${Date.now()}.png`, mimeType: image.mimeType },
      "TECHNICAL_FLAT_IMAGE"
    );

    const flat = await AiGarmentTechnicalFlatRepository.create({
      companyId: actor.companyId,
      projectId,
      designDirectionId,
      runId: run.id,
      baseImageAttachmentId,
      resultImageAttachmentId: resultAttachment.id,
      additionalNotes: input.additionalNotes || null,
      createdByUserId: actor.userId,
    });

    await AiGarmentTechnicalFlatRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_technical_flats",
      recordId: flat.id,
      action: "CREATE",
      newValues: { designDirectionId },
    });

    return flat;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentTechnicalFlatRunRepository.markFailed(run.id, category, message);
    mapImageGenError(err);
  }
}

/** Lists every technical-flat attempt for the project's own currently selected design — empty (not an error) when no design has been selected yet, matching the panel's own "nothing to show" empty state. */
export async function listTechnicalFlats(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) return [];
  return AiGarmentTechnicalFlatRepository.findByDesignDirectionId(project.selectedDesignDirectionId);
}

/** "Approve" per attempt — a lighter maker/checker step than the final APPROVE TECHNICAL FLAT button below, but still requires explicit confirmation, matching every other Approve/Select action across this codebase. */
export async function decideTechnicalFlat(actor: ActorContext, flatId: string, input: TechnicalFlatDecisionInput) {
  const flat = await AiGarmentTechnicalFlatRepository.findWithProjectOwner(flatId);
  if (!flat || flat.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Technical flat not found.", { id: flatId });
  }
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving a technical flat requires explicit confirmation.");
  }

  const updated = await AiGarmentTechnicalFlatRepository.approveExclusive(flat.designDirectionId, flatId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_technical_flats",
    recordId: flatId,
    action: "UPDATE",
    oldValues: { decision: flat.decision },
    newValues: { decision: "APPROVED" },
  });

  return updated;
}

/**
 * "APPROVE TECHNICAL FLAT" — the final button. Requires the chosen technical
 * flat to already be APPROVED (via decideTechnicalFlat above) and always
 * requires its own explicit confirmation — a second, separate commitment,
 * not implied by the per-attempt Approve. Records the choice on the project
 * (same "not a real Style Master row yet" reasoning as
 * approveDesignAndFabric) and reuses the existing, unchanged
 * saveWorkflowStep() twice — once for TECHNICAL_DEVELOPMENT itself, then
 * once more for whichever step genuinely follows it (BOM, in both source-type
 * workflows).
 */
export async function approveTechnicalFlat(actor: ActorContext, projectId: string, input: ApproveTechnicalFlatInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving the technical flat requires explicit confirmation.");
  }

  const flat = await AiGarmentTechnicalFlatRepository.findWithProjectOwner(input.technicalFlatId);
  if (!flat || flat.project.companyId !== actor.companyId || flat.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Technical flat not found in this project.", { id: input.technicalFlatId });
  }
  if (flat.decision !== "APPROVED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve this technical flat first before finalizing it.");
  }

  const updated = await AiGarmentProjectRepository.update(projectId, {
    approvedTechnicalFlatId: input.technicalFlatId,
    approvedTechnicalFlatAt: new Date(),
    approvedTechnicalFlatByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { approvedTechnicalFlatId: project.approvedTechnicalFlatId },
    newValues: { approvedTechnicalFlatId: input.technicalFlatId },
  });

  await saveWorkflowStep(actor, projectId, { stepKey: "TECHNICAL_DEVELOPMENT" });

  const steps = stepsForSourceType(project.sourceType);
  const currentIndex = steps.findIndex((s) => s.key === "TECHNICAL_DEVELOPMENT");
  const nextStep = steps[currentIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, projectId, { stepKey: nextStep.key });
  }

  return updated;
}

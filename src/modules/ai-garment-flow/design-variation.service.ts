import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadAttachment, getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import { getImageGenerationProvider } from "@/core/ai/image-generation/factory";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { buildFeatureChangePrompt, FEATURE_CHANGE_PROMPT_VERSION } from "@/core/ai/design-variation/prompt";
import { AiGarmentGeneratedImageRepository } from "./visual-generation.repository";
import { AiGarmentDesignVariationRunRepository, AiGarmentDesignVariationRepository } from "./design-variation.repository";
import type { CreateDesignVariationInput, DesignVariationDecisionInput } from "./design-variation.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 1/3 use for their own single-external-call run logs — a
// stuck IN_PROGRESS row older than this is treated as abandoned, not a
// permanent lock (this module has no background job queue to reap it otherwise).
const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;

const CONFIGURED_PROVIDER_NAME = (process.env.IMAGE_GENERATION_PROVIDER || "openai").toLowerCase();
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

async function getOwnedGeneratedImage(companyId: string, imageId: string) {
  const image = await AiGarmentGeneratedImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Generated image not found.", { id: imageId });
  }
  return image;
}

async function assertNoActiveRun(parentGeneratedImageId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentDesignVariationRunRepository.findActiveSince(parentGeneratedImageId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A design variation is already being generated for this image.", {
      runId: activeRun.id,
    });
  }
}

/**
 * Every "Modify Design" submission always targets the SAME original
 * generated image — deliberately one level deep, not a chain (see the
 * schema's own comment on AiGarmentDesignVariationRun). `variationNumber`
 * increments per parent image starting at 1.
 *
 * Mirrors visual-generation.service.ts's `runGeneration` shape exactly: the
 * run row is created first (status IN_PROGRESS, provider/model recorded from
 * configuration before it's even resolved) so a MISSING_CONFIG failure is
 * still logged for audit; the variation row is only ever inserted, never
 * updated in place — full version history is every row that ever existed
 * for a given parent image.
 */
export async function createDesignVariation(actor: ActorContext, parentImageId: string, input: CreateDesignVariationInput) {
  const parentImage = await getOwnedGeneratedImage(actor.companyId, parentImageId);
  await assertNoActiveRun(parentImageId);

  const additionalInstructions = input.additionalInstructions || null;
  const prompt = buildFeatureChangePrompt({
    featureKey: input.featureKey,
    currentFeatureValue: input.currentFeatureValue,
    newRequirement: input.newRequirement,
    additionalInstructions,
  });

  const run = await AiGarmentDesignVariationRunRepository.create({
    companyId: actor.companyId,
    projectId: parentImage.projectId,
    designDirectionId: parentImage.designDirectionId,
    parentGeneratedImageId: parentImageId,
    featureKey: input.featureKey,
    currentFeatureValue: input.currentFeatureValue,
    newRequirement: input.newRequirement,
    additionalInstructions,
    provider: CONFIGURED_PROVIDER_NAME,
    model: CONFIGURED_MODEL_NAME,
    promptVersion: FEATURE_CHANGE_PROMPT_VERSION,
    promptText: prompt,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(
      actor.companyId,
      parentImage.imageAttachmentId
    );

    const provider = getImageGenerationProvider();
    if (!provider.generateVariation) {
      throw new ImageGenerationServiceError(
        `The configured image provider ("${provider.name}") does not support modifying an existing image.`,
        "UNSUPPORTED_OPERATION"
      );
    }
    const result = await provider.generateVariation({
      prompt,
      count: 1,
      parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
    });
    const image = result.images[0];
    if (!image) {
      throw new ImageGenerationServiceError("The image provider returned no image.", "INVALID_IMAGE_RESPONSE");
    }

    const attachment = await uploadAttachment(
      actor,
      "AI_GARMENT_PROJECT",
      parentImage.projectId,
      { buffer: image.buffer, fileName: `design-variation-${Date.now()}.png`, mimeType: image.mimeType },
      "DESIGN_VARIATION_IMAGE"
    );

    const variationNumber = (await AiGarmentDesignVariationRepository.countByParentImageId(parentImageId)) + 1;

    const variation = await AiGarmentDesignVariationRepository.create({
      companyId: actor.companyId,
      projectId: parentImage.projectId,
      designDirectionId: parentImage.designDirectionId,
      parentGeneratedImageId: parentImageId,
      variationRunId: run.id,
      variationNumber,
      featureKey: input.featureKey,
      previousValue: input.currentFeatureValue,
      newValue: input.newRequirement,
      additionalInstructions,
      promptVersion: FEATURE_CHANGE_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      imageAttachmentId: attachment.id,
      createdByUserId: actor.userId,
    });

    await AiGarmentDesignVariationRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_design_variations",
      recordId: variation.id,
      action: "CREATE",
      newValues: { featureKey: input.featureKey, variationNumber },
    });

    return variation;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentDesignVariationRunRepository.markFailed(run.id, category, message);
    mapImageGenError(err);
  }
}

export async function listDesignVariations(companyId: string, parentImageId: string) {
  await getOwnedGeneratedImage(companyId, parentImageId);
  return AiGarmentDesignVariationRepository.findByParentImageId(parentImageId);
}

/**
 * SELECT requires confirmed:true (the client shows a ConfirmModal first) —
 * KEEP_ORIGINAL is a lighter one-click action, matching this project's own
 * Approve/Reject asymmetry precedent (Sampling, Development Brief, Process 3's
 * own Select/Reject). Neither action ever touches the original image itself —
 * "never delete the original" holds structurally: nothing in this function
 * writes to AiGarmentGeneratedImage at all.
 */
export async function decideDesignVariation(actor: ActorContext, variationId: string, input: DesignVariationDecisionInput) {
  const variation = await AiGarmentDesignVariationRepository.findWithProjectOwner(variationId);
  if (!variation || variation.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design variation not found.", { id: variationId });
  }

  if (input.decision === "SELECT" && !input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a variation requires explicit confirmation.");
  }

  const decision = input.decision === "SELECT" ? "SELECTED" : "KEPT_ORIGINAL";
  const updated = await AiGarmentDesignVariationRepository.update(variationId, { decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_design_variations",
    recordId: variationId,
    action: "UPDATE",
    oldValues: { decision: variation.decision },
    newValues: { decision },
  });

  return updated;
}

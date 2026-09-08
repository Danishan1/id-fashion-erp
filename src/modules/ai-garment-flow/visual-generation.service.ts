import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadAttachment, getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import { getImageGenerationProvider } from "@/core/ai/image-generation/factory";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import {
  buildImageGenerationPrompt,
  buildVariationPrompt,
  humanizeCommercialPosition,
  PROMPT_VERSION,
  type VisualGenerationContext,
} from "@/core/ai/image-generation/prompt";
import { AiGarmentDesignDirectionRepository, AiGarmentDevelopmentBriefRunRepository } from "./development-brief.repository";
import { AiGarmentFabricDevelopmentRunRepository } from "./fabric-development-brief.repository";
import { AiGarmentImageGenerationRunRepository, AiGarmentGeneratedImageRepository } from "./visual-generation.repository";
import type { GenerateVisualsInput, CreateVariationInput, ImageDecisionInput, UpdateImageNotesInput } from "./visual-generation.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

type OwnedDirection = NonNullable<Awaited<ReturnType<typeof AiGarmentDesignDirectionRepository.findWithProjectOwner>>>;

const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000; // same window Process 1 uses for its own single-external-call run log

// Recorded on the run row before the provider is even resolved, so a
// MISSING_CONFIG failure is still logged for audit — matching Process 1/2's
// own "the run row always exists before the AI call is attempted" discipline.
// The real provider/model actually used (once resolved) is what the
// generated image rows themselves carry.
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

async function getOwnedApprovedDirection(companyId: string, directionId: string): Promise<OwnedDirection> {
  const direction = await AiGarmentDesignDirectionRepository.findWithProjectOwner(directionId);
  if (!direction || direction.project.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design direction not found.", { id: directionId });
  }
  if (direction.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "Only APPROVED design directions can have visuals generated — approve this direction first."
    );
  }
  return direction;
}

async function getOwnedImage(companyId: string, imageId: string) {
  const image = await AiGarmentGeneratedImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Generated image not found.", { id: imageId });
  }
  return image;
}

async function assertNoActiveRun(designDirectionId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentImageGenerationRunRepository.findActiveSince(designDirectionId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Visuals are already being generated for this design direction.", {
      runId: activeRun.id,
    });
  }
}

/**
 * Every field maps to a real, already-approved structured value — never free
 * text a user types for this prompt. Market/season/category come from the
 * originating run's own context snapshot (the resolved values at
 * brief-generation time), not re-derived from the project's possibly-since-
 * changed live state. Branches on which FK is set (same "derive from the
 * real state" discipline as regenerateDesignDirection's own branch) — a
 * FABRIC-sourced direction's own snapshot has no garmentCategory field at
 * all (that concept doesn't apply the same way; the specific garment type
 * is already woven into the direction's own designDirectionName/silhouette
 * text instead), so `category` simply falls back to "" for it, same as the
 * existing fallback already handles a missing/null value.
 */
async function buildContext(direction: OwnedDirection): Promise<VisualGenerationContext> {
  const snapshot = direction.developmentBriefRunId
    ? ((await AiGarmentDevelopmentBriefRunRepository.findById(direction.developmentBriefRunId))?.contextSnapshotJson as Record<
        string,
        unknown
      > | null) ?? {}
    : direction.fabricDevelopmentRunId
      ? ((await AiGarmentFabricDevelopmentRunRepository.findById(direction.fabricDevelopmentRunId))?.contextSnapshotJson as Record<
          string,
          unknown
        > | null) ?? {}
      : {};

  return {
    category: (snapshot.garmentCategory as string | null) ?? "",
    silhouette: direction.silhouette,
    fit: direction.fit,
    length: direction.garmentLength,
    neckline: direction.neckline,
    collar: direction.collar,
    sleeve: direction.sleeve,
    shoulder: direction.shoulderConstruction,
    front: direction.frontConstruction,
    back: direction.backConstruction,
    closure: direction.closure,
    pocket: direction.pocket,
    waist: direction.waistTreatment,
    hem: direction.hem,
    feature: direction.keyNewDesignFeature,
    fabric: direction.suggestedFabricCharacter,
    customer: direction.targetConsumer,
    market: (snapshot.targetMarket as string | null) ?? "",
    season: (snapshot.season as string | null) ?? "",
    commercialPosition: humanizeCommercialPosition(direction.commercialClassification),
  };
}

/**
 * Creates the run row first (status IN_PROGRESS, provider/model recorded
 * from configuration before it's even resolved), then attempts
 * `resolveAndCall` — resolving the provider AND making the actual request
 * both happen inside this one try/catch, so a MISSING_CONFIG failure is
 * logged on the run exactly like a genuine provider error would be, never
 * silently skipped. On success, every returned image becomes its own new
 * AiGarmentGeneratedImage row (never an update to an existing one) saved
 * through the shared AttachmentService/local file storage — never trusted
 * as a bare external URL.
 */
async function runGeneration(
  actor: ActorContext,
  projectId: string,
  directionId: string,
  runFields: { promptVersion: string; promptText: string; requestedImageCount: number; parentGeneratedImageId?: string },
  resolveAndCall: () => Promise<{ provider: string; result: { images: { buffer: Buffer; mimeType: string }[]; model: string; raw: unknown } }>
) {
  const run = await AiGarmentImageGenerationRunRepository.create({
    companyId: actor.companyId,
    projectId,
    designDirectionId: directionId,
    provider: CONFIGURED_PROVIDER_NAME,
    model: CONFIGURED_MODEL_NAME,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
    ...runFields,
  });

  try {
    const { provider, result } = await resolveAndCall();

    const rows = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "AI_GARMENT_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `generated-design-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "GENERATED_DESIGN_IMAGE"
      );
      rows.push({
        companyId: actor.companyId,
        projectId,
        designDirectionId: directionId,
        generationRunId: run.id,
        promptVersion: runFields.promptVersion,
        provider,
        model: result.model,
        imageAttachmentId: attachment.id,
        createdByUserId: actor.userId,
      });
    }

    await AiGarmentGeneratedImageRepository.createMany(rows);
    await AiGarmentImageGenerationRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_image_generation_runs",
      recordId: run.id,
      action: "CREATE",
      newValues: { imageCount: rows.length },
    });

    return AiGarmentGeneratedImageRepository.findByDesignDirectionId(directionId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentImageGenerationRunRepository.markFailed(run.id, category, message);
    mapImageGenError(err);
  }
}

/**
 * Generates a fresh batch of `imageCount` images for one APPROVED design
 * direction, purely from its own structured content — used by both the
 * initial "GENERATE VISUAL" action and by "Regenerate" (always imageCount:1
 * from the caller).
 */
export async function generateVisuals(actor: ActorContext, directionId: string, input: GenerateVisualsInput) {
  const direction = await getOwnedApprovedDirection(actor.companyId, directionId);
  await assertNoActiveRun(directionId);

  const context = await buildContext(direction);
  const prompt = buildImageGenerationPrompt(context);

  return runGeneration(
    actor,
    direction.projectId,
    directionId,
    { promptVersion: PROMPT_VERSION, promptText: prompt, requestedImageCount: input.imageCount },
    async () => {
      const provider = getImageGenerationProvider();
      const result = await provider.generate({ prompt, count: input.imageCount });
      return { provider: provider.name, result };
    }
  );
}

/**
 * Image-to-image variation of one specific prior generated image —
 * `generationRun.parentGeneratedImageId` records the lineage. Requires a
 * provider that implements `generateVariation`; a provider without that
 * capability is an honest, logged failure — never a silent fallback to a
 * plain text-only regenerate that would ignore the parent image entirely.
 */
export async function createVariation(actor: ActorContext, parentImageId: string, input: CreateVariationInput) {
  const parentImage = await getOwnedImage(actor.companyId, parentImageId);
  const direction = await getOwnedApprovedDirection(actor.companyId, parentImage.designDirectionId);
  await assertNoActiveRun(direction.id);

  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);
  const context = await buildContext(direction);
  const prompt = buildVariationPrompt(context);

  return runGeneration(
    actor,
    direction.projectId,
    direction.id,
    { promptVersion: PROMPT_VERSION, promptText: prompt, requestedImageCount: input.imageCount, parentGeneratedImageId: parentImageId },
    async () => {
      const provider = getImageGenerationProvider();
      if (!provider.generateVariation) {
        throw new ImageGenerationServiceError(
          `The configured image provider ("${provider.name}") does not support creating a variation of an existing image.`,
          "UNSUPPORTED_OPERATION"
        );
      }
      const result = await provider.generateVariation({
        prompt,
        count: input.imageCount,
        parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
      });
      return { provider: provider.name, result };
    }
  );
}

export async function listGeneratedImages(companyId: string, directionId: string) {
  const direction = await AiGarmentDesignDirectionRepository.findWithProjectOwner(directionId);
  if (!direction || direction.project.companyId !== companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design direction not found.", { id: directionId });
  }
  return AiGarmentGeneratedImageRepository.findByDesignDirectionId(directionId);
}

/** SELECT requires confirmed:true (the client shows a ConfirmModal first) — REJECT is a lighter one-click action, matching this project's own Approve/Reject asymmetry precedent elsewhere (Sampling, Development Brief). */
export async function decideImage(actor: ActorContext, imageId: string, input: ImageDecisionInput) {
  const image = await getOwnedImage(actor.companyId, imageId);

  if (input.decision === "SELECT" && !input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a design as the final visual requires explicit confirmation.");
  }

  const decision = input.decision === "SELECT" ? "SELECTED" : "REJECTED";
  const updated = await AiGarmentGeneratedImageRepository.update(imageId, { decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_generated_images",
    recordId: imageId,
    action: "UPDATE",
    oldValues: { decision: image.decision },
    newValues: { decision },
  });

  return updated;
}

export async function updateImageNotes(actor: ActorContext, imageId: string, input: UpdateImageNotesInput) {
  await getOwnedImage(actor.companyId, imageId);
  const updated = await AiGarmentGeneratedImageRepository.update(imageId, { userNotes: input.userNotes || null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_generated_images",
    recordId: imageId,
    action: "UPDATE",
    newValues: { userNotes: input.userNotes || null },
  });

  return updated;
}

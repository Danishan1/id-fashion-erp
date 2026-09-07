import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadAttachment, getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import { getImageGenerationProvider } from "@/core/ai/image-generation/factory";
import { ImageGenConfigMissingError } from "@/core/ai/image-generation/config";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { buildFabricApplicationPrompt, FABRIC_APPLICATION_PROMPT_VERSION } from "@/core/ai/fabric-application/prompt";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentGeneratedImageRepository } from "./visual-generation.repository";
import { AiGarmentDesignVariationRepository } from "./design-variation.repository";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import { AiGarmentFabricApplicationRunRepository, AiGarmentFabricApplicationRepository } from "./fabric-application.repository";
import type {
  CreateFabricApplicationInput,
  FabricApplicationDecisionInput,
  ApproveDesignAndFabricInput,
} from "./fabric-application.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

interface UploadableFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

// Same window Process 2/5 use for their own larger/slower AI calls.
const RUN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

// Layered on top of FileStorage's own broader shared allowlist, same
// narrowing already applied to Process 1's reference image — gpt-image-1's
// edit endpoint only accepts png/webp/jpg.
const ALLOWED_SWATCH_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

/**
 * "Start from the SELECTED DESIGN" — resolves the specific garment image to
 * apply fabric to. Checks every image AND every variation across the
 * selected design direction for whichever was most recently marked
 * SELECTED (a variation can supersede its own parent image as "the chosen
 * visual," so both pools are checked rather than assuming one always wins),
 * never guessing which one to use when the signal is ambiguous or absent.
 */
async function resolveSelectedGarmentImage(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Select a design for development first (Commercial Evaluation step) before applying fabric."
    );
  }

  const [images, variations] = await Promise.all([
    AiGarmentGeneratedImageRepository.findByDesignDirectionId(project.selectedDesignDirectionId),
    AiGarmentDesignVariationRepository.findByDesignDirectionId(project.selectedDesignDirectionId),
  ]);

  const candidates = [
    ...images.filter((i) => i.decision === "SELECTED").map((i) => ({ imageAttachmentId: i.imageAttachmentId, at: i.updatedAt })),
    ...variations.filter((v) => v.decision === "SELECTED").map((v) => ({ imageAttachmentId: v.imageAttachmentId, at: v.updatedAt })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  if (candidates.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No visual has been selected for this design yet — select one on the Generate Variations step first."
    );
  }

  return { project, designDirectionId: project.selectedDesignDirectionId, baseImageAttachmentId: candidates[0].imageAttachmentId };
}

function textFieldsOf(input: CreateFabricApplicationInput) {
  return {
    fabricCode: input.fabricCode || null,
    composition: input.composition || null,
    width: input.width || null,
    gsm: input.gsm || null,
    wovenOrKnit: input.wovenOrKnit || null,
    stretch: input.stretch || null,
    drape: input.drape || null,
    transparency: input.transparency || null,
    surfaceCharacter: input.surfaceCharacter || null,
    printPattern: input.printPattern || null,
    directionality: input.directionality || null,
    specialPlacement: input.specialPlacement || null,
    availableQuantity: input.availableQuantity ?? null,
    costPerMetre: input.costPerMetre ?? null,
  };
}

/**
 * Every attempt — the initial "APPLY FABRIC" click, "Regenerate," "Change
 * Fabric" (a new swatch file), "Adjust Print Scale," "Adjust Placement" —
 * funnels through this same function; only the submitted fields (and
 * possibly the swatch file) differ. Never overwrites a prior attempt —
 * always a brand-new AiGarmentFabricApplication row, "before" and "after"
 * images both kept, matching the spec's own "Do not overwrite the selected
 * garment design" / "Store original fabric image separately."
 */
export async function createFabricApplication(
  actor: ActorContext,
  projectId: string,
  input: CreateFabricApplicationInput & { swatchFile: UploadableFile }
) {
  const { designDirectionId, baseImageAttachmentId } = await resolveSelectedGarmentImage(actor.companyId, projectId);

  if (!ALLOWED_SWATCH_MIME_TYPES.has(input.swatchFile.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The fabric swatch must be a JPG, PNG, or WEBP image.");
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentFabricApplicationRunRepository.findActiveSince(designDirectionId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A fabric application is already being generated for this design.", {
      runId: activeRun.id,
    });
  }

  const swatchAttachment = await uploadAttachment(actor, "AI_GARMENT_PROJECT", projectId, input.swatchFile, "FABRIC_SWATCH_IMAGE");

  const fields = textFieldsOf(input);
  const prompt = buildFabricApplicationPrompt(fields);

  const run = await AiGarmentFabricApplicationRunRepository.create({
    companyId: actor.companyId,
    projectId,
    designDirectionId,
    baseImageAttachmentId,
    swatchAttachmentId: swatchAttachment.id,
    ...fields,
    provider: CONFIGURED_PROVIDER_NAME,
    model: CONFIGURED_MODEL_NAME,
    promptVersion: FABRIC_APPLICATION_PROMPT_VERSION,
    promptText: prompt,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const { attachment: baseAttachment, buffer: baseBuffer } = await getAttachmentForDownload(actor.companyId, baseImageAttachmentId);

    const provider = getImageGenerationProvider();
    if (!provider.applyFabric) {
      throw new ImageGenerationServiceError(
        `The configured image provider ("${provider.name}") does not support applying a fabric swatch to an existing image.`,
        "UNSUPPORTED_OPERATION"
      );
    }
    const result = await provider.applyFabric({
      prompt,
      count: 1,
      baseImage: { buffer: baseBuffer, mimeType: baseAttachment.mimeType },
      swatchImage: { buffer: input.swatchFile.buffer, mimeType: input.swatchFile.mimeType },
    });
    const image = result.images[0];
    if (!image) {
      throw new ImageGenerationServiceError("The image provider returned no image.", "INVALID_IMAGE_RESPONSE");
    }

    const resultAttachment = await uploadAttachment(
      actor,
      "AI_GARMENT_PROJECT",
      projectId,
      { buffer: image.buffer, fileName: `fabric-applied-${Date.now()}.png`, mimeType: image.mimeType },
      "FABRIC_APPLIED_GARMENT_IMAGE"
    );

    const application = await AiGarmentFabricApplicationRepository.create({
      companyId: actor.companyId,
      projectId,
      designDirectionId,
      runId: run.id,
      baseImageAttachmentId,
      swatchAttachmentId: swatchAttachment.id,
      resultImageAttachmentId: resultAttachment.id,
      ...fields,
      createdByUserId: actor.userId,
    });

    await AiGarmentFabricApplicationRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_fabric_applications",
      recordId: application.id,
      action: "CREATE",
      newValues: { designDirectionId },
    });

    return application;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentFabricApplicationRunRepository.markFailed(run.id, category, message);
    mapImageGenError(err);
  }
}

/** Lists every fabric-application attempt for the project's own currently selected design — empty (not an error) when no design has been selected yet, matching the panel's own "nothing to show" empty state. */
export async function listFabricApplications(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) return [];
  return AiGarmentFabricApplicationRepository.findByDesignDirectionId(project.selectedDesignDirectionId);
}

/** "Approve" per attempt — a lighter maker/checker step than the final APPROVE DESIGN & FABRIC button below, but still requires explicit confirmation, matching every other Approve/Select action across this codebase. */
export async function decideFabricApplication(actor: ActorContext, applicationId: string, input: FabricApplicationDecisionInput) {
  const application = await AiGarmentFabricApplicationRepository.findWithProjectOwner(applicationId);
  if (!application || application.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric application not found.", { id: applicationId });
  }
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving a fabric application requires explicit confirmation.");
  }

  const updated = await AiGarmentFabricApplicationRepository.approveExclusive(application.designDirectionId, applicationId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_fabric_applications",
    recordId: applicationId,
    action: "UPDATE",
    oldValues: { decision: application.decision },
    newValues: { decision: "APPROVED" },
  });

  return updated;
}

/**
 * "APPROVE DESIGN & FABRIC" — the final button. Requires the chosen fabric
 * application to already be APPROVED (via decideFabricApplication above)
 * and always requires its own explicit confirmation — a second, separate
 * commitment, not implied by the per-attempt Approve. Records the choice on
 * the project (same "not a real Style Master row yet" reasoning as
 * selectDesignForDevelopment) and reuses the existing, unchanged
 * saveWorkflowStep() twice — once for APPLY_FABRIC itself, then once more
 * for whichever step genuinely follows it. APPLY_FABRIC only exists in the
 * REFERENCE-sourced workflow's own step list (a FABRIC-sourced project
 * already has real fabric from its own earlier steps) — the first
 * saveWorkflowStep call's own step-key validation already rejects this
 * action outright for a FABRIC-sourced project, so no separate source-type
 * guard is needed here.
 */
export async function approveDesignAndFabric(actor: ActorContext, projectId: string, input: ApproveDesignAndFabricInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving the design and fabric requires explicit confirmation.");
  }

  const application = await AiGarmentFabricApplicationRepository.findWithProjectOwner(input.fabricApplicationId);
  if (!application || application.project.companyId !== actor.companyId || application.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric application not found in this project.", { id: input.fabricApplicationId });
  }
  if (application.decision !== "APPROVED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve this fabric application first before finalizing Design & Fabric.");
  }

  const updated = await AiGarmentProjectRepository.update(projectId, {
    approvedFabricApplicationId: input.fabricApplicationId,
    approvedFabricApplicationAt: new Date(),
    approvedFabricApplicationByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { approvedFabricApplicationId: project.approvedFabricApplicationId },
    newValues: { approvedFabricApplicationId: input.fabricApplicationId },
  });

  await saveWorkflowStep(actor, projectId, { stepKey: "APPLY_FABRIC" });

  const steps = stepsForSourceType(project.sourceType);
  const applyFabricIndex = steps.findIndex((s) => s.key === "APPLY_FABRIC");
  const nextStep = steps[applyFabricIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, projectId, { stepKey: nextStep.key });
  }

  return updated;
}

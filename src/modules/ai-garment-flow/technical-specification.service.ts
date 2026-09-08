import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateTechnicalSpecification as callTechnicalSpecificationAi,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/technical-specification/generate";
import type { TechnicalSpecificationContext, SizeForSpec } from "@/core/ai/technical-specification/prompt";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { describeFabricDetail } from "./fabric-detail-description";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import {
  AiGarmentTechnicalSpecificationRunRepository,
  AiGarmentTechnicalSpecificationRepository,
  AiGarmentMeasurementValueRepository,
  type CreateMeasurementPointInput,
} from "./technical-specification.repository";
import type {
  CreateTechnicalSpecificationInput,
  TechnicalSpecificationDecisionInput,
  ApproveTechnicalSpecificationInput,
  UpdateMeasurementValueInput,
} from "./technical-specification.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6/7/8 use for their own larger/slower AI calls.
const RUN_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

function errorCategoryFor(err: unknown): string {
  if (err instanceof AiConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof AiInvalidResponseError) return "INVALID_STRUCTURED_RESPONSE";
  if (err instanceof AiServiceError) return err.category;
  return "UNKNOWN";
}

function mapAiError(err: unknown): never {
  if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
    const code = err instanceof AiInvalidResponseError ? "AI_INVALID_RESPONSE" : "AI_SERVICE_ERROR";
    throw new BusinessRuleError(code, err.message);
  }
  throw err;
}

async function getOwnedProject(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return project;
}

/**
 * "GENERATE DRAFT SPECIFICATION" — needs the project's selected design
 * direction (for its own structured construction fields), exactly like BOM
 * Suggestion, and does NOT require productId to already be set — a
 * measurement chart is built directly against the company's own global Size
 * master (S/M/L/...), never against a Style's own generated ProductVariant
 * rows, so no graduation is required at all.
 */
export async function createTechnicalSpecification(
  actor: ActorContext,
  projectId: string,
  input: CreateTechnicalSpecificationInput
) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Select a design for development first (Commercial Evaluation step) before generating a technical specification."
    );
  }

  const direction = await AiGarmentDesignDirectionRepository.findById(project.selectedDesignDirectionId);
  if (!direction) throw new BusinessRuleError("NOT_FOUND", "Selected design direction not found.", { id: project.selectedDesignDirectionId });

  const activeSizes = await LookupRepository.size.findMany({
    where: { companyId: actor.companyId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  if (activeSizes.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No active Sizes exist for this company yet. Add at least one in Masters → Lookups → Sizes before generating a technical specification."
    );
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentTechnicalSpecificationRunRepository.findActiveSince(direction.id, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A technical specification is already being generated for this design.", {
      runId: activeRun.id,
    });
  }

  // The requested order is preserved end-to-end: the AI's response is
  // positional (value N corresponds to size N as listed in the prompt),
  // never id-keyed — same discipline Process 5/8 already established.
  const sizesForPrompt: SizeForSpec[] = activeSizes.map((s, index) => ({ displayNumber: index + 1, name: s.name }));

  const context: TechnicalSpecificationContext = {
    designDirectionName: direction.designDirectionName,
    silhouette: direction.silhouette,
    garmentLength: direction.garmentLength,
    fit: direction.fit,
    neckline: direction.neckline,
    collar: direction.collar,
    sleeve: direction.sleeve,
    shoulderConstruction: direction.shoulderConstruction,
    frontConstruction: direction.frontConstruction,
    backConstruction: direction.backConstruction,
    closure: direction.closure,
    pocket: direction.pocket,
    waistTreatment: direction.waistTreatment,
    hem: direction.hem,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    additionalNotes: input.additionalNotes,
    sizes: sizesForPrompt,
  };

  const run = await AiGarmentTechnicalSpecificationRunRepository.create({
    companyId: actor.companyId,
    projectId,
    designDirectionId: direction.id,
    additionalNotes: input.additionalNotes || null,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText: JSON.stringify(context),
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await callTechnicalSpecificationAi(context);

    const points: CreateMeasurementPointInput[] = result.data.measurementPoints.map((point, pointIndex) => ({
      measurementName: point.measurementName,
      howToMeasure: point.howToMeasure,
      toleranceText: point.toleranceText,
      sortOrder: pointIndex,
      values: point.values.map((valueText, sizeIndex) => ({
        sizeId: activeSizes[sizeIndex].id,
        aiValueText: valueText,
        approvedValueText: valueText,
      })),
    }));

    const specification = await AiGarmentTechnicalSpecificationRepository.create(
      {
        companyId: actor.companyId,
        projectId,
        designDirectionId: direction.id,
        runId: run.id,
        generalNotes: result.data.generalNotes,
        createdByUserId: actor.userId,
      },
      points
    );

    await AiGarmentTechnicalSpecificationRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_technical_specifications",
      recordId: specification.id,
      action: "CREATE",
      newValues: { designDirectionId: direction.id, pointCount: points.length, sizeCount: activeSizes.length },
    });

    return AiGarmentTechnicalSpecificationRepository.findByDesignDirectionId(direction.id);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentTechnicalSpecificationRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/** Empty (not an error) when no design has been selected yet, matching every other AI Garment Flow list endpoint's own empty state. */
export async function listTechnicalSpecifications(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.selectedDesignDirectionId) return [];
  return AiGarmentTechnicalSpecificationRepository.findByDesignDirectionId(project.selectedDesignDirectionId);
}

/**
 * Correcting one cell's value — the real, human-in-the-loop correction this
 * whole process exists to collect, since every AI-suggested value is an
 * advisory starting draft. Pushes an already-APPROVED specification back to
 * PENDING, requiring a fresh Approve, matching every other per-item edit
 * discipline in this module (Reference/Fabric Analysis, Product
 * Suitability).
 */
export async function updateMeasurementValue(actor: ActorContext, valueId: string, input: UpdateMeasurementValueInput) {
  const value = await AiGarmentMeasurementValueRepository.findWithSpecOwner(valueId);
  if (!value || value.measurementPoint.technicalSpecification.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Measurement value not found.", { id: valueId });
  }

  const spec = value.measurementPoint.technicalSpecification;
  if (spec.decision === "APPROVED") {
    await AiGarmentTechnicalSpecificationRepository.revertToPending(spec.id);
  }

  const updated = await AiGarmentMeasurementValueRepository.update(valueId, {
    approvedValueText: input.approvedValueText,
    userEdited: true,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_measurement_values",
    recordId: valueId,
    action: "UPDATE",
    oldValues: { approvedValueText: value.approvedValueText, userEdited: value.userEdited },
    newValues: { approvedValueText: input.approvedValueText, userEdited: true },
  });

  return updated;
}

export async function resetMeasurementValueToAi(actor: ActorContext, valueId: string) {
  const value = await AiGarmentMeasurementValueRepository.findWithSpecOwner(valueId);
  if (!value || value.measurementPoint.technicalSpecification.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Measurement value not found.", { id: valueId });
  }

  const spec = value.measurementPoint.technicalSpecification;
  if (spec.decision === "APPROVED") {
    await AiGarmentTechnicalSpecificationRepository.revertToPending(spec.id);
  }

  const updated = await AiGarmentMeasurementValueRepository.update(valueId, {
    approvedValueText: value.aiValueText,
    userEdited: false,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_measurement_values",
    recordId: valueId,
    action: "UPDATE",
    oldValues: { approvedValueText: value.approvedValueText, userEdited: value.userEdited },
    newValues: { approvedValueText: value.aiValueText, userEdited: false },
  });

  return updated;
}

/** "Approve" per attempt — a lighter maker/checker step than the final APPROVE TECHNICAL SPECIFICATION button below, mirroring decideTechnicalFlat exactly. */
export async function decideTechnicalSpecification(actor: ActorContext, specId: string, input: TechnicalSpecificationDecisionInput) {
  const spec = await AiGarmentTechnicalSpecificationRepository.findWithProjectOwner(specId);
  if (!spec || spec.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Technical specification not found.", { id: specId });
  }
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving a technical specification requires explicit confirmation.");
  }

  const updated = await AiGarmentTechnicalSpecificationRepository.approveExclusive(spec.designDirectionId, specId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_technical_specifications",
    recordId: specId,
    action: "UPDATE",
    oldValues: { decision: spec.decision },
    newValues: { decision: "APPROVED" },
  });

  return updated;
}

/**
 * "APPROVE TECHNICAL SPECIFICATION" — the final button. Requires the chosen
 * specification to already be APPROVED (via decideTechnicalSpecification
 * above) and always requires its own explicit confirmation. Records the
 * choice on the project and reuses the existing, unchanged saveWorkflowStep()
 * twice — once for TECHNICAL_DEVELOPMENT itself, then once more for
 * whichever step genuinely follows it — the exact pattern
 * approveTechnicalFlat() already established.
 */
export async function approveTechnicalSpecification(
  actor: ActorContext,
  projectId: string,
  input: ApproveTechnicalSpecificationInput
) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approving the technical specification requires explicit confirmation.");
  }

  const spec = await AiGarmentTechnicalSpecificationRepository.findWithProjectOwner(input.technicalSpecificationId);
  if (!spec || spec.project.companyId !== actor.companyId || spec.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Technical specification not found in this project.", { id: input.technicalSpecificationId });
  }
  if (spec.decision !== "APPROVED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve this technical specification first before finalizing it.");
  }

  const updated = await AiGarmentProjectRepository.update(projectId, {
    approvedTechnicalSpecificationId: input.technicalSpecificationId,
    approvedTechnicalSpecificationAt: new Date(),
    approvedTechnicalSpecificationByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { approvedTechnicalSpecificationId: project.approvedTechnicalSpecificationId },
    newValues: { approvedTechnicalSpecificationId: input.technicalSpecificationId },
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

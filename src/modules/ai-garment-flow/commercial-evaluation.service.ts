import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateCommercialEvaluation,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/commercial-evaluation/generate";
import { buildSystemPrompt, buildUserText, type DesignForComparison } from "@/core/ai/commercial-evaluation/prompt";
import { computeCommercialDevelopmentScore, type CommercialEvaluationItemOutput } from "@/core/ai/commercial-evaluation/schema";
import type { Prisma } from "@prisma/client";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { describeFabricDetail } from "./fabric-detail-description";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import {
  AiGarmentCommercialEvaluationRunRepository,
  AiGarmentCommercialEvaluationRepository,
  AiGarmentCommercialEvaluationItemRepository,
} from "./commercial-evaluation.repository";
import type { CreateCommercialEvaluationInput, OverrideRankInput, SelectDesignForDevelopmentInput } from "./commercial-evaluation.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Longer than Process 1's single-image call — a comparison across up to 8
// designs each producing 5 prose fields takes longer, matching the same
// "longer window for a bigger batch" reasoning already used for Process 2's
// 9-direction Development Brief run.
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

/** Only APPROVED design directions are real, proven-out candidates for a commercial commitment — the same eligibility gate Process 3 (Generate Visuals) already applies. */
export async function listEligibleDesignsForComparison(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  const directions = await AiGarmentDesignDirectionRepository.findByProjectId(projectId);
  return directions.filter((d) => d.status === "APPROVED");
}

export async function createCommercialEvaluation(actor: ActorContext, projectId: string, input: CreateCommercialEvaluationInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentCommercialEvaluationRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A commercial evaluation is already being generated for this project.", {
      runId: activeRun.id,
    });
  }

  // The requested order is preserved end-to-end: the AI's response is
  // positional (item N corresponds to design N as listed in the prompt),
  // never id-keyed, so the order the designs are fetched in here is exactly
  // the order they're presented in and exactly the order results are zipped
  // back to real ids afterward.
  const found = await AiGarmentDesignDirectionRepository.findManyByIds(projectId, input.designDirectionIds);
  const byId = new Map(found.map((d) => [d.id, d]));
  const orderedDirections = input.designDirectionIds.map((id) => byId.get(id));

  const missingIds = input.designDirectionIds.filter((id) => !byId.has(id));
  if (missingIds.length > 0) {
    throw new BusinessRuleError("NOT_FOUND", "One or more selected designs were not found in this project.", { ids: missingIds });
  }
  const notApproved = orderedDirections.filter((d) => d!.status !== "APPROVED").map((d) => d!.designDirectionName);
  if (notApproved.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Only APPROVED design directions can be commercially compared. Not approved: ${notApproved.join(", ")}.`,
      { names: notApproved }
    );
  }

  const designs: DesignForComparison[] = orderedDirections.map((d, index) => ({
    displayNumber: index + 1,
    designDirectionName: d!.designDirectionName,
    commercialClassification: d!.commercialClassification,
    targetConsumer: d!.targetConsumer,
    silhouette: d!.silhouette,
    garmentLength: d!.garmentLength,
    fit: d!.fit,
    neckline: d!.neckline,
    collar: d!.collar,
    sleeve: d!.sleeve,
    closure: d!.closure,
    pocket: d!.pocket,
    waistTreatment: d!.waistTreatment,
    hem: d!.hem,
    keyNewDesignFeature: d!.keyNewDesignFeature,
    suggestedFabricCharacter: d!.suggestedFabricCharacter,
    suggestedTrims: d!.suggestedTrims,
    productionComplexity: d!.productionComplexity,
    expectedFabricConsumption: d!.expectedFabricConsumption,
    targetPriceCompatibilityLevel: d!.targetPriceCompatibilityLevel,
    commercialRationale: d!.commercialRationale,
    manufacturingRisk: d!.manufacturingRisk,
  }));

  const factoryCapability = input.factoryCapability || null;
  const context = {
    buyer: project.buyer?.name ?? null,
    customer: project.customer?.name ?? null,
    targetMarket: project.targetMarket ?? null,
    season: project.season?.name ?? null,
    targetSellingPrice: project.targetSellingPrice != null ? Number(project.targetSellingPrice) : null,
    currencyCode: project.currencyCode ?? null,
    orderQuantityEstimate: project.orderQuantityEstimate != null ? Number(project.orderQuantityEstimate) : null,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    factoryCapability,
    designs,
  };

  const contextSnapshot: Prisma.InputJsonValue = {
    buyer: context.buyer,
    customer: context.customer,
    targetMarket: context.targetMarket,
    season: context.season,
    targetSellingPrice: context.targetSellingPrice,
    currencyCode: context.currencyCode,
    orderQuantityEstimate: context.orderQuantityEstimate,
    fabricDescription: context.fabricDescription,
    factoryCapability: context.factoryCapability,
  };

  const promptText = `${buildSystemPrompt(designs.length)}\n\n${buildUserText(context)}`;

  const run = await AiGarmentCommercialEvaluationRunRepository.create({
    companyId: actor.companyId,
    projectId,
    comparedDesignDirectionIds: input.designDirectionIds,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText,
    contextSnapshotJson: contextSnapshot,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateCommercialEvaluation(context);

    const itemRows = result.items.map((item: CommercialEvaluationItemOutput, index: number) => ({
      designDirectionId: orderedDirections[index]!.id,
      targetCustomerFitScore: item.targetCustomerFitScore,
      buyerFitScore: item.buyerFitScore,
      fabricSuitabilityScore: item.fabricSuitabilityScore,
      commercialAppealScore: item.commercialAppealScore,
      manufacturingSimplicityScore: item.manufacturingSimplicityScore,
      fabricConsumptionEfficiencyScore: item.fabricConsumptionEfficiencyScore,
      patternMakingComplexityScore: item.patternMakingComplexityScore,
      sewingComplexityScore: item.sewingComplexityScore,
      trimComplexityScore: item.trimComplexityScore,
      targetPriceCompatibilityScore: item.targetPriceCompatibilityScore,
      bulkProductionScalabilityScore: item.bulkProductionScalabilityScore,
      designFreshnessScore: item.designFreshnessScore,
      commercialDevelopmentScore: computeCommercialDevelopmentScore(item),
      strengths: item.strengths,
      weaknesses: item.weaknesses,
      manufacturingRisks: item.manufacturingRisks,
      potentialCostRisks: item.potentialCostRisks,
      suggestedImprovement: item.suggestedImprovement,
      aiRank: item.rank,
    }));

    const evaluationId = await AiGarmentCommercialEvaluationRepository.create(
      {
        companyId: actor.companyId,
        projectId,
        runId: run.id,
        overallRankingRationale: result.overallRankingRationale,
        createdByUserId: actor.userId,
      },
      itemRows
    );

    await AiGarmentCommercialEvaluationRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_commercial_evaluations",
      recordId: evaluationId,
      action: "CREATE",
      newValues: { designCount: designs.length },
    });

    return AiGarmentCommercialEvaluationRepository.findById(evaluationId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentCommercialEvaluationRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

export async function getLatestCommercialEvaluation(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiGarmentCommercialEvaluationRepository.findLatestByProjectId(projectId);
}

/** "Allow user to override AI ranking" — a lighter action than Select/Keep Original elsewhere in this codebase: overriding a display ranking commits nothing, so it deliberately needs no confirmation. Compare with selectDesignForDevelopment below, which is the actual commitment and always requires one. */
export async function overrideCommercialRank(actor: ActorContext, itemId: string, input: OverrideRankInput) {
  const item = await AiGarmentCommercialEvaluationItemRepository.findWithProjectOwner(itemId);
  if (!item || item.evaluation.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Commercial evaluation item not found.", { id: itemId });
  }

  const updated = await AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive(item.evaluationId, itemId, input.userRank);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_commercial_evaluation_items",
    recordId: itemId,
    action: "UPDATE",
    oldValues: { userRank: item.userRank },
    newValues: { userRank: input.userRank },
  });

  return updated;
}

/**
 * "SELECT DESIGN FOR DEVELOPMENT" — the one action that actually commits a
 * design, always behind explicit confirmation ("Final choice must always be
 * user-approved"). Recorded on the project itself, not a real Style Master
 * row (see the schema's own comment on AiGarmentProject.selectedDesignDirectionId
 * for why) — deliberately NOT a guarded "set once" write like productId/
 * sampleRequestId: a merchandiser revisiting this step to pick a different
 * design later is a legitimate correction, not a graduation to protect.
 *
 * "Move workflow to Apply Fabric" is read literally per source type: the
 * REFERENCE workflow has a real APPLY_FABRIC step right after SELECT_DESIGN;
 * the FABRIC workflow has none (fabric is already known for that path), so
 * the natural next step there is TECHNICAL_DEVELOPMENT instead. Both
 * transitions reuse the existing, unchanged saveWorkflowStep() — first to
 * mark SELECT_DESIGN itself completed, then to land on whichever step
 * genuinely follows it for this project's own source type.
 */
export async function selectDesignForDevelopment(actor: ActorContext, projectId: string, input: SelectDesignForDevelopmentInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a design for development requires explicit confirmation.");
  }

  const direction = await AiGarmentDesignDirectionRepository.findWithProjectOwner(input.designDirectionId);
  if (!direction || direction.project.companyId !== actor.companyId || direction.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Design direction not found in this project.", { id: input.designDirectionId });
  }
  if (direction.status !== "APPROVED") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Only an APPROVED design direction can be selected for development.");
  }

  const updated = await AiGarmentProjectRepository.update(projectId, {
    selectedDesignDirectionId: input.designDirectionId,
    selectedDesignAt: new Date(),
    selectedDesignByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { selectedDesignDirectionId: project.selectedDesignDirectionId },
    newValues: { selectedDesignDirectionId: input.designDirectionId },
  });

  await saveWorkflowStep(actor, projectId, { stepKey: "SELECT_DESIGN" });

  const steps = stepsForSourceType(project.sourceType);
  const selectDesignIndex = steps.findIndex((s) => s.key === "SELECT_DESIGN");
  const nextStep = steps[selectDesignIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, projectId, { stepKey: nextStep.key });
  }

  return updated;
}

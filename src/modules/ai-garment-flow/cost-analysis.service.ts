import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateCostAnalysis as callCostAnalysisAi,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/cost-analysis/generate";
import type { CostAnalysisContext, RealSampleCostingSnapshot } from "@/core/ai/cost-analysis/prompt";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { SampleVersionRepository } from "@/modules/sampling/sample.repository";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { describeFabricDetail } from "./fabric-detail-description";
import { stepsForSourceType } from "./ai-garment-project.schema";
import { saveWorkflowStep } from "./ai-garment-project.service";
import { AiGarmentCostAnalysisRunRepository, AiGarmentCostAnalysisRepository } from "./cost-analysis.repository";
import type { GenerateCostAnalysisInput } from "./cost-analysis.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6/7/8 use for their own larger/slower AI calls — a
// full cost-analysis response is a comparably-sized structured-text response.
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

/** Builds a short human-readable summary of the style's currently resolved BOM (if any) — never re-derives the real numbers, just describes them for the AI's own context. */
async function describeResolvedBom(companyId: string, productId: string | null): Promise<string | null> {
  if (!productId) return null;
  const { bom } = await getBomByProductId(companyId, productId);
  const currentVersion = bom?.versions.find((v) => v.versionNumber === bom.currentVersionNumber);
  if (!currentVersion || currentVersion.items.length === 0) return null;
  return currentVersion.items
    .map((item) => `${item.material.styleName} (${item.quantityPerUnit} ${item.uom.code}, +${item.wastagePercentage}% wastage)`)
    .join("; ");
}

/** Only included when a linked Sample Request's current version has genuinely been priced. */
async function describeRealSampleCosting(sampleRequestId: string | null): Promise<RealSampleCostingSnapshot | null> {
  if (!sampleRequestId) return null;
  const version = await SampleVersionRepository.findLatest(sampleRequestId);
  if (!version || version.finalTotal == null) return null;
  return {
    costSubtotal: Number(version.costSubtotal ?? 0),
    finalTotal: Number(version.finalTotal),
    marginPercent: Number(version.marginPercent ?? 0),
    commissionPercent: Number(version.commissionPercent ?? 0),
    freightAmount: Number(version.freightAmount ?? 0),
  };
}

/**
 * "Analyse Cost with AI" — needs the project's selected design direction
 * (same minimum gate every other AI Garment Flow process uses), and pulls
 * in whatever real context already exists (resolved BOM, fabric detail,
 * a linked Sample Request's own real costing) without requiring any of it —
 * this is advisory commentary, never a substitute for Sampling's real
 * costing engine.
 */
export async function generateCostAnalysis(actor: ActorContext, projectId: string, input: GenerateCostAnalysisInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Select a design for development first (Commercial Evaluation step) before analysing cost."
    );
  }

  const direction = await AiGarmentDesignDirectionRepository.findById(project.selectedDesignDirectionId);
  if (!direction) {
    throw new BusinessRuleError("NOT_FOUND", "Selected design direction not found.", { id: project.selectedDesignDirectionId });
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentCostAnalysisRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A cost analysis is already being generated for this project.", {
      runId: activeRun.id,
    });
  }

  const context: CostAnalysisContext = {
    designDirectionName: direction.designDirectionName,
    silhouette: direction.silhouette,
    garmentLength: direction.garmentLength,
    fit: direction.fit,
    neckline: direction.neckline,
    collar: direction.collar,
    sleeve: direction.sleeve,
    closure: direction.closure,
    pocket: direction.pocket,
    waistTreatment: direction.waistTreatment,
    hem: direction.hem,
    keyNewDesignFeature: direction.keyNewDesignFeature,
    suggestedFabricCharacter: direction.suggestedFabricCharacter,
    suggestedTrims: direction.suggestedTrims,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    bomSummary: await describeResolvedBom(actor.companyId, project.productId),
    targetMarket: project.targetMarket,
    targetSellingPrice: project.targetSellingPrice != null ? Number(project.targetSellingPrice) : null,
    currencyCode: project.currencyCode,
    orderQuantityEstimate: project.orderQuantityEstimate != null ? Number(project.orderQuantityEstimate) : null,
    realSampleCosting: await describeRealSampleCosting(project.sampleRequestId),
    additionalGuidance: input.additionalGuidance,
  };

  const run = await AiGarmentCostAnalysisRunRepository.create({
    companyId: actor.companyId,
    projectId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText: JSON.stringify(context),
    contextSnapshotJson: context as object,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await callCostAnalysisAi(context);

    const analysis = await AiGarmentCostAnalysisRepository.create({
      companyId: actor.companyId,
      projectId,
      runId: run.id,
      estimatedCostPerUnitLow: result.estimatedCostPerUnitLow,
      estimatedCostPerUnitHigh: result.estimatedCostPerUnitHigh,
      costBreakdownCommentary: result.costBreakdownCommentary,
      pricePositioningCommentary: result.pricePositioningCommentary,
      marginFeasibilityCommentary: result.marginFeasibilityCommentary,
      riskNotes: result.riskNotes,
      createdByUserId: actor.userId,
    });

    await AiGarmentCostAnalysisRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_cost_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { projectId, estimatedCostPerUnitLow: result.estimatedCostPerUnitLow, estimatedCostPerUnitHigh: result.estimatedCostPerUnitHigh },
    });

    return analysis;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentCostAnalysisRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/** Null (not an error) when no analysis has been run yet, matching every other AI Garment Flow single-result endpoint's own empty state. */
export async function getLatestCostAnalysis(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return AiGarmentCostAnalysisRepository.findLatestByProjectId(projectId);
}

/**
 * "Mark Costing Complete" — advances from COSTING into Process 10's own
 * SAMPLING_REVIEW step (the real handoff into Sampling's own state machine
 * and, eventually, Production). Requires a linked Sample Request whose
 * current version has actually been priced (SampleVersion.finalTotal set) —
 * the real, existing fact this module derives rather than duplicates, the
 * same "bom-mrp's own Bom.approvedVersionId" reasoning completeBomStep()
 * already established, just reading Sampling's costing state instead of
 * bom-mrp's approval state. Stamps the one-time "costing reviewed"
 * milestone (never re-stamped on a later re-run of the AI analysis — see
 * markCostingReviewed's own guard) and reuses the existing, unchanged
 * saveWorkflowStep() twice, the same completeBomStep()/
 * completeSamplingReviewStep() "advance to the next real step" pattern —
 * this is no longer this project's own terminal action (Process 10 added
 * real steps after COSTING; see the schema comment on
 * productionHandoffCompletedAt for the real terminal milestone).
 */
export async function completeCostingStep(actor: ActorContext, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  if (!project.sampleRequestId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Create a Sample Request from this project before marking costing complete.");
  }

  const version = await SampleVersionRepository.findLatest(project.sampleRequestId);
  if (!version || version.finalTotal == null) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Enter and calculate real costing on the linked Sample Request before marking this project's costing complete."
    );
  }

  await saveWorkflowStep(actor, projectId, { stepKey: "COSTING" });
  await AiGarmentProjectRepository.markCostingReviewed(projectId, actor.userId);

  const steps = stepsForSourceType(project.sourceType);
  const currentIndex = steps.findIndex((s) => s.key === "COSTING");
  const nextStep = steps[currentIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, projectId, { stepKey: nextStep.key });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { costingReviewed: true, finalTotal: Number(version.finalTotal) },
  });

  return AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateValueEngineering as callValueEngineeringAi,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/value-engineering/generate";
import type { BomLineForValueEngineering, ValueEngineeringContext } from "@/core/ai/value-engineering/prompt";
import { getBomByProductId } from "@/modules/bom-mrp/bom.service";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { describeFabricDetail } from "./fabric-detail-description";
import { AiGarmentCostAnalysisRepository } from "./cost-analysis.repository";
import { AiGarmentValueEngineeringRunRepository, AiGarmentValueEngineeringRepository } from "./value-engineering.repository";
import type { GenerateValueEngineeringInput } from "./value-engineering.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same window Process 2/5/6/7/8/9 use for their own larger/slower AI calls.
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
 * Builds the real BOM lines to review — never estimates a per-piece cost
 * when the material's own Product.unitCost isn't set, rendering "Not
 * Tracked" instead of a silently-undercounted number, the same discipline
 * this project's own Profitability reports already established for exactly
 * this gap (CLAUDE.md's Phase 9 section).
 */
function buildBomLinesForReview(
  items: Array<{
    material: { styleName: string; unitCost: unknown };
    color: { name: string } | null;
    quantityPerUnit: unknown;
    wastagePercentage: unknown;
    uom: { code: string };
  }>,
  currencyCode: string | null
): BomLineForValueEngineering[] {
  return items.map((item) => {
    const unitCost = item.material.unitCost != null ? Number(item.material.unitCost) : null;
    const qty = Number(item.quantityPerUnit);
    const wastage = Number(item.wastagePercentage);
    const costPerPieceContribution = unitCost != null ? unitCost * qty * (1 + wastage / 100) : null;
    return {
      materialDescription: `${item.material.styleName}${item.color ? ` (${item.color.name})` : ""}`,
      quantityPerUnit: qty,
      uomCode: item.uom.code,
      wastagePercentage: wastage,
      costPerPieceContribution,
      currencyCode,
    };
  });
}

/**
 * "ANALYSE FOR VALUE ENGINEERING" — unlike every other AI Garment Flow
 * process, this one genuinely REQUIRES the real, graduated Style's approved
 * BOM to already exist (checked directly here, not just relying on any
 * step gate, matching Process 2/8/9's own "the service checks the real
 * upstream fact itself" discipline) — there is nothing to review without
 * one, and this process never suggests materials from scratch the way BOM
 * Suggestion does.
 */
export async function generateValueEngineering(actor: ActorContext, projectId: string, input: GenerateValueEngineeringInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.productId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Convert this project to a Style first (Technical Development step).");
  }
  if (!project.selectedDesignDirectionId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Select a design for development first (Commercial Evaluation step).");
  }

  const direction = await AiGarmentDesignDirectionRepository.findById(project.selectedDesignDirectionId);
  if (!direction) {
    throw new BusinessRuleError("NOT_FOUND", "Selected design direction not found.", { id: project.selectedDesignDirectionId });
  }

  const { bom } = await getBomByProductId(actor.companyId, project.productId);
  if (!bom || !bom.approvedVersionId || !bom.approvedVersion) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Approve this style's BOM in the BOM editor before running Value Engineering.");
  }
  if (bom.approvedVersion.items.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This style's approved BOM has no lines to review.");
  }

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentValueEngineeringRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A value engineering review is already in progress for this project.", {
      runId: activeRun.id,
    });
  }

  const latestCostAnalysis = await AiGarmentCostAnalysisRepository.findLatestByProjectId(projectId);

  const context: ValueEngineeringContext = {
    designDirectionName: direction.designDirectionName,
    silhouette: direction.silhouette,
    garmentLength: direction.garmentLength,
    fit: direction.fit,
    neckline: direction.neckline,
    collar: direction.collar,
    sleeve: direction.sleeve,
    closure: direction.closure,
    waistTreatment: direction.waistTreatment,
    hem: direction.hem,
    fabricDescription: describeFabricDetail(project.fabricDetail),
    bomLines: buildBomLinesForReview(bom.approvedVersion.items, project.currencyCode),
    costAnalysisSummary: latestCostAnalysis?.costBreakdownCommentary ?? null,
    additionalGuidance: input.additionalGuidance,
  };

  const run = await AiGarmentValueEngineeringRunRepository.create({
    companyId: actor.companyId,
    projectId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    promptText: JSON.stringify(context),
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await callValueEngineeringAi(context);

    const analysis = await AiGarmentValueEngineeringRepository.create(
      {
        companyId: actor.companyId,
        projectId,
        runId: run.id,
        overallSummary: result.data.overallSummary,
        createdByUserId: actor.userId,
      },
      result.data.suggestions.map((s, index) => ({
        materialDescription: s.materialDescription,
        suggestedChange: s.suggestedChange,
        costImpactDirection: s.costImpactDirection,
        qualityRiskNotes: s.qualityRiskNotes,
        reasoning: s.reasoning,
        sortOrder: index,
      }))
    );

    await AiGarmentValueEngineeringRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_value_engineering_analyses",
      recordId: analysis.id,
      action: "CREATE",
      newValues: { projectId, suggestionCount: analysis.suggestions.length },
    });

    return analysis;
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentValueEngineeringRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/** Null (not an error) when no review has been run yet, matching every other AI Garment Flow single-result endpoint's own empty state. */
export async function getLatestValueEngineering(companyId: string, projectId: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  return AiGarmentValueEngineeringRepository.findLatestByProjectId(projectId);
}

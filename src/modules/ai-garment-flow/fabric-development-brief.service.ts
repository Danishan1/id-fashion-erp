import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import {
  generateFabricDevelopmentBrief,
  regenerateFabricDesignDirection as aiRegenerateFabricDesignDirection,
  AiConfigMissingError,
  AiInvalidResponseError,
  AiServiceError,
  PROMPT_VERSION,
} from "@/core/ai/fabric-development-brief/generate";
import type { FabricDevelopmentBriefContext, SuitableProductTypeForPrompt } from "@/core/ai/fabric-development-brief/prompt";
import { FABRIC_FEATURE_REGISTRY } from "@/core/ai/fabric-analysis/feature-registry";
import type { Prisma } from "@prisma/client";
import { AiGarmentProjectRepository } from "./ai-garment-project.repository";
import { AiGarmentFabricAnalysisRepository } from "./fabric-analysis.repository";
import { AiGarmentProductSuitabilityRepository } from "./product-suitability.repository";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import { AiGarmentFabricDevelopmentRunRepository } from "./fabric-development-brief.repository";
import { directionToRow } from "./design-direction-row";
import type { CreateFabricDevelopmentBriefInput } from "./fabric-development-brief.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

// Same "longer window for a bigger batch" reasoning already used for
// Process 2's own Development Brief run.
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

type FabricContextOverrides = Omit<CreateFabricDevelopmentBriefInput, "directionCount"> & { directionCount: number };

/**
 * Resolves the project + approved Fabric Analysis + approved Product
 * Suitability (filtered to HIGHLY_SUITABLE/SUITABLE only) into the AI
 * prompt's context — mirrors development-brief.service.ts's own
 * buildContext() exactly, including re-verifying both analyses are
 * genuinely APPROVED on every call (not just relying on
 * saveWorkflowStep()'s own gate), so both create AND regenerate always
 * build from the freshest approved data, never a stale snapshot.
 * Exported so development-brief.service.ts's regenerateDesignDirection can
 * reuse it for a FABRIC-sourced direction without duplicating this logic.
 */
export async function buildFabricContext(
  companyId: string,
  projectId: string,
  overrides: FabricContextOverrides
): Promise<{
  context: FabricDevelopmentBriefContext;
  fabricAnalysisId: string;
  productSuitabilityId: string;
  contextSnapshot: Record<string, unknown>;
}> {
  const project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });

  const fabricAnalysis = await AiGarmentFabricAnalysisRepository.findByProjectId(projectId);
  if (!fabricAnalysis || fabricAnalysis.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "The Fabric Analysis must be approved before creating a Fabric Development Brief."
    );
  }

  const suitability = await AiGarmentProductSuitabilityRepository.findByProjectId(projectId);
  if (!suitability || suitability.status !== "APPROVED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "The Product Suitability assessment must be approved before creating a Fabric Development Brief."
    );
  }

  const suitableProductTypes: SuitableProductTypeForPrompt[] = suitability.items
    .filter((i) => i.approvedRating === "HIGHLY_SUITABLE" || i.approvedRating === "SUITABLE")
    .map((i) => ({
      name: i.productType.name,
      rating: i.approvedRating as "HIGHLY_SUITABLE" | "SUITABLE",
      reasoning: i.aiReasoning,
    }));
  if (suitableProductTypes.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "No garment type was rated Highly Suitable or Suitable for this fabric — review the Product Suitability assessment before creating a Fabric Development Brief."
    );
  }

  const fabricObservations = fabricAnalysis.observations
    .map((o) => {
      const feature = FABRIC_FEATURE_REGISTRY.find((f) => f.key === o.featureKey);
      return feature ? { label: feature.label, value: o.approvedObservation } : null;
    })
    .filter((o): o is { label: string; value: string } => o !== null);

  let seasonName: string | null = null;
  if (overrides.seasonId) {
    const season = await GarmentAttributeRepository.season.findFirst({ where: { id: overrides.seasonId, companyId } });
    if (!season) throw new BusinessRuleError("NOT_FOUND", "Season not found.", { id: overrides.seasonId });
    seasonName = season.name;
  } else if (project.season) {
    seasonName = project.season.name;
  }

  let buyerName: string | null = null;
  if (overrides.buyerId) {
    const customer = project.customerId ? await CustomerRepository.findByIdWithBuyers(companyId, project.customerId) : null;
    const buyer = customer?.buyers.find((b) => b.id === overrides.buyerId);
    if (!buyer) throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: overrides.buyerId });
    buyerName = buyer.name;
  } else if (project.buyer) {
    buyerName = project.buyer.name;
  }

  const targetMarket = overrides.targetMarket || project.targetMarket || null;
  const targetCustomerProfile = overrides.targetCustomerProfile || project.targetCustomerProfile || null;
  const targetSellingPrice = overrides.targetSellingPrice ?? (project.targetSellingPrice ? Number(project.targetSellingPrice) : null);
  const currencyCode = overrides.currencyCode || project.currencyCode || null;
  const factoryCapabilities = overrides.factoryCapabilities || null;

  const context: FabricDevelopmentBriefContext = {
    directionCount: overrides.directionCount,
    designBalance: overrides.designBalance,
    targetMarket,
    targetCustomerProfile,
    season: seasonName,
    targetSellingPrice,
    currencyCode,
    factoryCapabilities,
    buyer: buyerName,
    fabricSummary: fabricAnalysis.fabricSummary ?? "",
    fabricObservations,
    suitableProductTypes,
  };

  const contextSnapshot = {
    targetMarket,
    targetCustomerProfile,
    season: seasonName,
    targetSellingPrice,
    currencyCode,
    factoryCapabilities,
    buyer: buyerName,
  };

  return { context, fabricAnalysisId: fabricAnalysis.id, productSuitabilityId: suitability.id, contextSnapshot };
}

export async function createFabricDevelopmentBrief(
  actor: ActorContext,
  projectId: string,
  input: CreateFabricDevelopmentBriefInput
) {
  const { context, fabricAnalysisId, productSuitabilityId, contextSnapshot } = await buildFabricContext(
    actor.companyId,
    projectId,
    input
  );

  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const activeRun = await AiGarmentFabricDevelopmentRunRepository.findActiveSince(projectId, freshSince);
  if (activeRun) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A fabric development brief is already being generated for this project.", {
      runId: activeRun.id,
    });
  }

  const run = await AiGarmentFabricDevelopmentRunRepository.create({
    companyId: actor.companyId,
    projectId,
    fabricAnalysisId,
    productSuitabilityId,
    provider: "anthropic",
    model: process.env.ANTHROPIC_DEFAULT_MODEL || "claude-sonnet-5",
    promptVersion: PROMPT_VERSION,
    requestedDirectionCount: input.directionCount,
    designBalance: input.designBalance,
    contextSnapshotJson: contextSnapshot as Prisma.InputJsonValue,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await generateFabricDevelopmentBrief(context);

    const rows = result.directions.map((d) =>
      directionToRow(d, {
        companyId: actor.companyId,
        projectId,
        fabricDevelopmentRunId: run.id,
        createdByUserId: actor.userId,
        aiRawJson: d,
      })
    );
    await AiGarmentDesignDirectionRepository.createMany(rows);
    await AiGarmentDesignDirectionRepository.recomputeRecommendations(projectId);
    await AiGarmentFabricDevelopmentRunRepository.markSuccess(run.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_garment_fabric_development_runs",
      recordId: run.id,
      action: "CREATE",
      newValues: { directionCount: rows.length, designBalance: input.designBalance },
    });

    return AiGarmentDesignDirectionRepository.findByProjectId(projectId);
  } catch (err) {
    const category = errorCategoryFor(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiGarmentFabricDevelopmentRunRepository.markFailed(run.id, category, message);
    mapAiError(err);
  }
}

/**
 * Rebuilds the freshest context for regenerating one FABRIC-sourced
 * direction, from the originating run's own snapshot — re-verifying both
 * analyses are still APPROVED, exactly like createFabricDevelopmentBrief
 * does. Deliberately does NOT also call the AI itself (unlike a bundled
 * "rebuild + regenerate" helper would) — development-brief.service.ts's own
 * regenerateDesignDirection() needs to call the AI step inside its own
 * try/catch and this context-build step outside it, exactly mirroring the
 * REFERENCE-path's existing error-handling boundary (a stale-analysis
 * BusinessRuleError from context-building propagates directly; only the AI
 * call itself is mapped via mapAiError). Splitting the two steps here keeps
 * that boundary identical for both branches rather than silently narrowing
 * it for one of them.
 */
export async function buildFabricContextForRegenerate(companyId: string, fabricDevelopmentRunId: string) {
  const run = await AiGarmentFabricDevelopmentRunRepository.findById(fabricDevelopmentRunId);
  if (!run) throw new BusinessRuleError("NOT_FOUND", "The originating fabric development run could not be found.");

  const snapshot = run.contextSnapshotJson as Record<string, unknown>;
  return buildFabricContext(companyId, run.projectId, {
    targetMarket: snapshot.targetMarket as string | undefined,
    targetCustomerProfile: snapshot.targetCustomerProfile as string | undefined,
    factoryCapabilities: snapshot.factoryCapabilities as string | undefined,
    targetSellingPrice: snapshot.targetSellingPrice as number | undefined,
    currencyCode: snapshot.currencyCode as string | undefined,
    directionCount: 1,
    designBalance: run.designBalance,
  });
}

export { aiRegenerateFabricDesignDirection as regenerateFabricDesignDirectionAi };

import type { Prisma } from "@prisma/client";
import type { DesignDirectionOutput } from "@/core/ai/development-brief/schema";

/**
 * Extracted out of development-brief.service.ts so fabric-development-brief.
 * service.ts can reuse the identical mapping (both processes produce the
 * exact same 24-field DesignDirectionOutput shape into the exact same
 * AiGarmentDesignDirection table — only which run created a row differs).
 * Kept in this small, neutral, side-effect-free file rather than exported
 * from either service file directly, so neither service ever needs to
 * import from the other (avoiding a circular dependency between them).
 *
 * `common` takes exactly one of developmentBriefRunId/fabricDevelopmentRunId
 * — the caller's own responsibility to supply exactly one, matching the
 * DB's own ai_garment_design_directions_exactly_one_source_check CHECK
 * constraint.
 */
export function directionToRow(
  d: DesignDirectionOutput,
  common: {
    companyId: string;
    projectId: string;
    developmentBriefRunId?: string;
    fabricDevelopmentRunId?: string;
    createdByUserId: string;
    aiRawJson: Prisma.InputJsonValue;
  }
) {
  return {
    ...common,
    designDirectionName: d.designDirectionName,
    commercialClassification: d.commercialClassification,
    targetConsumer: d.targetConsumer,
    silhouette: d.silhouette,
    garmentLength: d.garmentLength,
    fit: d.fit,
    neckline: d.neckline,
    collar: d.collar,
    sleeve: d.sleeve,
    shoulderConstruction: d.shoulderConstruction,
    frontConstruction: d.frontConstruction,
    backConstruction: d.backConstruction,
    closure: d.closure,
    pocket: d.pocket,
    waistTreatment: d.waistTreatment,
    hem: d.hem,
    keyNewDesignFeature: d.keyNewDesignFeature,
    suggestedFabricCharacter: d.suggestedFabricCharacter,
    suggestedTrims: d.suggestedTrims,
    productionComplexity: d.productionComplexity,
    expectedFabricConsumption: d.expectedFabricConsumption,
    targetPriceCompatibilityLevel: d.targetPriceCompatibilityLevel,
    commercialRationale: d.commercialRationale,
    manufacturingRisk: d.manufacturingRisk,
    differentiationFromReference: d.differentiationFromReference,
    commercialPotentialScore: d.scores.commercialPotential,
    buyerFitScore: d.scores.buyerFit,
    manufacturingEaseScore: d.scores.manufacturingEase,
    targetPriceCompatibilityScore: d.scores.targetPriceCompatibility,
    fabricEfficiencyScore: d.scores.fabricEfficiency,
    designFreshnessScore: d.scores.designFreshness,
    overallScore: d.overallScore,
  };
}

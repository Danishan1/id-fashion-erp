import { z } from "zod";

// These enum string values match the Prisma AiGarmentCommercialRank enum
// directly — no normalization/mapping step needed between "what the AI
// returned" and "what gets persisted" (same convention already established
// by reference-analysis/schema.ts's CONFIDENCE_VALUES).
export const COMMERCIAL_RANK_VALUES = ["FIRST_CHOICE", "SECOND_CHOICE", "THIRD_CHOICE", "NOT_RANKED"] as const;

const scoreField = () => z.number().int().min(1).max(10);

const evaluationItemSchema = z.object({
  targetCustomerFitScore: scoreField(),
  buyerFitScore: scoreField(),
  fabricSuitabilityScore: scoreField(),
  commercialAppealScore: scoreField(),
  manufacturingSimplicityScore: scoreField(),
  fabricConsumptionEfficiencyScore: scoreField(),
  patternMakingComplexityScore: scoreField(),
  sewingComplexityScore: scoreField(),
  trimComplexityScore: scoreField(),
  targetPriceCompatibilityScore: scoreField(),
  bulkProductionScalabilityScore: scoreField(),
  designFreshnessScore: scoreField(),
  strengths: z.string().min(1),
  weaknesses: z.string().min(1),
  manufacturingRisks: z.string().min(1),
  potentialCostRisks: z.string().min(1),
  suggestedImprovement: z.string().min(1),
  rank: z.enum(COMMERCIAL_RANK_VALUES),
});
export type CommercialEvaluationItemOutput = z.infer<typeof evaluationItemSchema>;

export interface CommercialEvaluationResponse {
  items: CommercialEvaluationItemOutput[];
  overallRankingRationale: string;
}

/**
 * Built per-request since the array length depends on how many designs
 * (2-8) were actually selected for comparison — the model must return
 * exactly one evaluation item per design, in the same order the designs
 * were presented (see prompt.ts), never asked to name which design an item
 * is for (avoids any risk of the model inventing or misreporting an id).
 */
export function buildCommercialEvaluationResponseSchema(designCount: number) {
  return z
    .object({
      items: z.array(evaluationItemSchema).length(designCount),
      overallRankingRationale: z.string().min(1),
    })
    .superRefine((data, ctx) => {
      const ranks = data.items.map((i) => i.rank);
      const countOf = (r: (typeof COMMERCIAL_RANK_VALUES)[number]) => ranks.filter((x) => x === r).length;

      if (countOf("FIRST_CHOICE") !== 1) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Exactly one design must be ranked FIRST_CHOICE." });
      }
      if (designCount >= 2 && countOf("SECOND_CHOICE") !== 1) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "Exactly one design must be ranked SECOND_CHOICE." });
      }
      if (designCount >= 3) {
        if (countOf("THIRD_CHOICE") !== 1) {
          ctx.addIssue({ code: "custom", path: ["items"], message: "Exactly one design must be ranked THIRD_CHOICE." });
        }
      } else if (countOf("THIRD_CHOICE") !== 0) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "THIRD_CHOICE is only valid when comparing at least 3 designs." });
      }
    });
}

/** Adapts buildCommercialEvaluationResponseSchema to the `validate` callback requestStructuredTextOutput() expects. */
export function validateCommercialEvaluationResponse(
  designCount: number,
  input: unknown
): { success: true; data: CommercialEvaluationResponse } | { success: false; error: string } {
  const result = buildCommercialEvaluationResponseSchema(designCount).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

/**
 * The spec's own fixed weighted formula — Commercial Appeal/Buyer Fit/Target
 * Price Compatibility each 15%, Manufacturing Simplicity/Fabric Suitability/
 * Consumption Efficiency/Scalability/Design Freshness each 10%, and a 5%
 * "Other Technical Factors" bucket. The spec names 12 criteria but only
 * gives explicit weights for 8 of them — the remaining 4 (Target Customer
 * Fit, Pattern Making Complexity, Sewing Complexity, Trim Complexity) are
 * deliberately read as together comprising "Other Technical Factors": their
 * average (each already on the same 1-10, higher-is-better scale — see the
 * prompt's own instruction that a 10 on a "complexity" criterion means LOW
 * complexity, i.e. commercially favorable) is weighted 5%. Max score is
 * exactly 100 (15+15+15+10+10+10+10+10+5). Always computed server-side —
 * never trusted from the AI's own arithmetic, matching this project's
 * "never trust a computed total from the client/model" discipline used
 * everywhere else (Sales Order/Journal/MRP totals, etc.).
 */
export function computeCommercialDevelopmentScore(item: CommercialEvaluationItemOutput): number {
  const otherTechnicalFactorsAvg =
    (item.targetCustomerFitScore + item.patternMakingComplexityScore + item.sewingComplexityScore + item.trimComplexityScore) / 4;

  const raw =
    item.commercialAppealScore * 1.5 +
    item.buyerFitScore * 1.5 +
    item.targetPriceCompatibilityScore * 1.5 +
    item.manufacturingSimplicityScore * 1.0 +
    item.fabricSuitabilityScore * 1.0 +
    item.fabricConsumptionEfficiencyScore * 1.0 +
    item.bulkProductionScalabilityScore * 1.0 +
    item.designFreshnessScore * 1.0 +
    otherTechnicalFactorsAvg * 0.5;

  return Math.round(raw);
}

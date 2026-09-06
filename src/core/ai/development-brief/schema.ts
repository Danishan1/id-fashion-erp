import { z } from "zod";

export const COMMERCIAL_CLASSIFICATION_VALUES = ["SAFE_COMMERCIAL", "BALANCED", "FASHION_FORWARD"] as const;
export const RATING_LEVEL_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;
export const DESIGN_BALANCE_VALUES = ["COMMERCIAL_LOWER_RISK", "BALANCED", "FASHION_FORWARD"] as const;
export const DIRECTION_COUNT_VALUES = [3, 6, 9] as const;

const score10 = z.number().int().min(0).max(10);
const score100 = z.number().int().min(0).max(100);

export const designDirectionSchema = z.object({
  designDirectionName: z.string().min(1),
  commercialClassification: z.enum(COMMERCIAL_CLASSIFICATION_VALUES),
  targetConsumer: z.string().min(1),
  silhouette: z.string().min(1),
  garmentLength: z.string().min(1),
  fit: z.string().min(1),
  neckline: z.string().min(1),
  collar: z.string().min(1),
  sleeve: z.string().min(1),
  shoulderConstruction: z.string().min(1),
  frontConstruction: z.string().min(1),
  backConstruction: z.string().min(1),
  closure: z.string().min(1),
  pocket: z.string().min(1),
  waistTreatment: z.string().min(1),
  hem: z.string().min(1),
  keyNewDesignFeature: z.string().min(1),
  suggestedFabricCharacter: z.string().min(1),
  suggestedTrims: z.string().min(1),
  productionComplexity: z.enum(RATING_LEVEL_VALUES),
  expectedFabricConsumption: z.enum(RATING_LEVEL_VALUES),
  targetPriceCompatibilityLevel: z.enum(RATING_LEVEL_VALUES),
  commercialRationale: z.string().min(1),
  manufacturingRisk: z.string().min(1),
  differentiationFromReference: z.string().min(1),
  scores: z.object({
    commercialPotential: score10,
    buyerFit: score10,
    manufacturingEase: score10,
    targetPriceCompatibility: score10,
    fabricEfficiency: score10,
    designFreshness: score10,
  }),
  overallScore: score100,
});
export type DesignDirectionOutput = z.infer<typeof designDirectionSchema>;

export const developmentBriefResponseSchema = z.object({
  designDirections: z.array(designDirectionSchema).min(1),
});
export type DevelopmentBriefResponse = z.infer<typeof developmentBriefResponseSchema>;

/**
 * `expectedCount` enforces the exact requested number of directions — the
 * tool schema itself can no longer express this (Anthropic's `strict: true`
 * tool mode rejects `minItems`/`maxItems` on an array node), so this is the
 * real gate; a mismatch surfaces as a validation error, triggering the
 * existing one-shot corrective retry in requestStructuredToolCall.
 */
export function validateDevelopmentBriefResponse(
  input: unknown,
  expectedCount?: number
): { success: true; data: DevelopmentBriefResponse } | { success: false; error: string } {
  const result = developmentBriefResponseSchema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      success: false,
      error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
    };
  }
  if (expectedCount !== undefined && result.data.designDirections.length !== expectedCount) {
    return {
      success: false,
      error: `designDirections: expected exactly ${expectedCount} design directions, got ${result.data.designDirections.length}.`,
    };
  }
  return { success: true, data: result.data };
}

/** Validates a response expected to contain exactly one design direction (Regenerate). */
export function validateSingleDesignDirectionResponse(
  input: unknown
): { success: true; data: DesignDirectionOutput } | { success: false; error: string } {
  const result = validateDevelopmentBriefResponse(input, 1);
  if (!result.success) return result;
  return { success: true, data: result.data.designDirections[0] };
}

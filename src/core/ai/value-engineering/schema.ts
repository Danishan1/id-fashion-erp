import { z } from "zod";

export const COST_IMPACT_DIRECTION_VALUES = ["LOWER", "SIMILAR", "HIGHER"] as const;

const valueEngineeringSuggestionSchema = z.object({
  materialDescription: z.string().min(1),
  suggestedChange: z.string().min(1),
  costImpactDirection: z.enum(COST_IMPACT_DIRECTION_VALUES),
  qualityRiskNotes: z.string().min(1),
  reasoning: z.string().min(1),
});
export type ValueEngineeringSuggestionOutput = z.infer<typeof valueEngineeringSuggestionSchema>;

export interface ValueEngineeringResponse {
  overallSummary: string;
  suggestions: ValueEngineeringSuggestionOutput[];
}

/**
 * Unlike Process 5/8/9's exact-length arrays (one item per a fixed,
 * caller-supplied list), the real suggestion count depends entirely on how
 * many genuine cost-reduction opportunities the model actually finds in
 * this BOM — bounded to a sane range, same shape as BOM Suggestion's own
 * items array, rather than a fixed count. Zero suggestions is a valid,
 * honest response (a lean, already-efficient BOM), not an error.
 */
const valueEngineeringResponseSchema = z.object({
  overallSummary: z.string().min(1),
  suggestions: z.array(valueEngineeringSuggestionSchema).min(0).max(15),
});

export function validateValueEngineeringResponse(
  input: unknown
): { success: true; data: ValueEngineeringResponse } | { success: false; error: string } {
  const result = valueEngineeringResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

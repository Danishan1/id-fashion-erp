import { z } from "zod";

const costAnalysisResponseSchema = z
  .object({
    estimatedCostPerUnitLow: z.number().positive(),
    estimatedCostPerUnitHigh: z.number().positive(),
    costBreakdownCommentary: z.string().min(1),
    pricePositioningCommentary: z.string().min(1),
    marginFeasibilityCommentary: z.string().min(1),
    riskNotes: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.estimatedCostPerUnitHigh < data.estimatedCostPerUnitLow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["estimatedCostPerUnitHigh"],
        message: "estimatedCostPerUnitHigh must be greater than or equal to estimatedCostPerUnitLow.",
      });
    }
  });

export type CostAnalysisResponse = z.infer<typeof costAnalysisResponseSchema>;

export function validateCostAnalysisResponse(
  input: unknown
): { success: true; data: CostAnalysisResponse } | { success: false; error: string } {
  const result = costAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

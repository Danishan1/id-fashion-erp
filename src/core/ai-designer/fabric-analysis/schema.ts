import { z } from "zod";

/**
 * Deliberately simpler than the sibling module's own fabric-analysis schema
 * — the brief explicitly asked for a minimal interface with NO confidence
 * scores or metadata, so every field here is a plain string (the AI is still
 * instructed, in the hidden prompt, to be honest about uncertainty within the
 * text itself — just not exposed as a separate structured field/UI badge).
 * Exactly the 12 fields named in the brief, in that order.
 */
export const fabricAnalysisResponseSchema = z.object({
  fabricName: z.string().min(1),
  composition: z.string().min(1),
  gsm: z.string().min(1),
  width: z.string().min(1),
  weave: z.string().min(1),
  stretch: z.string().min(1),
  opacity: z.string().min(1),
  texture: z.string().min(1),
  patternType: z.string().min(1),
  printType: z.string().min(1),
  suitableSeason: z.string().min(1),
  recommendedGarments: z.string().min(1),
});

export type FabricAnalysisResponse = z.infer<typeof fabricAnalysisResponseSchema>;

/** Adapts fabricAnalysisResponseSchema to the `validate` callback requestStructuredVisionOutput() expects. */
export function validateFabricAnalysisResponse(
  input: unknown
): { success: true; data: FabricAnalysisResponse } | { success: false; error: string } {
  const result = fabricAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

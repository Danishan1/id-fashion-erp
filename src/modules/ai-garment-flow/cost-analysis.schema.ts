import { z } from "zod";

export const generateCostAnalysisSchema = z.object({
  additionalGuidance: z.string().max(1000).optional(),
});
export type GenerateCostAnalysisInput = z.infer<typeof generateCostAnalysisSchema>;

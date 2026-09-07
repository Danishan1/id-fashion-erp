import { z } from "zod";

export const createTechnicalFlatSchema = z.object({
  additionalNotes: z.string().max(1000).optional(),
});
export type CreateTechnicalFlatInput = z.infer<typeof createTechnicalFlatSchema>;

export const technicalFlatDecisionSchema = z.object({
  decision: z.literal("APPROVE"),
  /** Required — every decision-style action in this codebase requires explicit confirmation before committing. */
  confirmed: z.boolean(),
});
export type TechnicalFlatDecisionInput = z.infer<typeof technicalFlatDecisionSchema>;

export const approveTechnicalFlatSchema = z.object({
  technicalFlatId: z.string().uuid(),
  /** Required — "APPROVE TECHNICAL FLAT" is the final, workflow-advancing action. */
  confirmed: z.boolean(),
});
export type ApproveTechnicalFlatInput = z.infer<typeof approveTechnicalFlatSchema>;

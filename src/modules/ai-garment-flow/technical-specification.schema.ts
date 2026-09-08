import { z } from "zod";

export const createTechnicalSpecificationSchema = z.object({
  additionalNotes: z.string().max(1000).optional(),
});
export type CreateTechnicalSpecificationInput = z.infer<typeof createTechnicalSpecificationSchema>;

export const technicalSpecificationDecisionSchema = z.object({
  decision: z.literal("APPROVE"),
  /** Required — every decision-style action in this codebase requires explicit confirmation before committing. */
  confirmed: z.boolean(),
});
export type TechnicalSpecificationDecisionInput = z.infer<typeof technicalSpecificationDecisionSchema>;

export const approveTechnicalSpecificationSchema = z.object({
  technicalSpecificationId: z.string().uuid(),
  /** Required — "APPROVE TECHNICAL SPECIFICATION" is the final, workflow-advancing action. */
  confirmed: z.boolean(),
});
export type ApproveTechnicalSpecificationInput = z.infer<typeof approveTechnicalSpecificationSchema>;

export const updateMeasurementValueSchema = z.object({
  approvedValueText: z.string().min(1).max(100),
});
export type UpdateMeasurementValueInput = z.infer<typeof updateMeasurementValueSchema>;

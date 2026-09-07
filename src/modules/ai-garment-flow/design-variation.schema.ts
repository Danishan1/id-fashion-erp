import { z } from "zod";
import { DESIGN_FEATURE_VALUES } from "@/core/ai/design-variation/feature-registry";

export const createDesignVariationSchema = z.object({
  featureKey: z.enum(DESIGN_FEATURE_VALUES),
  currentFeatureValue: z.string().min(1).max(500),
  newRequirement: z.string().min(1).max(1000),
  additionalInstructions: z.string().max(1000).optional().or(z.literal("")),
});
export type CreateDesignVariationInput = z.infer<typeof createDesignVariationSchema>;

export const designVariationDecisionSchema = z.object({
  decision: z.enum(["SELECT", "KEEP_ORIGINAL"]),
  /** Required only for SELECT — same "require confirmation" contract as visual-generation's own imageDecisionSchema. */
  confirmed: z.boolean().optional(),
});
export type DesignVariationDecisionInput = z.infer<typeof designVariationDecisionSchema>;

import { z } from "zod";
import { SUITABILITY_RATING_VALUES } from "@/core/ai/product-suitability/schema";

export const updateSuitabilityItemSchema = z.object({
  approvedRating: z.enum(SUITABILITY_RATING_VALUES),
});
export type UpdateSuitabilityItemInput = z.infer<typeof updateSuitabilityItemSchema>;

import { z } from "zod";
import { bomItemSchema } from "@/modules/bom-mrp/bom.schema";

export const generateBomSuggestionsSchema = z.object({
  additionalGuidance: z.string().max(1000).optional(),
});
export type GenerateBomSuggestionsInput = z.infer<typeof generateBomSuggestionsSchema>;

/**
 * Resolving a suggestion into a real BomItem needs exactly the same shape
 * bom-mrp's own BOM editor already collects for one line — reused directly
 * rather than redefined, so the two can never silently drift apart.
 */
export const resolveBomSuggestionSchema = bomItemSchema;
export type ResolveBomSuggestionInput = z.infer<typeof resolveBomSuggestionSchema>;

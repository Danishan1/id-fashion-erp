import { z } from "zod";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

const bomSuggestionItemSchema = z.object({
  materialDescription: z.string().min(1),
  materialCategory: z.enum(MATERIAL_CATEGORIES),
  suggestedQuantityPerUnit: z.number().positive(),
  // Free text, e.g. "MTR"/"PCS"/"SET" — the AI has no knowledge of this
  // company's real UnitOfMeasure rows/ids, so a suggestion can only ever
  // describe a unit in words; a real uomId is chosen by the user when they
  // resolve a suggestion into an actual BomItem (see bom-suggestion.service.ts).
  suggestedUom: z.string().min(1),
  suggestedWastagePercentage: z.number().min(0).max(100),
  colorNote: z.string().optional(),
  reasoning: z.string().min(1),
});
export type BomSuggestionItemOutput = z.infer<typeof bomSuggestionItemSchema>;

export interface BomSuggestionResponse {
  items: BomSuggestionItemOutput[];
}

/**
 * Unlike Commercial Evaluation's exact-length array (one item per design the
 * user picked), a draft BOM's real line count depends entirely on how
 * complex the garment actually is — bounded to a sane range rather than a
 * fixed count.
 */
const bomSuggestionResponseSchema = z.object({
  items: z.array(bomSuggestionItemSchema).min(1).max(20),
});

export function validateBomSuggestionResponse(
  input: unknown
): { success: true; data: BomSuggestionResponse } | { success: false; error: string } {
  const result = bomSuggestionResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

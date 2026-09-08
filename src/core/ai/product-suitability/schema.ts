import { z } from "zod";

// Matches the Prisma AiGarmentSuitabilityRating enum directly — no
// normalization step needed between "what the AI returned" and "what gets
// persisted," same convention as every other AI Garment Flow enum.
export const SUITABILITY_RATING_VALUES = ["HIGHLY_SUITABLE", "SUITABLE", "MARGINALLY_SUITABLE", "NOT_SUITABLE"] as const;

const suitabilityItemSchema = z.object({
  rating: z.enum(SUITABILITY_RATING_VALUES),
  reasoning: z.string().min(1),
});
export type SuitabilityItemOutput = z.infer<typeof suitabilityItemSchema>;

export interface ProductSuitabilityResponse {
  items: SuitabilityItemOutput[];
  overallSummary: string;
}

/**
 * Built per-request since the array length depends on how many active
 * ProductType rows the company actually has — the model must return exactly
 * one assessment per product type, in the same order they were presented
 * (see prompt.ts), never asked to name which type an item is for (the same
 * "never give the model a real id it could mishandle" discipline already
 * used by Process 5's own positional design comparison).
 */
export function buildProductSuitabilityResponseSchema(productTypeCount: number) {
  return z.object({
    items: z.array(suitabilityItemSchema).length(productTypeCount),
    overallSummary: z.string().min(1),
  });
}

/** Adapts buildProductSuitabilityResponseSchema to the `validate` callback requestStructuredTextOutput() expects. */
export function validateProductSuitabilityResponse(
  productTypeCount: number,
  input: unknown
): { success: true; data: ProductSuitabilityResponse } | { success: false; error: string } {
  const result = buildProductSuitabilityResponseSchema(productTypeCount).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

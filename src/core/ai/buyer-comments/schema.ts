import { z } from "zod";

export const BUYER_COMMENT_CATEGORY_VALUES = ["FIT", "CONSTRUCTION", "FABRIC", "COLOR", "TRIM", "PRICING", "OTHER"] as const;

const buyerCommentCategorySummarySchema = z.object({
  category: z.enum(BUYER_COMMENT_CATEGORY_VALUES),
  summary: z.string().min(1),
  // A quoted/paraphrased excerpt of the real comment(s)/decision notes this
  // summary was drawn from — never fabricated, must be traceable to the
  // real source text supplied in the prompt.
  evidenceExcerpt: z.string().min(1),
});
export type BuyerCommentCategorySummaryOutput = z.infer<typeof buyerCommentCategorySummarySchema>;

export interface BuyerCommentsResponse {
  overallSummary: string;
  categories: BuyerCommentCategorySummaryOutput[];
}

/**
 * The real category count depends entirely on how many distinct topics the
 * buyer's own real feedback actually touches — bounded to the 7 known
 * categories (one summary per category at most), same "bounded, not fixed"
 * shape as Value Engineering's own suggestions array. Zero categories would
 * mean the real feedback existed but described nothing categorizable, which
 * the gate in the module-layer service (requiring at least one real comment
 * or decision note to exist before calling this at all) makes vanishingly
 * unlikely, but is still a valid, honest response if it ever happens.
 */
const buyerCommentsResponseSchema = z.object({
  overallSummary: z.string().min(1),
  categories: z.array(buyerCommentCategorySummarySchema).min(0).max(7),
});

export function validateBuyerCommentsResponse(
  input: unknown
): { success: true; data: BuyerCommentsResponse } | { success: false; error: string } {
  const result = buyerCommentsResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

import { z } from "zod";

// Matches ReplicateCompatibilityRating's Prisma enum names directly.
export const COMPATIBILITY_RATING_VALUES = ["COMPATIBLE", "MINOR_CONCERN", "INCOMPATIBLE"] as const;

const compatibilityItemSchema = z.object({
  // The subject's own 1-based ordinal, exactly as given to the model in the
  // prompt's "SUBJECT N: ..." list — NOT a real database id (the model never
  // sees one), just a self-consistency check so the response can be matched
  // back to the correct subject even if the model doesn't return items in
  // the exact order they were given. Validated below (buildCompatibility
  // CheckResponseSchema's superRefine) to cover 1..subjectCount exactly once
  // — this replaced a purely positional (array-index) zip-back, which had no
  // way to detect or explain a genuine count/order mismatch, the most likely
  // real cause of a live "AI returned an invalid structured response" error.
  subjectNumber: z.number().int().positive(),
  rating: z.enum(COMPATIBILITY_RATING_VALUES),
  reasoning: z.string().min(1),
  // A concrete, actionable next step for THIS subject — "no changes needed"
  // is a valid, expected answer for a COMPATIBLE rating; required (not
  // optional) so the UI never has to guess why a suggestion is missing.
  suggestion: z.string().min(1),
});
export type CompatibilityItemOutput = z.infer<typeof compatibilityItemSchema>;

export interface CompatibilityCheckResponse {
  items: CompatibilityItemOutput[];
  overallSummary: string;
  overallRating: (typeof COMPATIBILITY_RATING_VALUES)[number];
  overallSuggestion: string;
}

/**
 * Built per-request since the array length depends on how many subjects
 * (the fabric + each material line) are actually being assessed — the model
 * must return exactly one assessment per subject (see prompt.ts). The
 * superRefine below is the real completeness check: `.length(subjectCount)`
 * alone catches a wrong total count, but gives the corrective retry no clue
 * WHICH subject is missing/duplicated — checking subjectNumber coverage
 * explicitly produces a much more specific error message, which is fed
 * straight back to the model as its own corrective instruction (see
 * requestStructuredToolCall in anthropic.ts), making the retry far more
 * likely to actually succeed.
 */
export function buildCompatibilityCheckResponseSchema(subjectCount: number) {
  return z
    .object({
      items: z.array(compatibilityItemSchema).length(subjectCount),
      overallSummary: z.string().min(1),
      overallRating: z.enum(COMPATIBILITY_RATING_VALUES),
      overallSuggestion: z.string().min(1),
    })
    .superRefine((data, ctx) => {
      const seen = new Set<number>();
      for (const item of data.items) {
        if (item.subjectNumber < 1 || item.subjectNumber > subjectCount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items"],
            message: `subjectNumber ${item.subjectNumber} is out of range — every item's subjectNumber must be between 1 and ${subjectCount}.`,
          });
        } else if (seen.has(item.subjectNumber)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items"],
            message: `subjectNumber ${item.subjectNumber} appears more than once — each subject (1 to ${subjectCount}) must appear exactly once.`,
          });
        }
        seen.add(item.subjectNumber);
      }
      for (let n = 1; n <= subjectCount; n++) {
        if (!seen.has(n)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items"],
            message: `Missing an item for subjectNumber ${n} — every subject (1 to ${subjectCount}) must appear exactly once.`,
          });
        }
      }
    });
}

/** Adapts buildCompatibilityCheckResponseSchema to the `validate` callback requestStructuredTextOutput() expects. */
export function validateCompatibilityCheckResponse(
  subjectCount: number,
  input: unknown
): { success: true; data: CompatibilityCheckResponse } | { success: false; error: string } {
  const result = buildCompatibilityCheckResponseSchema(subjectCount).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

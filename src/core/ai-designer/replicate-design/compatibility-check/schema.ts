import { z } from "zod";

// Matches ReplicateCompatibilityRating's Prisma enum names directly.
export const COMPATIBILITY_RATING_VALUES = ["COMPATIBLE", "MINOR_CONCERN", "INCOMPATIBLE"] as const;

const compatibilityItemSchema = z.object({
  rating: z.enum(COMPATIBILITY_RATING_VALUES),
  reasoning: z.string().min(1),
});
export type CompatibilityItemOutput = z.infer<typeof compatibilityItemSchema>;

export interface CompatibilityCheckResponse {
  items: CompatibilityItemOutput[];
  overallSummary: string;
  overallRating: (typeof COMPATIBILITY_RATING_VALUES)[number];
}

/**
 * Built per-request since the array length depends on how many subjects
 * (the fabric + each material line) are actually being assessed — the model
 * must return exactly one assessment per subject, in the same order they
 * were presented (see prompt.ts), never asked to name which subject an item
 * is for — the same "never give the model a real id it could mishandle"
 * discipline already used by AI Garment Flow's Process 5/8/9.
 */
export function buildCompatibilityCheckResponseSchema(subjectCount: number) {
  return z.object({
    items: z.array(compatibilityItemSchema).length(subjectCount),
    overallSummary: z.string().min(1),
    overallRating: z.enum(COMPATIBILITY_RATING_VALUES),
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

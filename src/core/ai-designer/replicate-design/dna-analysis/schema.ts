import { z } from "zod";

/**
 * The confidence enum's string values match ReplicateAnalysisConfidence's
 * Prisma enum names directly, so no mapping step is needed between "what the
 * AI returned" and "what gets persisted" — same convention as
 * src/core/ai/reference-analysis/schema.ts.
 */
export const CONFIDENCE_VALUES = ["CONFIRMED_VISUALLY", "LIKELY_INFERRED", "NOT_DETERMINABLE"] as const;

const observationSchema = z.object({
  observation: z.string().min(1),
  confidence: z.enum(CONFIDENCE_VALUES),
});
export type ObservationOutput = z.infer<typeof observationSchema>;

/**
 * A lean ~14-field structural list — genuinely just what's needed to lock a
 * garment's silhouette/construction for Replicate Design, not the sibling
 * AI Garment Flow module's own richer 36-field reference analysis (which
 * this module deliberately never imports or duplicates, per its own
 * isolation rule). One row per key becomes a ReplicateDesignDnaObservation.
 */
export const FEATURE_KEYS = [
  "garmentCategory",
  "silhouette",
  "garmentLength",
  "fit",
  "neckline",
  "collar",
  "sleeveType",
  "sleeveLength",
  "shoulderConstruction",
  "closureType",
  "panelsAndSeams",
  "waistTreatment",
  "hemFinish",
  "keyConstructionDetails",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const dnaAnalysisResponseSchema = z.object({
  garmentCategory: observationSchema,
  silhouette: observationSchema,
  garmentLength: observationSchema,
  fit: observationSchema,
  neckline: observationSchema,
  collar: observationSchema,
  sleeveType: observationSchema,
  sleeveLength: observationSchema,
  shoulderConstruction: observationSchema,
  closureType: observationSchema,
  panelsAndSeams: observationSchema,
  waistTreatment: observationSchema,
  hemFinish: observationSchema,
  keyConstructionDetails: observationSchema,
  designDnaSummary: z.string().min(1),
});

export type DnaAnalysisResponse = z.infer<typeof dnaAnalysisResponseSchema>;

/** Adapts dnaAnalysisResponseSchema to the `validate` callback requestStructuredVisionOutput() expects. */
export function validateDnaAnalysisResponse(
  input: unknown
): { success: true; data: DnaAnalysisResponse } | { success: false; error: string } {
  const result = dnaAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

/** Flattens a validated response into the {featureKey, aiObservation, aiConfidence}[] shape ReplicateDesignDnaObservation rows are created from. */
export function flattenToObservations(
  data: DnaAnalysisResponse
): { featureKey: FeatureKey; aiObservation: string; aiConfidence: (typeof CONFIDENCE_VALUES)[number] }[] {
  return FEATURE_KEYS.map((key) => ({
    featureKey: key,
    aiObservation: data[key].observation,
    aiConfidence: data[key].confidence,
  }));
}

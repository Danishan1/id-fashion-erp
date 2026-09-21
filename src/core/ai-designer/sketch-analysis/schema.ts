import { z } from "zod";

/**
 * The confidence enum's string values match AiDesignerSketchConfidence's
 * Prisma enum names directly, so no mapping step is needed between "what the
 * AI returned" and "what gets persisted" — same convention as
 * src/core/ai-designer/replicate-design/dna-analysis/schema.ts.
 */
export const CONFIDENCE_VALUES = ["CONFIRMED_VISUALLY", "LIKELY_INFERRED", "NOT_DETERMINABLE"] as const;

const observationSchema = z.object({
  observation: z.string().min(1),
  confidence: z.enum(CONFIDENCE_VALUES),
});
export type ObservationOutput = z.infer<typeof observationSchema>;

/**
 * A 21-key structural registry for a hand-drawn/digital sketch — a
 * consolidation of the user's own ~30-item requirements list into "group
 * related concerns into one reviewable key" (e.g. placket/buttons/zipper
 * combined into closureDetails), the same choice Replicate Design's own
 * 14-key list already makes. One row per key becomes an
 * AiDesignerSketchObservation.
 */
export const SKETCH_FEATURE_KEYS = [
  "garmentType",
  "silhouette",
  "length",
  "fit",
  "frontNeckline",
  "backNeckline",
  "sleeveType",
  "sleeveLength",
  "collar",
  "shoulderConstruction",
  "waistConstruction",
  "closureDetails",
  "pockets",
  "panelsAndYokes",
  "pleatsAndGathers",
  "dartsAndSeams",
  "slitsAndOpenings",
  "ruffleAndLayerDetails",
  "hemAndCuffs",
  "decorativeDetails",
  "otherConstructionNotes",
] as const;
export type SketchFeatureKey = (typeof SKETCH_FEATURE_KEYS)[number];

export const sketchAnalysisResponseSchema = z.object({
  garmentType: observationSchema,
  silhouette: observationSchema,
  length: observationSchema,
  fit: observationSchema,
  frontNeckline: observationSchema,
  backNeckline: observationSchema,
  sleeveType: observationSchema,
  sleeveLength: observationSchema,
  collar: observationSchema,
  shoulderConstruction: observationSchema,
  waistConstruction: observationSchema,
  closureDetails: observationSchema,
  pockets: observationSchema,
  panelsAndYokes: observationSchema,
  pleatsAndGathers: observationSchema,
  dartsAndSeams: observationSchema,
  slitsAndOpenings: observationSchema,
  ruffleAndLayerDetails: observationSchema,
  hemAndCuffs: observationSchema,
  decorativeDetails: observationSchema,
  otherConstructionNotes: observationSchema,
  sketchAnalysisSummary: z.string().min(1),
});

export type SketchAnalysisResponse = z.infer<typeof sketchAnalysisResponseSchema>;

/** Adapts sketchAnalysisResponseSchema to the `validate` callback requestStructuredVisionOutput() expects. */
export function validateSketchAnalysisResponse(
  input: unknown
): { success: true; data: SketchAnalysisResponse } | { success: false; error: string } {
  const result = sketchAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

/** Flattens a validated response into the {featureKey, aiObservation, aiConfidence}[] shape AiDesignerSketchObservation rows are created from. */
export function flattenToObservations(
  data: SketchAnalysisResponse
): { featureKey: SketchFeatureKey; aiObservation: string; aiConfidence: (typeof CONFIDENCE_VALUES)[number] }[] {
  return SKETCH_FEATURE_KEYS.map((key) => ({
    featureKey: key,
    aiObservation: data[key].observation,
    aiConfidence: data[key].confidence,
  }));
}

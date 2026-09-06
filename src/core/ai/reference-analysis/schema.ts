import { z } from "zod";

// These enum string values are what the tool schema constrains the model's
// output to (see prompt.ts's buildToolInputSchema) — chosen to match the
// Prisma enum names directly (AiGarmentAnalysisConfidence,
// AiGarmentConstructionComplexity) so no normalization/mapping step is
// needed between "what the AI returned" and "what gets persisted."
export const CONFIDENCE_VALUES = ["CONFIRMED_VISUALLY", "LIKELY_INFERRED", "NOT_DETERMINABLE"] as const;
export const COMPLEXITY_VALUES = ["LOW", "MEDIUM", "HIGH"] as const;

const observationSchema = z.object({
  observation: z.string().min(1),
  confidence: z.enum(CONFIDENCE_VALUES),
  manufacturingRelevance: z.string().min(1),
});
export type ObservationOutput = z.infer<typeof observationSchema>;

export const referenceAnalysisResponseSchema = z.object({
  garmentCategory: observationSchema,
  silhouette: observationSchema,
  garmentLength: observationSchema,
  fit: observationSchema,
  neckline: observationSchema,
  collar: observationSchema,
  sleeve: z.object({
    type: observationSchema,
    length: observationSchema,
    volume: observationSchema,
    cuff: observationSchema,
  }),
  shoulderConstruction: observationSchema,
  frontConstruction: observationSchema,
  backConstruction: observationSchema,
  openingClosure: observationSchema,
  panels: observationSchema,
  seams: observationSchema,
  darts: observationSchema,
  pleats: observationSchema,
  gathers: observationSchema,
  tucks: observationSchema,
  pockets: observationSchema,
  waistTreatment: observationSchema,
  hem: observationSchema,
  trims: observationSchema,
  decorativeDetails: observationSchema,
  fabricObservations: z.object({
    weight: observationSchema,
    drape: observationSchema,
    texture: observationSchema,
    stretchAppearance: observationSchema,
    transparency: observationSchema,
    surfaceCharacter: observationSchema,
  }),
  printPattern: z.object({
    type: observationSchema,
    scale: observationSchema,
    direction: observationSchema,
    placement: observationSchema,
    repeatAppearance: observationSchema,
  }),
  constructionComplexity: z.object({
    level: z.enum(COMPLEXITY_VALUES),
    explanation: z.string().min(1),
  }),
  manufacturingChallenges: z.array(z.string()),
  keyDesignLanguageFeatures: z.array(z.string()),
  featuresForFurtherDevelopment: z.array(z.string()),
  featuresToChangeForDifferentiation: z.array(z.string()),
  missingInformation: z.array(z.string()),
  designDnaSummary: z.string().min(1),
});

export type ReferenceAnalysisResponse = z.infer<typeof referenceAnalysisResponseSchema>;

/** Adapts referenceAnalysisResponseSchema to the `validate` callback requestStructuredVisionOutput() expects. */
export function validateReferenceAnalysisResponse(
  input: unknown
): { success: true; data: ReferenceAnalysisResponse } | { success: false; error: string } {
  const result = referenceAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

function readAtPath(data: ReferenceAnalysisResponse, path: string[]): ObservationOutput {
  let node: unknown = data;
  for (const segment of path) {
    node = (node as Record<string, unknown>)[segment];
  }
  return node as ObservationOutput;
}

export interface FlattenedObservation {
  featureKey: string;
  aiObservation: string;
  aiConfidence: (typeof CONFIDENCE_VALUES)[number];
  aiManufacturingRelevance: string;
}

/** Walks the shared FEATURE_REGISTRY to turn one validated AI response into the 36 rows AiGarmentReferenceObservation stores. */
export function flattenToObservations(
  data: ReferenceAnalysisResponse,
  featureRegistry: { key: string; path: string[] }[]
): FlattenedObservation[] {
  return featureRegistry.map((feature) => {
    const node = readAtPath(data, feature.path);
    return {
      featureKey: feature.key,
      aiObservation: node.observation,
      aiConfidence: node.confidence,
      aiManufacturingRelevance: node.manufacturingRelevance,
    };
  });
}

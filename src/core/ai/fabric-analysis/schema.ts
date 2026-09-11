import { z } from "zod";

// Reused verbatim from reference-analysis/schema.ts's own enum values — the
// Prisma AiGarmentAnalysisConfidence enum is already generic (no
// garment-specific meaning baked in), so this process shares it rather than
// duplicating an identical enum under a new name.
export const FABRIC_CONFIDENCE_VALUES = ["CONFIRMED_VISUALLY", "LIKELY_INFERRED", "NOT_DETERMINABLE"] as const;

const observationSchema = z.object({
  observation: z.string().min(1),
  confidence: z.enum(FABRIC_CONFIDENCE_VALUES),
  manufacturingRelevance: z.string().min(1),
});
export type FabricObservationOutput = z.infer<typeof observationSchema>;

/**
 * Flat by design from the start — reference-analysis's own schema.ts
 * documents at length why a nested shape (sleeve.*, fabricObservations.*)
 * blew past Anthropic's tool-schema size limit and had to be flattened
 * after the fact; this process starts flat rather than repeating that
 * discovery. 13 fields total is comfortably smaller than reference
 * analysis's 36 either way. Originally 17 fields — the 4-field Manufacturing
 * Considerations group (cutting/sewing/care/quality-risk prose) was removed
 * per explicit user feedback that it wasn't "fabric details."
 */
export const fabricAnalysisResponseSchema = z.object({
  fabricType: observationSchema,
  weaveOrKnitStructure: observationSchema,
  estimatedComposition: observationSchema,
  estimatedGsmClass: observationSchema,
  directionality: observationSchema,
  colorDescription: observationSchema,
  patternOrPrint: observationSchema,
  surfaceTexture: observationSchema,
  sheenOrLuster: observationSchema,
  transparencyLevel: observationSchema,
  estimatedStretch: observationSchema,
  estimatedDrape: observationSchema,
  estimatedRecovery: observationSchema,
  missingInformation: z.array(z.string()),
  fabricSummary: z.string().min(1),
});

export type FabricAnalysisResponse = z.infer<typeof fabricAnalysisResponseSchema>;

/** Adapts fabricAnalysisResponseSchema to the `validate` callback requestStructuredVisionOutput() expects. */
export function validateFabricAnalysisResponse(
  input: unknown
): { success: true; data: FabricAnalysisResponse } | { success: false; error: string } {
  const result = fabricAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

export interface FlattenedFabricObservation {
  featureKey: string;
  aiObservation: string;
  aiConfidence: (typeof FABRIC_CONFIDENCE_VALUES)[number];
  aiManufacturingRelevance: string;
}

/** Walks the shared FABRIC_FEATURE_REGISTRY to turn one validated AI response into the 13 rows AiGarmentFabricObservation stores. */
export function flattenToFabricObservations(
  data: FabricAnalysisResponse,
  featureRegistry: { key: string; path: string[] }[]
): FlattenedFabricObservation[] {
  return featureRegistry.map((feature) => {
    const node = (data as unknown as Record<string, FabricObservationOutput>)[feature.path[0]];
    return {
      featureKey: feature.key,
      aiObservation: node.observation,
      aiConfidence: node.confidence,
      aiManufacturingRelevance: node.manufacturingRelevance,
    };
  });
}

import { z } from "zod";

const measurementPointSchema = (sizeCount: number) =>
  z.object({
    measurementName: z.string().min(1),
    howToMeasure: z.string().min(1),
    toleranceText: z.string().min(1),
    // Exactly one value per size, positional — never id-keyed, matching
    // Process 5/9's own "the model returns exactly N items in the same
    // order, never a real database id it could hallucinate" discipline.
    values: z.array(z.string().min(1)).length(sizeCount),
  });

export interface MeasurementPointOutput {
  measurementName: string;
  howToMeasure: string;
  toleranceText: string;
  values: string[];
}

export interface TechnicalSpecificationResponse {
  generalNotes: string;
  measurementPoints: MeasurementPointOutput[];
}

/**
 * Built per-request since the per-point values array length depends on how
 * many Sizes this company actually has configured — mirrors
 * buildCommercialEvaluationResponseSchema(designCount)'s exact shape.
 */
export function buildTechnicalSpecificationResponseSchema(sizeCount: number) {
  return z.object({
    generalNotes: z.string().min(1),
    measurementPoints: z.array(measurementPointSchema(sizeCount)).min(5).max(20),
  });
}

export function validateTechnicalSpecificationResponse(
  sizeCount: number,
  input: unknown
): { success: true; data: TechnicalSpecificationResponse } | { success: false; error: string } {
  const result = buildTechnicalSpecificationResponseSchema(sizeCount).safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

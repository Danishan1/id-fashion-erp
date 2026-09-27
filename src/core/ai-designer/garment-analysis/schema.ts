import { z } from "zod";

/**
 * AI Designer "New Design" flow (2026-09-27) — Step 1's analysis of an
 * uploaded GARMENT photo or SKETCH. Plain-string fields (same deliberately
 * minimal, no-confidence-score shape as fabric-analysis/schema.ts), shown as
 * label/value rows in the right-hand "AI Analysis" panel. garmentType drives
 * the garment-template suggestions; fabricDescription/printDescription drive
 * the keyword match against the company's own Fabric Master.
 */
export const GARMENT_ANALYSIS_FIELD_KEYS = [
  "garmentType",
  "silhouette",
  "neckline",
  "sleeve",
  "length",
  "fit",
  "keyDetails",
  "primaryColor",
  "fabricDescription",
  "printDescription",
  "occasion",
  "suggestedGarments",
] as const;

export type GarmentAnalysisFieldKey = (typeof GARMENT_ANALYSIS_FIELD_KEYS)[number];

export const GARMENT_ANALYSIS_FIELD_LABELS: Record<GarmentAnalysisFieldKey, string> = {
  garmentType: "Garment Type",
  silhouette: "Silhouette",
  neckline: "Neckline",
  sleeve: "Sleeve",
  length: "Length",
  fit: "Fit",
  keyDetails: "Key Details",
  primaryColor: "Primary Colour",
  fabricDescription: "Likely Fabric",
  printDescription: "Print / Pattern",
  occasion: "Occasion",
  suggestedGarments: "Suggested Garments",
};

export const garmentAnalysisResponseSchema = z.object(
  Object.fromEntries(GARMENT_ANALYSIS_FIELD_KEYS.map((k) => [k, z.string().min(1)])) as Record<GarmentAnalysisFieldKey, z.ZodString>
);

export type GarmentAnalysisResponse = Record<GarmentAnalysisFieldKey, string>;

export function validateGarmentAnalysisResponse(
  input: unknown
): { success: true; data: GarmentAnalysisResponse } | { success: false; error: string } {
  const result = garmentAnalysisResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data as GarmentAnalysisResponse };
  const firstIssue = result.error.issues[0];
  return {
    success: false,
    error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response.",
  };
}

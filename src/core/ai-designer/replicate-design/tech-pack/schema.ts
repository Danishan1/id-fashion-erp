import { z } from "zod";

/**
 * Replicate Design's OWN dedicated copy of AI Designer's original Tech Pack
 * schema — forked verbatim on 2026-09-14 when AI Designer's own Tech Pack
 * feature was rebuilt (v3: AI image generation removed from the pages
 * entirely, per an explicit user rule scoped to that feature). Replicate
 * Design's Tech Pack had been reusing AI Designer's shared `tech-pack/*`
 * files directly since it was first built — the one place this genuinely
 * separate module (see its own `replicate-design/` subfolder convention for
 * dna-analysis/compatibility-check/image-generation, each with their own
 * dedicated files) had quietly broken its own isolation rule. Forking here
 * keeps Replicate Design's Tech Pack behavior completely unchanged (still
 * generates 4 AI page images) while letting AI Designer's own `tech-pack/*`
 * evolve independently — matches this codebase's own "genuinely separate
 * module, zero shared business logic" convention, and avoids touching an
 * unrelated feature's behavior as a side effect of a different one's rebuild.
 */
export const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type StandardSize = (typeof STANDARD_SIZES)[number];

export const TECH_PACK_PAGE_DEFINITIONS = [
  { pageNumber: 1, title: "Cover Page / Style Summary", needsImage: true },
  { pageNumber: 2, title: "Construction & Detail Callouts", needsImage: true },
  { pageNumber: 3, title: "Bill of Materials / BOM", needsImage: false },
  { pageNumber: 4, title: "Colorways & Artwork Placement", needsImage: true },
  { pageNumber: 5, title: "Measurements & Spec Table", needsImage: true },
  { pageNumber: 6, title: "Size Grading", needsImage: false },
  { pageNumber: 7, title: "Labels & Packaging", needsImage: false },
] as const;

export const TECH_PACK_IMAGE_PAGE_DEFINITIONS = TECH_PACK_PAGE_DEFINITIONS.filter((p) => p.needsImage);

function str() {
  return z.string().min(1);
}

// ---------------------------------------------------------------------------
// Part 1 (vision) — Categories A-G: what the image itself shows
// ---------------------------------------------------------------------------

const garmentIdentificationSchema = z.object({
  brandName: str(),
  styleName: str(),
  styleNumber: str(),
  garmentCategory: str(),
  subCategory: str(),
  fitType: str(),
  genderCategory: str(),
  targetSeason: str(),
  baseSampleSize: str(),
  dateCreated: str(),
  designer: str(),
});
export type GarmentIdentification = z.infer<typeof garmentIdentificationSchema>;

const constructionSilhouetteSchema = z.object({
  silhouette: str(),
  bodyShape: str(),
  bodyLength: str(),
  width: str(),
  hemShape: str(),
  sideSeamConstruction: str(),
  shoulderConstruction: str(),
  sleeveConstruction: str(),
  hoodCollarConstruction: str(),
  ribTrims: str(),
  paneling: str(),
  dropShoulderAmount: str(),
  cuffConstruction: str(),
  neckConstruction: str(),
});
export type ConstructionSilhouette = z.infer<typeof constructionSilhouetteSchema>;

const closureSystemSchema = z.object({
  closureType: str(),
  closureDetails: str(),
});
export type ClosureSystem = z.infer<typeof closureSystemSchema>;

const seamCalloutSchema = z.object({
  calloutNumber: z.number().int().positive(),
  location: str(),
  technicalSpecification: str(),
  status: z.enum(["PROPOSED", "CONFIRMED"]),
});
export type SeamCallout = z.infer<typeof seamCalloutSchema>;

const visibleColorSchema = z.object({
  colorName: str(),
  pantoneEstimate: str(),
  hexEstimate: str(),
  garmentPanel: str(),
});
export type VisibleColor = z.infer<typeof visibleColorSchema>;

const suggestedColorwaySchema = z.object({
  colorwayCode: str(),
  colorwayName: str(),
  mainColor: str(),
  contrastColor: str(),
  trimColor: str(),
  artworkColor: str(),
  notes: str(),
});
export type SuggestedColorway = z.infer<typeof suggestedColorwaySchema>;

const artworkItemSchema = z.object({
  artworkType: str(),
  placement: str(),
  scale: str(),
  dimensions: str(),
  alignment: str(),
  printMethod: str(),
  distanceFromHps: str(),
  distanceFromCf: str(),
});
export type ArtworkItem = z.infer<typeof artworkItemSchema>;

const garmentAnalysisPart1Schema = z.object({
  identification: garmentIdentificationSchema,
  construction: constructionSilhouetteSchema,
  closure: closureSystemSchema,
  seamCallouts: z.array(seamCalloutSchema).min(1).max(15),
  visibleColors: z.array(visibleColorSchema).min(1).max(10),
  suggestedColorways: z.array(suggestedColorwaySchema).min(2).max(5),
  artworkItems: z.array(artworkItemSchema).max(8),
  artworkSummary: str(),
  patternPrintType: str(),
  patternPrintNotes: str(),
});
export type GarmentAnalysisPart1 = z.infer<typeof garmentAnalysisPart1Schema>;

export function validateGarmentAnalysisPart1(input: unknown): { success: true; data: GarmentAnalysisPart1 } | { success: false; error: string } {
  const result = garmentAnalysisPart1Schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

// ---------------------------------------------------------------------------
// Part 2 (text) — Categories H, I, J: BOM, graded measurements, labels & packaging
// ---------------------------------------------------------------------------

const bomItemSchema = z.object({
  materialType: str(),
  composition: str(),
  gsm: str(),
  color: str(),
  consumption: str(),
  notes: str(),
});
export type TechPackBomItem = z.infer<typeof bomItemSchema>;

const sizeValuesSchema = z.object({
  XS: str(),
  S: str(),
  M: str(),
  L: str(),
  XL: str(),
  XXL: str(),
});

const measurementPointSchema = z.object({
  pointName: str(),
  howToMeasure: str(),
  toleranceCm: str(),
  values: sizeValuesSchema,
});
export type TechPackMeasurementPoint = z.infer<typeof measurementPointSchema>;

const garmentAnalysisPart2Schema = z.object({
  bomItems: z.array(bomItemSchema).min(8).max(30),
  measurementPoints: z.array(measurementPointSchema).min(6).max(20),
  gradeRulesNotes: str(),
  mainLabelSpec: str(),
  sizeLabelSpec: str(),
  careLabelSpec: str(),
  hangtagSpec: str(),
  polybagSpec: str(),
  foldingInstructions: str(),
  cartonPackingSpec: str(),
  barcodePlacement: str(),
});
export type GarmentAnalysisPart2 = z.infer<typeof garmentAnalysisPart2Schema>;

export function validateGarmentAnalysisPart2(input: unknown): { success: true; data: GarmentAnalysisPart2 } | { success: false; error: string } {
  const result = garmentAnalysisPart2Schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

/** The combined, persisted Garment Analysis — parts 1 and 2 together, exactly what the DB's `garmentAnalysisJson` column stores. */
export interface GarmentAnalysis {
  part1: GarmentAnalysisPart1;
  part2: GarmentAnalysisPart2;
}

// ---------------------------------------------------------------------------
// Part 3 (text) — exactly 7 image-generation prompts + designer notes
// ---------------------------------------------------------------------------

const pagePromptsResponseSchema = z.object({
  // Positional, one prompt per needsImage page (in TECH_PACK_IMAGE_PAGE_DEFINITIONS order) — NOT one per all 7 pages.
  pagePrompts: z.array(str()).length(TECH_PACK_IMAGE_PAGE_DEFINITIONS.length),
  designerNotes: str(),
  suggestedAdditionalViews: str(),
});
export type PagePromptsResponse = z.infer<typeof pagePromptsResponseSchema>;

export function validatePagePromptsResponse(input: unknown): { success: true; data: PagePromptsResponse } | { success: false; error: string } {
  const result = pagePromptsResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

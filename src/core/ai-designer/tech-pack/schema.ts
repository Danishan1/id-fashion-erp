import { z } from "zod";

/**
 * Tech Pack's own graded size set — deliberately a small fixed list, NOT
 * the company's real Size master (unlike AI Garment Flow's own Technical
 * Specification process, which grades across the real master). This is a
 * documented, deliberate scope reduction: AI Designer has no per-company
 * Size-master integration anywhere else, and building one just for this one
 * feature would be a much larger, separate piece of work.
 */
export const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type StandardSize = (typeof STANDARD_SIZES)[number];

/**
 * The 7 tech-pack pages are a FIXED structure per the user's own spec (exact
 * titles/content per page) — never AI-chosen.
 *
 * v3 (2026-09-14): AI image generation was removed from Tech Pack entirely,
 * per the user's own explicit, repeated rule against using it to build the
 * document ("do not use AI image generation just to make the PDF... if
 * unavailable, use the reference garment image instead"). Pages that show a
 * visual (`PHOTO_PAGE_NUMBERS` below) now embed the project's own real,
 * already-generated design photo — the exact same attachment id already on
 * the project, reused as-is, never a freshly AI-drawn "flat". Page 5
 * (Measurements) lost its image slot entirely in this same pass — the user's
 * own spec never asked for one there, only the prior (v2) build added it.
 */
export const TECH_PACK_PAGE_DEFINITIONS = [
  { pageNumber: 1, title: "Cover Page / Style Summary" },
  { pageNumber: 2, title: "Construction & Detail Callouts" },
  { pageNumber: 3, title: "Bill of Materials / BOM" },
  { pageNumber: 4, title: "Colorways & Artwork Placement" },
  { pageNumber: 5, title: "Measurements & Spec Table" },
  { pageNumber: 6, title: "Size Grading" },
  { pageNumber: 7, title: "Labels & Packaging" },
] as const;

/** The only 3 pages that embed the project's real design photo — see the doc comment above. */
export const PHOTO_PAGE_NUMBERS = [1, 2, 4] as const;

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
/** Every field on this category is a plain free-text string — all are safe to edit as-is. */
export const IDENTIFICATION_EDITABLE_FIELDS = Object.keys(garmentIdentificationSchema.shape) as (keyof GarmentIdentification)[];

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
export const CONSTRUCTION_EDITABLE_FIELDS = Object.keys(constructionSilhouetteSchema.shape) as (keyof ConstructionSilhouette)[];

const closureSystemSchema = z.object({
  closureType: str(),
  closureDetails: str(),
});
export type ClosureSystem = z.infer<typeof closureSystemSchema>;
export const CLOSURE_EDITABLE_FIELDS = Object.keys(closureSystemSchema.shape) as (keyof ClosureSystem)[];

const seamCalloutSchema = z.object({
  calloutNumber: z.number().int().positive(),
  location: str(),
  technicalSpecification: str(),
  status: z.enum(["PROPOSED", "CONFIRMED"]),
  /**
   * Best-effort estimated position of this callout on the REAL PHOTO the
   * vision model analyzed (percentage from the top-left corner, 0-100) — used
   * to draw a numbered pin directly on that photo on Page 2. Both optional
   * and deliberately NOT required together at the Zod level for a single
   * value (a callout with only one, or neither, simply renders in the table
   * with no pin — the renderer is what enforces "both present" before ever
   * drawing a pin). Never estimated against a generated technical flat (a
   * different image, different framing) — see tech-pack-pdf.tsx's own
   * documented reasoning for why Page 2 always shows the photo, not the flat.
   * Deliberately excluded from SEAM_CALLOUT_TEXT_FIELDS below — these are
   * AI-estimated numeric values, not meant for manual free-text editing.
   */
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
});
export type SeamCallout = z.infer<typeof seamCalloutSchema>;
/** `calloutNumber` is deliberately excluded — it's a positional ordinal assigned by the AI, not a free-text value a user corrects (renumbering/reordering callouts is out of scope for this pass). `status` is editable as a constrained enum, not free text — validated separately against SEAM_CALLOUT_STATUS_VALUES. `xPercent`/`yPercent` are also excluded — see the schema's own doc comment. */
export const SEAM_CALLOUT_TEXT_FIELDS = ["location", "technicalSpecification"] as const;
export const SEAM_CALLOUT_STATUS_VALUES = ["PROPOSED", "CONFIRMED"] as const;

const visibleColorSchema = z.object({
  colorName: str(),
  pantoneEstimate: str(),
  hexEstimate: str(),
  garmentPanel: str(),
});
export type VisibleColor = z.infer<typeof visibleColorSchema>;
export const VISIBLE_COLOR_EDITABLE_FIELDS = Object.keys(visibleColorSchema.shape) as (keyof VisibleColor)[];

const suggestedColorwaySchema = z.object({
  colorwayCode: str(),
  colorwayName: str(),
  mainColor: str(),
  contrastColor: str(),
  trimColor: str(),
  artworkColor: str(),
  notes: str(),
  /**
   * Best-effort HEX estimates for each named color above, so the PDF can
   * render a real swatch chip instead of just a color-name string — optional
   * and independent per field, since the model may reasonably be able to
   * estimate one color's hex but not another's. Absent on any
   * `garmentAnalysisJson` row generated before this field existed; the
   * renderer's `resolveColorHex()` helper falls back to a small common-color
   * name dictionary, and shows text-only when nothing resolves — never a
   * fabricated exact hex. Deliberately excluded from
   * SUGGESTED_COLORWAY_EDITABLE_FIELDS below (see that constant's own doc
   * comment).
   */
  mainColorHex: z.string().optional(),
  contrastColorHex: z.string().optional(),
  trimColorHex: z.string().optional(),
  artworkColorHex: z.string().optional(),
});
export type SuggestedColorway = z.infer<typeof suggestedColorwaySchema>;
/** Only the original 7 text fields are manually editable — the 4 *Hex fields are AI-estimated swatch data, not meant for free-text editing in this pass. */
export const SUGGESTED_COLORWAY_EDITABLE_FIELDS = ["colorwayCode", "colorwayName", "mainColor", "contrastColor", "trimColor", "artworkColor", "notes"] as const;

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
export const ARTWORK_ITEM_EDITABLE_FIELDS = Object.keys(artworkItemSchema.shape) as (keyof ArtworkItem)[];

const garmentAnalysisPart1Schema = z.object({
  identification: garmentIdentificationSchema,
  construction: constructionSilhouetteSchema,
  closure: closureSystemSchema,
  seamCallouts: z.array(seamCalloutSchema).min(1).max(15),
  visibleColors: z.array(visibleColorSchema).min(1).max(10),
  // Prompt asks for "2-3 logical commercial colorways" as guidance, but a
  // real response confirmed live can reasonably produce 4 well-differentiated
  // ones — bounded generously rather than fixed, matching this codebase's
  // established "bounded not fixed" idiom for an AI-decided count.
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
// Part 2 (text) — Categories H, I, J: BOM, graded measurements, labels &
// packaging — plus (v3) designer notes / suggested additional views, folded
// in from the now-removed "Part 3" (image-prompt) call.
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
export const BOM_ITEM_EDITABLE_FIELDS = Object.keys(bomItemSchema.shape) as (keyof TechPackBomItem)[];

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
/** `values.<SIZE>` cells are handled separately (validated against STANDARD_SIZES), not part of this plain-field list. */
export const MEASUREMENT_POINT_EDITABLE_FIELDS = ["pointName", "howToMeasure", "toleranceCm"] as const;

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
  designerNotes: str(),
  suggestedAdditionalViews: str(),
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

/**
 * The 9 plain scalar-string fields on Part 2 that aren't part of an array —
 * each is directly replaceable as a whole value (no per-field key needed).
 * `designerNotes`/`suggestedAdditionalViews` are deliberately NOT included
 * here — they're editorial commentary about the analysis, not tech-pack
 * document content a user corrects the same way as a label spec.
 */
export const PART2_SCALAR_FIELDS = [
  "gradeRulesNotes",
  "mainLabelSpec",
  "sizeLabelSpec",
  "careLabelSpec",
  "hangtagSpec",
  "polybagSpec",
  "foldingInstructions",
  "cartonPackingSpec",
  "barcodePlacement",
] as const;

/** The 3 plain scalar-string fields on Part 1 that aren't part of an array. */
export const PART1_SCALAR_FIELDS = ["artworkSummary", "patternPrintType", "patternPrintNotes"] as const;

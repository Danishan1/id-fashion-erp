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
 * v4 (2026-09-22): adopted the user's own, more rigorous "GARMENT TECH PACK
 * STRUCTURED DATA GENERATOR" system prompt (supplied verbatim, 2026-09-22)
 * in place of v3's simpler spec-sheet prompt — per two explicit scope
 * confirmations: (1) add every new section the new prompt implies (Fabric &
 * Materials as its own table separate from BOM, Production Instructions, QC
 * Checkpoints, Assumptions & Missing Data, Additional Reference Images
 * Required, Hangtag & Barcode split out of Labels & Packaging), and (2) give
 * every fact-level value ("did the AI confirm this, infer it, propose it, or
 * genuinely not know it") its OWN structured `status` field (see
 * `ConfidenceStatus` below) rather than the old v1-v3 convention of baking a
 * "[NOT VISIBLE — confirm with designer]" marker into the text value itself.
 *
 * 12 fixed pages now (was 7) — every new section above gets its own page.
 * `PHOTO_PAGE_NUMBERS`/technical-flat eligibility below were re-derived to
 * match the new page order.
 */
export const TECH_PACK_PAGE_DEFINITIONS = [
  { pageNumber: 1, title: "Cover Page / Style Summary" },
  { pageNumber: 2, title: "Construction & Detail Callouts" },
  { pageNumber: 3, title: "Fabric & Materials" },
  { pageNumber: 4, title: "Bill of Materials / BOM" },
  { pageNumber: 5, title: "Colorways & Artwork Placement" },
  { pageNumber: 6, title: "Measurements & Spec Table" },
  { pageNumber: 7, title: "Size Grading" },
  { pageNumber: 8, title: "Production Instructions" },
  { pageNumber: 9, title: "Quality Control Checkpoints" },
  { pageNumber: 10, title: "Labels & Packaging" },
  { pageNumber: 11, title: "Hangtag & Barcode" },
  { pageNumber: 12, title: "Assumptions, Missing Data & Reference Images Needed" },
] as const;

/** The only 3 pages that embed the project's real design photo — see the doc comment above. */
export const PHOTO_PAGE_NUMBERS = [1, 2, 5] as const;

/**
 * Every fact this document states about the real garment carries its own
 * confidence tag, instead of the old inline "[NOT VISIBLE]"/"[ASSUMED]"
 * text-bracket convention:
 *  - CONFIRMED   — clearly, unambiguously visible/stated in the source image or context.
 *  - INFERRED    — a reasonable technical inference from what IS visible (e.g. a standard construction method for this garment type).
 *  - PROPOSED    — the AI's own recommendation/draft where no single correct answer exists (e.g. a suggested colorway, a proposed QC tolerance).
 *  - TBC         — genuinely undetermined; a human must confirm this before production.
 *  - NOT_VISIBLE — the detail is simply not visible/present in the supplied image at all.
 */
export const CONFIDENCE_STATUSES = ["CONFIRMED", "INFERRED", "PROPOSED", "TBC", "NOT_VISIBLE"] as const;
export type ConfidenceStatus = (typeof CONFIDENCE_STATUSES)[number];

function str() {
  return z.string().min(1);
}

const statusValueSchema = z.object({ value: str(), status: z.enum(CONFIDENCE_STATUSES) });
export type StatusValue = z.infer<typeof statusValueSchema>;

// ---------------------------------------------------------------------------
// Part 1 (vision) — Categories A-G: what the image itself shows
// ---------------------------------------------------------------------------

const garmentIdentificationSchema = z.object({
  brandName: statusValueSchema,
  styleName: statusValueSchema,
  styleNumber: statusValueSchema,
  garmentCategory: statusValueSchema,
  subCategory: statusValueSchema,
  fitType: statusValueSchema,
  genderCategory: statusValueSchema,
  targetSeason: statusValueSchema,
  baseSampleSize: statusValueSchema,
  dateCreated: statusValueSchema,
  designer: statusValueSchema,
});
export type GarmentIdentification = z.infer<typeof garmentIdentificationSchema>;
export const IDENTIFICATION_EDITABLE_FIELDS = Object.keys(garmentIdentificationSchema.shape) as (keyof GarmentIdentification)[];

const constructionSilhouetteSchema = z.object({
  silhouette: statusValueSchema,
  bodyShape: statusValueSchema,
  bodyLength: statusValueSchema,
  width: statusValueSchema,
  hemShape: statusValueSchema,
  sideSeamConstruction: statusValueSchema,
  shoulderConstruction: statusValueSchema,
  sleeveConstruction: statusValueSchema,
  hoodCollarConstruction: statusValueSchema,
  ribTrims: statusValueSchema,
  paneling: statusValueSchema,
  dropShoulderAmount: statusValueSchema,
  cuffConstruction: statusValueSchema,
  neckConstruction: statusValueSchema,
});
export type ConstructionSilhouette = z.infer<typeof constructionSilhouetteSchema>;
export const CONSTRUCTION_EDITABLE_FIELDS = Object.keys(constructionSilhouetteSchema.shape) as (keyof ConstructionSilhouette)[];

const closureSystemSchema = z.object({
  closureType: statusValueSchema,
  closureDetails: statusValueSchema,
});
export type ClosureSystem = z.infer<typeof closureSystemSchema>;
export const CLOSURE_EDITABLE_FIELDS = Object.keys(closureSystemSchema.shape) as (keyof ClosureSystem)[];

const seamCalloutSchema = z.object({
  calloutNumber: z.number().int().positive(),
  location: str(),
  technicalSpecification: str(),
  status: z.enum(CONFIDENCE_STATUSES),
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
   */
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
});
export type SeamCallout = z.infer<typeof seamCalloutSchema>;
/** `calloutNumber` is a positional ordinal assigned by the AI, not a free-text value a user corrects. `status` is one of the shared CONFIDENCE_STATUSES (not free text). `xPercent`/`yPercent` are AI-estimated numeric values, not manually edited. */
export const SEAM_CALLOUT_TEXT_FIELDS = ["location", "technicalSpecification"] as const;

const visibleColorSchema = z.object({
  colorName: str(),
  pantoneEstimate: statusValueSchema,
  hexEstimate: statusValueSchema,
  garmentPanel: str(),
});
export type VisibleColor = z.infer<typeof visibleColorSchema>;
export const VISIBLE_COLOR_EDITABLE_FIELDS = ["colorName", "pantoneEstimate", "hexEstimate", "garmentPanel"] as const;

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
   * estimate one color's hex but not another's.
   */
  mainColorHex: z.string().optional(),
  contrastColorHex: z.string().optional(),
  trimColorHex: z.string().optional(),
  artworkColorHex: z.string().optional(),
});
export type SuggestedColorway = z.infer<typeof suggestedColorwaySchema>;
export const SUGGESTED_COLORWAY_EDITABLE_FIELDS = ["colorwayCode", "colorwayName", "mainColor", "contrastColor", "trimColor", "artworkColor", "notes"] as const;

const artworkItemSchema = z.object({
  artworkType: str(),
  placement: str(),
  scale: str(),
  dimensions: statusValueSchema,
  alignment: str(),
  printMethod: str(),
  distanceFromHps: statusValueSchema,
  distanceFromCf: statusValueSchema,
});
export type ArtworkItem = z.infer<typeof artworkItemSchema>;
export const ARTWORK_ITEM_EDITABLE_FIELDS = ["artworkType", "placement", "scale", "dimensions", "alignment", "printMethod", "distanceFromHps", "distanceFromCf"] as const;

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
// Part 2 (text) — Fabric & Materials (NEW, its own table — separate from
// BOM), Bill of Materials, Measurements & Grading
// ---------------------------------------------------------------------------

const fabricMaterialLineSchema = z.object({
  materialRole: str(),
  fabricType: str(),
  composition: statusValueSchema,
  gsm: statusValueSchema,
  width: statusValueSchema,
  finish: str(),
  consumption: statusValueSchema,
  supplierNotes: str(),
});
export type FabricMaterialLine = z.infer<typeof fabricMaterialLineSchema>;
export const FABRIC_MATERIAL_EDITABLE_FIELDS = ["materialRole", "fabricType", "composition", "gsm", "width", "finish", "consumption", "supplierNotes"] as const;

const bomItemSchema = z.object({
  materialType: str(),
  composition: statusValueSchema,
  gsm: statusValueSchema,
  color: str(),
  consumption: statusValueSchema,
  notes: str(),
});
export type TechPackBomItem = z.infer<typeof bomItemSchema>;
export const BOM_ITEM_EDITABLE_FIELDS = ["materialType", "composition", "gsm", "color", "consumption", "notes"] as const;

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
  /** One status per point (not per size cell) — a deliberate, documented granularity choice: per-cell status across 6-20 points x 6 sizes would roughly double this call's own schema size for a distinction ("is the M value more confirmed than the XS value") that rarely matters in practice — the grading math is what actually drives every size once the base size is set. */
  status: z.enum(CONFIDENCE_STATUSES),
});
export type TechPackMeasurementPoint = z.infer<typeof measurementPointSchema>;
export const MEASUREMENT_POINT_EDITABLE_FIELDS = ["pointName", "howToMeasure", "toleranceCm", "status"] as const;

const garmentAnalysisPart2Schema = z.object({
  fabricMaterials: z.array(fabricMaterialLineSchema).min(1).max(12),
  bomItems: z.array(bomItemSchema).min(8).max(30),
  measurementPoints: z.array(measurementPointSchema).min(6).max(20),
  gradeRulesNotes: str(),
});
export type GarmentAnalysisPart2 = z.infer<typeof garmentAnalysisPart2Schema>;

export function validateGarmentAnalysisPart2(input: unknown): { success: true; data: GarmentAnalysisPart2 } | { success: false; error: string } {
  const result = garmentAnalysisPart2Schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

// ---------------------------------------------------------------------------
// Part 3 (text, NEW) — Production Instructions, QC Checkpoints, Labels &
// Packaging, Hangtag & Barcode (split out of Labels & Packaging)
// ---------------------------------------------------------------------------

const productionInstructionStepSchema = z.object({
  stepNumber: z.number().int().positive(),
  instruction: str(),
});
export type ProductionInstructionStep = z.infer<typeof productionInstructionStepSchema>;
/** `stepNumber` is a positional ordinal assigned by the AI, not manually re-numbered in this pass. */
export const PRODUCTION_INSTRUCTION_EDITABLE_FIELDS = ["instruction"] as const;

const qcCheckpointSchema = z.object({
  checkpointArea: str(),
  whatToCheck: str(),
  acceptanceCriteria: str(),
  toolsOrMethod: str(),
});
export type QcCheckpoint = z.infer<typeof qcCheckpointSchema>;
export const QC_CHECKPOINT_EDITABLE_FIELDS = ["checkpointArea", "whatToCheck", "acceptanceCriteria", "toolsOrMethod"] as const;

const garmentAnalysisPart3Schema = z.object({
  productionInstructions: z.array(productionInstructionStepSchema).min(4).max(20),
  qcCheckpoints: z.array(qcCheckpointSchema).min(4).max(15),
  mainLabelSpec: statusValueSchema,
  sizeLabelSpec: statusValueSchema,
  careLabelSpec: statusValueSchema,
  polybagSpec: statusValueSchema,
  foldingInstructions: str(),
  cartonPackingSpec: statusValueSchema,
  hangtagSpec: statusValueSchema,
  barcodeType: statusValueSchema,
  barcodeContent: statusValueSchema,
  barcodePlacement: statusValueSchema,
});
export type GarmentAnalysisPart3 = z.infer<typeof garmentAnalysisPart3Schema>;

export function validateGarmentAnalysisPart3(input: unknown): { success: true; data: GarmentAnalysisPart3 } | { success: false; error: string } {
  const result = garmentAnalysisPart3Schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

// ---------------------------------------------------------------------------
// Part 4 (text, NEW) — Assumptions & Missing Data, Additional Reference
// Images Required, plus the carried-forward Designer Notes overview
// ---------------------------------------------------------------------------

const assumptionSchema = z.object({
  item: str(),
  assumptionMade: str(),
  status: z.enum(CONFIDENCE_STATUSES),
});
export type Assumption = z.infer<typeof assumptionSchema>;
export const ASSUMPTION_TEXT_FIELDS = ["item", "assumptionMade"] as const;

const referenceImageNeededSchema = z.object({
  viewNeeded: str(),
  reason: str(),
});
export type ReferenceImageNeeded = z.infer<typeof referenceImageNeededSchema>;
export const REFERENCE_IMAGE_NEEDED_EDITABLE_FIELDS = ["viewNeeded", "reason"] as const;

const garmentAnalysisPart4Schema = z.object({
  assumptionsAndMissingData: z.array(assumptionSchema).max(20),
  additionalReferenceImagesRequired: z.array(referenceImageNeededSchema).max(10),
  designerNotes: str(),
});
export type GarmentAnalysisPart4 = z.infer<typeof garmentAnalysisPart4Schema>;

export function validateGarmentAnalysisPart4(input: unknown): { success: true; data: GarmentAnalysisPart4 } | { success: false; error: string } {
  const result = garmentAnalysisPart4Schema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

/** The combined, persisted Garment Analysis — parts 1-4 together, exactly what the DB's `garmentAnalysisJson` column stores. */
export interface GarmentAnalysis {
  part1: GarmentAnalysisPart1;
  part2: GarmentAnalysisPart2;
  part3: GarmentAnalysisPart3;
  part4: GarmentAnalysisPart4;
}

/** The `{value,status}`-shaped scalar fields on Part 3 (Labels/Packaging/Hangtag/Barcode) — each directly replaceable via a `.value`/`.status` subfield path. `foldingInstructions` is deliberately excluded (a numbered-steps narrative, not a single fact). */
export const PART3_STATUS_FIELDS = [
  "mainLabelSpec",
  "sizeLabelSpec",
  "careLabelSpec",
  "polybagSpec",
  "cartonPackingSpec",
  "hangtagSpec",
  "barcodeType",
  "barcodeContent",
  "barcodePlacement",
] as const;

/** The 3 plain scalar-string fields on Part 1 that aren't part of an array. */
export const PART1_SCALAR_FIELDS = ["artworkSummary", "patternPrintType", "patternPrintNotes"] as const;

/** The 1 plain scalar-string field on Part 2 that isn't part of an array. */
export const PART2_SCALAR_FIELDS = ["gradeRulesNotes"] as const;

/** The 1 plain scalar-string field on Part 3 that isn't part of an array or a status field. */
export const PART3_SCALAR_FIELDS = ["foldingInstructions"] as const;

/** The 1 plain scalar-string field on Part 4 that isn't part of an array. */
export const PART4_SCALAR_FIELDS = ["designerNotes"] as const;

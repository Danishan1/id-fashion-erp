import { STANDARD_SIZES, type GarmentAnalysisPart1 } from "./schema";

/**
 * Every prompt in this file is written to faithfully implement the user's
 * own "GARMENT TECH PACK SPEC SHEET GENERATOR" system prompt (supplied
 * verbatim, 2026-09-13, "ye prompt use kro" — use this prompt) — split
 * across 2 real AI calls (Part 1 vision, Part 2 text) rather than one
 * mega-call, for the same reason every other multi-category AI Garment Flow/
 * AI Designer process in this codebase splits a large deliverable into
 * focused calls: keeps each call's schema/output size well inside
 * Anthropic's real, confirmed-live limits (a compiled strict-mode
 * tool-schema grammar-size ceiling, and a 16000-max-output-tokens ceiling on
 * a single response) rather than risking truncation or an outright 400.
 *
 * v3 (2026-09-14): the third AI call this file used to make ("Part 3" — 4
 * image-generation prompts for the tech-pack's own drawn garment artwork)
 * was removed entirely, per the user's own explicit, repeated rule against
 * using AI image generation to build the document at all. The two real
 * fields that call also produced — `designerNotes`/`suggestedAdditionalViews`
 * — were folded into Part 2's own schema/prompt instead, since Part 2
 * already has the complete analysis in hand at that point; this removes a
 * whole AI call rather than just its image-prompt half.
 */
export const GARMENT_ANALYSIS_PART1_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part1-v1";
export const GARMENT_ANALYSIS_PART2_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part2-v2";

export interface TechPackDesignContext {
  productCategory: string;
  designSelections: string;
  fabricDescription: string;
  targetCustomer: string;
  ageGroup: string;
  projectName: string;
}

function contextLines(ctx: TechPackDesignContext): string[] {
  return [
    `Project / Style Name: ${ctx.projectName}`,
    `Garment Category: ${ctx.productCategory}`,
    `Design Details: ${ctx.designSelections}`,
    `Fabric: ${ctx.fabricDescription}`,
    `Target Customer: ${ctx.targetCustomer}`,
    `Age Group: ${ctx.ageGroup}`,
  ];
}

const FLAGGING_RULES = `If a detail is unclear or not actually visible in the image, mark that field's value as "[NOT VISIBLE — confirm with designer]". If a detail is inferred rather than directly seen, mark it as "[ASSUMED — confirm with designer]". Never invent a specific detail (an exact brand, style number, date, or designer name) without one of these two flags — only state a detail as fact when it is genuinely visible in the image or is a standard, uncontroversial convention for this garment type.`;

// ---------------------------------------------------------------------------
// Part 1 (vision) — Categories A-G
// ---------------------------------------------------------------------------

export function buildGarmentAnalysisPart1SystemPrompt(): string {
  return `You are a Senior Technical Fashion Designer and Apparel Product Developer with 20+ years of experience creating factory-ready garment tech packs for manufacturers, sourcing teams, and apparel suppliers. You are NOT a fashion stylist or creative director giving opinions — you are a technical translator for apparel manufacturing, and your output must resemble a real supplier tech pack (Nike/Balenciaga/Zara-style production specification sheets, professional apparel CAD documentation).

Analyze the supplied garment image and extract every visible and inferable technical detail across the categories below. ${FLAGGING_RULES}

## A. GARMENT IDENTIFICATION
Brand name, style name, style number, garment category, sub-category, fit type, gender/category, target season, base sample size, date created, designer.

## B. CONSTRUCTION & SILHOUETTE
Silhouette, body shape, body length, width, hem shape, side seam construction, shoulder construction, sleeve construction, hood/collar construction, rib trims, paneling, drop shoulder amount, cuff construction, neck construction. Use professional apparel-construction terminology throughout (e.g. overlock, coverstitch, safety stitch, twin needle, topstitch, bartack, rib knit, self-fabric binding).

## C. CLOSURE SYSTEM
Determine the closure system (pullover / zipper / buttons / drawcord / snaps / velcro / toggle system). If there is no closure at all, state that clearly rather than flagging it as unclear.

## D. PANELS & SEAM CONSTRUCTION
Identify every seam line, panel join, shoulder seam, sleeve seam, hood seam, hem seam, rib attachment, and artwork application visible on the garment, and assign each one a numbered callout with its location, a technical specification, and a status of "PROPOSED" (your own inference) or "CONFIRMED" (clearly visible and unambiguous).

## E. COLORS & COLORWAYS
For the visible colorway: identify every color, estimate a Pantone reference and a HEX value for each, and map each color to the garment panel it appears on. Then, separately, propose 2-3 logical commercial colorways (alternate color stories a buyer might request) — each with a colorway code, colorway name, main color, contrast color, trim color, artwork color, and notes.

## F. ARTWORK & GRAPHICS
Document every artwork/graphic element: type (screen print / embroidery / puff print / DTG / heat transfer / appliqué / etc.), placement, scale, dimensions, alignment, print method, distance from HPS (high point shoulder), and distance from CF (center front). If there is no artwork at all, return an empty list and say so plainly in the summary field.

## G. PATTERN / PRINT
If applicable, describe any repeat pattern, placement print, sublimation, engineered print, distressed wash, fade, spray effect, or graphic texture. If none applies, state that plainly.`;
}

export function buildGarmentAnalysisPart1UserText(ctx: TechPackDesignContext): string {
  return contextLines(ctx).join("\n");
}

function stringField() {
  return { type: "string" };
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required };
}

export function buildGarmentAnalysisPart1ToolInputSchema() {
  const stringFields = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, stringField()]));

  return {
    type: "object" as const,
    properties: {
      identification: objectSchema(
        stringFields([
          "brandName",
          "styleName",
          "styleNumber",
          "garmentCategory",
          "subCategory",
          "fitType",
          "genderCategory",
          "targetSeason",
          "baseSampleSize",
          "dateCreated",
          "designer",
        ]),
        ["brandName", "styleName", "styleNumber", "garmentCategory", "subCategory", "fitType", "genderCategory", "targetSeason", "baseSampleSize", "dateCreated", "designer"]
      ),
      construction: objectSchema(
        stringFields([
          "silhouette",
          "bodyShape",
          "bodyLength",
          "width",
          "hemShape",
          "sideSeamConstruction",
          "shoulderConstruction",
          "sleeveConstruction",
          "hoodCollarConstruction",
          "ribTrims",
          "paneling",
          "dropShoulderAmount",
          "cuffConstruction",
          "neckConstruction",
        ]),
        [
          "silhouette",
          "bodyShape",
          "bodyLength",
          "width",
          "hemShape",
          "sideSeamConstruction",
          "shoulderConstruction",
          "sleeveConstruction",
          "hoodCollarConstruction",
          "ribTrims",
          "paneling",
          "dropShoulderAmount",
          "cuffConstruction",
          "neckConstruction",
        ]
      ),
      closure: objectSchema(stringFields(["closureType", "closureDetails"]), ["closureType", "closureDetails"]),
      seamCallouts: {
        type: "array",
        items: objectSchema(
          {
            calloutNumber: { type: "number" },
            location: stringField(),
            technicalSpecification: stringField(),
            status: { type: "string", enum: ["PROPOSED", "CONFIRMED"] },
          },
          ["calloutNumber", "location", "technicalSpecification", "status"]
        ),
      },
      visibleColors: {
        type: "array",
        items: objectSchema(stringFields(["colorName", "pantoneEstimate", "hexEstimate", "garmentPanel"]), ["colorName", "pantoneEstimate", "hexEstimate", "garmentPanel"]),
      },
      suggestedColorways: {
        type: "array",
        items: objectSchema(
          stringFields(["colorwayCode", "colorwayName", "mainColor", "contrastColor", "trimColor", "artworkColor", "notes"]),
          ["colorwayCode", "colorwayName", "mainColor", "contrastColor", "trimColor", "artworkColor", "notes"]
        ),
      },
      artworkItems: {
        type: "array",
        items: objectSchema(
          stringFields(["artworkType", "placement", "scale", "dimensions", "alignment", "printMethod", "distanceFromHps", "distanceFromCf"]),
          ["artworkType", "placement", "scale", "dimensions", "alignment", "printMethod", "distanceFromHps", "distanceFromCf"]
        ),
      },
      artworkSummary: stringField(),
      patternPrintType: stringField(),
      patternPrintNotes: stringField(),
    },
    required: [
      "identification",
      "construction",
      "closure",
      "seamCallouts",
      "visibleColors",
      "suggestedColorways",
      "artworkItems",
      "artworkSummary",
      "patternPrintType",
      "patternPrintNotes",
    ],
  };
}

// ---------------------------------------------------------------------------
// Part 2 (text) — Categories H, I, J, plus designer notes / suggested
// additional views (folded in from the now-removed Part 3 image-prompt call)
// ---------------------------------------------------------------------------

export function buildGarmentAnalysisPart2SystemPrompt(): string {
  return `You are the same Senior Technical Fashion Designer and Apparel Product Developer continuing this garment's tech pack. You are given the garment analysis already completed (categories A-G) — use it as ground truth, never contradict it.

## H. BILL OF MATERIALS (BOM)
Generate an EXHAUSTIVE bill of materials — at least 14 distinct line items — covering every relevant category the design actually calls for: fabrics, rib, labels, threads, print inks, packaging, polybags, hangtags, care labels, neck tape, interfacing, drawcords, zippers, hardware. For each line give: material type, composition, GSM (or "N/A" if not applicable), color, a realistic consumption estimate with unit, and notes. Never invent an exact cost.

## I. MEASUREMENTS & GRADING
Generate a graded Point-of-Measure (POM) chart: 6-15 measurement points genuinely relevant to this specific garment (never a point that makes no sense for the category). For each point give: point name, how-to-measure instruction, tolerance in cm, and a graded value for every one of these sizes: ${STANDARD_SIZES.join(", ")} — graded sensibly from a reasonable base size (M), with the grading math consistent across sizes (each larger size's value increases by a sensible, consistent increment for that point). Also give overall grade-rules notes.

## J. LABELS & PACKAGING
Generate: main label spec, size label spec, care label spec, hangtag spec, polybag spec, folding instructions, carton packing spec, and barcode placement.

## DESIGNER NOTES & SUGGESTED ADDITIONAL VIEWS
Also return "designerNotes" (a list of every assumption and unclear area flagged during the full analysis so far, categories A-J) and "suggestedAdditionalViews" (a list of recommended reference images/angles that would improve this tech pack's accuracy, e.g. a flat-lay back view or a close-up of the trim).

State plainly, in your own notes, that this BOM and measurement chart are a reasonable starting draft only, pending real technical costing, sourcing, and grading review — never present them as confirmed final production figures.`;
}

export function buildGarmentAnalysisPart2UserText(ctx: TechPackDesignContext, part1: GarmentAnalysisPart1): string {
  return [
    ...contextLines(ctx),
    "",
    "Garment analysis so far (categories A-G):",
    JSON.stringify(part1, null, 2),
  ].join("\n");
}

export function buildGarmentAnalysisPart2ToolInputSchema() {
  const stringFields = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, stringField()]));

  return {
    type: "object" as const,
    properties: {
      bomItems: {
        type: "array",
        items: objectSchema(
          stringFields(["materialType", "composition", "gsm", "color", "consumption", "notes"]),
          ["materialType", "composition", "gsm", "color", "consumption", "notes"]
        ),
      },
      measurementPoints: {
        type: "array",
        items: objectSchema(
          {
            pointName: stringField(),
            howToMeasure: stringField(),
            toleranceCm: stringField(),
            values: objectSchema(Object.fromEntries(STANDARD_SIZES.map((s) => [s, stringField()])), [...STANDARD_SIZES]),
          },
          ["pointName", "howToMeasure", "toleranceCm", "values"]
        ),
      },
      gradeRulesNotes: stringField(),
      mainLabelSpec: stringField(),
      sizeLabelSpec: stringField(),
      careLabelSpec: stringField(),
      hangtagSpec: stringField(),
      polybagSpec: stringField(),
      foldingInstructions: stringField(),
      cartonPackingSpec: stringField(),
      barcodePlacement: stringField(),
      designerNotes: stringField(),
      suggestedAdditionalViews: stringField(),
    },
    required: [
      "bomItems",
      "measurementPoints",
      "gradeRulesNotes",
      "mainLabelSpec",
      "sizeLabelSpec",
      "careLabelSpec",
      "hangtagSpec",
      "polybagSpec",
      "foldingInstructions",
      "cartonPackingSpec",
      "barcodePlacement",
      "designerNotes",
      "suggestedAdditionalViews",
    ],
  };
}

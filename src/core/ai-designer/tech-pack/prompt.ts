import { CONFIDENCE_STATUSES, STANDARD_SIZES, type GarmentAnalysisPart1, type GarmentAnalysisPart2, type GarmentAnalysisPart3 } from "./schema";

/**
 * Every prompt in this file is written to faithfully implement the user's
 * own "SYSTEM PROMPT — GARMENT TECH PACK STRUCTURED DATA GENERATOR" (supplied
 * verbatim, 2026-09-22, "is prompt ka use kr skte ho yhi achha ho to" — can
 * you use this prompt) — split across 4 real AI calls (Part 1 vision, Parts
 * 2/3/4 text, run concurrently once Part 1 resolves) rather than one
 * mega-call, for the same reason every other multi-category AI Garment
 * Flow/AI Designer process in this codebase splits a large deliverable into
 * focused calls: keeps each call's schema/output size well inside
 * Anthropic's real, confirmed-live limits (a compiled strict-mode
 * tool-schema grammar-size ceiling, and a 16000-max-output-tokens ceiling on
 * a single response) rather than risking truncation or an outright 400.
 *
 * v4 (2026-09-22) supersedes v1-v3's simpler spec-sheet prompt (see
 * schema.ts's own v4 doc comment for the full list of what changed): the new
 * system prompt's own "DO NOT generate image-generation prompts... Return
 * actual Tech Pack DATA" instruction is fully consistent with this project's
 * own, separately-confirmed rule against using AI image generation to build
 * this document at all (see the doc comment on generateTechPack in
 * ai-designer.service.ts) — no conflict, nothing to reconcile.
 */
export const GARMENT_ANALYSIS_PART1_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part1-v2";
export const GARMENT_ANALYSIS_PART2_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part2-v3";
export const GARMENT_ANALYSIS_PART3_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part3-v1";
export const GARMENT_ANALYSIS_PART4_PROMPT_VERSION = "ai-designer-tech-pack-analysis-part4-v1";

export interface TechPackDesignContext {
  productCategory: string;
  designSelections: string;
  fabricDescription: string;
  targetCustomer: string;
  ageGroup: string;
  projectName: string;
  /**
   * Sketch / Drawing → Garment (2026-09-20) — populated only for a
   * SKETCH-mode project, from its approved Sketch Analysis's own locked
   * observations. The Tech Pack's own vision call still analyzes the FINAL
   * generated garment PHOTO (per the product requirement: "represent the
   * final approved garment, not blindly copy the original sketch"), never
   * this note alone — this is additional grounding context, not a
   * replacement for that image.
   */
  sketchDesignNote?: string;
  /**
   * Fuller fabric/model/environment detail, widened from the original
   * name/composition/GSM-only shape so the AI's own construction/silhouette
   * inferences (categories B/D, which legitimately need to come from the
   * model, not the app) are made with the full real context this project
   * already has on file — mirrors buildSpecJson()'s own shape in
   * ai-designer.service.ts.
   */
  fabricDetail?: string;
  modelDescription?: string;
  environmentDescription?: string;
  /**
   * Multi-piece Set support (2026-09-22) — populated only when the project's
   * AiDesignerProjectMode is SET (e.g. Kurta + Pant + Dupatta). Each entry is
   * a plain "Label (Category) — design notes" line, built server-side from
   * AiDesignerProjectPiece rows. Absent/undefined for every ordinary
   * SINGLE-garment project — leaves this whole feature a no-op there.
   */
  garmentPieces?: string[];
}

function contextLines(ctx: TechPackDesignContext): string[] {
  const lines = [
    `Project / Style Name: ${ctx.projectName}`,
    `Garment Category: ${ctx.productCategory}`,
    `Design Details: ${ctx.designSelections}`,
    `Fabric: ${ctx.fabricDescription}`,
    `Target Customer: ${ctx.targetCustomer}`,
    `Age Group: ${ctx.ageGroup}`,
  ];
  if (ctx.garmentPieces && ctx.garmentPieces.length > 0) {
    lines.push(
      `This is a coordinated ${ctx.garmentPieces.length}-piece SET, not a single garment. The pieces are:`,
      ...ctx.garmentPieces.map((p, i) => `  ${i + 1}. ${p}`)
    );
  }
  if (ctx.sketchDesignNote) {
    lines.push(`Originating Sketch Design (for reference — the supplied photo of the FINAL approved garment is the authoritative source, use this note only as supporting context): ${ctx.sketchDesignNote}`);
  }
  if (ctx.fabricDetail) lines.push(`Additional Fabric Detail: ${ctx.fabricDetail}`);
  if (ctx.modelDescription) lines.push(`Model: ${ctx.modelDescription}`);
  if (ctx.environmentDescription) lines.push(`Environment: ${ctx.environmentDescription}`);
  return lines;
}

const STATUS_TAGGING_RULES = `Every field that carries its own "status" property must be tagged with EXACTLY ONE of: ${CONFIDENCE_STATUSES.join(", ")} — never bake a confidence marker into the text value itself.
- CONFIRMED: clearly, unambiguously visible/stated in the supplied image or context.
- INFERRED: a reasonable technical inference from what IS visible (e.g. a standard construction method for this exact garment type).
- PROPOSED: your own recommendation/draft where no single correct answer exists (e.g. a suggested colorway, a proposed QC tolerance, a suggested carton spec).
- TBC: genuinely undetermined and must be confirmed by a human before production.
- NOT_VISIBLE: the detail is simply not visible/present in the supplied image at all.
Never mark a fabricated, invented, or guessed-with-false-confidence detail as CONFIRMED. When in doubt between two tags, choose the more conservative one (prefer TBC/NOT_VISIBLE over INFERRED/PROPOSED over CONFIRMED).

DATA INTEGRITY RULES — never fabricate: an exact measurement value, GSM figure, fiber composition percentage, fabric/trim consumption quantity, Pantone reference, or a physical dimension (artwork placement distance, carton dimensions/weight) that is not genuinely determinable — always tag such a field TBC/INFERRED/PROPOSED rather than presenting an invented number as CONFIRMED fact. Likewise never invent legal/compliance label text (country of origin, fiber-content legal wording, safety warnings) as a fixed fact — describe the SPEC/PLACEMENT of such labels, tagged appropriately, rather than authoring their exact legal wording.

You are producing REAL TECH PACK DATA for a supplier/manufacturer, not image-generation prompts or creative copy — never describe how to draw or render anything; describe the real technical specification.`;

// ---------------------------------------------------------------------------
// Part 1 (vision) — Categories A-G
// ---------------------------------------------------------------------------

export function buildGarmentAnalysisPart1SystemPrompt(): string {
  return `You are a Senior Technical Fashion Designer and Apparel Product Developer with 20+ years of experience creating factory-ready garment tech packs for manufacturers, sourcing teams, and apparel suppliers. You are NOT a fashion stylist or creative director giving opinions — you are a technical translator for apparel manufacturing, and your output must resemble a real supplier tech pack (Nike/Balenciaga/Zara-style production specification sheets, professional apparel CAD documentation).

Analyze the supplied garment image and extract every visible and inferable technical detail across the categories below.

${STATUS_TAGGING_RULES}

## A. GARMENT IDENTIFICATION
Brand name, style name, style number, garment category, sub-category, fit type, gender/category, target season, base sample size, date created, designer — each tagged with its own status.

## B. CONSTRUCTION & SILHOUETTE
Silhouette, body shape, body length, width, hem shape, side seam construction, shoulder construction, sleeve construction, hood/collar construction, rib trims, paneling, drop shoulder amount, cuff construction, neck construction — each tagged with its own status. Use professional apparel-construction terminology throughout (e.g. overlock, coverstitch, safety stitch, twin needle, topstitch, bartack, rib knit, self-fabric binding).

## C. CLOSURE SYSTEM
Determine the closure system (pullover / zipper / buttons / drawcord / snaps / velcro / toggle system), each tagged with its own status. If there is no closure at all, state that clearly rather than flagging it as unclear.

## D. PANELS & SEAM CONSTRUCTION
Identify every seam line, panel join, shoulder seam, sleeve seam, hood seam, hem seam, rib attachment, and artwork application visible on the garment, and assign each one a numbered callout with its location, a technical specification, and an overall status. For each callout, also estimate its approximate position on THIS image as a percentage from the top-left corner (xPercent/yPercent, each 0-100) — your best-effort visual estimate of where that detail actually appears in the photo. Omit xPercent/yPercent entirely for a callout if you cannot confidently estimate a position; never guess a position for a detail you cannot actually locate in the image.

## E. COLORS & COLORWAYS
For the visible colorway: identify every color, estimate a Pantone reference and a HEX value for each (each individually tagged with its own status — a color name and garment panel are directly observed facts and stay plain text), and map each color to the garment panel it appears on. Then, separately, propose 2-3 logical commercial colorways (alternate color stories a buyer might request) — each with a colorway code, colorway name, main color, contrast color, trim color, artwork color, and notes. Also provide a best-effort HEX estimate for each of a colorway's main/contrast/trim/artwork colors (mainColorHex/contrastColorHex/trimColorHex/artworkColorHex) so it can be shown as a real swatch — omit any of these you cannot reasonably estimate rather than guessing.

## F. ARTWORK & GRAPHICS
Document every artwork/graphic element: type (screen print / embroidery / puff print / DTG / heat transfer / appliqué / etc.), placement, scale, dimensions (tagged with its own status — this is a physical-dimension field, never fabricate an exact size), alignment, print method, distance from HPS (high point shoulder, tagged), and distance from CF (center front, tagged). If there is no artwork at all, return an empty list and say so plainly in the summary field.

## G. PATTERN / PRINT
If applicable, describe any repeat pattern, placement print, sublimation, engineered print, distressed wash, fade, spray effect, or graphic texture. If none applies, state that plainly.`;
}

export function buildGarmentAnalysisPart1UserText(ctx: TechPackDesignContext): string {
  return contextLines(ctx).join("\n");
}

function stringField() {
  return { type: "string" };
}

function statusValueField() {
  return objectSchema({ value: stringField(), status: { type: "string", enum: [...CONFIDENCE_STATUSES] } }, ["value", "status"]);
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", properties, required };
}

export function buildGarmentAnalysisPart1ToolInputSchema() {
  const statusFields = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, statusValueField()]));

  return {
    type: "object" as const,
    properties: {
      identification: objectSchema(
        statusFields([
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
        statusFields([
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
      closure: objectSchema(statusFields(["closureType", "closureDetails"]), ["closureType", "closureDetails"]),
      seamCallouts: {
        type: "array",
        items: objectSchema(
          {
            calloutNumber: { type: "number" },
            location: stringField(),
            technicalSpecification: stringField(),
            status: { type: "string", enum: [...CONFIDENCE_STATUSES] },
            // Optional — not in `required` below — so the model can omit a
            // position it cannot confidently estimate rather than guessing.
            xPercent: { type: "number" },
            yPercent: { type: "number" },
          },
          ["calloutNumber", "location", "technicalSpecification", "status"]
        ),
      },
      visibleColors: {
        type: "array",
        items: objectSchema(
          { colorName: stringField(), pantoneEstimate: statusValueField(), hexEstimate: statusValueField(), garmentPanel: stringField() },
          ["colorName", "pantoneEstimate", "hexEstimate", "garmentPanel"]
        ),
      },
      suggestedColorways: {
        type: "array",
        items: objectSchema(
          {
            colorwayCode: stringField(),
            colorwayName: stringField(),
            mainColor: stringField(),
            contrastColor: stringField(),
            trimColor: stringField(),
            artworkColor: stringField(),
            notes: stringField(),
            mainColorHex: stringField(),
            contrastColorHex: stringField(),
            trimColorHex: stringField(),
            artworkColorHex: stringField(),
          },
          // Only the original 7 fields are required — the 4 *Hex fields are optional (see prompt Section E and schema.ts's own doc comment).
          ["colorwayCode", "colorwayName", "mainColor", "contrastColor", "trimColor", "artworkColor", "notes"]
        ),
      },
      artworkItems: {
        type: "array",
        items: objectSchema(
          {
            artworkType: stringField(),
            placement: stringField(),
            scale: stringField(),
            dimensions: statusValueField(),
            alignment: stringField(),
            printMethod: stringField(),
            distanceFromHps: statusValueField(),
            distanceFromCf: statusValueField(),
          },
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
// Part 2 (text) — Fabric & Materials (NEW), Bill of Materials, Measurements
// & Grading
// ---------------------------------------------------------------------------

function priorAnalysisLines(ctx: TechPackDesignContext, part1: GarmentAnalysisPart1): string[] {
  return [...contextLines(ctx), "", "Garment analysis already completed (categories A-G) — use it as ground truth, never contradict it:", JSON.stringify(part1, null, 2)];
}

function setPieceTaggingInstruction(ctx: TechPackDesignContext): string {
  if (!ctx.garmentPieces || ctx.garmentPieces.length === 0) return "";
  return `\n\nMULTI-PIECE SET — this project is a coordinated ${ctx.garmentPieces.length}-piece set (see the Garment Pieces list in the context above), not one single garment. Generate SEPARATE, appropriately-scoped lines/points for EACH piece — e.g. a Kurta's own chest/length measurements are genuinely different from a Pant's own waist/inseam, and each piece's own fabric/trim lines. Tag EVERY Fabric & Materials line, EVERY BOM line, and EVERY measurement point with the "garmentPiece" field, set to the exact piece label given in context (e.g. "Kurta"), or to "Common / Shared" for an item genuinely used across every piece (e.g. sewing thread, a shared hangtag). Do not produce one generic set of measurements/BOM lines that ignores which piece they belong to.`;
}

export function buildGarmentAnalysisPart2SystemPrompt(ctx?: TechPackDesignContext): string {
  return `You are the same Senior Technical Fashion Designer and Apparel Product Developer continuing this garment's tech pack.

${STATUS_TAGGING_RULES}

## FABRIC & MATERIALS (its own table, separate from the Bill of Materials below)
List every distinct fabric/material used in the garment's own body — shell fabric, lining, interlining, pocketing, rib/cuff fabric, etc. — as its own line. For each: material role (e.g. "Shell — Body", "Lining", "Interlining"), fabric type (e.g. "Single Jersey Knit", "Woven Twill"), composition (tagged), GSM (tagged), usable width (tagged), finish (e.g. "Enzyme Wash", "Peached"), a realistic consumption estimate with unit (tagged), and any supplier/sourcing notes. This table is about the RAW FABRIC itself — trims, labels, and packaging materials belong in the Bill of Materials below, not here.

## BILL OF MATERIALS (BOM)
Generate an EXHAUSTIVE bill of materials — at least 10 distinct line items — covering every TRIM/NOTION/COMPONENT the design actually calls for (not the body fabric itself, which is in Fabric & Materials above): rib, labels, threads, print inks, zippers, buttons, drawcords, elastic, interfacing, hardware, hangtag string, poly bags. For each line give: material type, composition (tagged), GSM or "N/A" (tagged), color, a realistic consumption estimate with unit (tagged), and notes.

## MEASUREMENTS & GRADING
Generate a graded Point-of-Measure (POM) chart: 6-15 measurement points genuinely relevant to this specific garment (never a point that makes no sense for the category). For each point give: point name, how-to-measure instruction, tolerance in cm, an overall status for the whole graded row, and a graded value for every one of these sizes: ${STANDARD_SIZES.join(", ")} — graded sensibly from a reasonable base size (M), with the grading math consistent across sizes (each larger size's value increases by a sensible, consistent increment for that point). Also give overall grade-rules notes.

State plainly, in your notes, that this BOM, fabric table, and measurement chart are a reasonable starting draft only, pending real technical costing, sourcing, and grading review — never present them as confirmed final production figures.${ctx ? setPieceTaggingInstruction(ctx) : ""}`;
}

export function buildGarmentAnalysisPart2UserText(ctx: TechPackDesignContext, part1: GarmentAnalysisPart1): string {
  return priorAnalysisLines(ctx, part1).join("\n");
}

export function buildGarmentAnalysisPart2ToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      fabricMaterials: {
        type: "array",
        items: objectSchema(
          {
            materialRole: stringField(),
            fabricType: stringField(),
            composition: statusValueField(),
            gsm: statusValueField(),
            width: statusValueField(),
            finish: stringField(),
            consumption: statusValueField(),
            supplierNotes: stringField(),
            // Optional — omitted from `required` — so a SINGLE-garment
            // project's response simply never carries it.
            garmentPiece: stringField(),
          },
          ["materialRole", "fabricType", "composition", "gsm", "width", "finish", "consumption", "supplierNotes"]
        ),
      },
      bomItems: {
        type: "array",
        items: objectSchema(
          {
            materialType: stringField(),
            composition: statusValueField(),
            gsm: statusValueField(),
            color: stringField(),
            consumption: statusValueField(),
            notes: stringField(),
            garmentPiece: stringField(),
          },
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
            status: { type: "string", enum: [...CONFIDENCE_STATUSES] },
            values: objectSchema(Object.fromEntries(STANDARD_SIZES.map((s) => [s, stringField()])), [...STANDARD_SIZES]),
            garmentPiece: stringField(),
          },
          ["pointName", "howToMeasure", "toleranceCm", "status", "values"]
        ),
      },
      gradeRulesNotes: stringField(),
    },
    required: ["fabricMaterials", "bomItems", "measurementPoints", "gradeRulesNotes"],
  };
}

// ---------------------------------------------------------------------------
// Part 3 (text, NEW) — Production Instructions, QC Checkpoints, Labels &
// Packaging, Hangtag & Barcode (split out of Labels & Packaging)
// ---------------------------------------------------------------------------

export function buildGarmentAnalysisPart3SystemPrompt(): string {
  return `You are the same Senior Technical Fashion Designer and Apparel Product Developer continuing this garment's tech pack.

${STATUS_TAGGING_RULES}

## PRODUCTION INSTRUCTIONS
Write a clear, numbered, sewing-floor-ready sequence of production/construction steps for this exact garment (4-15 steps) — e.g. "1. Overlock shoulder seams with 4-thread safety stitch", "2. Attach rib collar with twin-needle topstitch". Order them the way a garment is actually assembled.

## QUALITY CONTROL CHECKPOINTS
List 5-12 QC checkpoints a quality inspector would actually check before this garment ships — for each: the checkpoint area (e.g. "Seam Strength", "Print Placement", "Measurement Tolerance"), what to check, the acceptance criteria, and the tool or method used to check it (e.g. "tape measure", "visual inspection under standard light", "wash test").

## LABELS & PACKAGING
Generate, each tagged with its own status: main label spec, size label spec, care label spec, polybag spec, and carton packing spec. Also give folding instructions as a plain numbered-steps description (not tagged — this is a packing procedure, not a single fact).

## HANGTAG & BARCODE (its own section, separate from the labels above)
Generate, each tagged with its own status: hangtag spec (size/material/printed content), barcode type (e.g. "UPC-A", "EAN-13", "Code128"), barcode content/what it encodes, and barcode placement on the garment/packaging.`;
}

export function buildGarmentAnalysisPart3UserText(ctx: TechPackDesignContext, part1: GarmentAnalysisPart1): string {
  return priorAnalysisLines(ctx, part1).join("\n");
}

export function buildGarmentAnalysisPart3ToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      productionInstructions: {
        type: "array",
        items: objectSchema({ stepNumber: { type: "number" }, instruction: stringField() }, ["stepNumber", "instruction"]),
      },
      qcCheckpoints: {
        type: "array",
        items: objectSchema(
          { checkpointArea: stringField(), whatToCheck: stringField(), acceptanceCriteria: stringField(), toolsOrMethod: stringField() },
          ["checkpointArea", "whatToCheck", "acceptanceCriteria", "toolsOrMethod"]
        ),
      },
      mainLabelSpec: statusValueField(),
      sizeLabelSpec: statusValueField(),
      careLabelSpec: statusValueField(),
      polybagSpec: statusValueField(),
      foldingInstructions: stringField(),
      cartonPackingSpec: statusValueField(),
      hangtagSpec: statusValueField(),
      barcodeType: statusValueField(),
      barcodeContent: statusValueField(),
      barcodePlacement: statusValueField(),
    },
    required: [
      "productionInstructions",
      "qcCheckpoints",
      "mainLabelSpec",
      "sizeLabelSpec",
      "careLabelSpec",
      "polybagSpec",
      "foldingInstructions",
      "cartonPackingSpec",
      "hangtagSpec",
      "barcodeType",
      "barcodeContent",
      "barcodePlacement",
    ],
  };
}

// ---------------------------------------------------------------------------
// Part 4 (text, NEW) — Assumptions & Missing Data, Additional Reference
// Images Required, plus the carried-forward Designer Notes overview
// ---------------------------------------------------------------------------

export function buildGarmentAnalysisPart4SystemPrompt(): string {
  return `You are the same Senior Technical Fashion Designer and Apparel Product Developer wrapping up this garment's tech pack. You have now completed the full analysis (identification, construction, closure, seams, colors, artwork, fabric, BOM, measurements, production instructions, QC checkpoints, labels, packaging, hangtag, barcode). Review the ENTIRE analysis supplied to you and produce a final honesty pass.

## ASSUMPTIONS & MISSING DATA
Consolidate every item across the whole analysis that you tagged (or should have tagged) as anything other than CONFIRMED into one list — for each: the item name, the specific assumption or gap, and its status (one of ${CONFIDENCE_STATUSES.join(", ")}). This is the single place a designer/merchandiser can scan to see exactly what still needs verifying before this tech pack goes to a factory. If genuinely nothing needs flagging, return an empty list rather than inventing filler entries.

## ADDITIONAL REFERENCE IMAGES REQUIRED
List every additional reference image/angle that would materially improve this tech pack's accuracy (e.g. "Back flat-lay view", "Close-up of the zipper pull", "Interior lining shot") — for each, state the view needed and why it's needed. If the single supplied image is genuinely sufficient, return an empty list.

## DESIGNER NOTES
Write a short (2-5 sentence) overall summary for the designer/merchandiser reading this tech pack — the headline takeaways, and a reminder that the BOM, fabric table, and measurement chart are a starting draft pending real technical review.`;
}

export function buildGarmentAnalysisPart4UserText(ctx: TechPackDesignContext, part1: GarmentAnalysisPart1, part2: GarmentAnalysisPart2, part3: GarmentAnalysisPart3): string {
  return [
    ...contextLines(ctx),
    "",
    "Full analysis so far:",
    JSON.stringify({ part1, part2, part3 }, null, 2),
  ].join("\n");
}

export function buildGarmentAnalysisPart4ToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      assumptionsAndMissingData: {
        type: "array",
        items: objectSchema({ item: stringField(), assumptionMade: stringField(), status: { type: "string", enum: [...CONFIDENCE_STATUSES] } }, ["item", "assumptionMade", "status"]),
      },
      additionalReferenceImagesRequired: {
        type: "array",
        items: objectSchema({ viewNeeded: stringField(), reason: stringField() }, ["viewNeeded", "reason"]),
      },
      designerNotes: stringField(),
    },
    required: ["assumptionsAndMissingData", "additionalReferenceImagesRequired", "designerNotes"],
  };
}

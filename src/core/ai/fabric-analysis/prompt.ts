import { FABRIC_CONFIDENCE_VALUES } from "./schema";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output shape/meaning — stored on every AiGarmentFabricAnalysis /
 * AiGarmentFabricAnalysisRun row so a past analysis stays auditable against
 * the exact prompt that produced it, even after this text changes.
 */
export const PROMPT_VERSION = "fabric-analysis-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — only used
 * server-side inside requestStructuredVisionOutput(). Written fresh for this
 * process (no verbatim brief exists, unlike Processes 1/2/5/6 — only the
 * process name and the dead AIService.analyseFabric() placeholder signature
 * were given), matching the tone/discipline already established by
 * reference-analysis's own prompt: confidence-graded, never fabricated,
 * never overreaching into a later process's own job.
 */
export const FABRIC_ANALYSIS_SYSTEM_PROMPT = `You are an experienced textile technologist and garment manufacturing consultant.

You are analysing a photograph of a fabric swatch for a professional garment product-development workflow, at the very start of that workflow — before any garment has been designed against it.

The purpose is to understand:
- the fabric's physical structure (woven vs. knit, apparent weight, likely composition)
- its visual characteristics (color, pattern, texture, sheen, transparency)
- its likely performance behaviour (stretch, drape, recovery)
- practical manufacturing considerations (cutting, sewing, care, quality risks)

Analyse ONLY what can reasonably be determined from the supplied photograph.

Never present uncertain visual assumptions as confirmed laboratory facts. You cannot measure GSM, exact fibre content, exact stretch percentage, or colourfastness from a photo — only estimate them.

For every observation assign exactly one confidence classification:
- CONFIRMED VISUALLY
- LIKELY / INFERRED
- NOT DETERMINABLE

If an item cannot be seen or reliably inferred, explicitly mark it as NOT DETERMINABLE rather than guessing.

Do not invent an exact fibre composition, exact GSM figure, or exact stretch percentage — describe these only as estimated classes or ranges (e.g. "likely a cotton-elastane blend", "medium-weight, roughly 180-220 GSM range", "moderate two-way stretch").

Analyse the following:

1. FABRIC TYPE — woven, knit, non-woven, or another construction.
2. WEAVE / KNIT STRUCTURE — e.g. plain weave, twill, satin, single jersey, rib, interlock, fleece-back.
3. ESTIMATED COMPOSITION — a likely fibre-content guess based only on visual appearance (sheen, drape, weave), clearly framed as an estimate.
4. ESTIMATED WEIGHT CLASS — lightweight, medium-weight, or heavyweight, with an approximate GSM range if you can reasonably infer one.
5. DIRECTIONALITY — whether the fabric is non-directional, has a nap/one-way sheen, or has a stripe/check requiring pattern matching.
6. COLOR — the dominant color(s) visible.
7. PATTERN / PRINT — solid, stripe, check, floral, engineered print, etc., and its scale if applicable.
8. SURFACE TEXTURE — smooth, textured/slubbed, brushed/fleece, ribbed, etc.
9. SHEEN / LUSTER — matte, slight sheen, high sheen/satin-like.
10. TRANSPARENCY / OPACITY — opaque, semi-sheer, or sheer.
11. ESTIMATED STRETCH — none, slight (e.g. a woven with a little added elastane), moderate (typical single-knit), or high (4-way stretch).
12. ESTIMATED DRAPE — stiff/structured, medium, or fluid/soft.
13. ESTIMATED RECOVERY — how well the fabric is likely to spring back after stretching, if stretch is present at all; NOT_DETERMINABLE if the fabric shows no visible stretch.
14. CUTTING CONSIDERATIONS — practical notes for a cutting room (e.g. fraying risk at cut edges, stripe/check matching required, nap direction to respect).
15. SEWING CONSIDERATIONS — practical notes for sewing operators (e.g. needle type suited to a knit, puckering risk on a lightweight fabric, seam finishing needs).
16. CARE CONSIDERATIONS — a plain-language, visually-reasoned guess at likely care needs (e.g. "likely machine washable", "may need gentle/delicate handling", "pre-wash recommended for shrinkage").
17. POTENTIAL QUALITY RISKS — any fraying, pilling, shrinkage, or colour-consistency concerns visible or reasonably inferred from the photo.

Finally, create a FABRIC SUMMARY of maximum 150 words capturing the overall fabric character, its likely best-fit use cases in general terms, and the single most important consideration for whoever develops a garment from it next.

Do NOT suggest which specific garment types or products this fabric is suitable for — that decision belongs to a separate, later step in this workflow, not this one.
Do NOT design a garment.
Do NOT create a Bill of Materials.
Do NOT calculate costing.
Do NOT move into Product Suitability or Product Directions.

Return ONLY data matching the required structured JSON schema.`;

/**
 * Technical addendum (not part of the hidden business prompt above, and
 * never shown to end users either) explaining the exact tool-call contract
 * and the machine-readable enum tokens the tool schema constrains output
 * to — mirrors reference-analysis/prompt.ts's own addendum exactly.
 */
const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "confidence" field must be exactly one of: CONFIRMED_VISUALLY, LIKELY_INFERRED, NOT_DETERMINABLE. Every field in the schema is required — for a field you cannot determine, still provide an observation object with confidence NOT_DETERMINABLE and a brief note explaining why, rather than omitting the field.`;

export function buildSystemPrompt(): string {
  return `${FABRIC_ANALYSIS_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

/**
 * Only the non-sensitive project fields relevant to interpreting the swatch
 * (garment category hint, target market) are ever included — never pricing,
 * buyer identity, or any other company/commercial information not needed
 * for visual analysis, matching reference-analysis's own precedent exactly.
 */
export function buildUserText(projectContext: { garmentCategory?: string | null; targetMarket?: string | null }): string {
  const lines = ["Analyse the attached fabric swatch photograph."];
  if (projectContext.garmentCategory) {
    lines.push(
      `Known garment category context (if helpful, do not let this override what the photo actually shows): ${projectContext.garmentCategory}.`
    );
  }
  if (projectContext.targetMarket) {
    lines.push(`Target market context: ${projectContext.targetMarket}.`);
  }
  return lines.join("\n");
}

function observationNode() {
  return {
    type: "object",
    properties: {
      observation: { type: "string" },
      confidence: { type: "string", enum: [...FABRIC_CONFIDENCE_VALUES] },
      manufacturingRelevance: { type: "string" },
    },
    required: ["observation", "confidence", "manufacturingRelevance"],
  };
}

const OBSERVATION_KEYS = [
  "fabricType",
  "weaveOrKnitStructure",
  "estimatedComposition",
  "estimatedGsmClass",
  "directionality",
  "colorDescription",
  "patternOrPrint",
  "surfaceTexture",
  "sheenOrLuster",
  "transparencyLevel",
  "estimatedStretch",
  "estimatedDrape",
  "estimatedRecovery",
  "cuttingConsiderations",
  "sewingConsiderations",
  "careConsiderations",
  "potentialQualityRisks",
] as const;

/**
 * Built once from FABRIC_CONFIDENCE_VALUES + the shared key list — cannot
 * drift from schema.ts's Zod shape since both read from the same constant.
 * requestStructuredVisionOutput() always calls with strict: false (see
 * anthropic.ts), so the "compiled grammar too large" limit that forced
 * reference-analysis's own schema flat and its own strict:false decision
 * doesn't even apply here at this smaller size — kept flat anyway, for
 * consistency and because there is genuinely no natural nested grouping
 * among these 17 fields the way sleeve/fabricObservations/printPattern
 * grouped reference-analysis's 36.
 */
export function buildToolInputSchema() {
  const properties: Record<string, unknown> = {};
  for (const key of OBSERVATION_KEYS) properties[key] = observationNode();

  properties.missingInformation = { type: "array", items: { type: "string" } };
  properties.fabricSummary = { type: "string" };

  const required = [...OBSERVATION_KEYS, "missingInformation", "fabricSummary"];

  return { type: "object" as const, properties, required };
}

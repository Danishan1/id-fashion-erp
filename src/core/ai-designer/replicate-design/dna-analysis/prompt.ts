import { CONFIDENCE_VALUES, FEATURE_KEYS } from "./schema";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output shape/meaning — stored on every ReplicateDesignDnaAnalysis /
 * ReplicateDesignDnaAnalysisRun row so a past analysis stays auditable
 * against the exact prompt that produced it.
 */
export const PROMPT_VERSION = "replicate-design-dna-analysis-v1";

/**
 * The hidden system prompt. Never sent to the browser — used only
 * server-side inside requestStructuredVisionOutput(). This is Replicate
 * Design's own Design DNA extraction — the whole point of this feature is
 * that the garment's structure becomes a LOCKED baseline the company's own
 * fabric/materials are later applied onto, never a redesign.
 */
const REPLICATE_DESIGN_DNA_SYSTEM_PROMPT = `You are an experienced garment technologist and product developer analysing a reference garment photo so its structural design can be faithfully recreated using different materials.

The objective is NOT to redesign this garment and NOT to suggest changes to it — only to accurately record its structural design as a locked baseline for later recreation with a different fabric/materials.

Analyse ONLY what can reasonably be determined from the supplied image. Never present an uncertain visual assumption as a confirmed technical fact — for every field, assign exactly one confidence classification:
- CONFIRMED_VISUALLY — clearly visible in the image
- LIKELY_INFERRED — a reasonable inference, not directly confirmable
- NOT_DETERMINABLE — cannot be determined from the supplied image at all

Analyse the following structural aspects of the garment:
1. Garment category (e.g. dress, shirt, kurti, jacket, trouser)
2. Silhouette (overall shape — A-line, straight, fitted, oversized, etc.)
3. Garment length (e.g. knee-length, hip-length, floor-length)
4. Fit (slim/regular/relaxed/oversized)
5. Neckline (shape and style)
6. Collar (type, or "none" if collarless)
7. Sleeve type (style — set-in, raglan, dolman, etc.)
8. Sleeve length
9. Shoulder construction (seam placement, padding, drop-shoulder, etc.)
10. Closure / opening type (buttons, zipper, pull-over, tie, none, etc.)
11. Panels and seams (visible construction panels/seam lines — princess seams, side panels, yokes, etc.)
12. Waist treatment (fitted waist, elastic, drawstring, no waist definition, etc.)
13. Hem finish (straight hem, curved hem, slit, asymmetric, etc.)
14. Key construction details — any other structurally significant detail worth recording (pleats, darts, pockets, gathers) as a single combined note

Then write a Design DNA Summary (maximum 100 words) capturing the garment's overall structural design in plain English — this becomes the human-readable record of what makes this garment this specific garment, structurally.

Do NOT invent unseen back/internal construction details. Do NOT suggest fabric, color, print, or material choices — that is deliberately out of scope for this analysis. Do NOT propose any design change.

Return ONLY data matching the required structured JSON schema.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "confidence" field must be exactly one of: CONFIRMED_VISUALLY, LIKELY_INFERRED, NOT_DETERMINABLE. Every field in the schema is required — for a field you cannot determine, still provide an observation with confidence NOT_DETERMINABLE and a brief note explaining why, rather than omitting the field.`;

export function buildSystemPrompt(): string {
  return `${REPLICATE_DESIGN_DNA_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export function buildUserText(projectContext: { fabricKnown?: boolean }): string {
  const lines = ["Analyse the attached reference garment photo and extract its structural Design DNA."];
  if (projectContext.fabricKnown) {
    lines.push("A separate fabric/material choice has already been made for this project — do not comment on fabric, print, or color at all in this analysis.");
  }
  return lines.join("\n");
}

function observationNode() {
  return {
    type: "object",
    properties: {
      observation: { type: "string" },
      confidence: { type: "string", enum: [...CONFIDENCE_VALUES] },
    },
    required: ["observation", "confidence"],
  };
}

/**
 * Built once from FEATURE_KEYS/CONFIDENCE_VALUES — cannot drift from
 * schema.ts's own Zod shape since both read from the same constants. This
 * schema is small (14 fields) so `strict: true`'s grammar-size ceiling
 * (documented in src/core/ai/reference-analysis/prompt.ts for a 36-field
 * schema) does not apply here — moot anyway, since
 * requestStructuredVisionOutput() always passes `strict: false` for every
 * vision call regardless of schema size.
 */
export function buildToolInputSchema() {
  const properties: Record<string, unknown> = {};
  for (const key of FEATURE_KEYS) properties[key] = observationNode();
  properties.designDnaSummary = { type: "string" };

  return {
    type: "object" as const,
    properties,
    required: [...FEATURE_KEYS, "designDnaSummary"],
  };
}

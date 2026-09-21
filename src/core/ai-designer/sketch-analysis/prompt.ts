import { CONFIDENCE_VALUES, SKETCH_FEATURE_KEYS } from "./schema";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output shape/meaning — stored on every AiDesignerSketchAnalysis /
 * AiDesignerSketchAnalysisRun row so a past analysis stays auditable against
 * the exact prompt that produced it.
 */
export const PROMPT_VERSION = "ai-designer-sketch-analysis-v1";

/**
 * The hidden system prompt. Never sent to the browser — used only
 * server-side inside requestStructuredVisionOutput(). Adapted directly from
 * Replicate Design's own Design DNA extraction prompt (a proven, tested
 * pattern already in this codebase) — the whole point of this analysis is
 * that the sketch's structural design becomes a LOCKED baseline the real
 * fabric/materials/Product Design overrides are later applied onto, never a
 * redesign the AI invents on its own initiative.
 */
const SKETCH_ANALYSIS_SYSTEM_PROMPT = `You are an experienced garment technologist and technical designer analysing an uploaded sketch or drawing of a garment (hand-drawn or digital) so its structural design can be faithfully recreated as a realistic, manufacturable garment.

This is a SKETCH, not a photograph — read its construction lines, proportions, and labelled details, not its drawing style, shading, or artistic rendering. The objective is NOT to redesign this garment and NOT to suggest changes to it — only to accurately record its structural design as a locked baseline for later recreation.

Analyse ONLY what can reasonably be determined from the supplied sketch. Never present an uncertain visual assumption as a confirmed technical fact — for every field, assign exactly one confidence classification:
- CONFIRMED_VISUALLY — clearly drawn/labelled in the sketch
- LIKELY_INFERRED — a reasonable inference from the drawing, not directly confirmable
- NOT_DETERMINABLE — cannot be determined from the supplied sketch at all (e.g. a sketch that only shows the front view has no real basis for describing back construction — mark it NOT_DETERMINABLE rather than guessing)

Analyse the following structural aspects of the garment:
1. Garment type (e.g. dress, shirt, kurti, frock, jacket, trouser)
2. Silhouette (overall shape — A-line, straight, fitted, oversized, etc.)
3. Garment length (e.g. knee-length, hip-length, floor-length)
4. Fit (slim/regular/relaxed/oversized)
5. Front neckline (shape and style as drawn)
6. Back neckline (shape and style as drawn, or NOT_DETERMINABLE if no back view is shown)
7. Sleeve type (style — set-in, raglan, dolman, puff, etc., or "sleeveless" if drawn with none)
8. Sleeve length
9. Collar (type, or "none" if collarless as drawn)
10. Shoulder construction (seam placement, padding, drop-shoulder, etc.)
11. Waist construction (fitted waist, elastic, drawstring, no waist definition, etc.)
12. Closure details — combined: placket, buttons, zipper, tie, or none, as drawn
13. Pockets (type, placement, or "none")
14. Panels and yokes (visible construction panels/seam lines/yokes as drawn)
15. Pleats and gathers (as drawn)
16. Darts and seams (as drawn)
17. Slits and openings (as drawn)
18. Ruffle and layer details (as drawn, or "none")
19. Hem and cuff details (hem shape, cuff style as drawn)
20. Decorative details — any embellishment, trim, or surface detail explicitly drawn (never invent one that isn't drawn)
21. Other construction notes — any other structurally significant detail worth recording, as a single combined note

Then write a Sketch Analysis Summary (maximum 100 words) capturing the garment's overall structural design in plain English — this becomes the human-readable record of what this sketch specifies, structurally, and is shown to the user for review before generation.

Do NOT invent unseen back/internal construction details that the sketch does not actually show. Do NOT suggest fabric, color, print, or material choices — that is deliberately out of scope for this analysis; a separate fabric selection step handles that. Do NOT propose any design change. If the sketch is unclear, extremely rough, or not a recognizable garment sketch at all, still return your best-effort structured answer with NOT_DETERMINABLE confidence on the affected fields rather than refusing — the caller decides how to handle a low-confidence result.

Return ONLY data matching the required structured JSON schema.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every "confidence" field must be exactly one of: CONFIRMED_VISUALLY, LIKELY_INFERRED, NOT_DETERMINABLE. Every field in the schema is required — for a field you cannot determine, still provide an observation with confidence NOT_DETERMINABLE and a brief note explaining why, rather than omitting the field.`;

export function buildSystemPrompt(): string {
  return `${SKETCH_ANALYSIS_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export function buildUserText(): string {
  return "Analyse the attached garment sketch/drawing and extract its structural design details.";
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
 * Built once from SKETCH_FEATURE_KEYS/CONFIDENCE_VALUES — cannot drift from
 * schema.ts's own Zod shape since both read from the same constants.
 * requestStructuredVisionOutput() always passes `strict: false` for every
 * vision call regardless of schema size (this codebase's own confirmed
 * Anthropic tool-schema-size limitation), so a 21-field schema is safe here.
 */
export function buildToolInputSchema() {
  const properties: Record<string, unknown> = {};
  for (const key of SKETCH_FEATURE_KEYS) properties[key] = observationNode();
  properties.sketchAnalysisSummary = { type: "string" };

  return {
    type: "object" as const,
    properties,
    required: [...SKETCH_FEATURE_KEYS, "sketchAnalysisSummary"],
  };
}

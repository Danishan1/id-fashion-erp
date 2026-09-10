/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output — stored on every AiDesignerPrompt row so a past analysis stays
 * auditable against the exact prompt that produced it.
 */
export const PROMPT_VERSION = "ai-designer-fabric-analysis-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — server-side
 * only. Deliberately minimal per the brief's own explicit instruction: exactly
 * 12 fields, no confidence scores, no per-field metadata.
 */
export const FABRIC_ANALYSIS_SYSTEM_PROMPT = `You are an experienced textile technologist and fashion product developer.

You are analysing a photograph of a fabric (either an existing fabric swatch or an uploaded fabric image) at the start of a garment design workflow, before any garment has been designed against it.

Analyse ONLY what can reasonably be determined from the supplied photograph. Never present an uncertain visual assumption as a confirmed laboratory fact — you cannot measure exact composition, exact GSM, or exact stretch percentage from a photo. Where something genuinely cannot be determined from the image, say so plainly in that field's own text (e.g. "Not determinable from this image — composition/construction detail is not visible") rather than inventing a plausible-sounding but unsupported value.

Provide exactly the following, each as a short, plain-language description:

1. FABRIC NAME — a short, descriptive commercial-style name synthesized from what is visible (e.g. "Navy Cotton-Elastane Single Jersey").
2. COMPOSITION — a likely fibre-content estimate based only on visual appearance, framed as an estimate.
3. GSM — an approximate weight class (lightweight/medium-weight/heavyweight) with a rough GSM range if reasonably inferable.
4. WIDTH — the fabric's likely usable width, if inferable from the image context; otherwise state it cannot be determined from a photo alone.
5. WEAVE — the weave/knit structure (e.g. plain weave, twill, single jersey, rib), or "not determinable" if no structural detail is visible.
6. STRETCH — none / slight / moderate / high, based on visible construction cues.
7. OPACITY — opaque / semi-sheer / sheer.
8. TEXTURE — smooth, textured/slubbed, brushed, ribbed, etc.
9. PATTERN TYPE — solid, stripe, check, geometric, floral, etc.
10. PRINT TYPE — none, engineered print, all-over print, placement print, etc.
11. SUITABLE SEASON — the general season(s) this fabric's weight/character suits best.
12. RECOMMENDED GARMENTS — 2-4 broad garment categories this fabric is well suited for, in plain commercial terms (a short general hint only, not an exhaustive assessment).

Do NOT design a garment, create a Bill of Materials, or calculate costing.
Return ONLY data matching the required structured JSON schema.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. Every field is required — for a field you genuinely cannot determine, still provide a brief string explaining why, rather than omitting the field.`;

export function buildSystemPrompt(): string {
  return `${FABRIC_ANALYSIS_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

/**
 * Only non-sensitive project context (garment category hint, target market)
 * is ever included — never pricing, buyer identity, or other commercial
 * information not needed for visual analysis.
 */
export function buildUserText(projectContext: { productCategory?: string | null; targetCustomerLabel?: string | null }): string {
  const lines = ["Analyse the attached fabric photograph."];
  if (projectContext.productCategory) {
    lines.push(`Known intended product category (if helpful, do not let this override what the photo actually shows): ${projectContext.productCategory}.`);
  }
  if (projectContext.targetCustomerLabel) {
    lines.push(`Target customer context: ${projectContext.targetCustomerLabel}.`);
  }
  return lines.join("\n");
}

const FIELD_KEYS = [
  "fabricName",
  "composition",
  "gsm",
  "width",
  "weave",
  "stretch",
  "opacity",
  "texture",
  "patternType",
  "printType",
  "suitableSeason",
  "recommendedGarments",
] as const;

/** Built once from the shared field-key list — cannot drift from schema.ts's Zod shape since both read from the same constant. */
export function buildToolInputSchema() {
  const properties: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) properties[key] = { type: "string" };

  return { type: "object" as const, properties, required: [...FIELD_KEYS] };
}

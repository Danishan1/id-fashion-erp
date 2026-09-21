import { AGE_GROUPS_BY_CUSTOMER, PRODUCT_CATEGORIES_BY_CUSTOMER, TARGET_CUSTOMER_LABELS, TARGET_CUSTOMER_VALUES } from "@/core/ai-designer/catalogs/customer-catalog";
import { ENVIRONMENTS } from "@/core/ai-designer/catalogs/environment-catalog";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output — stored on every AiDesignerPrompt row so a past suggestion result
 * stays auditable against the exact prompt that produced it.
 */
export const PROMPT_VERSION = "ai-designer-product-suggestions-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — server-side
 * only. A senior merchandiser/product-line-planner persona reasoning from a
 * fabric that's already been described in plain text (Fabric Analysis) —
 * this is a text-only call, no image involved.
 */
export const PRODUCT_SUGGESTIONS_SYSTEM_PROMPT = `You are a senior fashion merchandiser and product line planner working for a garment manufacturer.

Given the technical characteristics of a fabric (already analysed from a photograph), decide which customer segments this fabric is genuinely commercially suitable for, and for each suitable segment, suggest specific garment types worth producing from it — ranked by commercial priority.

Rules:
1. Do NOT force every customer segment to have an entry. Skip a segment entirely if the fabric genuinely does not suit it (e.g. a stiff, heavy structured fabric is not suitable for Baby; a delicate sheer fabric is not suitable for rugged Boys' outerwear). Only include a segment when you can genuinely justify at least one real product for it.
2. For every segment you do include, suggest 1 to 5 specific garment types, using ONLY the exact category names given below for that segment — never invent a category name that isn't in the allowed list.
3. Rank the items within each segment by priorityRank (1 = the single best commercial choice for this fabric, higher numbers = lower priority), based on genuine fit between the fabric's own stated characteristics and that garment type's real construction/fit needs.
4. For each item, pick exactly one ageGroup from the exact allowed age groups for that segment, and exactly one environmentKey from the allowed photoshoot environment list — never invent either.
5. Ground every reasoning in the fabric's own actual stated characteristics (composition, GSM/weight, stretch, opacity, texture, pattern) — never generic boilerplate that could apply to any fabric.
6. Provide a short overall summary of the fabric's best commercial direction across all suggested segments.

Return ONLY data matching the required structured JSON schema, calling the provided tool exactly once.`;

function catalogLines(): string {
  const lines: string[] = ["ALLOWED CUSTOMER SEGMENTS, CATEGORIES, AND AGE GROUPS (use only these exact values):"];
  for (const customer of TARGET_CUSTOMER_VALUES) {
    lines.push(
      `- ${TARGET_CUSTOMER_LABELS[customer]} (targetCustomer: "${customer}"): categories = [${PRODUCT_CATEGORIES_BY_CUSTOMER[customer].join(", ")}]; age groups = [${AGE_GROUPS_BY_CUSTOMER[customer].join(", ")}]`
    );
  }
  lines.push("");
  lines.push("ALLOWED PHOTOSHOOT ENVIRONMENT KEYS (use only these exact keys):");
  lines.push(ENVIRONMENTS.map((e) => `${e.key} (${e.label})`).join(", "));
  return lines.join("\n");
}

export interface FabricAnalysisContext {
  fabricName: string | null;
  composition: string | null;
  gsm: string | null;
  width: string | null;
  weave: string | null;
  stretch: string | null;
  opacity: string | null;
  texture: string | null;
  patternType: string | null;
  printType: string | null;
  suitableSeason: string | null;
  recommendedGarments: string | null;
}

export function buildUserText(fabric: FabricAnalysisContext): string {
  const fabricLines = [
    `Fabric Name: ${fabric.fabricName ?? "Not specified"}`,
    `Composition: ${fabric.composition ?? "Not specified"}`,
    `GSM/Weight: ${fabric.gsm ?? "Not specified"}`,
    `Width: ${fabric.width ?? "Not specified"}`,
    `Weave/Knit: ${fabric.weave ?? "Not specified"}`,
    `Stretch: ${fabric.stretch ?? "Not specified"}`,
    `Opacity: ${fabric.opacity ?? "Not specified"}`,
    `Texture: ${fabric.texture ?? "Not specified"}`,
    `Pattern Type: ${fabric.patternType ?? "Not specified"}`,
    `Print Type: ${fabric.printType ?? "Not specified"}`,
    `Suitable Season: ${fabric.suitableSeason ?? "Not specified"}`,
    `Broad Recommended Garments (a general hint only, not exhaustive): ${fabric.recommendedGarments ?? "Not specified"}`,
  ];

  return `FABRIC CHARACTERISTICS:\n${fabricLines.join("\n")}\n\n${catalogLines()}\n\nSuggest specific, prioritized garment types per suitable customer segment following the rules above.`;
}

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once.`;

export function buildSystemPrompt(): string {
  return `${PRODUCT_SUGGESTIONS_SYSTEM_PROMPT}${TOOL_CONTRACT_ADDENDUM}`;
}

/**
 * Kept intentionally shape-only (no minItems/maxItems on the array nodes) —
 * Anthropic's own strict tool-schema validator either rejects or silently
 * strips array-length keywords (confirmed live during this session's earlier
 * Compatibility Check work) — the real bounds (1-6 groups, 1-5 items) are
 * enforced entirely by the Zod schema + the corrective retry, not by this
 * tool schema.
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      groups: {
        type: "array",
        items: {
          type: "object",
          properties: {
            targetCustomer: { type: "string", enum: [...TARGET_CUSTOMER_VALUES] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  productCategory: { type: "string" },
                  priorityRank: { type: "integer" },
                  ageGroup: { type: "string" },
                  environmentKey: { type: "string" },
                  reasoning: { type: "string" },
                },
                required: ["productCategory", "priorityRank", "ageGroup", "environmentKey", "reasoning"],
              },
            },
          },
          required: ["targetCustomer", "items"],
        },
      },
      overallSummary: { type: "string" },
    },
    required: ["groups", "overallSummary"],
  };
}

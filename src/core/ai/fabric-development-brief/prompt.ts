import { COMMERCIAL_CLASSIFICATION_VALUES, RATING_LEVEL_VALUES } from "@/core/ai/development-brief/schema";
export { buildToolInputSchema } from "@/core/ai/development-brief/prompt";

export const PROMPT_VERSION = "fabric-development-brief-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — only used
 * server-side inside requestStructuredTextOutput(). Written fresh for this
 * process (no verbatim brief exists for it, same as Fabric Analysis/Product
 * Suitability before it) — adapted from development-brief's own prompt for
 * the case where there is no reference garment photo at all, only a real,
 * already-approved fabric plus which garment types it suits.
 */
export const FABRIC_DEVELOPMENT_BRIEF_SYSTEM_PROMPT = `You are a senior garment product-development director working for a commercial apparel manufacturer/exporter.

There is no reference garment image for this project — it starts from a real, physical fabric that has already been analysed and a set of garment types that fabric has already been assessed as suited for.

Using the APPROVED Fabric Analysis and the APPROVED Product Suitability assessment below, create differentiated commercial garment-development directions FROM SCRATCH for this fabric.

You must ONLY propose directions for garment types listed below as HIGHLY_SUITABLE or SUITABLE. Never propose a direction for a garment type not listed, and never propose one for a type rated MARGINALLY_SUITABLE or NOT_SUITABLE.

The fabric itself is fixed and already known — do not suggest an alternative fabric character; instead describe how THIS specific fabric will read and behave within each proposed design.

Consider:
- Target Market
- Target Customer
- Season
- Buyer Positioning
- Target Price
- Factory Capability
- Expected Manufacturing Complexity
- The fabric's own analysed weight, drape, stretch, structure, and surface character

For every design direction return:
- Design Direction Name (name the specific garment type it is for as part of this name)
- Commercial Classification: SAFE COMMERCIAL / BALANCED / FASHION FORWARD
- Target Consumer
- Silhouette
- Garment Length
- Fit
- Neckline
- Collar
- Sleeve
- Shoulder Construction
- Front Construction
- Back Construction
- Closure
- Pocket
- Waist Treatment
- Hem
- Key New Design Feature
- How This Specific Fabric Reads And Behaves In This Design
- Suggested Trims
- Production Complexity: LOW / MEDIUM / HIGH
- Expected Fabric Consumption: LOW / MEDIUM / HIGH
- Target Price Compatibility: LOW / MEDIUM / HIGH
- Commercial Rationale
- Manufacturing Risk
- What Makes This Direction Different From The Other Directions In This Batch

Do not create images.
Do not invent exact garment consumption.
Do not invent exact manufacturing costs.

Score each design out of 10 for:
- Commercial Potential
- Buyer Fit
- Manufacturing Ease
- Target Price Compatibility
- Fabric Efficiency
- Design Freshness

Create an overall score out of 100.`;

const TOOL_CONTRACT_ADDENDUM = `
You must respond by calling the provided tool exactly once. "commercialClassification" must be exactly one of: ${COMMERCIAL_CLASSIFICATION_VALUES.join(", ")}. Every LOW/MEDIUM/HIGH rating field must be exactly one of: ${RATING_LEVEL_VALUES.join(", ")}. Every field in the schema is required for every design direction — do not omit any field, and do not return fewer or more design directions than the number requested.`;

export function buildSystemPrompt(): string {
  return `${FABRIC_DEVELOPMENT_BRIEF_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export interface SuitableProductTypeForPrompt {
  name: string;
  rating: "HIGHLY_SUITABLE" | "SUITABLE";
  reasoning: string;
}

export interface FabricObservationForPrompt {
  label: string;
  value: string;
}

export interface FabricDevelopmentBriefContext {
  directionCount: number;
  designBalance: string;
  targetMarket?: string | null;
  targetCustomerProfile?: string | null;
  season?: string | null;
  targetSellingPrice?: number | null;
  currencyCode?: string | null;
  factoryCapabilities?: string | null;
  buyer?: string | null;
  fabricSummary: string;
  fabricObservations: FabricObservationForPrompt[];
  suitableProductTypes: SuitableProductTypeForPrompt[];
}

const DESIGN_BALANCE_GUIDANCE: Record<string, string> = {
  COMMERCIAL_LOWER_RISK: "Bias the overall set toward SAFE COMMERCIAL directions — lower risk, broad market appeal, proven silhouettes.",
  BALANCED: "Aim for a genuine mix across SAFE COMMERCIAL, BALANCED, and FASHION FORWARD classifications.",
  FASHION_FORWARD: "Bias the overall set toward FASHION FORWARD directions — more distinctive, higher design risk.",
};

export function buildUserText(ctx: FabricDevelopmentBriefContext): string {
  const lines: string[] = [
    `Generate exactly ${ctx.directionCount} differentiated commercial design directions.`,
    DESIGN_BALANCE_GUIDANCE[ctx.designBalance] ?? DESIGN_BALANCE_GUIDANCE.BALANCED,
    "",
    "=== Approved Fabric Analysis (fixed and known — do not suggest an alternative fabric) ===",
    `Fabric Summary: ${ctx.fabricSummary}`,
  ];
  for (const obs of ctx.fabricObservations) {
    lines.push(`${obs.label}: ${obs.value}`);
  }

  lines.push("", "=== Garment Types This Fabric Is Approved For (only propose directions for these) ===");
  for (const pt of ctx.suitableProductTypes) {
    lines.push(`${pt.name} (${pt.rating}) — ${pt.reasoning}`);
  }

  lines.push("", "=== Commercial Information ===");
  if (ctx.targetMarket) lines.push(`Target Market: ${ctx.targetMarket}`);
  if (ctx.targetCustomerProfile) lines.push(`Target Customer: ${ctx.targetCustomerProfile}`);
  if (ctx.season) lines.push(`Season: ${ctx.season}`);
  if (ctx.targetSellingPrice != null) lines.push(`Target Price: ${ctx.targetSellingPrice} ${ctx.currencyCode ?? ""}`.trim());
  if (ctx.factoryCapabilities) lines.push(`Factory Capabilities: ${ctx.factoryCapabilities}`);
  if (ctx.buyer) lines.push(`Buyer (if known): ${ctx.buyer}`);

  return lines.join("\n");
}

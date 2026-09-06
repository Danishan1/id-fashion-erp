import {
  COMMERCIAL_CLASSIFICATION_VALUES,
  RATING_LEVEL_VALUES,
} from "./schema";

export const PROMPT_VERSION = "development-brief-v1";

/**
 * The hidden business/system prompt. Never sent to the browser — only used
 * server-side inside requestStructuredTextOutput(). Verbatim per the
 * product brief; do not display this to end users.
 */
export const DEVELOPMENT_BRIEF_SYSTEM_PROMPT = `You are a senior garment product-development director working for a commercial apparel manufacturer/exporter.

Using the APPROVED Reference Garment Analysis and the supplied commercial information, create differentiated commercial garment-development directions.

The objective is NOT to reproduce the reference garment.

Use the reference only to understand broad design language.

Create commercially viable new products.

Consider:
- Target Market
- Target Customer
- Season
- Buyer Positioning
- Target Price
- Fabric
- Factory Capability
- Expected Manufacturing Complexity

For every design direction return:
- Design Direction Name
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
- Suggested Fabric Character
- Suggested Trims
- Production Complexity: LOW / MEDIUM / HIGH
- Expected Fabric Consumption: LOW / MEDIUM / HIGH
- Target Price Compatibility: LOW / MEDIUM / HIGH
- Commercial Rationale
- Manufacturing Risk
- How This Design Is Materially Different From The Reference

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
  return `${DEVELOPMENT_BRIEF_SYSTEM_PROMPT}\n${TOOL_CONTRACT_ADDENDUM}`;
}

export interface DevelopmentBriefContext {
  directionCount: number;
  designBalance: string;
  targetMarket?: string | null;
  targetCustomerProfile?: string | null;
  season?: string | null;
  garmentCategory?: string | null;
  targetSellingPrice?: number | null;
  currencyCode?: string | null;
  preferredFabric?: string | null;
  factoryCapabilities?: string | null;
  buyer?: string | null;
  // From the APPROVED Reference Garment Analysis — approvedObservation values
  // only, never the raw AI-original ones (the approved analysis is the
  // source of truth downstream processes must read).
  designDnaSummary: string;
  keyDesignLanguageFeatures: string[];
  featuresForFurtherDevelopment: string[];
  featuresToChangeForDifferentiation: string[];
  constructionComplexityLevel: string | null;
  garmentCategoryObservation?: string;
  silhouetteObservation?: string;
}

const DESIGN_BALANCE_GUIDANCE: Record<string, string> = {
  COMMERCIAL_LOWER_RISK: "Bias the overall set toward SAFE COMMERCIAL directions — lower risk, broad market appeal, proven silhouettes.",
  BALANCED: "Aim for a genuine mix across SAFE COMMERCIAL, BALANCED, and FASHION FORWARD classifications.",
  FASHION_FORWARD: "Bias the overall set toward FASHION FORWARD directions — more distinctive, higher design risk.",
};

export function buildUserText(ctx: DevelopmentBriefContext): string {
  const lines: string[] = [
    `Generate exactly ${ctx.directionCount} differentiated commercial design directions.`,
    DESIGN_BALANCE_GUIDANCE[ctx.designBalance] ?? DESIGN_BALANCE_GUIDANCE.BALANCED,
    "",
    "=== Approved Reference Garment Analysis (source of design language only — do not reproduce) ===",
    `Design DNA Summary: ${ctx.designDnaSummary}`,
  ];
  if (ctx.garmentCategoryObservation) lines.push(`Garment Category (reference): ${ctx.garmentCategoryObservation}`);
  if (ctx.silhouetteObservation) lines.push(`Silhouette (reference): ${ctx.silhouetteObservation}`);
  if (ctx.constructionComplexityLevel) lines.push(`Construction Complexity (reference): ${ctx.constructionComplexityLevel}`);
  if (ctx.keyDesignLanguageFeatures.length > 0) {
    lines.push(`Key Design-Language Features (reference): ${ctx.keyDesignLanguageFeatures.join("; ")}`);
  }
  if (ctx.featuresForFurtherDevelopment.length > 0) {
    lines.push(`Suitable for Further Development (reference): ${ctx.featuresForFurtherDevelopment.join("; ")}`);
  }
  if (ctx.featuresToChangeForDifferentiation.length > 0) {
    lines.push(`Change Substantially for Differentiation (reference): ${ctx.featuresToChangeForDifferentiation.join("; ")}`);
  }

  lines.push("", "=== Commercial Information ===");
  if (ctx.targetMarket) lines.push(`Target Market: ${ctx.targetMarket}`);
  if (ctx.targetCustomerProfile) lines.push(`Target Customer: ${ctx.targetCustomerProfile}`);
  if (ctx.season) lines.push(`Season: ${ctx.season}`);
  if (ctx.garmentCategory) lines.push(`Garment Category: ${ctx.garmentCategory}`);
  if (ctx.targetSellingPrice != null) lines.push(`Target Price: ${ctx.targetSellingPrice} ${ctx.currencyCode ?? ""}`.trim());
  if (ctx.preferredFabric) lines.push(`Preferred Fabric (if known): ${ctx.preferredFabric}`);
  if (ctx.factoryCapabilities) lines.push(`Factory Capabilities: ${ctx.factoryCapabilities}`);
  if (ctx.buyer) lines.push(`Buyer (if known): ${ctx.buyer}`);

  return lines.join("\n");
}

function stringField() {
  return { type: "string" };
}

function ratingField() {
  return { type: "string", enum: [...RATING_LEVEL_VALUES] };
}

function designDirectionNode() {
  return {
    type: "object",
    properties: {
      designDirectionName: stringField(),
      commercialClassification: { type: "string", enum: [...COMMERCIAL_CLASSIFICATION_VALUES] },
      targetConsumer: stringField(),
      silhouette: stringField(),
      garmentLength: stringField(),
      fit: stringField(),
      neckline: stringField(),
      collar: stringField(),
      sleeve: stringField(),
      shoulderConstruction: stringField(),
      frontConstruction: stringField(),
      backConstruction: stringField(),
      closure: stringField(),
      pocket: stringField(),
      waistTreatment: stringField(),
      hem: stringField(),
      keyNewDesignFeature: stringField(),
      suggestedFabricCharacter: stringField(),
      suggestedTrims: stringField(),
      productionComplexity: ratingField(),
      expectedFabricConsumption: ratingField(),
      targetPriceCompatibilityLevel: ratingField(),
      commercialRationale: stringField(),
      manufacturingRisk: stringField(),
      differentiationFromReference: stringField(),
      scores: {
        type: "object",
        properties: {
          commercialPotential: { type: "integer", minimum: 0, maximum: 10 },
          buyerFit: { type: "integer", minimum: 0, maximum: 10 },
          manufacturingEase: { type: "integer", minimum: 0, maximum: 10 },
          targetPriceCompatibility: { type: "integer", minimum: 0, maximum: 10 },
          fabricEfficiency: { type: "integer", minimum: 0, maximum: 10 },
          designFreshness: { type: "integer", minimum: 0, maximum: 10 },
        },
        required: ["commercialPotential", "buyerFit", "manufacturingEase", "targetPriceCompatibility", "fabricEfficiency", "designFreshness"],
      },
      overallScore: { type: "integer", minimum: 0, maximum: 100 },
    },
    required: [
      "designDirectionName",
      "commercialClassification",
      "targetConsumer",
      "silhouette",
      "garmentLength",
      "fit",
      "neckline",
      "collar",
      "sleeve",
      "shoulderConstruction",
      "frontConstruction",
      "backConstruction",
      "closure",
      "pocket",
      "waistTreatment",
      "hem",
      "keyNewDesignFeature",
      "suggestedFabricCharacter",
      "suggestedTrims",
      "productionComplexity",
      "expectedFabricConsumption",
      "targetPriceCompatibilityLevel",
      "commercialRationale",
      "manufacturingRisk",
      "differentiationFromReference",
      "scores",
      "overallScore",
    ],
  };
}

/**
 * `count` is the exact number of directions requested (1 for Regenerate, 3/6/9
 * for the initial batch) — stated in the prompt text (see buildUserText) and
 * enforced by validateDevelopmentBriefResponse's own exact-length check, not
 * by the tool schema itself: Anthropic's `strict: true` tool mode rejects
 * `minItems`/`maxItems` on an array node ("property 'maxItems' is not
 * supported"), confirmed live against the real API.
 */
export function buildToolInputSchema(count: number) {
  void count;
  return {
    type: "object" as const,
    properties: {
      designDirections: {
        type: "array",
        items: designDirectionNode(),
      },
    },
    required: ["designDirections"],
  };
}

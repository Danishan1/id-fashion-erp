import { COMMERCIAL_RANK_VALUES } from "./schema";

export const PROMPT_VERSION = "commercial-evaluation-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Verbatim per the product brief; do
 * not display this to end users.
 */
export const COMMERCIAL_EVALUATION_SYSTEM_PROMPT = `Act as a garment manufacturer, product developer, senior merchandiser and commercial apparel buyer.

Evaluate the proposed garment designs.

Do not choose based only on visual attractiveness.

Evaluate:

Target Customer Fit
Buyer Fit
Fabric Suitability
Commercial Appeal
Manufacturing Simplicity
Fabric Consumption Efficiency
Pattern Making Complexity
Sewing Complexity
Trim Complexity
Target Price Compatibility
Bulk Production Scalability
Design Freshness

Score each criterion from 1 to 10.

Use these weights:

Commercial Appeal 15%
Buyer Fit 15%
Target Price Compatibility 15%
Manufacturing Simplicity 10%
Fabric Suitability 10%
Consumption Efficiency 10%
Scalability 10%
Design Freshness 10%
Other Technical Factors 5%

Calculate:

COMMERCIAL DEVELOPMENT SCORE /100

For each design provide:

Strengths
Weaknesses
Manufacturing Risks
Potential Cost Risks
Suggested Improvement

Rank:

FIRST CHOICE
SECOND CHOICE
THIRD CHOICE

Explain the commercial reasoning.

Never invent exact costs or exact consumption without technical data.`;

/**
 * Technical addendum (not part of the hidden business prompt above, never
 * shown to end users either) — explains the exact tool-call contract and
 * the two judgment calls this implementation had to make that the business
 * prompt itself leaves implicit: (1) "Other Technical Factors 5%" is not a
 * 13th criterion — it's computed server-side from four of the twelve named
 * criteria (Target Customer Fit, Pattern Making Complexity, Sewing
 * Complexity, Trim Complexity), so every criterion must still be scored
 * individually; (2) every "complexity" criterion must be scored on the same
 * higher-is-better scale as every other criterion (10 = low complexity /
 * commercially favorable), so a single weighted sum is meaningful across all
 * twelve without needing to invert any of them.
 */
function buildToolContractAddendum(designCount: number): string {
  return `
You must respond by calling the provided tool exactly once, with exactly ${designCount} items in the "items" array — one per design, in the exact same order the designs are listed below (do not reorder them, and do not name which design each item is for). Score every one of the 12 named criteria for every design, each as an integer from 1 to 10. For every criterion, including Manufacturing Simplicity, Pattern Making Complexity, Sewing Complexity, and Trim Complexity, a HIGHER score always means more commercially favorable — for the three "complexity" criteria specifically, a 10 means very LOW complexity (simple, easy, favorable), and a 1 means very HIGH complexity (difficult, unfavorable). Do not compute or return a combined "commercial development score" yourself — the application computes that from your 12 individual scores.

"rank" must be exactly one of: ${COMMERCIAL_RANK_VALUES.join(", ")}. Exactly one design must be ranked FIRST_CHOICE. If ${designCount} designs are being compared and ${designCount} >= 2, exactly one design must be ranked SECOND_CHOICE. If ${designCount} >= 3, exactly one design must be ranked THIRD_CHOICE. Every other design must be ranked NOT_RANKED. In "overallRankingRationale", explain your comparative reasoning across the whole set — why the top-ranked design(s) beat the others commercially, not just a description of each one individually.`;
}

export function buildSystemPrompt(designCount: number): string {
  return `${COMMERCIAL_EVALUATION_SYSTEM_PROMPT}\n${buildToolContractAddendum(designCount)}`;
}

export interface DesignForComparison {
  /** 1-based position in the array actually sent to the model — never the real database id, so the model has no id to hallucinate or misreport. */
  displayNumber: number;
  designDirectionName: string;
  commercialClassification: string;
  targetConsumer: string;
  silhouette: string;
  garmentLength: string;
  fit: string;
  neckline: string;
  collar: string;
  sleeve: string;
  closure: string;
  pocket: string;
  waistTreatment: string;
  hem: string;
  keyNewDesignFeature: string;
  suggestedFabricCharacter: string;
  suggestedTrims: string;
  productionComplexity: string;
  expectedFabricConsumption: string;
  targetPriceCompatibilityLevel: string;
  commercialRationale: string;
  manufacturingRisk: string;
}

export interface CommercialEvaluationContext {
  buyer?: string | null;
  customer?: string | null;
  targetMarket?: string | null;
  season?: string | null;
  targetSellingPrice?: number | null;
  currencyCode?: string | null;
  orderQuantityEstimate?: number | null;
  /** Only included when AiGarmentFabricDetail already exists for this project — "Fabric if known" per the spec. */
  fabricDescription?: string | null;
  /** Free-text runtime input, never persisted on the project — same non-persisted-override convention already used by Development Brief's own factoryCapabilities field. */
  factoryCapability?: string | null;
  designs: DesignForComparison[];
}

export function buildUserText(ctx: CommercialEvaluationContext): string {
  const lines: string[] = ["=== Commercial Information (auto-pulled from the project) ==="];
  if (ctx.buyer) lines.push(`Buyer: ${ctx.buyer}`);
  if (ctx.customer) lines.push(`Customer: ${ctx.customer}`);
  if (ctx.targetMarket) lines.push(`Market: ${ctx.targetMarket}`);
  if (ctx.season) lines.push(`Season: ${ctx.season}`);
  if (ctx.targetSellingPrice != null) lines.push(`Target Price: ${ctx.targetSellingPrice} ${ctx.currencyCode ?? ""}`.trim());
  if (ctx.orderQuantityEstimate != null) lines.push(`Order Quantity (if known): ${ctx.orderQuantityEstimate}`);
  if (ctx.fabricDescription) lines.push(`Fabric (if known): ${ctx.fabricDescription}`);
  if (ctx.factoryCapability) lines.push(`Factory Capability: ${ctx.factoryCapability}`);
  if (lines.length === 1) lines.push("(No commercial context has been recorded on this project yet.)");

  lines.push("", `=== ${ctx.designs.length} Garment Designs to Compare ===`);
  for (const d of ctx.designs) {
    lines.push(
      "",
      `DESIGN ${d.displayNumber}: ${d.designDirectionName}`,
      `Commercial Classification: ${d.commercialClassification}`,
      `Target Consumer: ${d.targetConsumer}`,
      `Silhouette: ${d.silhouette}`,
      `Garment Length: ${d.garmentLength}`,
      `Fit: ${d.fit}`,
      `Neckline: ${d.neckline}`,
      `Collar: ${d.collar}`,
      `Sleeve: ${d.sleeve}`,
      `Closure: ${d.closure}`,
      `Pocket: ${d.pocket}`,
      `Waist Treatment: ${d.waistTreatment}`,
      `Hem: ${d.hem}`,
      `Key New Design Feature: ${d.keyNewDesignFeature}`,
      `Suggested Fabric Character: ${d.suggestedFabricCharacter}`,
      `Suggested Trims: ${d.suggestedTrims}`,
      `Production Complexity (from Development Brief): ${d.productionComplexity}`,
      `Expected Fabric Consumption (from Development Brief): ${d.expectedFabricConsumption}`,
      `Target Price Compatibility (from Development Brief): ${d.targetPriceCompatibilityLevel}`,
      `Commercial Rationale (from Development Brief): ${d.commercialRationale}`,
      `Manufacturing Risk (from Development Brief): ${d.manufacturingRisk}`
    );
  }

  return lines.join("\n");
}

function scoreField() {
  return { type: "integer", minimum: 1, maximum: 10 };
}

function stringField() {
  return { type: "string" };
}

function evaluationItemNode() {
  return {
    type: "object",
    properties: {
      targetCustomerFitScore: scoreField(),
      buyerFitScore: scoreField(),
      fabricSuitabilityScore: scoreField(),
      commercialAppealScore: scoreField(),
      manufacturingSimplicityScore: scoreField(),
      fabricConsumptionEfficiencyScore: scoreField(),
      patternMakingComplexityScore: scoreField(),
      sewingComplexityScore: scoreField(),
      trimComplexityScore: scoreField(),
      targetPriceCompatibilityScore: scoreField(),
      bulkProductionScalabilityScore: scoreField(),
      designFreshnessScore: scoreField(),
      strengths: stringField(),
      weaknesses: stringField(),
      manufacturingRisks: stringField(),
      potentialCostRisks: stringField(),
      suggestedImprovement: stringField(),
      rank: { type: "string", enum: [...COMMERCIAL_RANK_VALUES] },
    },
    required: [
      "targetCustomerFitScore",
      "buyerFitScore",
      "fabricSuitabilityScore",
      "commercialAppealScore",
      "manufacturingSimplicityScore",
      "fabricConsumptionEfficiencyScore",
      "patternMakingComplexityScore",
      "sewingComplexityScore",
      "trimComplexityScore",
      "targetPriceCompatibilityScore",
      "bulkProductionScalabilityScore",
      "designFreshnessScore",
      "strengths",
      "weaknesses",
      "manufacturingRisks",
      "potentialCostRisks",
      "suggestedImprovement",
      "rank",
    ],
  };
}

/**
 * `designCount` is stated in the prompt text and enforced by
 * validateCommercialEvaluationResponse's own exact-length check, not by the
 * tool schema itself — Anthropic's `strict: true` tool mode rejects
 * `minItems`/`maxItems` on an array node, confirmed live already for
 * Process 2's own comparably-shaped array-of-objects schema.
 */
export function buildToolInputSchema(designCount: number) {
  void designCount;
  return {
    type: "object" as const,
    properties: {
      items: { type: "array", items: evaluationItemNode() },
      overallRankingRationale: { type: "string" },
    },
    required: ["items", "overallRankingRationale"],
  };
}

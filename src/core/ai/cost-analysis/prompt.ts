export const PROMPT_VERSION = "cost-analysis-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Written for this process since no
 * verbatim business-prompt spec was given (unlike Processes 1-6) — scoped
 * from the existing `analyseCost(input: { projectId })` placeholder and the
 * COSTING step's prior "deep-link into Sampling only" scaffolding.
 */
export const COST_ANALYSIS_SYSTEM_PROMPT = `Act as a senior costing and merchandising analyst producing an early, advisory cost estimate for a new garment style — before real technical costing (marker efficiency, consumption studies, vendor quotes) exists.

Based on the approved garment design, its known or resolved Bill of Materials (if any), fabric information (if known), target market context, and any real Sampling costing figures already entered, produce:
- A realistic estimated cost-per-unit RANGE (low and high), in the project's own stated currency — never a single precise figure, since the true cost depends on real vendor quotes and marker efficiency that are not yet available at this stage.
- A qualitative cost breakdown commentary: which cost drivers (main fabric, trims/accessories, labour/CMT, overhead, packaging) are likely to dominate for this specific design, and why — grounded in the actual construction details given, not generic garment-costing boilerplate.
- A price positioning commentary: how your estimated cost range compares to the stated target selling price and market context, and whether that positioning looks commercially realistic for this market.
- A margin feasibility commentary: whether a reasonable margin looks achievable at the target selling price given your estimated cost range, and what would need to be true for it to work.
- Risk notes: cost risks specific to THIS design — a construction feature that is typically labour-intensive, a fabric character that tends to run expensive, a low order quantity limiting vendor negotiating leverage, and so on.

If real Sampling costing figures are supplied below (an actual priced sample version), treat those as ground truth for material and process cost rather than re-estimating from nothing — comment on whether they look reasonable and how they compare to the target selling price, instead of guessing your own range in place of real numbers that already exist.

Never invent an exact number as if it were a real vendor quote or a completed cost sheet. State plainly, in your own commentary, that this is an early advisory estimate pending real technical costing — not a substitute for it.`;

function buildToolContractAddendum(): string {
  return `
You must respond by calling the provided tool exactly once, with a single estimatedCostPerUnitLow/estimatedCostPerUnitHigh range (estimatedCostPerUnitHigh must be greater than or equal to estimatedCostPerUnitLow) plus the four commentary fields. Every commentary field must be genuine prose reasoning about THIS design, never a generic template sentence.`;
}

export function buildSystemPrompt(): string {
  return `${COST_ANALYSIS_SYSTEM_PROMPT}\n${buildToolContractAddendum()}`;
}

export interface RealSampleCostingSnapshot {
  costSubtotal: number;
  finalTotal: number;
  marginPercent: number;
  commissionPercent: number;
  freightAmount: number;
}

export interface CostAnalysisContext {
  designDirectionName: string;
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
  /** Only included when AiGarmentFabricDetail already exists for this project. */
  fabricDescription?: string | null;
  /** Only included when the project has graduated to a Style with a real, resolved BOM. */
  bomSummary?: string | null;
  targetMarket?: string | null;
  targetSellingPrice?: number | null;
  currencyCode?: string | null;
  orderQuantityEstimate?: number | null;
  /** Only included when a linked Sample Request's current version is already priced. */
  realSampleCosting?: RealSampleCostingSnapshot | null;
  /** Free-text runtime input, never persisted anywhere except the run's own audit log — same non-persisted-override convention as Development Brief's factoryCapabilities and Process 7/8's own additional-notes fields. */
  additionalGuidance?: string | null;
}

export function buildUserText(ctx: CostAnalysisContext): string {
  const currency = ctx.currencyCode || "the project's base currency";
  const lines: string[] = [
    `=== Approved Garment Design: ${ctx.designDirectionName} ===`,
    `Silhouette: ${ctx.silhouette}`,
    `Garment Length: ${ctx.garmentLength}`,
    `Fit: ${ctx.fit}`,
    `Neckline: ${ctx.neckline}`,
    `Collar: ${ctx.collar}`,
    `Sleeve: ${ctx.sleeve}`,
    `Closure: ${ctx.closure}`,
    `Pocket: ${ctx.pocket}`,
    `Waist Treatment: ${ctx.waistTreatment}`,
    `Hem: ${ctx.hem}`,
    `Key New Design Feature: ${ctx.keyNewDesignFeature}`,
    `Suggested Fabric Character (from Development Brief): ${ctx.suggestedFabricCharacter}`,
    `Suggested Trims (from Development Brief): ${ctx.suggestedTrims}`,
    `Currency for your cost range: ${currency}`,
  ];
  if (ctx.fabricDescription) lines.push(`Fabric (if known): ${ctx.fabricDescription}`);
  if (ctx.bomSummary) lines.push(`Resolved Bill of Materials so far: ${ctx.bomSummary}`);
  if (ctx.targetMarket) lines.push(`Market: ${ctx.targetMarket}`);
  if (ctx.targetSellingPrice != null) lines.push(`Target Selling Price: ${ctx.targetSellingPrice} ${currency}`);
  if (ctx.orderQuantityEstimate != null) lines.push(`Estimated Order Quantity: ${ctx.orderQuantityEstimate}`);
  if (ctx.realSampleCosting) {
    const c = ctx.realSampleCosting;
    lines.push(
      "",
      `=== Real Sampling costing already entered for this style (treat as ground truth, not a guess) ===`,
      `Material + process cost subtotal: ${c.costSubtotal} ${currency}`,
      `Margin: ${c.marginPercent}%, Commission: ${c.commissionPercent}%, Freight: ${c.freightAmount} ${currency}`,
      `Final costed total per unit: ${c.finalTotal} ${currency}`
    );
  }
  if (ctx.additionalGuidance) lines.push("", `Additional guidance from the merchandiser: ${ctx.additionalGuidance}`);
  return lines.join("\n");
}

function stringField() {
  return { type: "string" };
}

/**
 * `min`/`max` bounds on the cost-range numbers are enforced by the Zod
 * schema instead of the tool schema — Anthropic's `strict: true` tool mode
 * rejects `exclusiveMinimum` on a "number" property outright (confirmed
 * live during Process 8's own build: "For 'number' type, property
 * 'exclusiveMinimum' is not supported"), the same "the tool schema states
 * shape, the Zod layer states the real constraints" split already used by
 * Process 2/5/8.
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      estimatedCostPerUnitLow: { type: "number" },
      estimatedCostPerUnitHigh: { type: "number" },
      costBreakdownCommentary: stringField(),
      pricePositioningCommentary: stringField(),
      marginFeasibilityCommentary: stringField(),
      riskNotes: stringField(),
    },
    required: [
      "estimatedCostPerUnitLow",
      "estimatedCostPerUnitHigh",
      "costBreakdownCommentary",
      "pricePositioningCommentary",
      "marginFeasibilityCommentary",
      "riskNotes",
    ],
  };
}

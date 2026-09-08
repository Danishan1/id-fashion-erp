export const PROMPT_VERSION = "value-engineering-v1";

/**
 * The hidden AI prompt. Never sent to the browser — only used server-side
 * inside requestStructuredTextOutput(). Written fresh (no verbatim brief
 * exists for this process), scoped per the user's own explicit choice (via
 * AskUserQuestion) to cost-reduction suggestions against the real BOM, over
 * a broader design-level pass.
 */
export const VALUE_ENGINEERING_SYSTEM_PROMPT = `Act as a senior costing and value-engineering specialist for a garment manufacturer.

Review this garment's real, approved Bill of Materials (BOM) line by line, alongside its design context and
fabric detail if known. For each BOM line where a genuine, specific cost-reduction opportunity exists —
never for a line that is already efficient — suggest ONE concrete change: an alternative material,
construction simplification, or specification adjustment that could reduce cost while preserving the
design's own intent and commercial quality. Not every line needs a suggestion; a lean, already-efficient BOM
may legitimately produce very few or none.

For each suggestion, state:
- Which BOM line it's about (echo the material description given).
- The specific change suggested.
- The likely cost impact direction — LOWER, SIMILAR, or HIGHER — never an invented exact percentage or
  currency figure, since only a real supplier quote can establish that.
- Any quality or risk tradeoff the change would introduce (e.g. "may reduce hand-feel slightly", "verify
  colorfastness of the alternative dye lot").
- Your reasoning.

Also provide a short overall summary of where this style's real cost genuinely concentrates and the biggest
lever available, based only on what the BOM and any known per-piece costs actually show.

These are advisory ideas only, for a human to evaluate and apply themselves by editing the real BOM if they
choose — never claim a suggestion has already been applied, and never fabricate a specific saving figure.`;

function buildToolContractAddendum(): string {
  return `
You must respond by calling the provided tool exactly once. The "suggestions" array may contain between 0
and 15 entries — only include a genuine opportunity, do not pad the list to reach a target count.`;
}

export function buildSystemPrompt(): string {
  return `${VALUE_ENGINEERING_SYSTEM_PROMPT}\n${buildToolContractAddendum()}`;
}

export interface BomLineForValueEngineering {
  materialDescription: string;
  quantityPerUnit: number;
  uomCode: string;
  wastagePercentage: number;
  /** Null when the material's own Product.unitCost isn't set — rendered as "Not Tracked", never estimated. */
  costPerPieceContribution: number | null;
  currencyCode: string | null;
}

export interface ValueEngineeringContext {
  designDirectionName: string;
  silhouette: string;
  garmentLength: string;
  fit: string;
  neckline: string;
  collar: string;
  sleeve: string;
  closure: string;
  waistTreatment: string;
  hem: string;
  fabricDescription?: string | null;
  bomLines: BomLineForValueEngineering[];
  /** Only included when a Cost Analysis (Process 9) already exists for this project — real context, never re-derived. */
  costAnalysisSummary?: string | null;
  additionalGuidance?: string | null;
}

export function buildUserText(ctx: ValueEngineeringContext): string {
  const lines: string[] = [
    "=== Design Context ===",
    `Design: ${ctx.designDirectionName}`,
    `Silhouette: ${ctx.silhouette}`,
    `Garment Length: ${ctx.garmentLength}`,
    `Fit: ${ctx.fit}`,
    `Neckline: ${ctx.neckline}`,
    `Collar: ${ctx.collar}`,
    `Sleeve: ${ctx.sleeve}`,
    `Closure: ${ctx.closure}`,
    `Waist Treatment: ${ctx.waistTreatment}`,
    `Hem: ${ctx.hem}`,
  ];
  if (ctx.fabricDescription) lines.push(`Fabric (if known): ${ctx.fabricDescription}`);
  if (ctx.costAnalysisSummary) lines.push(`Existing advisory Cost Analysis (if any): ${ctx.costAnalysisSummary}`);
  if (ctx.additionalGuidance) lines.push(`Additional guidance from the user: ${ctx.additionalGuidance}`);

  lines.push("", `=== ${ctx.bomLines.length} Real BOM Lines to Review ===`);
  for (const line of ctx.bomLines) {
    const costText =
      line.costPerPieceContribution != null
        ? `${line.costPerPieceContribution.toFixed(2)} ${line.currencyCode ?? ""}`.trim()
        : "Not Tracked";
    lines.push(
      `- ${line.materialDescription}: ${line.quantityPerUnit} ${line.uomCode} per piece (+${line.wastagePercentage}% wastage), cost contribution: ${costText}`
    );
  }

  return lines.join("\n");
}

function suggestionNode() {
  return {
    type: "object",
    properties: {
      materialDescription: { type: "string" },
      suggestedChange: { type: "string" },
      costImpactDirection: { type: "string", enum: ["LOWER", "SIMILAR", "HIGHER"] },
      qualityRiskNotes: { type: "string" },
      reasoning: { type: "string" },
    },
    required: ["materialDescription", "suggestedChange", "costImpactDirection", "qualityRiskNotes", "reasoning"],
  };
}

/**
 * The 0-15 suggestion-count bound is stated in the prompt text and enforced
 * by validateValueEngineeringResponse's own bounded-array check, never in
 * this tool schema — Anthropic's `strict: true` tool mode rejects
 * `minItems`/`maxItems` on an array node outright, confirmed live already
 * during Process 8's own build.
 */
export function buildToolInputSchema() {
  return {
    type: "object" as const,
    properties: {
      overallSummary: { type: "string" },
      suggestions: { type: "array", items: suggestionNode() },
    },
    required: ["overallSummary", "suggestions"],
  };
}

import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type CostAnalysisContext } from "./prompt";
import { validateCostAnalysisResponse, type CostAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateCostAnalysisResult extends CostAnalysisResponse {
  model: string;
  rawResponse: unknown;
}

/**
 * Produces one advisory cost estimate/commentary for the project's approved
 * design (and resolved BOM/fabric detail/real Sampling costing, if known).
 * Zero database access — the module-layer service owns fetching the
 * project/design direction/BOM/Sample Request context, the run-log/
 * persistence, and never writes to Sampling's own real costing engine; this
 * function only ever does "context in, validated analysis out (or a thrown
 * error)."
 */
export async function generateCostAnalysis(ctx: CostAnalysisContext): Promise<GenerateCostAnalysisResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_cost_analysis",
    toolDescription: "Records an advisory cost-per-unit estimate range plus breakdown/pricing/margin/risk commentary for this garment design.",
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateCostAnalysisResponse(input),
  });

  return {
    ...result.data,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

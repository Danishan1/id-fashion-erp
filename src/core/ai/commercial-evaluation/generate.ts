import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type CommercialEvaluationContext } from "./prompt";
import { validateCommercialEvaluationResponse, type CommercialEvaluationItemOutput } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateCommercialEvaluationResult {
  items: CommercialEvaluationItemOutput[];
  overallRankingRationale: string;
  model: string;
  rawResponse: unknown;
}

/**
 * Compares 2-8 designs on the spec's 12-criterion commercial rubric. Zero
 * database access — the module-layer service owns fetching the project/
 * design directions, the run-log/persistence, and the commercial-development-
 * score computation; this function only ever does "context in, validated
 * evaluation out (or a thrown error)."
 */
export async function generateCommercialEvaluation(ctx: CommercialEvaluationContext): Promise<GenerateCommercialEvaluationResult> {
  const designCount = ctx.designs.length;
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(designCount),
    userText: buildUserText(ctx),
    toolName: "record_commercial_evaluation",
    toolDescription: `Records a commercial evaluation for each of the ${designCount} garment designs being compared, plus the overall comparative ranking rationale.`,
    inputSchema: buildToolInputSchema(designCount),
    validate: (input: unknown) => validateCommercialEvaluationResponse(designCount, input),
  });

  return {
    items: result.data.items,
    overallRankingRationale: result.data.overallRankingRationale,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

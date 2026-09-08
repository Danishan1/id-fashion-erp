import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type ValueEngineeringContext } from "./prompt";
import { validateValueEngineeringResponse, type ValueEngineeringResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateValueEngineeringResult {
  data: ValueEngineeringResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * Reviews the real, approved BOM for genuine cost-reduction opportunities.
 * Zero database access — the module-layer service owns fetching the
 * project/BOM/fabric detail, the run-log/persistence; this function only
 * ever does "context in, validated suggestions out (or a thrown error)."
 */
export async function generateValueEngineering(ctx: ValueEngineeringContext): Promise<GenerateValueEngineeringResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_value_engineering_suggestions",
    toolDescription: "Records advisory cost-reduction suggestions against this garment's real BOM.",
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateValueEngineeringResponse(input),
  });

  return {
    data: result.data,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

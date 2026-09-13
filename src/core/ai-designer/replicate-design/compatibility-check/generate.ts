import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type CompatibilityCheckContext } from "./prompt";
import { validateCompatibilityCheckResponse, type CompatibilityItemOutput } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateCompatibilityCheckResult {
  items: CompatibilityItemOutput[];
  overallSummary: string;
  overallRating: "COMPATIBLE" | "MINOR_CONCERN" | "INCOMPATIBLE";
  model: string;
  rawResponse: unknown;
}

/**
 * Assesses every fabric/material subject against the project's own locked
 * Design DNA. Zero database access — the module-layer service owns
 * fetching the project/analysis/material lines, the run-log/persistence,
 * and zipping the positional response back to real subject rows; this
 * function only ever does "context in, validated assessment out (or a
 * thrown error)."
 */
export async function generateCompatibilityCheck(ctx: CompatibilityCheckContext): Promise<GenerateCompatibilityCheckResult> {
  const subjectCount = ctx.subjects.length;
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_compatibility_check",
    toolDescription: `Records a compatibility assessment for each of the ${subjectCount} fabric/material subjects being assessed, plus an overall summary and rating.`,
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateCompatibilityCheckResponse(subjectCount, input),
  });

  return {
    items: result.data.items,
    overallSummary: result.data.overallSummary,
    overallRating: result.data.overallRating,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

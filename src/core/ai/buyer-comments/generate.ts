import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type BuyerCommentsContext } from "./prompt";
import { validateBuyerCommentsResponse, type BuyerCommentsResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateBuyerCommentsResult {
  data: BuyerCommentsResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * Summarises the real buyer feedback already recorded on a Sample Request
 * (comment thread + decision notes) into a structured, categorized summary.
 * Zero database access — the module-layer service owns fetching the real
 * comments/decisions, the run-log/persistence; this function only ever does
 * "real feedback in, validated structured summary out (or a thrown error)."
 */
export async function generateBuyerComments(ctx: BuyerCommentsContext): Promise<GenerateBuyerCommentsResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_buyer_comments_summary",
    toolDescription: "Records a structured, categorized summary of the buyer's real recorded feedback.",
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateBuyerCommentsResponse(input),
  });

  return {
    data: result.data,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type BomSuggestionContext } from "./prompt";
import { validateBomSuggestionResponse, type BomSuggestionItemOutput } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateBomSuggestionsResult {
  items: BomSuggestionItemOutput[];
  model: string;
  rawResponse: unknown;
}

/**
 * Suggests a draft Bill of Materials for one finished garment piece, based
 * on the approved design's own structured fields (and fabric detail, if
 * known). Zero database access — the module-layer service owns fetching the
 * project/design direction, the run-log/persistence, and resolving each
 * suggestion into a real BomItem via the existing bom-mrp module; this
 * function only ever does "context in, validated suggestions out (or a
 * thrown error)."
 */
export async function generateBomSuggestions(ctx: BomSuggestionContext): Promise<GenerateBomSuggestionsResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_bom_suggestions",
    toolDescription: "Records a suggested draft Bill of Materials (one line per material/trim/accessory) for this garment design.",
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateBomSuggestionResponse(input),
  });

  return {
    items: result.data.items,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

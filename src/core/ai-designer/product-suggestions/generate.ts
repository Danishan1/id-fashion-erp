import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type FabricAnalysisContext } from "./prompt";
import { validateProductSuggestionsResponse, type ProductSuggestionsResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateProductSuggestionsResult {
  data: ProductSuggestionsResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point AI Designer's Product Suggestions step calls into
 * the AI layer. Deliberately zero database access — the module-layer
 * service owns fetching the project's own fabric fields, the duplicate-run
 * guard, and persisting the result; this function only ever does "fabric
 * context in, validated structured suggestions out (or a thrown error)." A
 * text-only call (the fabric is already described in plain text by Fabric
 * Analysis at this point) — never a vision call.
 */
export async function generateProductSuggestions(fabric: FabricAnalysisContext): Promise<GenerateProductSuggestionsResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(fabric),
    toolName: "record_product_suggestions",
    toolDescription: "Records a structured, prioritized list of suggested garments per suitable customer segment for this fabric.",
    inputSchema: buildToolInputSchema(),
    validate: validateProductSuggestionsResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

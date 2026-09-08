import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type ProductSuitabilityContext } from "./prompt";
import { validateProductSuitabilityResponse, type SuitabilityItemOutput } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateProductSuitabilityResult {
  items: SuitabilityItemOutput[];
  overallSummary: string;
  model: string;
  rawResponse: unknown;
}

/**
 * Assesses every one of the company's active ProductType rows against the
 * project's already-approved Fabric Analysis. Zero database access — the
 * module-layer service owns fetching the project/fabric analysis/product
 * types, the run-log/persistence, and zipping the positional response back
 * to real ProductType ids; this function only ever does "context in,
 * validated assessment out (or a thrown error)."
 */
export async function generateProductSuitability(ctx: ProductSuitabilityContext): Promise<GenerateProductSuitabilityResult> {
  const productTypeCount = ctx.productTypes.length;
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_product_suitability",
    toolDescription: `Records a suitability assessment for each of the ${productTypeCount} garment types being assessed, plus an overall summary.`,
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateProductSuitabilityResponse(productTypeCount, input),
  });

  return {
    items: result.data.items,
    overallSummary: result.data.overallSummary,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

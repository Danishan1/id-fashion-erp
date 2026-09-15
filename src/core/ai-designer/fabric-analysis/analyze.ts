import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateFabricAnalysisResponse, type FabricAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface AnalyzeFabricParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  projectContext: { productCategory?: string | null; targetCustomerLabel?: string | null };
}

export interface AnalyzeFabricResult {
  data: FabricAnalysisResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point AI Designer's Fabric Analysis step calls into the
 * AI layer. Deliberately zero database access — the module-layer service
 * owns fetching the project/attachment, the duplicate-run guard, and
 * persisting the result; this function only ever does "image + context in,
 * validated structured analysis out (or a thrown error)." Uses the shared,
 * generic Anthropic wrapper — this module's own prompt/schema is what makes
 * this genuinely AI Designer's own call, not a fork of the sibling module's.
 */
export async function analyzeFabric(params: AnalyzeFabricParams): Promise<AnalyzeFabricResult> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(params.projectContext),
    toolName: "record_fabric_analysis",
    toolDescription: "Records a structured, minimal analysis of the fabric photograph following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateFabricAnalysisResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

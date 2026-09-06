import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateReferenceAnalysisResponse, type ReferenceAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface AnalyzeReferenceGarmentParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  projectContext: { garmentCategory?: string | null; targetMarket?: string | null };
}

export interface AnalyzeReferenceGarmentResult {
  data: ReferenceAnalysisResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point Process 1 calls into the AI layer. Deliberately
 * has zero database access — the module-layer service
 * (src/modules/ai-garment-flow/reference-analysis.service.ts) owns fetching
 * the project/attachment, the duplicate-run guard, and persisting the
 * result; this function only ever does "image + context in, validated
 * structured analysis out (or a thrown error)."
 */
export async function analyzeReferenceGarment(
  params: AnalyzeReferenceGarmentParams
): Promise<AnalyzeReferenceGarmentResult> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(params.projectContext),
    toolName: "record_reference_garment_analysis",
    toolDescription:
      "Records a structured analysis of the reference garment image following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateReferenceAnalysisResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

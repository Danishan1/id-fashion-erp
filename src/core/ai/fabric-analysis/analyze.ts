import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateFabricAnalysisResponse, type FabricAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface AnalyzeFabricSwatchParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  projectContext: { garmentCategory?: string | null; targetMarket?: string | null };
}

export interface AnalyzeFabricSwatchResult {
  data: FabricAnalysisResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point Process 7 calls into the AI layer. Deliberately
 * has zero database access — the module-layer service
 * (src/modules/ai-garment-flow/fabric-analysis.service.ts) owns fetching
 * the project/attachment, the duplicate-run guard, and persisting the
 * result; this function only ever does "image + context in, validated
 * structured analysis out (or a thrown error)." Mirrors
 * reference-analysis/analyze.ts exactly.
 */
export async function analyzeFabricSwatch(params: AnalyzeFabricSwatchParams): Promise<AnalyzeFabricSwatchResult> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(params.projectContext),
    toolName: "record_fabric_analysis",
    toolDescription: "Records a structured analysis of the fabric swatch photograph following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateFabricAnalysisResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

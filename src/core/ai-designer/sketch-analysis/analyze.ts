import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateSketchAnalysisResponse, type SketchAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface AnalyzeSketchParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface AnalyzeSketchResult {
  data: SketchAnalysisResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point AI Designer's Sketch Analysis calls into the AI
 * layer. Zero database access — the module-layer service owns fetching the
 * project/attachment, the duplicate-run guard, and persisting the result;
 * this function only ever does "image in, validated structured analysis out
 * (or a thrown error)."
 */
export async function analyzeSketch(params: AnalyzeSketchParams): Promise<AnalyzeSketchResult> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(),
    toolName: "record_sketch_analysis",
    toolDescription: "Records a structured analysis of the garment sketch/drawing image following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateSketchAnalysisResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

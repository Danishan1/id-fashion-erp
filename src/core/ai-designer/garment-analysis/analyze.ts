import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateGarmentAnalysisResponse, type GarmentAnalysisResponse } from "./schema";

export { PROMPT_VERSION };

export interface AnalyzeGarmentParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  isSketch: boolean;
}

/** Zero database access — "image in, validated structured analysis out (or a thrown error)", same shape as fabric-analysis/analyze.ts. */
export async function analyzeGarment(params: AnalyzeGarmentParams): Promise<{ data: GarmentAnalysisResponse; model: string }> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText({ isSketch: params.isSketch }),
    toolName: "record_garment_analysis",
    toolDescription: "Records a structured analysis of the garment photo or sketch following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateGarmentAnalysisResponse,
  });
  return { data: result.data, model: result.model };
}

import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION } from "./prompt";
import { validateDnaAnalysisResponse, type DnaAnalysisResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface AnalyzeReplicateDesignDnaParams {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  projectContext: { fabricKnown?: boolean };
}

export interface AnalyzeReplicateDesignDnaResult {
  data: DnaAnalysisResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * The one real entry point Replicate Design's DNA analysis calls into the AI
 * layer. Zero database access — the module-layer service owns fetching the
 * project/attachment, the duplicate-run guard, and persisting the result;
 * this function only ever does "image + context in, validated structured
 * analysis out (or a thrown error)."
 */
export async function analyzeReplicateDesignDna(
  params: AnalyzeReplicateDesignDnaParams
): Promise<AnalyzeReplicateDesignDnaResult> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(params.projectContext),
    toolName: "record_design_dna",
    toolDescription: "Records a structured Design DNA analysis of the reference garment image following the required schema exactly.",
    inputSchema: buildToolInputSchema(),
    validate: validateDnaAnalysisResponse,
  });

  return { data: result.data, model: result.model, rawResponse: result.rawResponse };
}

import { requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import { buildMasterToolInputSchema, buildMasterUserText, MASTER_TECH_PACK_SYSTEM_PROMPT, type MasterTechPackErpFacts } from "./prompt";
import { validateMasterAnalysis, type MasterAnalysis } from "./schema";

/** Zero database access — garment image + ERP facts in, validated A–J analysis out (or a thrown AiServiceError/AiInvalidResponseError). */
export async function analyzeGarmentForTechPack(params: {
  imageBuffer: Buffer;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  facts: MasterTechPackErpFacts;
}): Promise<{ data: MasterAnalysis; model: string }> {
  const result = await requestStructuredVisionOutput({
    imageBase64: params.imageBuffer.toString("base64"),
    imageMediaType: params.imageMediaType,
    systemPrompt: MASTER_TECH_PACK_SYSTEM_PROMPT,
    userText: buildMasterUserText(params.facts),
    toolName: "record_tech_pack_analysis",
    toolDescription: "Records the complete A–J garment tech pack analysis following the required schema exactly.",
    inputSchema: buildMasterToolInputSchema(),
    validate: validateMasterAnalysis,
  });
  return { data: result.data, model: result.model };
}

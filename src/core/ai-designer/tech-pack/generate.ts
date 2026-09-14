import { requestStructuredTextOutput, requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import {
  buildGarmentAnalysisPart1SystemPrompt,
  buildGarmentAnalysisPart1UserText,
  buildGarmentAnalysisPart1ToolInputSchema,
  buildGarmentAnalysisPart2SystemPrompt,
  buildGarmentAnalysisPart2UserText,
  buildGarmentAnalysisPart2ToolInputSchema,
  type TechPackDesignContext,
} from "./prompt";
import { validateGarmentAnalysisPart1, validateGarmentAnalysisPart2, type GarmentAnalysisPart1, type GarmentAnalysisPart2 } from "./schema";

export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

/** Zero database access — inputs in, validated result out (or a thrown error), matching every other AI Designer/AI Garment Flow "generate" function. */
export async function generateGarmentAnalysisPart1(params: {
  ctx: TechPackDesignContext;
  imageBase64: string;
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
}): Promise<{ data: GarmentAnalysisPart1; model: string }> {
  const result = await requestStructuredVisionOutput({
    systemPrompt: buildGarmentAnalysisPart1SystemPrompt(),
    userText: buildGarmentAnalysisPart1UserText(params.ctx),
    imageBase64: params.imageBase64,
    imageMediaType: params.imageMediaType,
    toolName: "record_garment_analysis_part1",
    toolDescription: "Records the garment analysis (categories A-G: identification, construction, closure, seam callouts, colors & colorways, artwork, pattern/print).",
    inputSchema: buildGarmentAnalysisPart1ToolInputSchema(),
    validate: (input: unknown) => validateGarmentAnalysisPart1(input),
  });
  return { data: result.data, model: result.model };
}

export async function generateGarmentAnalysisPart2(params: {
  ctx: TechPackDesignContext;
  part1: GarmentAnalysisPart1;
}): Promise<{ data: GarmentAnalysisPart2; model: string }> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildGarmentAnalysisPart2SystemPrompt(),
    userText: buildGarmentAnalysisPart2UserText(params.ctx, params.part1),
    toolName: "record_garment_analysis_part2",
    toolDescription: "Records the garment analysis (categories H-J: bill of materials, measurements & grading, labels & packaging) plus designer notes and suggested additional views.",
    inputSchema: buildGarmentAnalysisPart2ToolInputSchema(),
    validate: (input: unknown) => validateGarmentAnalysisPart2(input),
  });
  return { data: result.data, model: result.model };
}

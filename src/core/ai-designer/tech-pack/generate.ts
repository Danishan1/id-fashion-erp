import { requestStructuredTextOutput, requestStructuredVisionOutput } from "@/core/ai/providers/anthropic";
import {
  buildGarmentAnalysisPart1SystemPrompt,
  buildGarmentAnalysisPart1UserText,
  buildGarmentAnalysisPart1ToolInputSchema,
  buildGarmentAnalysisPart2SystemPrompt,
  buildGarmentAnalysisPart2UserText,
  buildGarmentAnalysisPart2ToolInputSchema,
  buildGarmentAnalysisPart3SystemPrompt,
  buildGarmentAnalysisPart3UserText,
  buildGarmentAnalysisPart3ToolInputSchema,
  buildGarmentAnalysisPart4SystemPrompt,
  buildGarmentAnalysisPart4UserText,
  buildGarmentAnalysisPart4ToolInputSchema,
  type TechPackDesignContext,
} from "./prompt";
import {
  validateGarmentAnalysisPart1,
  validateGarmentAnalysisPart2,
  validateGarmentAnalysisPart3,
  validateGarmentAnalysisPart4,
  type GarmentAnalysisPart1,
  type GarmentAnalysisPart2,
  type GarmentAnalysisPart3,
} from "./schema";

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
    toolDescription: "Records the garment analysis (categories A-G: identification, construction, closure, seam callouts, colors & colorways, artwork, pattern/print), each fact tagged with its own confidence status.",
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
    toolDescription: "Records the Fabric & Materials table, Bill of Materials, and graded Measurements & Grading, each fabricatable fact tagged with its own confidence status.",
    inputSchema: buildGarmentAnalysisPart2ToolInputSchema(),
    validate: (input: unknown) => validateGarmentAnalysisPart2(input),
  });
  return { data: result.data, model: result.model };
}

export async function generateGarmentAnalysisPart3(params: {
  ctx: TechPackDesignContext;
  part1: GarmentAnalysisPart1;
}): Promise<{ data: GarmentAnalysisPart3; model: string }> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildGarmentAnalysisPart3SystemPrompt(),
    userText: buildGarmentAnalysisPart3UserText(params.ctx, params.part1),
    toolName: "record_garment_analysis_part3",
    toolDescription: "Records Production Instructions, QC Checkpoints, Labels & Packaging, and Hangtag & Barcode.",
    inputSchema: buildGarmentAnalysisPart3ToolInputSchema(),
    validate: (input: unknown) => validateGarmentAnalysisPart3(input),
  });
  return { data: result.data, model: result.model };
}

export async function generateGarmentAnalysisPart4(params: {
  ctx: TechPackDesignContext;
  part1: GarmentAnalysisPart1;
  part2: GarmentAnalysisPart2;
  part3: GarmentAnalysisPart3;
}) {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildGarmentAnalysisPart4SystemPrompt(),
    userText: buildGarmentAnalysisPart4UserText(params.ctx, params.part1, params.part2, params.part3),
    toolName: "record_garment_analysis_part4",
    toolDescription: "Records Assumptions & Missing Data, Additional Reference Images Required, and the Designer Notes overview.",
    inputSchema: buildGarmentAnalysisPart4ToolInputSchema(),
    validate: (input: unknown) => validateGarmentAnalysisPart4(input),
  });
  return { data: result.data, model: result.model };
}

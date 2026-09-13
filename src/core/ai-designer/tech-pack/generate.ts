import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import {
  buildGradingSystemPrompt,
  buildGradingUserText,
  buildGradingToolInputSchema,
  buildBomSystemPrompt,
  buildBomUserText,
  buildBomToolInputSchema,
  type TechPackDesignContext,
} from "./prompt";
import { validateGradingResponse, validateBomResponse, type GradingResponse, type BomResponse } from "./schema";

export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateGradingResult {
  data: GradingResponse;
  model: string;
}

/** Zero database access — context in, validated result out (or a thrown error), matching every other AI Designer/AI Garment Flow "generate" function. */
export async function generateGrading(ctx: TechPackDesignContext): Promise<GenerateGradingResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildGradingSystemPrompt(),
    userText: buildGradingUserText(ctx),
    toolName: "record_graded_measurements",
    toolDescription: "Records a graded Point-of-Measure chart for this garment across a fixed set of standard sizes.",
    inputSchema: buildGradingToolInputSchema(),
    validate: (input: unknown) => validateGradingResponse(input),
  });
  return { data: result.data, model: result.model };
}

export interface GenerateTechPackBomResult {
  data: BomResponse;
  model: string;
}

export async function generateTechPackBom(ctx: TechPackDesignContext): Promise<GenerateTechPackBomResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildBomSystemPrompt(),
    userText: buildBomUserText(ctx),
    toolName: "record_draft_bom",
    toolDescription: "Records a suggested draft Bill of Materials (one line per material/trim/accessory) for this garment.",
    inputSchema: buildBomToolInputSchema(),
    validate: (input: unknown) => validateBomResponse(input),
  });
  return { data: result.data, model: result.model };
}

import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type TechnicalSpecificationContext } from "./prompt";
import { validateTechnicalSpecificationResponse, type TechnicalSpecificationResponse } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateTechnicalSpecificationResult {
  data: TechnicalSpecificationResponse;
  model: string;
  rawResponse: unknown;
}

/**
 * Drafts a Point-of-Measure chart for one design direction, graded across
 * the company's own real Size list. Zero database access — the module-layer
 * service owns fetching the project/design direction/sizes, the run-log/
 * persistence, and the per-cell edit/reset discipline; this function only
 * ever does "context in, validated structured output out (or a thrown
 * error)."
 */
export async function generateTechnicalSpecification(
  ctx: TechnicalSpecificationContext
): Promise<GenerateTechnicalSpecificationResult> {
  const sizeCount = ctx.sizes.length;
  const sizeNames = ctx.sizes.map((s) => s.name);
  const userText = buildUserText(ctx);

  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(sizeCount, sizeNames),
    userText,
    toolName: "record_technical_specification",
    toolDescription: "Records a draft Point-of-Measure chart for this garment design, one value per size.",
    inputSchema: buildToolInputSchema(),
    validate: (input: unknown) => validateTechnicalSpecificationResponse(sizeCount, input),
  });

  return {
    data: result.data,
    model: result.model,
    rawResponse: result.rawResponse,
  };
}

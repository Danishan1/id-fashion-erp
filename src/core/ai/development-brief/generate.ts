import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type DevelopmentBriefContext } from "./prompt";
import { validateDevelopmentBriefResponse, validateSingleDesignDirectionResponse, type DesignDirectionOutput } from "./schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateDevelopmentBriefResult {
  directions: DesignDirectionOutput[];
  model: string;
  rawResponse: unknown;
}

/**
 * Generates a batch of N differentiated design directions. Zero database
 * access — the module-layer service owns fetching the project/approved
 * analysis, the run-log/persistence, and the per-direction status machine;
 * this function only ever does "context in, validated design directions
 * out (or a thrown error)."
 */
export async function generateDevelopmentBrief(
  ctx: DevelopmentBriefContext
): Promise<GenerateDevelopmentBriefResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_design_directions",
    toolDescription: "Records the requested number of differentiated commercial garment design directions, each fully scored.",
    inputSchema: buildToolInputSchema(ctx.directionCount),
    validate: (input: unknown) => validateDevelopmentBriefResponse(input, ctx.directionCount),
  });

  return { directions: result.data.designDirections, model: result.model, rawResponse: result.rawResponse };
}

export interface RegenerateDesignDirectionResult {
  direction: DesignDirectionOutput;
  model: string;
  rawResponse: unknown;
}

/** Same generation call, constrained to exactly one direction — used by the per-design Regenerate action. */
export async function regenerateDesignDirection(
  ctx: DevelopmentBriefContext
): Promise<RegenerateDesignDirectionResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText({ ...ctx, directionCount: 1 }),
    toolName: "record_design_directions",
    toolDescription: "Records exactly one fresh, differentiated commercial garment design direction, fully scored.",
    inputSchema: buildToolInputSchema(1),
    validate: validateSingleDesignDirectionResponse,
  });

  return { direction: result.data, model: result.model, rawResponse: result.rawResponse };
}

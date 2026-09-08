import { requestStructuredTextOutput } from "@/core/ai/providers/anthropic";
import { buildSystemPrompt, buildToolInputSchema, buildUserText, PROMPT_VERSION, type FabricDevelopmentBriefContext } from "./prompt";
import {
  validateDevelopmentBriefResponse,
  validateSingleDesignDirectionResponse,
  type DesignDirectionOutput,
} from "@/core/ai/development-brief/schema";

export { PROMPT_VERSION };
export { AiServiceError, AiInvalidResponseError } from "@/core/ai/providers/anthropic";
export { AiConfigMissingError } from "@/core/ai/config";

export interface GenerateFabricDevelopmentBriefResult {
  directions: DesignDirectionOutput[];
  model: string;
  rawResponse: unknown;
}

/**
 * Generates a batch of N differentiated design directions from a fixed,
 * already-known fabric — the FABRIC-workflow's own analogue to
 * generateDevelopmentBrief(). Reuses development-brief/schema.ts's
 * DesignDirectionOutput/validators directly rather than duplicating an
 * identical 24-field Zod schema a second time — the OUTPUT shape is
 * genuinely identical between the two processes (both populate the exact
 * same AiGarmentDesignDirection table), only the informing context (prompt)
 * differs. Zero database access — the module-layer service owns fetching
 * the project/approved analyses, the run-log/persistence, and the
 * per-direction status machine.
 */
export async function generateFabricDevelopmentBrief(
  ctx: FabricDevelopmentBriefContext
): Promise<GenerateFabricDevelopmentBriefResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText(ctx),
    toolName: "record_design_directions",
    toolDescription: "Records the requested number of differentiated commercial garment design directions for this fabric, each fully scored.",
    inputSchema: buildToolInputSchema(ctx.directionCount),
    validate: (input: unknown) => validateDevelopmentBriefResponse(input, ctx.directionCount),
  });

  return { directions: result.data.designDirections, model: result.model, rawResponse: result.rawResponse };
}

export interface RegenerateFabricDesignDirectionResult {
  direction: DesignDirectionOutput;
  model: string;
  rawResponse: unknown;
}

/** Same generation call, constrained to exactly one direction — used by the per-design Regenerate action. */
export async function regenerateFabricDesignDirection(
  ctx: FabricDevelopmentBriefContext
): Promise<RegenerateFabricDesignDirectionResult> {
  const result = await requestStructuredTextOutput({
    systemPrompt: buildSystemPrompt(),
    userText: buildUserText({ ...ctx, directionCount: 1 }),
    toolName: "record_design_directions",
    toolDescription: "Records exactly one fresh, differentiated commercial garment design direction for this fabric, fully scored.",
    inputSchema: buildToolInputSchema(1),
    validate: validateSingleDesignDirectionResponse,
  });

  return { direction: result.data, model: result.model, rawResponse: result.rawResponse };
}

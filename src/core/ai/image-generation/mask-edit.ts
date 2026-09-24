import { z } from "zod";
import { ImageGenerationServiceError } from "./types";
import { runWithFailover, type RunWithFailoverResult } from "@/core/ai/provider-manager/AIProviderManager";

export { buildMaskEditPrompt, MASK_EDIT_PROMPT_VERSION } from "./mask-edit-prompt";

/**
 * "Draw & Describe" (pencil-mask-based inpainting) — the ONE shared function
 * every module's mask-edit call goes through. Catalogue Designs and
 * Sketch-to-Garment (both via AI Designer's own generateMaskEditPreview) and
 * Replicate Design (via its own generateReplicateMaskEditPreview) each keep
 * their own separate route, schema, and prompt/generation/image persistence
 * (their own AiDesignerPrompt/Generation/Image vs. ReplicateDesignPrompt/
 * Generation/Image tables), and each builds the prompt text once via the
 * shared buildMaskEditPrompt() (re-exported above) so it can be persisted
 * onto their own prompt row — but the actual "resolve a capable provider and
 * call it" step always happens exactly once, here, so the feature's real
 * generation behavior can never silently diverge between modules.
 */
export const maskEditInstructionSchema = z.object({
  instruction: z.string().min(1, "Describe what to change in the drawn area.").max(2000),
  // Both routes parse this out of a multipart FormData field (always a
  // string) rather than a JSON body, since the mask itself has to travel as
  // a real file — z.coerce accepts that directly, no manual Number() cast
  // needed at either call site.
  imageCount: z.coerce.number().int().min(1).max(4).default(1),
});
export type MaskEditInstructionInput = z.infer<typeof maskEditInstructionSchema>;

export interface RunMaskEditGenerationParams {
  companyId: string;
  userId: string;
  /** Human-readable context for the audit trail, e.g. "AI Designer / Project AID-2026-00001 / Draw & Describe". */
  generationContext: string;
  aiDesignerProjectId?: string;
  /** A genuinely different project table from AiDesignerProject (Replicate Design's own), so it needs its own FK rather than overloading aiDesignerProjectId with an id the existing FK constraint would reject. */
  replicateDesignProjectId?: string;
  /** Built once by the caller via buildMaskEditPrompt() and persisted onto its own prompt row — passed straight through here, never re-derived, the same "compute once, thread it through" shape every other edit-preview function in this app already uses. */
  prompt: string;
  imageCount: number;
  baseImage: { buffer: Buffer; mimeType: string };
  /** Must be a same-dimension PNG with fully-transparent pixels marking the drawn (editable) area — callers validate dimensions before reaching here (see AI Designer's/Replicate Design's own generateMaskEditPreview). */
  maskImage: { buffer: Buffer; mimeType: string };
}

export async function runMaskEditGeneration(params: RunMaskEditGenerationParams): Promise<RunWithFailoverResult> {
  return runWithFailover({
    companyId: params.companyId,
    userId: params.userId,
    capability: "MASK_EDIT",
    generationContext: params.generationContext,
    aiDesignerProjectId: params.aiDesignerProjectId,
    replicateDesignProjectId: params.replicateDesignProjectId,
    inputImagePresent: true,
    call: (provider) => {
      if (!provider.inpaint) {
        throw new ImageGenerationServiceError(
          `The configured image provider ("${provider.name}") does not support drawing-based (mask) edits.`,
          "UNSUPPORTED_OPERATION"
        );
      }
      return provider.inpaint({ prompt: params.prompt, count: params.imageCount, baseImage: params.baseImage, maskImage: params.maskImage });
    },
  });
}

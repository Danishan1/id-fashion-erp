import { DESIGN_FEATURE_LABELS, type DesignFeature } from "./feature-registry";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output — stored on every AiGarmentDesignVariationRun/AiGarmentDesignVariation
 * row, same auditability reasoning as reference-analysis's own PROMPT_VERSION.
 */
export const FEATURE_CHANGE_PROMPT_VERSION = "feature-change-v1";

export interface FeatureChangeContext {
  featureKey: DesignFeature;
  currentFeatureValue: string;
  newRequirement: string;
  additionalInstructions?: string | null;
}

/**
 * The hidden AI image prompt. Verbatim per the product brief; never shown to
 * end users, never free-typed by a user — the form only ever collects the
 * feature/current/new/additional-instructions fields, which are substituted
 * in here server-side.
 */
export function buildFeatureChangePrompt(ctx: FeatureChangeContext): string {
  const lines = [
    "Keep the selected garment design as unchanged as possible.",
    "",
    "Change ONLY:",
    "",
    "Feature:",
    DESIGN_FEATURE_LABELS[ctx.featureKey],
    "",
    "Current:",
    ctx.currentFeatureValue,
    "",
    "New Requirement:",
    ctx.newRequirement,
    "",
    "Preserve:",
    "",
    "overall silhouette unless silhouette is the selected change",
    "fabric appearance",
    "colour",
    "print scale",
    "garment category",
    "remaining construction",
    "model",
    "pose",
    "background",
    "",
    "Do not independently redesign other garment features.",
    "",
    "The changed feature must be technically plausible and commercially manufacturable.",
    "",
    "Generate a clean revised garment suitable for direct comparison with the previous version.",
  ];

  if (ctx.additionalInstructions) {
    lines.push("", "Additional instructions from the user:", ctx.additionalInstructions);
  }

  return lines.join("\n");
}

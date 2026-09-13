import { DESIGN_FEATURE_LABELS, type DesignFeature } from "./feature-registry";

/**
 * Bumps whenever this prompt's wording changes in a way that could affect
 * output — stored on every AiGarmentDesignVariationRun/AiGarmentDesignVariation
 * row, same auditability reasoning as reference-analysis's own PROMPT_VERSION.
 */
export const FEATURE_CHANGE_PROMPT_VERSION = "feature-change-v2";

/**
 * Which fixed Preserve-list item(s) to drop when that same aspect is the one
 * actually being changed — generalizes what was previously a single
 * SILHOUETTE-only special case. Without this, "Change Color"/"Change
 * Background"/"Change Model" would contradictorily instruct the AI to both
 * change and preserve the same thing. BUTTONS/LOGO/EMBROIDERY need no
 * entry — they're pure additions with nothing in the fixed Preserve list to
 * exclude.
 */
const PRESERVE_EXCLUSIONS: Partial<Record<DesignFeature, string>> = {
  SILHOUETTE: "overall silhouette",
  COLOR: "colour",
  BACKGROUND_ENVIRONMENT: "background",
  MODEL: "model",
};

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
  const exclude = PRESERVE_EXCLUSIONS[ctx.featureKey];
  const preserveItems = [
    "overall silhouette",
    "fabric appearance",
    "colour",
    "print scale",
    "garment category",
    "remaining construction",
    "model",
    "pose",
    "background",
  ].filter((item) => item !== exclude);

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
    ...preserveItems,
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

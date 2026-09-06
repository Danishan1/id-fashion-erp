export const PROMPT_VERSION = "visual-generation-v1";

export interface VisualGenerationContext {
  category: string;
  silhouette: string;
  fit: string;
  length: string;
  neckline: string;
  collar: string;
  sleeve: string;
  shoulder: string;
  front: string;
  back: string;
  closure: string;
  pocket: string;
  waist: string;
  hem: string;
  feature: string;
  fabric: string;
  customer: string;
  market: string;
  season: string;
  commercialPosition: string;
}

const FALLBACK = "Not specified";

/**
 * The hidden image-generation prompt template — verbatim per the product
 * brief. Never shown to end users; built server-side only from the
 * APPROVED design direction's own structured fields (never free-typed by a
 * user), so every generated image is traceable back to exactly which
 * design-direction values produced it.
 */
export function buildImageGenerationPrompt(ctx: VisualGenerationContext): string {
  const v = (s: string | null | undefined) => (s && s.trim().length > 0 ? s : FALLBACK);

  return `Create a commercially differentiated garment inspired only by the broad design direction of the supplied reference.

Do not reproduce the original reference garment exactly.

Create:

Garment Category:
${v(ctx.category)}

Silhouette:
${v(ctx.silhouette)}

Fit:
${v(ctx.fit)}

Length:
${v(ctx.length)}

Neckline:
${v(ctx.neckline)}

Collar:
${v(ctx.collar)}

Sleeve:
${v(ctx.sleeve)}

Shoulder:
${v(ctx.shoulder)}

Front Construction:
${v(ctx.front)}

Back Construction:
${v(ctx.back)}

Closure:
${v(ctx.closure)}

Pocket:
${v(ctx.pocket)}

Waist:
${v(ctx.waist)}

Hem:
${v(ctx.hem)}

Key New Feature:
${v(ctx.feature)}

Fabric Character:
${v(ctx.fabric)}

Target Customer:
${v(ctx.customer)}

Target Market:
${v(ctx.market)}

Season:
${v(ctx.season)}

Commercial Position:
${v(ctx.commercialPosition)}

The garment must be realistic and commercially manufacturable.

Avoid impossible construction.

Avoid unnecessary runway exaggeration.

Preserve realistic garment proportions.

Make details visible enough for product-development review.

The output is a commercial garment-development visual, not fantasy fashion art.`;
}

const VARIATION_ADDENDUM = `

This is a variation request: keep the same broad design direction, silhouette, and key structural details as the referenced image, but produce a fresh, distinct rendering of it — not a duplicate.`;

/** "Create Variation" reuses the exact same hidden template, plus one addendum, and is sent alongside the parent image itself (image-to-image), never as text-only. */
export function buildVariationPrompt(ctx: VisualGenerationContext): string {
  return buildImageGenerationPrompt(ctx) + VARIATION_ADDENDUM;
}

const COMMERCIAL_POSITION_LABELS: Record<string, string> = {
  SAFE_COMMERCIAL: "Safe Commercial",
  BALANCED: "Balanced",
  FASHION_FORWARD: "Fashion Forward",
};

export function humanizeCommercialPosition(value: string): string {
  return COMMERCIAL_POSITION_LABELS[value] ?? value;
}

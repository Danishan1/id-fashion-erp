/**
 * AI Designer "New Design" flow (2026-09-27) — hidden generation prompts.
 * Built entirely server-side from the project's own structured fields; the
 * model-template photo and the fabric photo are supplied separately as real
 * input images to the provider call, never described in text.
 */

export const NEW_DESIGN_PROMPT_VERSION = "ai-designer-new-design-v1";

export interface TemplateDressSwapContext {
  /** e.g. "Dress", "Lehenga". */
  garmentType: string;
  targetCustomer: string;
  ageGroup: string;
  /** Free-text design brief from the Step 1 analysis (garment/sketch source), or null for a fabric-only source. */
  designBrief: string | null;
  /** "Studio White" keeps the template's own backdrop; anything else replaces the background. */
  environmentLabel: string;
  environmentHint: string | null;
  keepTemplateBackground: boolean;
}

/**
 * Dress-swap onto a fixed model photo: image 1 = the model template, image 2
 * = the fabric. Everything about the person and the camera is locked; only
 * the garment is replaced, rendered as a premium, manufacturable piece in
 * the supplied fabric's exact print and colour.
 */
export function buildTemplateDressSwapPrompt(ctx: TemplateDressSwapContext): string {
  const background = ctx.keepTemplateBackground
    ? "Keep the background, lighting, and set of the first image exactly as they are."
    : `Replace ONLY the background/setting with: ${ctx.environmentHint || ctx.environmentLabel}. Match the lighting on the model naturally to the new setting.`;

  return `You are editing a professional fashion catalogue photograph.

IMAGE 1 is the reference model photo. IMAGE 2 is the exact fabric the new garment must be made from.

LOCKED — do not change any of these from IMAGE 1:
- The same model: identical face, facial features, skin tone, hair, makeup, body shape, and proportions.
- The same pose, hand positions, expression, and camera angle, framing, crop, and focal length.
- Full-body, head-to-toe framing with the complete garment visible from neckline to hem.

CHANGE — replace ONLY the garment the model is wearing:
- Dress the model in a new ${ctx.garmentType} for ${ctx.targetCustomer} (${ctx.ageGroup}).
${ctx.designBrief ? `- Follow this design brief for the garment's construction and details: ${ctx.designBrief}\n` : ""}- The garment must be made from the fabric in IMAGE 2. Reproduce that fabric's print, motif, pattern scale and density, colours, texture, and sheen EXACTLY — do not simplify, recolour, thin out, or substitute the pattern.
- Make it a premium, attractive, commercially manufacturable design: clean seams and finishing, flattering fit, natural drape and folds appropriate to the fabric's weight, tasteful trims or detailing that suit the ${ctx.garmentType} and the fabric.
- Remove every trace of the original garment from IMAGE 1 — no leftover colours, prints, or silhouettes from it.

${background}

Output one ultra-realistic, high-resolution, premium fashion-catalogue photograph. It is a commercial product-development visual, not fantasy art.`;
}

/**
 * Colour-variant recolour of an existing design image: only the garment's
 * base colour changes; everything else (model, pose, design, print motif
 * shapes, background) is preserved.
 */
export function buildColorVariantPrompt(colorName: string): string {
  return `Recolour ONLY the garment worn by the model to ${colorName}.

Keep EVERYTHING else identical to the supplied image: the same model, face, hair, pose, and framing; the same garment design, silhouette, neckline, sleeves, length, seams, and trims; the same print/embroidery motif shapes, placement, scale, and density; the same fabric texture and drape; the same background and lighting.

Change the garment's dominant/base fabric colour to ${colorName}, adjusting motif and trim colours only as needed so the colourway stays harmonious and realistic. Do not add, remove, or redesign any element.

Output one ultra-realistic, high-resolution, premium fashion-catalogue photograph.`;
}

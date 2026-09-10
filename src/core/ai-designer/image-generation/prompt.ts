/**
 * v2 (2026-09-10): the original v1 prompt described the fabric only in
 * text (name/composition/GSM/color) and was sent to a plain text-to-image
 * call — the actual uploaded/selected fabric photo was never given to the
 * model at all, so a generated design used an AI-invented fabric pattern
 * that merely matched the text description, not the real fabric. Fixed:
 * generation is now always an image-conditioned call
 * (`ImageGenerationProvider.generateFromFabricReference`) with the real
 * fabric photo as an input image, and this prompt now leads with an
 * explicit instruction that the fabric's actual visual appearance comes
 * from that image, not from the text below.
 */
export const PROMPT_VERSION = "ai-designer-image-generation-v2";

export interface AiDesignerGenerationContext {
  targetCustomer: string;
  ageGroup: string;
  productCategory: string;
  designSelections: string;
  modelGender: string;
  modelBodyType: string;
  modelPose: string;
  environment: string;
}

const FALLBACK = "Not specified";

/**
 * The strong fabric-preservation instruction, verbatim per the product
 * requirement — this is what makes the fabric image a PRIMARY visual
 * reference rather than a hint the model may reinterpret.
 */
const FABRIC_REFERENCE_INSTRUCTION = `Use the supplied fabric reference image as the exact fabric source for the garment. Preserve the fabric's actual print, motif, pattern arrangement, colors, texture, and visual characteristics. Apply this fabric to the garment naturally while preserving the garment's construction, silhouette, seams, folds, drape, and fit. Do not invent, redesign, simplify, or substitute the fabric pattern. The garment must visibly use the supplied fabric.`;

/**
 * The hidden image-generation prompt template for AI Designer — built
 * entirely server-side from the project's own structured fields plus the
 * real fabric reference image (supplied separately as an input image to the
 * provider call, not embedded here). Never free-typed by a user.
 *
 * Deliberately AI Designer's own template, not the sibling module's (that
 * one is business logic, not shared infrastructure — confirmed by research
 * before writing this file).
 */
export function buildGenerationPrompt(ctx: AiDesignerGenerationContext): string {
  const v = (s: string | null | undefined) => (s && s.trim().length > 0 ? s : FALLBACK);

  return `${FABRIC_REFERENCE_INSTRUCTION}

The fabric image supplied with this request is the ONLY source of truth for the fabric's appearance. Do not substitute a different print, pattern, or colourway, even if the description below seems to suggest one — the description below is only for the garment type, fit, model, and setting.

Create a premium, catalogue-quality fashion product photograph of a garment made from the supplied fabric, based on the following specification.

Target Customer:
${v(ctx.targetCustomer)}

Age Group:
${v(ctx.ageGroup)}

Product Category:
${v(ctx.productCategory)}

Design Details:
${v(ctx.designSelections)}

Model:
${v(ctx.modelGender)}, ${v(ctx.modelBodyType)} build, ${v(ctx.modelPose)} pose.

Environment / Setting:
${v(ctx.environment)}

Requirements:

The garment must be realistic and commercially manufacturable — avoid impossible construction.

Maintain realistic, natural fabric folds and draping appropriate to the garment and the supplied fabric's own weight and texture.

Produce a premium fashion catalogue quality image.

Ultra realistic, high resolution.

The output is a commercial product-development visual, not fantasy fashion art.`;
}

export interface AiDesignerEditContext {
  featureLabel: string;
  currentValue: string;
  newValue: string;
  additionalInstructions?: string | null;
}

const PRESERVE_ITEMS = [
  "overall silhouette",
  "fabric appearance and texture",
  "colour",
  "print scale and placement",
  "garment category",
  "remaining construction details",
  "model",
  "pose",
  "background / environment",
];

/**
 * Which fixed Preserve-list item to drop when that same aspect is the one
 * actually being edited — without this, "Change Environment"/"Change Model"/
 * "Change Color" would contradictorily instruct the AI to both change and
 * preserve the same thing.
 */
const PRESERVE_EXCLUSIONS: Record<string, string> = {
  Color: "colour",
  Background: "background / environment",
  Environment: "background / environment",
  Model: "model",
  Pose: "pose",
};

/**
 * Step 10 — Edit Design. Only regenerates the affected area whenever
 * possible: this is the actual prompt sent alongside the current image for
 * an image-to-image edit call (provider.generateVariation). The current
 * image being edited already has the real fabric baked in from generation
 * (Step 9), so "fabric appearance and texture" staying in the Preserve list
 * here is what keeps an unrelated edit (e.g. "change the collar") from
 * altering the fabric.
 */
export function buildEditPrompt(ctx: AiDesignerEditContext): string {
  const exclude = PRESERVE_EXCLUSIONS[ctx.featureLabel];
  const preserveItems = PRESERVE_ITEMS.filter((item) => item !== exclude);

  const lines = [
    "Keep the existing garment design as unchanged as possible.",
    "",
    "Change ONLY:",
    "",
    "Feature:",
    ctx.featureLabel,
    "",
    "Current:",
    ctx.currentValue,
    "",
    "New Requirement:",
    ctx.newValue,
    "",
    "Preserve:",
    "",
    ...preserveItems,
    "",
    "Do not independently redesign other aspects of the garment or image.",
    "",
    "The changed feature must be technically plausible and commercially manufacturable.",
    "",
    "Generate a clean revised image suitable for direct comparison with the previous version.",
  ];

  if (ctx.additionalInstructions) {
    lines.push("", "Additional instructions:", ctx.additionalInstructions);
  }

  return lines.join("\n");
}

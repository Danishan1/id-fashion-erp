/**
 * AI Garment Flow — Process 7: Technical Development ("Create Technical
 * Flat"). Regenerates the currently selected garment visual as a
 * professional flat / CAD-style technical line drawing — the standard
 * tech-pack deliverable, distinct in kind from Processes 3/4/6's
 * photorealistic renders. Never shown to end users, never free-typed.
 */

export const TECHNICAL_FLAT_PROMPT_VERSION = "technical-flat-v1";

export interface TechnicalFlatContext {
  additionalNotes?: string;
}

const BASE_PROMPT = `Convert the garment shown in the reference image into a professional technical flat sketch (a "flat" / CAD-style technical fashion drawing) — the standard technical-development deliverable used in a garment tech pack for manufacturing reference.

Preserve exactly: the garment's silhouette, proportions, neckline, collar, sleeve style and length, closures, pockets, seam placement, hem, waist treatment, and every other construction detail visible in the reference image. Do not invent, add, or omit any design feature, and do not redesign anything.

Render as:
- A clean, flat, two-dimensional technical line drawing — NOT a photorealistic render, NOT a photograph, and NOT worn by a model or mannequin.
- Both the FRONT view and the BACK view of the garment, shown side by side on a plain white background.
- Standard technical-flat convention: black line art (a single neutral tone), showing every seam line, stitch line (topstitching), dart, and construction detail the way a real technical illustrator would draw it for a manufacturer.
- Do not render actual fabric texture, print, or photographic color — flats are conventionally shown as clean line art regardless of the garment's real fabric or color, so manufacturing staff can read the construction clearly.
- No background scenery, no shadows beyond simple flat shading, no branding, logos, or watermark text.`;

export function buildTechnicalFlatPrompt(ctx: TechnicalFlatContext): string {
  const parts = [BASE_PROMPT];
  if (ctx.additionalNotes && ctx.additionalNotes.trim() !== "") {
    parts.push(`\nAdditional construction details to call out on the flat: ${ctx.additionalNotes.trim()}`);
  }
  return parts.join("\n");
}

/**
 * "Draw & Describe" — the shared, module-agnostic prompt builder every
 * mask-edit call in this app uses (see runMaskEditGeneration in
 * ./mask-edit.ts). The mask image itself already constrains WHERE the edit
 * applies (only its fully-transparent pixels are eligible for change, a
 * real provider-level guarantee, not just prompt wording) — this prompt
 * only needs to say WHAT to do there, so it is deliberately much shorter
 * than the free-text/no-mask "AI Prompt" edit mode's own prompt (which has
 * to enumerate a "preserve everything else" list precisely because it has
 * no other way to scope the edit).
 */
export const MASK_EDIT_PROMPT_VERSION = "mask-edit-v1";

export function buildMaskEditPrompt(instruction: string): string {
  return [
    "Apply the following designer instruction only within the masked (edited) area of the supplied image.",
    "",
    "Designer instruction:",
    instruction,
    "",
    "The mask already protects every other pixel of the image from any change — do not alter anything outside the masked area. Inside the masked area, make the requested change fully and visibly, and blend it seamlessly with the surrounding fabric, lighting, shading, and background so the result reads as one continuous photograph, not a visible patch or seam.",
    "",
    "If the instruction describes a garment construction detail, the result must be technically plausible and commercially manufacturable.",
    "",
    "Generate a clean revised image suitable for direct comparison with the original.",
  ].join("\n");
}

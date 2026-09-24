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
export const MASK_EDIT_PROMPT_VERSION = "mask-edit-v2";

export function buildMaskEditPrompt(instruction: string): string {
  return [
    "Apply the following designer instruction only within the masked (edited) area of the supplied image.",
    "",
    "Designer instruction:",
    instruction,
    "",
    "The mask already protects every other pixel of the image from any change — do not alter anything outside the masked area.",
    "",
    "Inside the masked area, make the requested change FULLY and CLEARLY VISIBLE. If the instruction asks for a different fabric, trim, color, band, strip, print, or embellishment, it must look like a genuinely distinct, recognizable new element — do not simply smooth, flatten, or fade the existing fabric/print into a plain solid patch and call that the change; a real, contrasting piece of fabric or trim should visibly stand apart from what surrounds it, the same way it would in an actual garment.",
    "",
    "At the same time, render that new element as a natural, photorealistic part of the garment — matching the correct lighting, shading, fabric drape/wrinkle behaviour, and camera perspective of the rest of the photo — so it looks like it was genuinely sewn/worn there, not pasted on as a flat sticker or an obviously edited patch.",
    "",
    "Do not under-apply the requested change — a subtle or barely-visible result is a failed result.",
    "",
    "If the instruction describes a garment construction detail, the result must be technically plausible and commercially manufacturable.",
    "",
    "Generate a clean revised image suitable for direct comparison with the original.",
  ].join("\n");
}

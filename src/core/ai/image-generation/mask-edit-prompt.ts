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
export const MASK_EDIT_PROMPT_VERSION = "mask-edit-v5";

export function buildMaskEditPrompt(instruction: string): string {
  return [
    "Apply the following designer instruction only within the masked (edited) area of the supplied image.",
    "",
    "Designer instruction:",
    instruction,
    "",
    "STRICT BOUNDARY RULE — judge this ONLY by pixels, never by which figure/pose/view they belong to. Every pixel OUTSIDE the masked area must remain exactly as it is in the original image: do not add, remove, duplicate, or alter anything there, even if it would look more balanced or symmetrical to do so.",
    "",
    "GARMENT STRUCTURE LOCK — unless the designer instruction explicitly names that exact structural element, do NOT change the garment's overall silhouette, hemline/garment length, sleeve presence or sleeve length, or neckline shape as a side effect of applying the instruction — even if the requested change (e.g. a strap, band, or trim) would conventionally appear on a different style of garment. Keep the rest of the garment's construction exactly as shown in the original photo; only the masked pixels may change.",
    "",
    "The reverse matters just as much: apply the change to EVERY pixel INSIDE the masked area, completely and uniformly, with no exceptions. If the supplied photo shows the same garment more than once (for example a combined front-view-and-back-view photo side by side) and the mask happens to cover the corresponding spot on more than one of those views, you MUST apply the exact same change to each of them — never leave one of them unedited while only applying it to another. Do not skip, soften, or omit the change on any part of the masked area just because it falls on a different figure, pose, or view than another masked part.",
    "",
    "Inside the masked area, make the requested change FULLY and CLEARLY VISIBLE as a real, structurally distinct element — it should read as something genuinely added or changed there (with its own visible edge, seam, or boundary where it meets the surrounding fabric), never as the existing fabric/print merely smoothed, flattened, or faded into a plain patch. Follow the instruction's own wording for exactly what the new element should look like (its own fabric, color, and pattern) — if the instruction says to match the existing/same fabric, keep the same color and print; if it asks for something different or contrasting, make that difference clearly visible.",
    "",
    "Render the change as a natural, photorealistic part of the garment — correct lighting, shading, fabric drape/wrinkle behaviour, and camera perspective matching the rest of the photo — so it looks genuinely sewn/worn there, not pasted on as a flat sticker.",
    "",
    "Do not under-apply the requested change within the masked area — a subtle or barely-visible result there is a failed result. But nothing about applying it more strongly ever justifies touching pixels outside the mask.",
    "",
    "If the instruction describes a garment construction detail, the result must be technically plausible and commercially manufacturable.",
    "",
    "Generate a clean revised image suitable for direct comparison with the original.",
  ].join("\n");
}

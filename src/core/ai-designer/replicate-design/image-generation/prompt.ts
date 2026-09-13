export const PROMPT_VERSION = "replicate-design-generation-v1";

/**
 * The strong structure-preservation instruction — this is what makes the
 * reference garment photo a PRIMARY structural reference the model must not
 * reinterpret, matching this codebase's own "Critical AI Generation Rule"
 * discipline (see AI Designer's own image-generation prompt for the
 * equivalent fabric-density-preservation instruction).
 */
const STRUCTURE_PRESERVATION_INSTRUCTION = `Use the first supplied image (the reference garment photo) as the AUTHORITATIVE structural design reference. Preserve the exact garment silhouette, proportions, neckline, collar, sleeves, garment length, panels, seams, pockets, openings, and every other visible construction detail from that reference image. Do not redesign, reinterpret, or simplify the garment's structure in any way.

Use the second supplied image (the material/fabric photo) as the ONLY source of truth for the garment's fabric, print, texture, and color — replace the reference garment's own original fabric/material with this one, matching its actual print/pattern/color/texture as closely as possible, including the same density and intricacy of any pattern, not a simplified approximation of it.

Do not invent, redesign, or add any decorative element the reference garment does not already have. Do not remove any visible design element the reference garment has. Change ONLY the fabric/material — everything about the garment's structural design must remain exactly as shown in the reference image, unless a specific structural change is explicitly listed below.`;

export interface ReplicateGenerationContext {
  /** One line per locked Design DNA observation, e.g. "Neckline: V-neck with a narrow binding." */
  lockedConstraints: string[];
  /** A plain-English description of the new fabric/material being applied — never used to describe the garment's structure. */
  materialDescription: string;
}

/**
 * The hidden image-generation prompt for Replicate Design's own "Generate"
 * step — built entirely server-side from the project's own approved Design
 * DNA plus the selected fabric/material, and sent alongside two real input
 * images (the reference garment photo + the material photo) to
 * `ImageGenerationProvider.replicateWithNewMaterial`. Never free-typed by a
 * user.
 */
export function buildReplicateGenerationPrompt(ctx: ReplicateGenerationContext): string {
  const lines = [
    STRUCTURE_PRESERVATION_INSTRUCTION,
    "",
    "Locked structural design (must remain exactly as in the reference image):",
    ...ctx.lockedConstraints.map((c) => `- ${c}`),
    "",
    "New fabric/material to apply:",
    ctx.materialDescription,
    "",
    "Requirements:",
    "",
    "The garment must be realistic and commercially manufacturable.",
    "",
    "Maintain realistic, natural fabric folds and draping appropriate to the garment's own silhouette and the new fabric's own weight/texture.",
    "",
    "Produce a premium fashion catalogue quality image, ultra realistic, high resolution.",
    "",
    "The output is a commercial product-development visual, not fantasy fashion art.",
  ];

  return lines.join("\n");
}

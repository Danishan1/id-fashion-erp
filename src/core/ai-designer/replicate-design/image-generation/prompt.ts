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

// ---------------------------------------------------------------------------
// Edit Design workspace (2026-09-14) — the same "change one named feature,
// preserve everything else" mechanism as AI Designer's own Edit Design
// workspace (see src/core/ai-designer/image-generation/prompt.ts's
// buildWorkspaceEditPrompt), duplicated rather than imported per this
// module's own established isolation rule (each AI workflow module in this
// codebase — AI Garment Flow's Process 4, AI Designer's own Edit Design —
// has consistently built its own copy of this pattern, not a cross-module
// import). PRESERVE_ITEMS/PRESERVE_EXCLUSIONS are unchanged in substance;
// the fabric-grounding paragraph is worded for Replicate Design's own
// "reference garment + material photo" vocabulary instead of AI Designer's
// "fabric".
// ---------------------------------------------------------------------------

export type ReplicateEditWorkspaceMode = "QUICK" | "TECHNICAL" | "AI_PROMPT";

export interface ReplicateEditContext {
  featureLabel: string;
  currentValue: string;
  newValue: string;
  additionalInstructions?: string | null;
}

const REPLICATE_PRESERVE_ITEMS = [
  "overall silhouette",
  "material/fabric appearance and texture",
  "colour",
  "print scale and placement",
  "garment category",
  "remaining construction details",
];

/**
 * Which fixed Preserve-list item to drop when that same aspect is the one
 * actually being edited — without this, "Change Color"/"Change Material"
 * would contradictorily instruct the AI to both change and preserve the
 * same thing.
 */
const REPLICATE_PRESERVE_EXCLUSIONS: Record<string, string> = {
  Color: "colour",
  "Body Color": "colour",
  "Fabric Type": "material/fabric appearance and texture",
  Composition: "material/fabric appearance and texture",
};

/** Quick Edit's own prompt builder — mirrors AI Designer's buildEditPrompt() exactly, in this module's own vocabulary. */
export function buildReplicateEditPrompt(ctx: ReplicateEditContext): string {
  const exclude = REPLICATE_PRESERVE_EXCLUSIONS[ctx.featureLabel];
  const preserveItems = REPLICATE_PRESERVE_ITEMS.filter((item) => item !== exclude);

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

export interface ReplicateWorkspaceEditContext {
  mode: ReplicateEditWorkspaceMode;
  featureLabel: string;
  currentValue?: string | null;
  newValue?: string | null;
  technicalFields?: Record<string, string> | null;
  freeformInstructions?: string | null;
  /**
   * Set when a second, real reference photo (the project's own originally
   * selected/uploaded material — the same one Generate used) is being
   * supplied alongside the current design image for this edit call, closing
   * the same fabric-drift-across-successive-edits gap already fixed for AI
   * Designer's own Edit Design workspace (see ImageGenerationProvider
   * .applyFabric usage in generateReplicateEditPreview()).
   */
  hasMaterialReference?: boolean;
}

const MATERIAL_REFERENCE_GROUNDING = `A second image is also supplied — the project's own real original material/fabric reference photo. The garment's material print, texture, and colour in your output must match that reference image exactly, not however the material currently happens to look in the design being edited — including the same density, scale, and intricacy of any pattern/embroidery as shown in that reference photo. Do not invent, simplify, or let the material drift from the reference photo.`;

/** The one prompt builder the Edit Design workspace calls for all three edit modes — mirrors AI Designer's buildWorkspaceEditPrompt() exactly. */
export function buildReplicateWorkspaceEditPrompt(ctx: ReplicateWorkspaceEditContext): string {
  const withMaterialGrounding = (prompt: string) => (ctx.hasMaterialReference ? `${prompt}\n\n${MATERIAL_REFERENCE_GROUNDING}` : prompt);

  if (ctx.mode === "QUICK") {
    return withMaterialGrounding(
      buildReplicateEditPrompt({
        featureLabel: ctx.featureLabel,
        currentValue: ctx.currentValue || "Not specified",
        newValue: ctx.newValue || "",
        additionalInstructions: ctx.freeformInstructions,
      })
    );
  }

  if (ctx.mode === "TECHNICAL") {
    const exclude = REPLICATE_PRESERVE_EXCLUSIONS[ctx.featureLabel];
    const preserveItems = REPLICATE_PRESERVE_ITEMS.filter((item) => item !== exclude);
    const fieldLines = Object.entries(ctx.technicalFields ?? {}).map(([k, v]) => `${k}: ${v}`);

    const lines = [
      "Keep the existing garment design as unchanged as possible.",
      "",
      `Apply these exact technical changes to "${ctx.featureLabel}":`,
      "",
      ...fieldLines,
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
    if (ctx.freeformInstructions) lines.push("", "Additional instructions:", ctx.freeformInstructions);
    return withMaterialGrounding(lines.join("\n"));
  }

  // AI_PROMPT — never lists a static preserve set (which could contradict a
  // free-text instruction targeting one of those same aspects) — matches AI
  // Designer's own fixed bug for this exact mode.
  return withMaterialGrounding(
    [
      "Apply the following designer instruction to this garment image, changing exactly what it asks for and nothing else.",
      "",
      "Designer instruction:",
      ctx.freeformInstructions || "",
      "",
      "Preserve every aspect of the garment and image that the instruction above does not explicitly ask you to change — including silhouette, material, colour, print, construction details — UNLESS the instruction itself is asking you to change that specific aspect, in which case make that change fully and visibly.",
      "",
      "Do not independently redesign any aspect of the garment or image beyond what the instruction explicitly requests, and do not under-apply the requested change — the result must visibly reflect it.",
      "",
      "If only one garment component is clearly targeted by the instruction, edit only that component.",
      "",
      "The changed feature must be technically plausible and commercially manufacturable.",
      "",
      "Generate a clean revised image suitable for direct comparison with the previous version.",
    ].join("\n")
  );
}

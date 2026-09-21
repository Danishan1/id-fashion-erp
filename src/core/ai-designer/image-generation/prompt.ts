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
export const PROMPT_VERSION = "ai-designer-image-generation-v4";

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
const FABRIC_REFERENCE_INSTRUCTION = `Use the supplied fabric reference image as the exact fabric source for the garment. Preserve the fabric's actual print, motif, pattern arrangement, colors, texture, and visual characteristics EXACTLY as shown in the reference image — including the same density, scale, intricacy, and surface COVERAGE of the pattern/embroidery. Carefully examine how much of the fabric's base/background color remains visible between motifs in the reference image (the ratio of plain background to pattern), and reproduce that same coverage ratio on the garment — if the reference fabric is densely and heavily embroidered with very little plain background showing through, the garment's fabric must be equally densely covered, not thinned out with large plain gaps between motifs. Do not simplify a dense, detailed, or intricate pattern (e.g. embroidery, heavy motifs, layered florals) into a smaller, sparser, more spaced-out, or lower-detail version — match the reference image's own pattern density, complexity, and coverage as closely as possible, not a simplified or thinned-out approximation of it. Apply this fabric to the garment naturally while preserving the garment's construction, silhouette, seams, folds, drape, and fit. Do not invent, redesign, simplify, or substitute the fabric pattern. The garment must visibly use the supplied fabric.`;

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

// ---------------------------------------------------------------------------
// Sketch / Drawing → Garment (2026-09-20) — Step 9's generation prompt when
// AiDesignerProject.creationMode === "SKETCH". Sent alongside TWO real input
// images (the sketch as referenceImage, the fabric photo as materialImage)
// to ImageGenerationProvider.replicateWithNewMaterial. Implements the user's
// own explicit six-tier generation priority:
//   1. User's explicit Product Design overrides
//   2. The uploaded sketch (preserve every remaining locked detail)
//   3. The selected fabric (apply faithfully — reuses FABRIC_REFERENCE_INSTRUCTION above)
//   4. Product/Target/Age constraints
//   5. Model (apply without redesigning)
//   6. Environment (presentation only)
// ---------------------------------------------------------------------------

const SKETCH_STRUCTURE_PRESERVATION_INSTRUCTION = `Use the first supplied image (the uploaded sketch/drawing) as the AUTHORITATIVE structural design reference. This is a hand-drawn or digital sketch being converted into a realistic, commercially manufacturable garment photograph — read its construction lines, proportions, and labelled details, not its drawing style or artistic rendering. Preserve the exact garment silhouette, proportions, neckline, collar, sleeves, garment length, panels, seams, pockets, openings, and every other visible construction detail from that sketch. Do not redesign, reinterpret, or simplify the garment's structure in any way, except for any explicit override listed below.

Use the second supplied image (the fabric/material photo) as the ONLY source of truth for the garment's fabric, print, texture, and color.`;

export interface SketchGenerationOverride {
  featureLabel: string;
  sketchValue: string;
  selectedValue: string;
}

export interface AiDesignerSketchGenerationContext {
  targetCustomer: string;
  ageGroup: string;
  productCategory: string;
  modelGender: string;
  modelBodyType: string;
  modelPose: string;
  environment: string;
  /** Tier 1 — Product Design selections that explicitly differ from the sketch's own locked value for that feature (see detectDesignOverrides() in ai-designer.service.ts). */
  overrides: SketchGenerationOverride[];
  /** Tier 2 — one line per locked sketch observation NOT covered by an override above, e.g. "Sleeve Type: Full-length fitted sleeve." */
  lockedConstraints: string[];
}

/**
 * The hidden image-generation prompt for a SKETCH-mode project's Generate
 * Design step — built entirely server-side, never free-typed by a user.
 */
export function buildSketchGenerationPrompt(ctx: AiDesignerSketchGenerationContext): string {
  const v = (s: string | null | undefined) => (s && s.trim().length > 0 ? s : FALLBACK);

  const lines: string[] = [];

  // Tier 1 — explicit user overrides, stated first and most forcefully so
  // they take precedence over the sketch's own value for that one feature.
  if (ctx.overrides.length > 0) {
    lines.push(
      "The user has EXPLICITLY requested the following changes from the sketch — these override the sketch for ONLY the specific feature named, every other detail of the sketch must still be preserved exactly:",
      ""
    );
    for (const o of ctx.overrides) {
      lines.push(`- Change ${o.featureLabel} to "${o.selectedValue}" (explicitly requested — the sketch itself shows "${o.sketchValue}", do NOT use the sketch's own value for this one feature).`);
    }
    lines.push("");
  }

  // Tier 2 — the sketch as the authoritative structural reference, plus
  // every locked detail not already overridden above.
  lines.push(SKETCH_STRUCTURE_PRESERVATION_INSTRUCTION, "");
  if (ctx.lockedConstraints.length > 0) {
    lines.push("Locked sketch details (must remain exactly as in the sketch, unless explicitly overridden above):", "");
    for (const c of ctx.lockedConstraints) lines.push(`- ${c}`);
    lines.push("");
  }

  // Tier 3 — fabric, reusing the exact same fabric-fidelity instruction
  // every other AI Designer generation call already uses.
  lines.push(
    FABRIC_REFERENCE_INSTRUCTION,
    "",
    "The fabric image supplied with this request is the ONLY source of truth for the fabric's appearance. Do not substitute a different print, pattern, or colourway.",
    "",
    "Create a premium, catalogue-quality fashion product photograph of the garment described above, made from the supplied fabric."
  );

  // Tier 4 — Product/Target/Age constraints.
  lines.push(
    "",
    "Target Customer:",
    v(ctx.targetCustomer),
    "",
    "Age Group:",
    v(ctx.ageGroup),
    "",
    "Product Category:",
    v(ctx.productCategory)
  );

  // Tier 5 — Model, applied without redesigning the garment.
  lines.push(
    "",
    "Model (apply the garment to this model exactly as designed — do not let the model choice change the garment's own construction):",
    `${v(ctx.modelGender)}, ${v(ctx.modelBodyType)} build, ${v(ctx.modelPose)} pose.`
  );

  // Tier 6 — Environment, presentation only.
  lines.push(
    "",
    "Environment / Setting (affects presentation and background only, never the garment's construction):",
    v(ctx.environment)
  );

  lines.push(
    "",
    "Requirements:",
    "",
    "The garment must be realistic and commercially manufacturable — avoid impossible construction.",
    "",
    "Maintain realistic, natural fabric folds and draping appropriate to the garment and the supplied fabric's own weight and texture.",
    "",
    "Produce a premium fashion catalogue quality image, ultra realistic, high resolution.",
    "",
    "The output is a commercial product-development visual, not fantasy fashion art."
  );

  return lines.join("\n");
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

// ---------------------------------------------------------------------------
// Edit Design workspace (2026-09-13) — Quick Edit reuses buildEditPrompt()
// above unchanged; Technical Edit and AI Prompt modes get their own prompt
// shapes here, sharing the same PRESERVE_ITEMS/PRESERVE_EXCLUSIONS discipline
// so all three modes give the same "change only what was asked, preserve
// everything else" guarantee.
// ---------------------------------------------------------------------------

export type EditWorkspaceMode = "QUICK" | "TECHNICAL" | "AI_PROMPT";

export interface AiDesignerWorkspaceEditContext {
  mode: EditWorkspaceMode;
  featureLabel: string;
  currentValue?: string | null;
  newValue?: string | null;
  technicalFields?: Record<string, string> | null;
  freeformInstructions?: string | null;
  /**
   * Set when a second, real fabric reference photo (the project's own
   * originally uploaded fabric — the same one Generate Design used) is being
   * supplied alongside the current design image for this edit call. A real,
   * confirmed-live bug this fixes: chaining edits from image to image alone
   * (each edit based only on the PREVIOUS edit's own output) has no ground
   * truth to check fabric fidelity against, so the fabric print/texture can
   * visibly drift further from the original with every successive edit —
   * the "preserve fabric" wording alone is just text, not something the
   * model can verify itself against. Re-supplying the real original fabric
   * photo every time (see generateEditPreview()'s use of
   * ImageGenerationProvider.applyFabric instead of generateVariation) and
   * telling the model to match it exactly closes that drift.
   */
  hasFabricReference?: boolean;
}

const FABRIC_REFERENCE_GROUNDING = `A second image is also supplied — the project's own real original fabric reference photo. The garment's fabric print, texture, and colour in your output must match that reference image exactly, not however the fabric currently happens to look in the design being edited — including the same density, scale, and intricacy of the pattern/embroidery as shown in that reference photo. Do not invent, simplify, or let the fabric drift from the reference photo, and do not reduce a dense or intricate pattern to a sparser, lower-detail version.`;

/** The one prompt builder the Edit Design workspace calls for all three edit modes — Quick Edit defers to buildEditPrompt() unchanged; Technical Edit compiles its structured fields into an explicit change list; AI Prompt passes the designer's own free text through with the full, unscoped preserve list (since which single feature it targets isn't known ahead of time). Appends a fabric-grounding paragraph to whichever mode's prompt when a real second fabric reference image is also being supplied (see hasFabricReference above). */
export function buildWorkspaceEditPrompt(ctx: AiDesignerWorkspaceEditContext): string {
  const withFabricGrounding = (prompt: string) => (ctx.hasFabricReference ? `${prompt}\n\n${FABRIC_REFERENCE_GROUNDING}` : prompt);

  if (ctx.mode === "QUICK") {
    return withFabricGrounding(
      buildEditPrompt({
        featureLabel: ctx.featureLabel,
        currentValue: ctx.currentValue || "Not specified",
        newValue: ctx.newValue || "",
        additionalInstructions: ctx.freeformInstructions,
      })
    );
  }

  if (ctx.mode === "TECHNICAL") {
    const exclude = PRESERVE_EXCLUSIONS[ctx.featureLabel];
    const preserveItems = PRESERVE_ITEMS.filter((item) => item !== exclude);
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
    return withFabricGrounding(lines.join("\n"));
  }

  // AI_PROMPT — a real, confirmed-live bug fixed here: this branch used to
  // append the SAME static PRESERVE_ITEMS list QUICK mode uses (minus
  // nothing, since which item to exclude can't be known ahead of time for
  // free text) — that included "fabric appearance and texture" as an
  // unconditional preserve instruction, which directly CONTRADICTED a real
  // instruction like "make the sleeves net fabric" and the model complied
  // with the static preserve line instead of the actual request, silently
  // returning an unchanged image. Fixed by never listing specific aspects to
  // preserve at all here — only the free-text instruction says what changes,
  // and everything else is preserved by exclusion, not by an enumerated list
  // that can conflict with it.
  return withFabricGrounding(
    [
      "Apply the following designer instruction to this garment image, changing exactly what it asks for and nothing else.",
      "",
      "Designer instruction:",
      ctx.freeformInstructions || "",
      "",
      "Preserve every aspect of the garment and image that the instruction above does not explicitly ask you to change — including silhouette, fabric, colour, print, construction details, the model, pose, and background — UNLESS the instruction itself is asking you to change that specific aspect, in which case make that change fully and visibly.",
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

const APPLY_AREA_LABELS: Record<string, string> = {
  YOKE: "the yoke / neckline-shoulder area",
  SLEEVES: "the sleeves",
  BORDERS: "the borders / hemline",
  CONTRAST_PANELS: "contrast panels added to the garment",
};

/**
 * Multi-Fabric — a genuine two-image composition (the current design image
 * + a second fabric swatch photo), sent to `ImageGenerationProvider
 * .applyFabric`. Distinct from Edit Design's single-image
 * `generateVariation` call: this one supplies a SECOND real fabric photo as
 * its own visual reference, the same "the image is the source of truth,
 * never a text description" discipline as the primary fabric already uses.
 */
export function buildSecondFabricPrompt(applyAreas: readonly string[]): string {
  const areaLabels = applyAreas.map((a) => APPLY_AREA_LABELS[a] ?? a).join(", ");

  return [
    "Use the supplied SECOND fabric reference image as the exact fabric source for a contrasting fabric application on this garment.",
    "",
    `Apply this second fabric ONLY to: ${areaLabels}.`,
    "",
    "Preserve everything else exactly as it already is in the current design image: the primary fabric everywhere else on the garment, the overall silhouette, construction, model, pose, and background/environment.",
    "",
    "Do not invent, redesign, simplify, or substitute either fabric's actual print, pattern, or colour — both fabrics must visibly match their own real reference photos, including the same pattern density and intricacy shown in each reference image, not a simplified approximation.",
    "",
    "The result must be technically plausible and commercially manufacturable — a real two-fabric combination garment, not a fantasy composite.",
    "",
    "Generate a clean revised image suitable for direct comparison with the previous version.",
  ].join("\n");
}

const EMBELLISHMENT_TYPE_LABELS: Record<string, string> = {
  DIGITAL_APPLIQUE: "Digital Applique",
  EMBROIDERY: "Embroidery",
  SEQUIN_WORK: "Sequin Work",
  LACE_TRIM: "Lace Trim",
  BEADWORK: "Beadwork",
  PATCHWORK: "Patchwork",
};

/**
 * Embellishments — regenerates the current design with a digital applique/
 * embroidery motif added, either from a real uploaded motif reference photo
 * (a genuine two-image composition, sent to `ImageGenerationProvider
 * .applyFabric` the same way Multi-Fabric's own second-fabric photo is), or
 * from free-text instructions alone (a single-image `generateVariation`
 * edit, same shape as Edit Design's AI Prompt mode) when no motif image was
 * uploaded. `hasMotifImage` controls which grounding paragraph is appended —
 * the caller decides which provider method to call based on the same fact.
 */
export function buildEmbellishmentPrompt(embellishmentType: string, instructions: string | undefined, hasMotifImage: boolean): string {
  const typeLabel = EMBELLISHMENT_TYPE_LABELS[embellishmentType] ?? embellishmentType;
  const trimmedInstructions = instructions?.trim();

  const lines = [`Add a ${typeLabel} embellishment to this garment design.`, ""];

  if (hasMotifImage) {
    lines.push(
      "A second image is also supplied — the motif/embroidery reference photo. Use it as the exact visual source for the embellishment's pattern, artwork, and style. Do not invent a different motif or redesign the one shown.",
      ""
    );
  }

  if (trimmedInstructions) {
    lines.push("Apply it as follows:", trimmedInstructions, "");
  } else {
    lines.push(
      `Apply the ${typeLabel.toLowerCase()} in a placement and scale that looks natural and commercially plausible for this garment.`,
      ""
    );
  }

  lines.push(
    "Preserve everything else exactly as it already is in the current design image: the garment's own fabric, silhouette, construction, model, pose, and background/environment.",
    "",
    "Do not independently redesign any other aspect of the garment or image beyond the embellishment requested.",
    "",
    "The result must be technically plausible and commercially manufacturable — a real embellished garment, not a fantasy composite.",
    "",
    "Generate a clean revised image suitable for direct comparison with the previous version."
  );

  return lines.join("\n");
}

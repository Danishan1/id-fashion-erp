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

export interface TechnicalSketchGenerationContext {
  garmentType: string;
  targetCustomer: string;
  ageGroup: string;
  designBrief?: string | null;
  fabricDetails?: string | null;
  viewAngle?: "FRONT" | "BACK" | "BOTH";
}

/**
 * Technical CAD flat sketch generation prompt for apparel manufacturing:
 * outputs a clean 2D vector-style black line drawing on pure white background
 * suitable for tech packs and production factory specifications.
 */
export function buildTechnicalSketchGenerationPrompt(ctx: TechnicalSketchGenerationContext): string {
  const viewAngleText =
    ctx.viewAngle === "BACK"
      ? "Render the BACK view of the garment clearly."
      : ctx.viewAngle === "BOTH"
        ? "Render BOTH the FRONT view and the BACK view of the garment side by side within the same frame."
        : "Render both FRONT and BACK views side-by-side (standard apparel tech pack CAD convention), with all structural details clearly visible.";

  return `You are creating a professional fashion CAD technical flat sketch (spec sheet line drawing) for garment manufacturing and tech packs.

GARMENT SPECIFICATIONS:
- Garment Type: ${ctx.garmentType}
- Target Customer: ${ctx.targetCustomer} (${ctx.ageGroup})
${ctx.designBrief ? `- Construction & Styling Brief: ${ctx.designBrief}\n` : ""}${ctx.fabricDetails ? `- Fabric Context: ${ctx.fabricDetails}\n` : ""}
TECHNICAL SKETCH REQUIREMENTS:
- ${viewAngleText}
- Professional 2D technical fashion CAD flat sketch in black-and-white line art on a clean, solid white background.
- Show precise construction lines: seams (princess seams, side seams, shoulder seams), stitch lines (topstitching, hem stitching), neckline/collar shape, sleeve hems/cuffs, waist treatment, darts, pleats, pockets, plackets, and closures (buttons, zippers, hooks).
- Symmetrical, balanced proportions suitable for pattern drafting, cutting master, and apparel factory production.
- NOT a photograph, NOT 3D rendered, NOT worn by a human model or mannequin — strictly a 2D technical flat vector/CAD-style drawing for manufacturing.
- Do not render heavy photographic textures or scenery. Clean line art with subtle flat shading only where necessary to indicate fold/dimension.`;
}

export interface SketchEditContext {
  garmentType?: string | null;
  structuralChanges?: Record<string, string> | null;
  instruction?: string | null;
  viewAngle?: "FRONT" | "BACK" | "BOTH";
}

/**
 * Edit prompt for modifying an existing technical sketch.
 */
export function buildSketchEditPrompt(ctx: SketchEditContext): string {
  const lines = [
    "You are editing a professional fashion CAD technical flat sketch for apparel manufacturing.",
    "",
    "The input image is the reference technical fashion sketch.",
    "",
    "REVISE the technical sketch with the following specific construction modifications:",
  ];

  if (ctx.garmentType) {
    lines.push(`- Garment Category: ${ctx.garmentType}`);
  }

  if (ctx.structuralChanges && Object.keys(ctx.structuralChanges).length > 0) {
    for (const [k, v] of Object.entries(ctx.structuralChanges)) {
      if (v && v.trim()) lines.push(`- ${k}: ${v.trim()}`);
    }
  }

  if (ctx.instruction && ctx.instruction.trim()) {
    lines.push(`- Design Modification Instructions: ${ctx.instruction.trim()}`);
  }

  lines.push(
    "",
    "PRESERVE:",
    "- All unchanged construction lines, silhouette proportions, and core details from the reference sketch.",
    "- Clean 2D black line art on a pure solid white background (standard CAD flat convention).",
    "- Technical apparel styling suitable for pattern drafting and garment factory tech packs.",
    "- No human model, no mannequin, no photographic textures, no scenery.",
    "",
    "Output one clean, high-resolution updated technical flat sketch."
  );

  return lines.join("\n");
}


const VIEW_LABEL: Record<"FRONT" | "BACK" | "BOTH", string> = {
  FRONT: "the front view",
  BACK: "the back view",
  BOTH: "both the front and back views",
};

/**
 * "Draw with Pen" sketch edit: the input image is the designer's own flat
 * with hand-drawn pen markup on top (red = add/change, blue = remove — the
 * fixed key used by SketchPenCanvas). The model must read the markup the way
 * a technical designer reads a red-lined flat, then redraw clean CAD line art.
 */
export function buildSketchPenMarkupPrompt(ctx: SketchEditContext): string {
  const lines = [
    "You are a senior apparel technical designer revising a fashion CAD technical flat sketch for manufacturing.",
    "",
    "The input image is the CURRENT technical flat sketch with the designer's hand-drawn PEN MARKUP on top of it.",
    "",
    "PEN MARKUP KEY:",
    "- RED pen strokes = construction lines to ADD or RESHAPE, exactly where and how they are drawn — e.g. a new or reshaped neckline, collar, yoke, princess/panel seam, dart, pleat, pocket, placket, cuff, slit, hem shape, or topstitch line.",
    "- If a RED line is drawn near or across an existing black line of the same feature (e.g. a lower neckline under the old one, a longer hem below the old hem), it REPLACES that old line — remove the old black line.",
    "- BLUE pen strokes or scribbles = DELETE whatever black line, seam, or detail lies underneath them. This is mandatory: the covered line must NOT appear in the output.",
    "  - A blue scribble running along a seam line (e.g. a tier, yoke, panel or waist seam) means that seam no longer exists: erase it end to end (on the view where it is marked) and join the two pieces into one continuous panel — any gathers that only existed because of that seam go too.",
    "  - A blue scribble over a pocket, dart, button, trim or other detail means delete that whole detail.",
    "",
    "HOW TO INTERPRET HAND-DRAWN MARKUP (like a professional technical designer):",
    "- Treat the strokes as design intent, not final artwork: straighten wobbly straight lines, make curves smooth and fair, and join new seams cleanly into existing seams, edges and the garment outline.",
    "- Keep the position, proportion and shape the designer drew; do not invent extra features that were not marked.",
    "- On a symmetrical garment, when a structural change is drawn on one side only and is clearly symmetric by nature (armhole, side seam, princess seam, side pocket, sleeve), apply it to both sides; keep it one-sided only when it is clearly intended to be asymmetric (e.g. a single chest pocket, an asymmetric hem or closure).",
    "- Render new stitching the same way the sketch already shows stitching (dashed topstitch lines), and new seams as solid lines.",
  ];

  if (ctx.garmentType) lines.push("", `Garment category: ${ctx.garmentType}.`);

  const extra: string[] = [];
  if (ctx.structuralChanges) {
    for (const [k, v] of Object.entries(ctx.structuralChanges)) {
      if (v && v.trim()) extra.push(`- ${k}: ${v.trim()}`);
    }
  }
  if (ctx.instruction && ctx.instruction.trim()) extra.push(`- Designer's notes on the markup: ${ctx.instruction.trim()}`);
  if (extra.length > 0) lines.push("", "ADDITIONAL INSTRUCTIONS (apply together with the pen markup):", ...extra);

  lines.push(
    "",
    "PRESERVE:",
    "- Every part of the sketch that is NOT marked: silhouette, proportions, scale, position on the page, and all existing construction details.",
    "- Existing callout labels and arrows on the sketch (keep them; remove one only if it points to a feature that was deleted).",
    `- The same layout of ${VIEW_LABEL[ctx.viewAngle ?? "BOTH"]} as the input sketch.`,
    "",
    "OUTPUT:",
    "- One clean, high-resolution revised technical flat sketch: crisp black line art on a pure white background (standard CAD flat convention).",
    "- NO red or blue pen marks, scribbles, or colour of any kind may remain in the output — every markup must be converted into proper black technical line work or removed.",
    "- Before finishing, check every blue mark: the feature under it must be gone. Check every red mark: it must now be a clean black construction line.",
    "- No model, mannequin, fabric texture, scenery, watermark, or new text labels."
  );

  return lines.join("\n");
}

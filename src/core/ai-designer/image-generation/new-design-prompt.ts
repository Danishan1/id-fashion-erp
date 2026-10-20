/**
 * AI Designer "New Design" flow (2026-09-27) — hidden generation prompts.
 * Built entirely server-side from the project's own structured fields; the
 * model-template photo and the fabric photo are supplied separately as real
 * input images to the provider call, never described in text.
 */

import { describeSketchChange, SKETCH_CATEGORY_SCOPE } from "@/core/ai-designer/catalogs/sketch-structure-catalog";

export const NEW_DESIGN_PROMPT_VERSION = "ai-designer-new-design-v3";

/**
 * Distinct design directions per garment type. When the user asks for 3 or 4
 * designs, each image gets its own direction so the options are genuinely
 * different garments (silhouette, neckline, sleeves, length, signature detail),
 * not the same dress repeated. Keys are lower-case garment types; anything not
 * listed uses GENERIC_DIRECTIONS. Every list needs at least 4 entries (the
 * largest imageCount).
 */
const DESIGN_DIRECTIONS: Record<string, string[]> = {
  dress: [
    "A-line midi dress: V-neckline, short flutter sleeves, fitted bodice with a defined waist seam, softly flared skirt to mid-calf.",
    "Fitted sheath dress: square neckline, sleeveless with wide straps, princess seams, straight knee-length skirt with a small back slit.",
    "Tiered maxi dress: round neckline, puff sleeves with elastic cuffs, smocked bodice, three gathered tiers to the ankle.",
    "Wrap dress: crossover V-neck, three-quarter bishop sleeves, self-fabric waist tie, asymmetric hem falling just below the knee.",
    "Shirt dress: pointed collar, button-front placket, roll-up long sleeves with tabs, belted waist, straight knee-length skirt.",
    "Empire-waist dress: sweetheart neckline, thin spaghetti straps, high seam under the bust, long flowing skirt with a front slit.",
  ],
  gown: [
    "Ball gown: off-shoulder neckline, structured boned bodice, voluminous floor-length skirt with soft pleats.",
    "Mermaid gown: deep V-neck, long fitted sleeves, body-hugging silhouette flaring below the knee into a short train.",
    "Anarkali-style gown: round neck, three-quarter sleeves, fitted yoke with a high waist and a full flared floor-length panelled skirt.",
    "Column gown: one-shoulder neckline, sleeveless, straight slim floor-length silhouette with a draped sash at the waist.",
  ],
  top: [
    "Peplum top: square neckline, short puff sleeves, fitted bodice with a flared peplum at the waist.",
    "Wrap top: V-neckline, long balloon sleeves, side tie at the waist, hip length.",
    "Crop top: high halter neckline, sleeveless, fitted cropped length ending above the waist.",
    "Relaxed blouse: round neck with a front keyhole button, three-quarter cuffed sleeves, straight hip-length hem with side slits.",
    "Off-shoulder top: elasticated bardot neckline with a ruffle, short sleeves, smocked waistband, cropped length.",
  ],
  blouse: [
    "Pussy-bow blouse: neck tie bow, long sleeves with buttoned cuffs, relaxed fit, hip length.",
    "Ruffle-front blouse: high round neck, cascading front ruffle, short cap sleeves, tucked fitted waist.",
    "Peasant blouse: gathered round neckline with drawstring, billowy three-quarter sleeves, loose fit.",
    "Tie-front blouse: open V-neck, puff short sleeves, knotted front hem, cropped length.",
  ],
  shirt: [
    "Classic shirt: pointed collar, full button placket, long sleeves with barrel cuffs, one chest pocket, curved hem.",
    "Camp-collar shirt: open notched camp collar, short sleeves, boxy straight fit, straight hem with side vents.",
    "Mandarin-collar shirt: band collar, concealed placket, long sleeves, slim fit, longline curved hem.",
    "Oversized shirt: dropped shoulders, wide collar, rolled half sleeves, two flap chest pockets, high-low hem.",
  ],
  kurti: [
    "Straight kurti: round neck with a front slit, three-quarter sleeves, straight cut to the knee with side slits.",
    "Anarkali kurti: sweetheart neckline, long sleeves, fitted bodice, flared panelled skirt to mid-calf.",
    "A-line kurti: mandarin collar with a short button placket, elbow sleeves, A-line flare to just below the knee.",
    "Angrakha kurti: overlapping wrap neckline with side tie-ups, short sleeves, high-low hem.",
  ],
  lehenga: [
    "Flared lehenga set: heavily flared circular skirt with a broad border, short-sleeve round-neck crop blouse, sheer dupatta.",
    "Panelled A-line lehenga: kalidar panels with contrast piping, sleeveless V-neck blouse with a back tie, dupatta draped on one shoulder.",
    "Mermaid lehenga: fitted through the hips and flaring below the knee, off-shoulder blouse, cape-style dupatta.",
    "Tiered lehenga: three gathered tiers with ruffle edges, puff-sleeve sweetheart blouse, long dupatta.",
  ],
  skirt: [
    "A-line midi skirt: high waistband, side zip, softly flared to mid-calf.",
    "Pleated maxi skirt: elastic waistband, knife pleats falling to the ankle.",
    "Pencil skirt: high waist, fitted to the knee, back vent.",
    "Wrap mini skirt: asymmetric overlapping front with a tie closure and ruffled hem.",
  ],
  jumpsuit: [
    "Wide-leg jumpsuit: V-neck, sleeveless, belted waist, floor-length palazzo legs.",
    "Utility jumpsuit: shirt collar, button front, short sleeves, patch pockets, tapered ankle-length legs.",
    "Halter jumpsuit: halter neck, open back, straight cropped culotte legs.",
    "Wrap jumpsuit: crossover neckline, flutter sleeves, tie waist, flared full-length legs.",
  ],
};

const GENERIC_DIRECTIONS = [
  "A fitted, structured version: clean tailored lines, minimal trims, shorter length.",
  "A relaxed, flowing version: loose drape, gathers or pleats, longer length.",
  "A statement version: one bold detail such as dramatic sleeves, a ruffle, or an asymmetric hem.",
  "A minimal modern version: simple neckline, no sleeves or simple sleeves, clean straight cut.",
];

/** Used when a design brief (garment photo or sketch) already fixes the construction. */
const BRIEF_DIRECTIONS = [
  "Faithful interpretation of the design brief — keep every construction detail exactly as described.",
  "Same silhouette and neckline as the brief; change the sleeve style and add a contrast piping or trim finish.",
  "Same silhouette and neckline as the brief; change the length and the hem finish (tiered, scalloped or asymmetric hem).",
  "Same silhouette as the brief; change the waist treatment (belt, smocking or tie) and the closure detail.",
];

function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function directionsForGarment(garmentType: string): string[] {
  const key = garmentType.trim().toLowerCase();
  if (DESIGN_DIRECTIONS[key]) return DESIGN_DIRECTIONS[key];
  // Loose match, e.g. "Maxi Dress" → dress, "Kurta" → kurti.
  if (key.includes("gown")) return DESIGN_DIRECTIONS.gown;
  if (key.includes("dress") || key.includes("frock")) return DESIGN_DIRECTIONS.dress;
  if (key.includes("kurt")) return DESIGN_DIRECTIONS.kurti;
  if (key.includes("lehenga")) return DESIGN_DIRECTIONS.lehenga;
  if (key.includes("blouse")) return DESIGN_DIRECTIONS.blouse;
  if (key.includes("shirt")) return DESIGN_DIRECTIONS.shirt;
  if (key.includes("top")) return DESIGN_DIRECTIONS.top;
  if (key.includes("skirt")) return DESIGN_DIRECTIONS.skirt;
  if (key.includes("jumpsuit")) return DESIGN_DIRECTIONS.jumpsuit;
  return GENERIC_DIRECTIONS;
}

/**
 * Picks `count` different design directions for one generation. Without a
 * brief, a random selection so each Generate click gives a new set. With a
 * brief, option 1 is always the faithful interpretation and the rest vary
 * details only.
 */
export function pickDesignDirections(
  garmentType: string,
  count: number,
  options: { hasBrief: boolean; random?: () => number }
): string[] {
  const random = options.random ?? Math.random;
  if (options.hasBrief) {
    return [BRIEF_DIRECTIONS[0], ...shuffled(BRIEF_DIRECTIONS.slice(1), random)].slice(0, count);
  }
  return shuffled(directionsForGarment(garmentType), random).slice(0, count);
}

export interface DesignVariation {
  optionNumber: number;
  totalOptions: number;
  direction: string;
  /** The directions given to the other images in the same set, so this one avoids them. */
  otherDirections: string[];
}

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
  /** Which design in a multi-image set this prompt is for; omitted = no explicit direction. */
  variation?: DesignVariation;
}

function buildVariationSection(ctx: TemplateDressSwapContext): string {
  const v = ctx.variation;
  if (!v) return "";
  const lines = [
    "",
    `DESIGN DIRECTION — this is design option ${v.optionNumber} of ${v.totalOptions}. The buyer will compare the options side by side, so each one must be a clearly different ${ctx.garmentType}.`,
    `- Design this option as: ${v.direction}`,
  ];
  if (v.otherDirections.length > 0) {
    lines.push(
      `- The other options in this set are: ${v.otherDirections.map((d) => `"${d}"`).join("; ")}. Do NOT reuse their silhouette, neckline, sleeve style, or length.`
    );
  }
  lines.push(
    `- Do NOT copy the silhouette, neckline, sleeves, or length of the garment in IMAGE 1. IMAGE 1 is only for the person, pose, framing, and setting.`
  );
  return `${lines.join("\n")}\n`;
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
${buildVariationSection(ctx)}
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
 *
 * v2: each requested change is a REQUIRED change with a precise drawing
 * definition and an explicit scope (what may be redrawn or removed), and the
 * PRESERVE list names only the parts that are NOT being changed. v1 asked to
 * "preserve silhouette proportions" in the same breath as a silhouette
 * change, so the model kept the old shape.
 */
export function buildSketchEditPrompt(ctx: SketchEditContext): string {
  const changes = Object.entries(ctx.structuralChanges ?? {}).filter(([, v]) => v && v.trim());
  const changedCategories = new Set(changes.map(([k]) => k));

  const lines = [
    "You are a senior apparel technical designer editing a fashion CAD technical flat sketch for manufacturing.",
    "",
    "The input image is the CURRENT technical flat sketch.",
  ];
  if (ctx.garmentType) lines.push(`Garment category: ${ctx.garmentType}.`);

  if (changes.length > 0 || (ctx.instruction && ctx.instruction.trim())) {
    lines.push("", "REQUIRED CHANGES — the output must visibly show every change below; returning the sketch unchanged is wrong:");
    for (const [category, value] of changes) {
      lines.push(`- ${describeSketchChange(category, value.trim())}`);
      const scope = SKETCH_CATEGORY_SCOPE[category]?.scope;
      if (scope) lines.push(`  You may redraw: ${scope}.`);
    }
    if (ctx.instruction && ctx.instruction.trim()) {
      lines.push(`- Designer's instructions: ${ctx.instruction.trim()}`);
    }
    lines.push(`- Apply each change to ${VIEW_LABEL[ctx.viewAngle ?? "BOTH"]}, consistently.`);
  }

  const kept = Object.entries(SKETCH_CATEGORY_SCOPE)
    .filter(([category]) => !changedCategories.has(category))
    .map(([, { label }]) => label.toLowerCase());

  lines.push(
    "",
    "PRESERVE (everything that is NOT part of the required changes):",
    ...(kept.length > 0 ? [`- Keep these exactly as drawn: ${kept.join(", ")}.`] : []),
    "- If the sketch shows a fabric print motif, keep the same motif and scale, spread over the new shape.",
    `- The same layout of ${VIEW_LABEL[ctx.viewAngle ?? "BOTH"]}, the same scale and position on the page, and any view labels.`,
    "- Clean 2D black line art on a pure solid white background (standard CAD flat convention).",
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

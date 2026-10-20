/**
 * Construction options offered on the AI Designer edit page ("Edit from
 * Sketch" → Construction Options). Each option is applied to the CAD sketch
 * with one click, and shows a small CAD-flat photo (variant CAD_FLAT in
 * ai_designer_option_reference_images, keyed by the option value).
 *
 * Client-safe: no Prisma or server imports. Shared by the edit page, the
 * Masters → AI Design "Construction Flats" panel and the flat generator.
 */
export interface SketchStructureGroup {
  /** Sent to the sketch-edit prompt as the field name (e.g. "silhouette: A-Line"). */
  category: string;
  label: string;
  icon: string;
  options: string[];
}

export const SKETCH_STRUCTURE_OPTIONS: SketchStructureGroup[] = [
  {
    category: "silhouette",
    label: "Garment Silhouette",
    icon: "👗",
    options: ["A-Line", "Straight / Column", "Fit & Flare", "Boxy / Relaxed", "Trapeze", "Empire Waist", "Mermaid", "Peplum", "Bodycon"],
  },
  {
    category: "neckline",
    label: "Neckline & Collar",
    icon: "👔",
    options: ["Round Neck", "V-Neck", "Mandarin Collar", "Shirt Collar", "Notch Collar", "Peter Pan Collar", "Square Neck", "Boat Neck", "Halter Neck", "Sweetheart"],
  },
  {
    category: "sleeves",
    label: "Sleeve Construction",
    icon: "🧥",
    options: ["Sleeveless", "Short Sleeve", "Cap Sleeve", "3/4 Sleeve", "Long Sleeve", "Raglan Sleeve", "Puff Sleeve", "Bishop Sleeve", "Bell Sleeve", "Kimono Sleeve"],
  },
  {
    category: "length",
    label: "Garment Length",
    icon: "📏",
    options: ["Crop Length", "Waist Length", "Hip Length", "Thigh Length", "Knee Length", "Midi Length", "Maxi / Ankle", "Floor Length"],
  },
  {
    category: "pockets",
    label: "Pockets & Placement",
    icon: "👝",
    options: ["No Pockets", "Patch Pockets", "In-Seam Pockets", "Flap Pockets", "Welt Pockets", "Cargo Pockets"],
  },
  {
    category: "closures",
    label: "Placket & Closures",
    icon: "🔘",
    options: ["Front Button Placket", "Center Back Zipper", "Side Invisible Zip", "Wrap with Tie", "Front Metal Zip", "Pullover (No Fastener)"],
  },
  {
    category: "construction",
    label: "Seams & Darts",
    icon: "🧵",
    options: ["Princess Seams", "French Darts", "Waist Darts", "Shoulder Yoke", "Tiered Gathered Panels", "Box Pleats", "Contrast Topstitching"],
  },
];

/**
 * Which parts of the drawing each category is allowed to change. Used in the
 * sketch-edit prompt so the model knows what to redraw (and what to remove)
 * and keeps everything else.
 */
export const SKETCH_CATEGORY_SCOPE: Record<string, { label: string; scope: string }> = {
  silhouette: {
    label: "Silhouette",
    scope:
      "the garment's overall outline: the side seams, waist shaping, the shape of the body/skirt below the bust, the amount of flare, and the hem width. Remove or redraw any existing tiers, gathers, panel seams, pleats or flounces that do not fit the new silhouette. Draw the NEW outline first, following the proportions given above; do not trace or keep the old side seams or hem line. Then place the unchanged details (neckline, straps, closures, bodice seams, print) onto the new outline",
  },
  neckline: { label: "Neckline & collar", scope: "the neckline shape and any collar, straps or neck finish" },
  sleeves: { label: "Sleeves", scope: "the sleeves, sleeve hems/cuffs and the armhole shape" },
  length: { label: "Length", scope: "where the hem falls (keep the hem finish and the rest of the garment)" },
  pockets: { label: "Pockets", scope: "the pockets only (add, remove or replace them)" },
  closures: { label: "Closures", scope: "the placket and fastening (buttons, zips, ties) only" },
  construction: { label: "Seams & darts", scope: "the internal seams, darts, pleats and topstitching only" },
};

/**
 * Precise drawing definitions for options whose label alone is too vague for
 * an image model. Keyed by option value. Silhouettes are the important case:
 * the model must know exactly how the outline and hem width should look.
 */
export const SKETCH_OPTION_DEFINITIONS: Record<string, string> = {
  "A-Line":
    "fitted at the bust, then the side seams run as straight diagonal lines from the waist to the hem, forming an 'A'. The hem is about 1.5 times the hip width. One smooth skirt panel: no tiers, no gathers, no pleats, no flounces.",
  "Straight / Column":
    "below the bust the outline is a tall rectangle: the side seams are vertical, parallel lines from the hip to the hem, and the hem is the SAME width as the hips (not wider). No flare at all, no gathers, no tiers, no flounces, no godets. Add a short slit at the centre back hem for walking.",
  "Fit & Flare":
    "a closely fitted bodice down to a clearly defined natural-waist seam, then a FULL CIRCLE skirt: right below the waist seam the skirt immediately spreads outward, so the hem is at least 2.5 times the waist width and extends well beyond the hips on both sides, with deep vertical fold lines and a wavy hem. It must look much fuller than an A-line (an A-line has straight sides and no folds). The contrast between the tight bodice and the full skirt must be obvious.",
  "Boxy / Relaxed":
    "a loose rectangle from shoulder to hem: the same width at bust, waist and hem, side seams straight and parallel, no waist seam, no waist shaping, no darts, no flare. Slightly dropped, wide shoulders.",
  Trapeze:
    "narrow at the shoulders and bust, then the body flares dramatically from just below the underarm to a very wide hem (at least 2 times the bust width), with NO waist seam and no waist shaping — an overall triangle outline.",
  "Empire Waist":
    "the waist seam is moved up to sit directly under the bust (well above the natural waist), so the bodice is short. Below that seam the skirt falls straight down and widens gently; the hem is about 1.3 times the hip width.",
  Mermaid:
    "tightly fitted from the bust through the waist, hips and thighs down to the knee (the knee width is no wider than the hips), then the skirt flares out sharply like a fish tail to a hem at least 2 times the knee width.",
  Peplum:
    "a fitted bodice to the natural waist, a short flared flounce (peplum) attached at the waist seam that ends at the upper hip and stands out wider than the hips, and below it a slim, straight, fitted lower part whose hem is no wider than the hips.",
  Bodycon:
    "hugs the body closely everywhere: the side seams follow the curves of bust, waist and hips, the waist is clearly narrow, and the hem is no wider than the hips. No flare, no gathers, no tiers.",
};

/** One line describing a requested change, with its definition when there is one. */
export function describeSketchChange(category: string, value: string): string {
  const label = SKETCH_CATEGORY_SCOPE[category]?.label ?? category;
  const definition = SKETCH_OPTION_DEFINITIONS[value];
  return definition ? `${label} → ${value}: ${definition}` : `${label} → ${value}`;
}

/** Every construction option value with its group, in catalog order. */
export function listSketchStructureOptions(): { category: string; groupLabel: string; value: string }[] {
  return SKETCH_STRUCTURE_OPTIONS.flatMap((g) => g.options.map((value) => ({ category: g.category, groupLabel: g.label, value })));
}

/**
 * Prompt for one option's small CAD-flat thumbnail: a plain garment drawn as
 * a technical line drawing, with only this construction detail emphasised.
 */
export function buildOptionFlatPrompt(groupLabel: string, value: string): string {
  return [
    `Technical fashion CAD flat sketch illustrating the construction detail "${value}" (${groupLabel}).`,
    `Draw one simple, generic women's garment in front view as clean black line art on a pure white background,`,
    `so that the "${value}" detail is clearly visible and is the obvious focus of the drawing.`,
    `Flat 2D technical drawing only: no model, no body, no colour, no fabric texture, no shading, no text, no labels, no measurements.`,
    `Centered, square composition, with even margins, readable at thumbnail size.`,
  ].join(" ");
}

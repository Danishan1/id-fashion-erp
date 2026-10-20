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

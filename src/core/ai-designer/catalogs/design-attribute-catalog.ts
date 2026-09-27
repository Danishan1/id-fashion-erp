/**
 * Fixed, built-in per-category Product Design attribute catalog for AI
 * Designer — deterministic, zero extra AI call. Keyed by CATEGORY NAME (not
 * customer segment), since a Pant's design attributes don't depend on who
 * wears it. Field names/options follow the brief's own examples exactly for
 * Shirt and Pant; the remaining categories follow the same shape.
 *
 * Every attribute also allows a free-text "Other" override in the UI —
 * handled generically by the picker component, not encoded per entry here.
 *
 * Expanded 2026-09-11 against a competitor reference (richer per-category
 * attributes, e.g. a separate Back Neckline picker) — two fields are now
 * universal across every category, added once here rather than duplicated
 * per entry:
 * - `surface` (Surface / Finish) — a genuinely new concern (plain vs.
 *   embroidered/printed/sequinned/quilted/textured), independent of cut.
 * - `accentColor` (Accent / Trim Color) — deliberately NOT a general
 *   "Colors" picker for the whole garment: the actual garment's base color
 *   is already, and remains, driven entirely by the real uploaded fabric
 *   photo (see image-generation/prompt.ts's own "the fabric image is the
 *   ONLY source of truth for color" instruction) — a generic Colors field
 *   here would silently conflict with that. This field is scoped narrowly
 *   to accent/trim/contrast-stitch color choices instead, with "Same as
 *   Fabric" as the safe default option, so it can never contradict the
 *   fabric-driven base color.
 * Dress additionally gained the full richer set a "Back Neckline"-style
 * picker implies (Back Neck, Bodice, Body Cut-Outs, Waist Add-On, Waist
 * Line, Shoulders, Straps, Flare Variation, Slit Length, Slit Type) — this
 * is the exact category shown in the reference; Blouse/Top/Kurti/Frock (the
 * other dress-like categories) got a lighter, plausible subset rather than
 * the full set, to avoid fields that don't make sense for their own silhouette.
 */

export interface DesignAttributeDef {
  key: string;
  label: string;
  options: string[];
}

const SURFACE_OPTIONS = ["Plain", "Embroidered", "Printed", "Sequinned", "Quilted", "Textured"];
const ACCENT_COLOR_OPTIONS = ["Same as Fabric", "Black", "White", "Navy Blue", "Red", "Gold", "Contrast Piping"];

const UNIVERSAL_ATTRIBUTES: DesignAttributeDef[] = [
  { key: "surface", label: "Surface / Finish", options: SURFACE_OPTIONS },
  { key: "accentColor", label: "Accent / Trim Color", options: ACCENT_COLOR_OPTIONS },
];

const BASE_CATEGORY_ATTRIBUTES: Record<string, DesignAttributeDef[]> = {
  Shirt: [
    { key: "collar", label: "Collar", options: ["Classic", "Mandarin", "Spread", "Button-Down", "Cuban", "Round Neck"] },
    { key: "sleeve", label: "Sleeve", options: ["Full Sleeve", "Half Sleeve", "Roll-Up Sleeve", "Sleeveless"] },
    { key: "pocket", label: "Pocket", options: ["No Pocket", "Single Chest Pocket", "Double Chest Pocket"] },
    { key: "cuff", label: "Cuff", options: ["Button Cuff", "Rounded Cuff", "French Cuff"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed", "Oversized"] },
    { key: "hem", label: "Hem", options: ["Straight Hem", "Curved Hem", "Shirt-Tail Hem"] },
    { key: "buttons", label: "Buttons", options: ["Standard Plastic", "Horn-Finish", "Metal Snap", "Concealed Placket"] },
  ],
  "T-Shirt": [
    { key: "neckline", label: "Neckline", options: ["Round Neck", "V-Neck", "Polo Collar", "Henley"] },
    { key: "sleeve", label: "Sleeve", options: ["Half Sleeve", "Full Sleeve", "Sleeveless", "Raglan Sleeve"] },
    { key: "pocket", label: "Pocket", options: ["No Pocket", "Chest Pocket"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Oversized", "Muscle Fit"] },
    { key: "hem", label: "Hem", options: ["Straight Hem", "Curved Hem"] },
    { key: "printPlacement", label: "Print Placement", options: ["No Print", "Front Print", "Back Print", "Front & Back Print"] },
  ],
  Pant: [
    { key: "rise", label: "Rise", options: ["Low Rise", "Mid Rise", "High Rise"] },
    { key: "pocket", label: "Pocket", options: ["Slant Pocket", "Cargo Pocket", "Welt Pocket", "Patch Pocket"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed", "Skinny", "Bootcut"] },
    { key: "bottom", label: "Bottom", options: ["Straight", "Tapered", "Wide Leg", "Bootcut", "Jogger Cuff"] },
    { key: "closure", label: "Closure", options: ["Zip Fly", "Button Fly", "Drawstring", "Elastic Waist"] },
    { key: "length", label: "Length", options: ["Full Length", "Ankle Length", "Cropped", "Capri"] },
  ],
  Jeans: [
    { key: "rise", label: "Rise", options: ["Low Rise", "Mid Rise", "High Rise"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed", "Skinny", "Bootcut", "Straight"] },
    { key: "wash", label: "Wash", options: ["Light Wash", "Medium Wash", "Dark Wash", "Black", "Raw Denim"] },
    { key: "closure", label: "Closure", options: ["Zip Fly", "Button Fly"] },
    { key: "length", label: "Length", options: ["Full Length", "Ankle Length", "Cropped"] },
  ],
  Kurta: [
    { key: "neckline", label: "Neckline", options: ["Round Neck", "Mandarin Collar", "V-Neck", "Chinese Collar"] },
    { key: "sleeve", label: "Sleeve", options: ["Full Sleeve", "Three-Quarter Sleeve", "Half Sleeve"] },
    { key: "length", label: "Length", options: ["Short Kurta", "Knee Length", "Below Knee", "Ankle Length"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Straight", "A-Line"] },
    { key: "sideSlit", label: "Side Slit", options: ["No Slit", "Side Slit", "Front Slit"] },
  ],
  Jacket: [
    { key: "collar", label: "Collar", options: ["Notch Lapel", "Shawl Collar", "Mandarin Collar", "Hooded"] },
    { key: "closure", label: "Closure", options: ["Zipper", "Button", "Snap Button"] },
    { key: "sleeve", label: "Sleeve", options: ["Full Sleeve", "Raglan Sleeve"] },
    { key: "pocket", label: "Pocket", options: ["Flap Pocket", "Zip Pocket", "Patch Pocket"] },
    { key: "length", label: "Length", options: ["Cropped", "Hip Length", "Long"] },
  ],
  Hoodie: [
    { key: "hoodType", label: "Hood Type", options: ["Attached Hood", "Drawstring Hood", "No Hood"] },
    { key: "closure", label: "Closure", options: ["Pullover", "Zip-Up", "Half Zip"] },
    { key: "pocket", label: "Pocket", options: ["Kangaroo Pocket", "Side Pockets", "No Pocket"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Oversized"] },
    { key: "sleeve", label: "Sleeve", options: ["Full Sleeve", "Raglan Sleeve"] },
  ],
  Shorts: [
    { key: "length", label: "Length", options: ["Above Knee", "Knee Length", "Bermuda"] },
    { key: "waist", label: "Waist", options: ["Elastic Waist", "Drawstring", "Belted"] },
    { key: "pocket", label: "Pocket", options: ["Slant Pocket", "Cargo Pocket", "No Pocket"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed"] },
  ],
  Dress: [
    { key: "neckline", label: "Front Neck", options: ["Round Neck", "V-Neck", "Halter", "Off-Shoulder", "Square Neck"] },
    { key: "backNeck", label: "Back Neck", options: ["Criss-Cross Back Cut-Out", "Deep Back Cut-Out", "Open Back Cut-Out", "Oval Back Cut-Out", "Tie-Back Cut-Out", "Regular Back"] },
    { key: "sleeve", label: "Sleeves", options: ["Sleeveless", "Cap Sleeve", "Half Sleeve", "Full Sleeve"] },
    { key: "silhouette", label: "Silhouette", options: ["A-Line", "Bodycon", "Fit & Flare", "Wrap", "Shift"] },
    { key: "length", label: "Length", options: ["Mini", "Knee Length", "Midi", "Maxi"] },
    { key: "closure", label: "Closure", options: ["Zipper", "Button", "Pull-On"] },
    { key: "bodice", label: "Bodice", options: ["Fitted Bodice", "Empire Bodice", "Corset Bodice", "Draped Bodice"] },
    { key: "bodyCutouts", label: "Body Cut-Outs", options: ["No Cut-Outs", "Waist Cut-Out", "Side Cut-Out", "Shoulder Cut-Out"] },
    { key: "waistAddOn", label: "Waist Add-On", options: ["None", "Tie Belt", "Fabric Belt", "Waist Tie Knot"] },
    { key: "waistLine", label: "Waist Line", options: ["Natural Waist", "High Waist", "Drop Waist", "Empire Waist"] },
    { key: "shoulders", label: "Shoulders", options: ["Regular Shoulders", "Puff Shoulders", "Padded Shoulders", "Cold Shoulder"] },
    { key: "straps", label: "Straps", options: ["No Straps", "Thin Straps", "Wide Straps", "Halter Straps", "Crisscross Straps"] },
    { key: "flareVariation", label: "Flare Variation", options: ["No Flare", "Subtle Flare", "Full Flare", "Godet Flare"] },
    { key: "slitLength", label: "Slit Length", options: ["No Slit", "Knee-High Slit", "Thigh-High Slit", "Full-Length Slit"] },
    { key: "slitType", label: "Slit Type", options: ["No Slit", "Front Slit", "Side Slit", "Back Slit"] },
  ],
  Top: [
    { key: "neckline", label: "Front Neck", options: ["Round Neck", "V-Neck", "Square Neck", "Halter", "Off-Shoulder"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Cap Sleeve", "Half Sleeve", "Full Sleeve", "Bell Sleeve"] },
    { key: "fit", label: "Fit", options: ["Fitted", "Regular", "Loose", "Crop"] },
    { key: "hem", label: "Hem", options: ["Straight Hem", "Curved Hem", "Peplum"] },
    { key: "bodyCutouts", label: "Body Cut-Outs", options: ["No Cut-Outs", "Waist Cut-Out", "Side Cut-Out"] },
  ],
  Lehenga: [
    { key: "neckline", label: "Blouse Neck", options: ["Sweetheart Neck", "V-Neck", "Square Neck", "Round Neck", "Halter"] },
    { key: "sleeve", label: "Blouse Sleeve", options: ["Sleeveless", "Cap Sleeve", "Half Sleeve", "Elbow Sleeve", "Full Sleeve"] },
    { key: "flare", label: "Skirt Flare", options: ["A-Line", "Circular Flare", "Mermaid", "Panelled Kalidar"] },
    { key: "dupattaStyle", label: "Dupatta Style", options: ["Shoulder Drape", "Head Drape", "Double Dupatta", "No Dupatta"] },
    { key: "border", label: "Border", options: ["Embroidered Border", "Gota Border", "Scalloped Border", "Plain Hem"] },
  ],
  Kurti: [
    { key: "neckline", label: "Front Neck", options: ["Round Neck", "V-Neck", "Mandarin Collar", "Boat Neck"] },
    { key: "sleeve", label: "Sleeve", options: ["Full Sleeve", "Three-Quarter Sleeve", "Half Sleeve", "Sleeveless"] },
    { key: "length", label: "Length", options: ["Short", "Knee Length", "Below Knee"] },
    { key: "fit", label: "Fit", options: ["A-Line", "Straight", "Anarkali", "Flared"] },
    { key: "slitType", label: "Slit Type", options: ["No Slit", "Front Slit", "Side Slit"] },
  ],
  Skirt: [
    { key: "silhouette", label: "Silhouette", options: ["A-Line", "Straight / Pencil", "Flared", "Pleated", "Wrap"] },
    { key: "length", label: "Length", options: ["Mini", "Knee Length", "Midi", "Maxi"] },
    { key: "waist", label: "Waist", options: ["High Waist", "Mid Waist"] },
    { key: "closure", label: "Closure", options: ["Zipper", "Elastic Waist"] },
  ],
  Blouse: [
    { key: "neckline", label: "Front Neck", options: ["Round Neck", "V-Neck", "Sweetheart", "Boat Neck"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Cap Sleeve", "Half Sleeve", "Full Sleeve"] },
    { key: "backStyle", label: "Back Neck", options: ["Regular Back", "Deep Back", "Tie-Back", "Criss-Cross Back", "Open Back"] },
    { key: "fit", label: "Fit", options: ["Fitted", "Regular"] },
    { key: "straps", label: "Straps", options: ["No Straps", "Thin Straps", "Wide Straps"] },
    { key: "bodyCutouts", label: "Body Cut-Outs", options: ["No Cut-Outs", "Waist Cut-Out", "Side Cut-Out"] },
  ],
  "Co-ord": [
    { key: "topStyle", label: "Top Style", options: ["Shirt", "Crop Top", "T-Shirt", "Blouse"] },
    { key: "bottomStyle", label: "Bottom Style", options: ["Pant", "Skirt", "Shorts"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed"] },
  ],
  Frock: [
    { key: "neckline", label: "Front Neck", options: ["Round Neck", "Peter Pan Collar", "Halter"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Puff Sleeve", "Half Sleeve"] },
    { key: "silhouette", label: "Silhouette", options: ["A-Line", "Flared", "Layered"] },
    { key: "length", label: "Length", options: ["Above Knee", "Knee Length"] },
    { key: "waistAddOn", label: "Waist Add-On", options: ["None", "Tie Belt", "Fabric Belt"] },
  ],
  Onesie: [
    { key: "neckline", label: "Neckline", options: ["Round Neck", "Envelope Neck"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Half Sleeve", "Full Sleeve"] },
    { key: "closure", label: "Closure", options: ["Snap Button", "Zipper"] },
    { key: "bottom", label: "Bottom", options: ["Open Bottom", "Footed"] },
  ],
  Romper: [
    { key: "neckline", label: "Neckline", options: ["Round Neck", "Halter"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Short Sleeve"] },
    { key: "closure", label: "Closure", options: ["Snap Button", "Zipper"] },
    { key: "length", label: "Length", options: ["Above Knee", "Knee Length"] },
  ],
  "Baby Dress": [
    { key: "neckline", label: "Neckline", options: ["Round Neck", "Peter Pan Collar"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Puff Sleeve", "Short Sleeve"] },
    { key: "silhouette", label: "Silhouette", options: ["A-Line", "Flared"] },
  ],
  Sleepwear: [
    { key: "setType", label: "Set Type", options: ["Top & Bottom Set", "Sleep Gown", "One-Piece"] },
    { key: "sleeve", label: "Sleeve", options: ["Sleeveless", "Short Sleeve", "Full Sleeve"] },
    { key: "closure", label: "Closure", options: ["Snap Button", "Pull-On"] },
  ],
  "Top-Bottom Set": [
    { key: "topStyle", label: "Top Style", options: ["T-Shirt", "Shirt"] },
    { key: "bottomStyle", label: "Bottom Style", options: ["Shorts", "Pant"] },
    { key: "fit", label: "Fit", options: ["Regular", "Relaxed"] },
  ],
  Sweatshirt: [
    { key: "neckline", label: "Neckline", options: ["Crew Neck", "Round Neck"] },
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Oversized"] },
    { key: "pocket", label: "Pocket", options: ["Kangaroo Pocket", "No Pocket"] },
    { key: "cuff", label: "Cuff", options: ["Ribbed Cuff", "Plain Cuff"] },
  ],
  "Track Pant": [
    { key: "fit", label: "Fit", options: ["Slim", "Regular", "Relaxed"] },
    { key: "waist", label: "Waist", options: ["Elastic Waist", "Drawstring"] },
    { key: "length", label: "Length", options: ["Full Length", "Ankle Length", "Cropped"] },
    { key: "cuff", label: "Cuff", options: ["Ribbed Cuff", "Open Hem"] },
  ],
};

export const PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY: Record<string, DesignAttributeDef[]> = Object.fromEntries(
  Object.entries(BASE_CATEGORY_ATTRIBUTES).map(([category, attrs]) => [category, [...attrs, ...UNIVERSAL_ATTRIBUTES]])
);

export function getDesignAttributesForCategory(categoryName: string): DesignAttributeDef[] {
  return PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY[categoryName] ?? [];
}

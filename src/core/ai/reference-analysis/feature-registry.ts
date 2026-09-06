/**
 * The 36 individually-tracked observation slots the reference-analysis
 * prompt produces (24 top-level + sleeve's 4 + fabricObservations' 6 +
 * printPattern's 5 sub-keys), each mapped to a display label, a UI section
 * grouping, and the dotted path into the raw structured-JSON response used
 * to pluck its value out. Deliberately zero Prisma/server-only imports —
 * both the server (flattening the AI response into DB rows) and the client
 * (rendering section headings/labels) import this same file, so a label
 * never has to be duplicated or kept in sync between the two.
 */

export const ANALYSIS_SECTIONS = ["OVERVIEW", "DESIGN_DETAILS", "CONSTRUCTION", "FABRIC"] as const;
export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];

export const ANALYSIS_SECTION_LABELS: Record<AnalysisSection, string> = {
  OVERVIEW: "Garment Overview",
  DESIGN_DETAILS: "Design Details",
  CONSTRUCTION: "Construction",
  FABRIC: "Fabric Observations",
};

interface FeatureDef {
  key: string;
  label: string;
  section: AnalysisSection;
  path: string[];
}

export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: "garmentCategory", label: "Garment Category", section: "OVERVIEW", path: ["garmentCategory"] },
  { key: "silhouette", label: "Silhouette", section: "OVERVIEW", path: ["silhouette"] },
  { key: "garmentLength", label: "Garment Length", section: "OVERVIEW", path: ["garmentLength"] },
  { key: "fit", label: "Fit", section: "OVERVIEW", path: ["fit"] },

  { key: "neckline", label: "Neckline", section: "DESIGN_DETAILS", path: ["neckline"] },
  { key: "collar", label: "Collar", section: "DESIGN_DETAILS", path: ["collar"] },
  { key: "sleeve.type", label: "Sleeve Type", section: "DESIGN_DETAILS", path: ["sleeveType"] },
  { key: "sleeve.length", label: "Sleeve Length", section: "DESIGN_DETAILS", path: ["sleeveLength"] },
  { key: "sleeve.volume", label: "Sleeve Volume", section: "DESIGN_DETAILS", path: ["sleeveVolume"] },
  { key: "sleeve.cuff", label: "Sleeve Cuff / Finish", section: "DESIGN_DETAILS", path: ["sleeveCuff"] },
  { key: "openingClosure", label: "Opening / Closure", section: "DESIGN_DETAILS", path: ["openingClosure"] },
  { key: "darts", label: "Darts", section: "DESIGN_DETAILS", path: ["darts"] },
  { key: "pleats", label: "Pleats", section: "DESIGN_DETAILS", path: ["pleats"] },
  { key: "gathers", label: "Gathers", section: "DESIGN_DETAILS", path: ["gathers"] },
  { key: "tucks", label: "Tucks", section: "DESIGN_DETAILS", path: ["tucks"] },
  { key: "pockets", label: "Pockets", section: "DESIGN_DETAILS", path: ["pockets"] },
  { key: "waistTreatment", label: "Waist Treatment", section: "DESIGN_DETAILS", path: ["waistTreatment"] },
  { key: "hem", label: "Hem / Bottom Finish", section: "DESIGN_DETAILS", path: ["hem"] },
  { key: "trims", label: "Trims", section: "DESIGN_DETAILS", path: ["trims"] },
  { key: "decorativeDetails", label: "Decorative Details", section: "DESIGN_DETAILS", path: ["decorativeDetails"] },
  { key: "printPattern.type", label: "Print / Pattern Type", section: "DESIGN_DETAILS", path: ["printPatternType"] },
  { key: "printPattern.scale", label: "Print / Pattern Scale", section: "DESIGN_DETAILS", path: ["printPatternScale"] },
  {
    key: "printPattern.direction",
    label: "Print / Pattern Direction",
    section: "DESIGN_DETAILS",
    path: ["printPatternDirection"],
  },
  {
    key: "printPattern.placement",
    label: "Print / Pattern Placement",
    section: "DESIGN_DETAILS",
    path: ["printPatternPlacement"],
  },
  {
    key: "printPattern.repeatAppearance",
    label: "Print / Pattern Repeat",
    section: "DESIGN_DETAILS",
    path: ["printPatternRepeatAppearance"],
  },

  { key: "shoulderConstruction", label: "Shoulder Construction", section: "CONSTRUCTION", path: ["shoulderConstruction"] },
  { key: "frontConstruction", label: "Front Construction", section: "CONSTRUCTION", path: ["frontConstruction"] },
  { key: "backConstruction", label: "Back Construction", section: "CONSTRUCTION", path: ["backConstruction"] },
  { key: "panels", label: "Panels", section: "CONSTRUCTION", path: ["panels"] },
  { key: "seams", label: "Seams", section: "CONSTRUCTION", path: ["seams"] },

  {
    key: "fabricObservations.weight",
    label: "Apparent Weight",
    section: "FABRIC",
    path: ["fabricWeight"],
  },
  { key: "fabricObservations.drape", label: "Drape", section: "FABRIC", path: ["fabricDrape"] },
  { key: "fabricObservations.texture", label: "Texture", section: "FABRIC", path: ["fabricTexture"] },
  {
    key: "fabricObservations.stretchAppearance",
    label: "Stretch Appearance",
    section: "FABRIC",
    path: ["fabricStretchAppearance"],
  },
  {
    key: "fabricObservations.transparency",
    label: "Transparency / Opacity",
    section: "FABRIC",
    path: ["fabricTransparency"],
  },
  {
    key: "fabricObservations.surfaceCharacter",
    label: "Surface Character / Sheen",
    section: "FABRIC",
    path: ["fabricSurfaceCharacter"],
  },
];

export function getFeatureDef(featureKey: string): FeatureDef | undefined {
  return FEATURE_REGISTRY.find((f) => f.key === featureKey);
}

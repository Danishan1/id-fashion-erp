/**
 * Client-safe display labels for each Sketch Analysis feature — zero Prisma
 * imports, so both server code and SketchAnalysisPanel (a client component)
 * can import this same file. Mirrors the established feature-registry.ts
 * convention already used by AI Garment Flow's own reference-analysis module
 * and by Replicate Design's own dna-analysis module.
 */
import { SKETCH_FEATURE_KEYS, type SketchFeatureKey } from "./schema";

export const SKETCH_FEATURE_LABELS: Record<SketchFeatureKey, string> = {
  garmentType: "Garment Type",
  silhouette: "Silhouette",
  length: "Garment Length",
  fit: "Fit",
  frontNeckline: "Front Neckline",
  backNeckline: "Back Neckline",
  sleeveType: "Sleeve Type",
  sleeveLength: "Sleeve Length",
  collar: "Collar",
  shoulderConstruction: "Shoulder Construction",
  waistConstruction: "Waist Construction",
  closureDetails: "Closure Details (Placket / Buttons / Zipper)",
  pockets: "Pockets",
  panelsAndYokes: "Panels & Yokes",
  pleatsAndGathers: "Pleats & Gathers",
  dartsAndSeams: "Darts & Seams",
  slitsAndOpenings: "Slits & Openings",
  ruffleAndLayerDetails: "Ruffles & Layers",
  hemAndCuffs: "Hem & Cuffs",
  decorativeDetails: "Decorative Details",
  otherConstructionNotes: "Other Construction Notes",
};

/**
 * A Product Design attribute key (from design-attribute-catalog.ts) that,
 * when the user explicitly picks a value differing from this sketch
 * feature's own locked value, counts as an intentional override — see
 * detectDesignOverrides() in ai-designer.service.ts. Two independently-
 * evolved registries, so this is a best-effort correlation, not a formal
 * schema link (see the plan's own "Residual risks" note): a sketch feature
 * with no entry here simply has no override path — it always stays
 * preserved from the sketch, which is the safe default per the spec's own
 * "if the user doesn't explicitly override it, preserve the sketch" rule.
 */
export const SKETCH_TO_DESIGN_ATTRIBUTE_KEYS: Partial<Record<SketchFeatureKey, string[]>> = {
  frontNeckline: ["neckline"],
  backNeckline: ["backNeck"],
  sleeveType: ["sleeve"],
  collar: ["collar"],
  silhouette: ["silhouette"],
  hemAndCuffs: ["hem", "cuff"],
  closureDetails: ["closure", "buttons"],
  pockets: ["pocket"],
  waistConstruction: ["waistLine", "waist", "rise"],
};

export { SKETCH_FEATURE_KEYS };
export type { SketchFeatureKey };

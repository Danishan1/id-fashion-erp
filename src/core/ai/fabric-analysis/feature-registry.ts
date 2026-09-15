/**
 * The 13 individually-tracked observation slots the fabric-analysis prompt
 * produces, each mapped to a display label, a UI section grouping, and the
 * (flat, single-segment) path into the raw structured-JSON response used to
 * pluck its value out. Deliberately zero Prisma/server-only imports — both
 * the server (flattening the AI response into DB rows) and the client
 * (rendering section headings/labels) import this same file, so a label
 * never has to be duplicated or kept in sync between the two. Mirrors
 * reference-analysis/feature-registry.ts's exact shape, scoped narrower
 * (13, not 36) since there is no garment yet to describe, only the fabric.
 * The original 17-field shape also had a MANUFACTURING section (Cutting/
 * Sewing/Care Considerations + Potential Quality Risks) — dropped per
 * explicit user feedback that it read as advisory consulting prose rather
 * than "fabric details," leaving just the fabric's own structural/visual/
 * performance properties.
 */

export const FABRIC_ANALYSIS_SECTIONS = ["STRUCTURE", "VISUAL", "PERFORMANCE"] as const;
export type FabricAnalysisSection = (typeof FABRIC_ANALYSIS_SECTIONS)[number];

export const FABRIC_ANALYSIS_SECTION_LABELS: Record<FabricAnalysisSection, string> = {
  STRUCTURE: "Fabric Structure",
  VISUAL: "Visual Characteristics",
  PERFORMANCE: "Performance Estimates",
};

interface FabricFeatureDef {
  key: string;
  label: string;
  section: FabricAnalysisSection;
  path: string[];
}

export const FABRIC_FEATURE_REGISTRY: FabricFeatureDef[] = [
  { key: "fabricType", label: "Fabric Type", section: "STRUCTURE", path: ["fabricType"] },
  { key: "weaveOrKnitStructure", label: "Weave / Knit Structure", section: "STRUCTURE", path: ["weaveOrKnitStructure"] },
  { key: "estimatedComposition", label: "Estimated Composition", section: "STRUCTURE", path: ["estimatedComposition"] },
  { key: "estimatedGsmClass", label: "Estimated Weight Class (GSM)", section: "STRUCTURE", path: ["estimatedGsmClass"] },
  { key: "directionality", label: "Directionality", section: "STRUCTURE", path: ["directionality"] },

  { key: "colorDescription", label: "Color", section: "VISUAL", path: ["colorDescription"] },
  { key: "patternOrPrint", label: "Pattern / Print", section: "VISUAL", path: ["patternOrPrint"] },
  { key: "surfaceTexture", label: "Surface Texture", section: "VISUAL", path: ["surfaceTexture"] },
  { key: "sheenOrLuster", label: "Sheen / Luster", section: "VISUAL", path: ["sheenOrLuster"] },
  { key: "transparencyLevel", label: "Transparency / Opacity", section: "VISUAL", path: ["transparencyLevel"] },

  { key: "estimatedStretch", label: "Estimated Stretch", section: "PERFORMANCE", path: ["estimatedStretch"] },
  { key: "estimatedDrape", label: "Estimated Drape", section: "PERFORMANCE", path: ["estimatedDrape"] },
  { key: "estimatedRecovery", label: "Estimated Recovery", section: "PERFORMANCE", path: ["estimatedRecovery"] },
];

export function getFabricFeatureDef(featureKey: string): FabricFeatureDef | undefined {
  return FABRIC_FEATURE_REGISTRY.find((f) => f.key === featureKey);
}

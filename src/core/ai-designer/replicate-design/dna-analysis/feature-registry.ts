/**
 * Client-safe display labels for each Design DNA feature — zero Prisma
 * imports, so both server code and the DesignDnaReviewPanel client
 * component can import this same file. Mirrors the established
 * feature-registry.ts convention already used by AI Garment Flow's own
 * reference-analysis/design-variation modules.
 */
import { FEATURE_KEYS, type FeatureKey } from "./schema";

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  garmentCategory: "Garment Category",
  silhouette: "Silhouette",
  garmentLength: "Garment Length",
  fit: "Fit",
  neckline: "Neckline",
  collar: "Collar",
  sleeveType: "Sleeve Type",
  sleeveLength: "Sleeve Length",
  shoulderConstruction: "Shoulder Construction",
  closureType: "Closure / Opening",
  panelsAndSeams: "Panels & Seams",
  waistTreatment: "Waist Treatment",
  hemFinish: "Hem Finish",
  keyConstructionDetails: "Key Construction Details",
};

export { FEATURE_KEYS };
export type { FeatureKey };

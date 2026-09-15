/**
 * The fixed feature picklist for AI Garment Flow Process 4 (Controlled
 * Design Variation). Zero Prisma imports so both the server (prompt
 * building) and the client (the "Feature to Change" dropdown) import this
 * same file — a label never has to be duplicated, matching the established
 * reference-analysis/feature-registry.ts precedent.
 */

export const DESIGN_FEATURE_VALUES = [
  "NECKLINE",
  "COLLAR",
  "SLEEVE",
  "SLEEVE_LENGTH",
  "CUFF",
  "GARMENT_LENGTH",
  "FIT",
  "SILHOUETTE",
  "POCKET",
  "CLOSURE",
  "WAIST",
  "HEM",
  "COLOR",
  "BUTTONS",
  "BACKGROUND_ENVIRONMENT",
  "MODEL",
  "LOGO",
  "EMBROIDERY",
  "OTHER",
] as const;

export type DesignFeature = (typeof DESIGN_FEATURE_VALUES)[number];

export const DESIGN_FEATURE_LABELS: Record<DesignFeature, string> = {
  NECKLINE: "Neckline",
  COLLAR: "Collar",
  SLEEVE: "Sleeve",
  SLEEVE_LENGTH: "Sleeve Length",
  CUFF: "Cuff",
  GARMENT_LENGTH: "Garment Length",
  FIT: "Fit",
  SILHOUETTE: "Silhouette",
  POCKET: "Pocket",
  CLOSURE: "Closure",
  WAIST: "Waist",
  HEM: "Hem",
  COLOR: "Color",
  BUTTONS: "Buttons",
  BACKGROUND_ENVIRONMENT: "Background / Environment",
  MODEL: "Model",
  LOGO: "Add Logo",
  EMBROIDERY: "Add Embroidery",
  OTHER: "Other",
};

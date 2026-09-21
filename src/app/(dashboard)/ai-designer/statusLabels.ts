export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export const WIZARD_STEP_LABELS: Record<string, string> = {
  UPLOAD_SKETCH: "Upload Sketch",
  SKETCH_ANALYSIS: "Sketch Analysis",
  FABRIC_SELECTION: "Fabric Selection",
  FABRIC_ANALYSIS: "Analyze Fabric",
  TARGET_CUSTOMER: "Target Customer",
  AGE_GROUP: "Age Group",
  PRODUCT_CATEGORY: "Product Category",
  PRODUCT_DESIGN: "Product Design",
  MODEL: "Model",
  ENVIRONMENT: "Environment",
  GENERATE: "Generate Design",
  MULTI_FABRIC: "Multi-Fabric",
  EMBELLISHMENTS: "Embellishments",
  EDIT: "Edit Design",
  TECH_PACK: "Tech Pack",
  EXPORT: "Export",
};

// Mirrors ai-designer.service.ts's own STANDARD_STEPS exactly (a
// duplicated, client-safe copy, same convention as every other
// client/server pair in this app — this file has zero Prisma imports).
export const WIZARD_STEP_ORDER = [
  "FABRIC_SELECTION",
  "FABRIC_ANALYSIS",
  "TARGET_CUSTOMER",
  "AGE_GROUP",
  "PRODUCT_CATEGORY",
  "PRODUCT_DESIGN",
  "MODEL",
  "ENVIRONMENT",
  "GENERATE",
  "MULTI_FABRIC",
  "EMBELLISHMENTS",
  "EDIT",
  "TECH_PACK",
  "EXPORT",
] as const;

const SKETCH_ONLY_STEPS = ["UPLOAD_SKETCH", "SKETCH_ANALYSIS"] as const;

/**
 * Mirrors ai-designer.service.ts's own stepsForCreationMode() exactly — a
 * SKETCH-mode project's wizard adds two steps (Upload Sketch, Sketch
 * Analysis) before every other step, which is reused completely unchanged
 * for either mode.
 */
export function stepsForCreationMode(mode: "STANDARD" | "SKETCH"): readonly string[] {
  return mode === "SKETCH" ? [...SKETCH_ONLY_STEPS, ...WIZARD_STEP_ORDER] : WIZARD_STEP_ORDER;
}

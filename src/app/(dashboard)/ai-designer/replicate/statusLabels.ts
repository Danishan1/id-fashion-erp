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

export const STEP_LABELS: Record<string, string> = {
  REFERENCE_UPLOAD: "Upload Reference Garment",
  DNA_ANALYSIS: "AI Design DNA Analysis",
  DESIGN_LOCK_REVIEW: "Design Lock Review",
  FABRIC_MATERIAL_SELECTION: "Fabric & Material Selection",
  COMPATIBILITY_CHECK: "Compatibility Check",
  GENERATE: "Generate Design",
  EDIT: "Edit Design",
  TECH_PACK: "Tech Pack",
};

// Mirrors replicate-design.service.ts's own REPLICATE_STEP_ORDER exactly — a
// duplicated, client-safe copy, same convention already used by the sibling
// AI Designer wizard's own statusLabels.ts (this file has zero Prisma
// imports, so it's safe for a Client Component to import directly).
export const STEP_ORDER = [
  "REFERENCE_UPLOAD",
  "DNA_ANALYSIS",
  "DESIGN_LOCK_REVIEW",
  "FABRIC_MATERIAL_SELECTION",
  "COMPATIBILITY_CHECK",
  "GENERATE",
  "EDIT",
  "TECH_PACK",
] as const;

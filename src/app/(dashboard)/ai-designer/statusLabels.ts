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
  FABRIC_SELECTION: "Fabric Selection",
  FABRIC_ANALYSIS: "Analyze Fabric",
  TARGET_CUSTOMER: "Target Customer",
  AGE_GROUP: "Age Group",
  PRODUCT_CATEGORY: "Product Category",
  PRODUCT_DESIGN: "Product Design",
  MODEL: "Model",
  ENVIRONMENT: "Environment",
  GENERATE: "Generate Design",
  EDIT: "Edit Design",
  EXPORT: "Export",
};

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
  "EDIT",
  "EXPORT",
] as const;

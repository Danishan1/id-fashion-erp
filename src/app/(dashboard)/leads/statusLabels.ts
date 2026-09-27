// Lead stages and sources are company-configurable masters (CRM Settings) —
// their labels come from the API, not from here. Only the fixed enums live here.

export const QUALITY_LABELS = {
  COLD: "Cold",
  WARM: "Warm",
  HOT: "Hot",
} as const;

export const QUALITY_BADGE_CLASS: Record<keyof typeof QUALITY_LABELS, string> = {
  HOT: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  WARM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  COLD: "bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
};

export const LEAD_PRIORITY_LABELS = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
} as const;

export const LEAD_PRIORITY_BADGE_CLASS: Record<keyof typeof LEAD_PRIORITY_LABELS, string> = {
  URGENT: "bg-red-600 text-white",
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  LOW: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

export const BUSINESS_TYPE_LABELS = {
  BRAND: "Brand",
  RETAILER: "Retailer",
  WHOLESALER: "Wholesaler",
  IMPORTER: "Importer",
  BUYING_HOUSE: "Buying House",
  BUYING_AGENT: "Buying Agent",
  DESIGNER: "Designer",
  ECOMMERCE_BRAND: "E-commerce Brand",
  DEPARTMENT_STORE: "Department Store",
  DISTRIBUTOR: "Distributor",
  MANUFACTURER: "Manufacturer",
  OTHER: "Other",
} as const;

export type StageKind = "OPEN" | "WON" | "LOST" | "DORMANT";

export const STAGE_KIND_BADGE_CLASS: Record<StageKind, string> = {
  OPEN: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  WON: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  LOST: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  DORMANT: "bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
};

export const REQUEST_TYPE_LABELS = {
  PRODUCTION_REQUIREMENT: "Production Requirement",
  DAMAGE_REPLACEMENT: "Damage Replacement",
} as const;

export const REQUEST_TYPE_BADGE_CLASS: Record<keyof typeof REQUEST_TYPE_LABELS, string> = {
  PRODUCTION_REQUIREMENT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  DAMAGE_REPLACEMENT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};

export const REQUEST_TYPE_LABELS = {
  PRODUCTION_REQUIREMENT: "Production Requirement",
  DAMAGE_REPLACEMENT: "Damage Replacement",
  // Was missing here despite existing on the Prisma MaterialRequestType enum
  // since the module's own build (a pre-existing gap this pass needed to
  // close to compare against it for the "Issue Extra" override, 2026-09-15).
  SAMPLING_REQUIREMENT: "Sampling Requirement",
} as const;

export const REQUEST_TYPE_BADGE_CLASS: Record<keyof typeof REQUEST_TYPE_LABELS, string> = {
  PRODUCTION_REQUIREMENT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  DAMAGE_REPLACEMENT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  SAMPLING_REQUIREMENT: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
};

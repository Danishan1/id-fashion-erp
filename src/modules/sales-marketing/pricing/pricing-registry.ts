/**
 * Labels and helpers for pricing (Phase 03). Client-safe (no Prisma).
 */

export const PRICE_LIST_KINDS = { DEFAULT: "Default", CUSTOMER: "Customer" } as const;
export type PriceListKindKey = keyof typeof PRICE_LIST_KINDS;

export const PRICE_LIST_VERSION_STATUSES = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  WITHDRAWN: "Withdrawn",
} as const;
export type PriceListVersionStatusKey = keyof typeof PRICE_LIST_VERSION_STATUSES;

export const DISCOUNT_RULE_STATUSES = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
} as const;
export type DiscountRuleStatusKey = keyof typeof DISCOUNT_RULE_STATUSES;

export const DISCOUNT_RULE_TYPES = { PERCENT: "% off", AMOUNT_PER_UNIT: "₹ off per unit" } as const;
export const DISCOUNT_STACKING = { EXCLUSIVE: "Exclusive (best one wins)", STACKABLE: "Stackable (combined)" } as const;

export const PRICING_EVENT_TYPES = {
  CREATED: "Created",
  UPDATED: "Saved",
  VERSION_CREATED: "New version started",
  SUBMITTED: "Submitted for approval",
  RETURNED_TO_DRAFT: "Returned to draft",
  APPROVED: "Approved",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  DISCARDED: "Draft discarded",
  DEACTIVATED: "Deactivated",
  REACTIVATED: "Reactivated",
} as const;
export type PricingEventType = keyof typeof PRICING_EVENT_TYPES;

/** Where an approved version stands on `today` (derived, never stored). */
export type VersionTiming = "IN_FORCE" | "SCHEDULED" | "SUPERSEDED" | "ENDED";

export function versionTimings(versions: { id: string; status: string; effectiveFrom: string; effectiveTo: string | null; versionNumber: number }[], today: string): Record<string, VersionTiming> {
  const approved = versions.filter((v) => v.status === "APPROVED");
  const current = approved
    .filter((v) => v.effectiveFrom <= today)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.versionNumber - a.versionNumber))[0];
  const out: Record<string, VersionTiming> = {};
  for (const v of approved) {
    if (v.effectiveFrom > today) out[v.id] = "SCHEDULED";
    else if (current && v.id === current.id) out[v.id] = v.effectiveTo && v.effectiveTo < today ? "ENDED" : "IN_FORCE";
    else out[v.id] = "SUPERSEDED";
  }
  return out;
}

export const VERSION_TIMING_LABELS: Record<VersionTiming, string> = {
  IN_FORCE: "In force",
  SCHEDULED: "Scheduled",
  SUPERSEDED: "Superseded",
  ENDED: "Ended",
};

export const PRICE_SOURCE_LABELS = { PRICE_LIST: "Price list", MANUAL: "Manual", OVERRIDE: "Override" } as const;

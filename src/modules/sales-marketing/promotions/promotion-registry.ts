import { z } from "zod";

/**
 * Sales & Marketing Phase 12 — promotions registry (client-safe).
 * A promotion = header (code, how it applies, on / paused / archived) +
 * versions with the commercial terms. Only approved, immutable versions are
 * ever priced; pricing itself is the Phase 03 engine (no second engine).
 */

export const PROMOTION_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc", help: "Not approved yet — never applied." },
  ACTIVE: { label: "On", tone: "green", help: "Applied while its approved version is valid on the quotation date." },
  PAUSED: { label: "Paused", tone: "amber", help: "Not applied to new prices. Issued quotations keep their prices." },
  ARCHIVED: { label: "Archived", tone: "zinc", help: "Retired. History and used prices are kept." },
} as const;
export type PromotionStatus = keyof typeof PROMOTION_STATUSES;

/** What the list shows: the stored status refined by the approved version's dates on a given day. */
export type PromotionDisplayStatus = PromotionStatus | "SCHEDULED" | "EXPIRED";
export function displayStatus(status: string, approved: { validFrom: string; validTo: string | null } | null, today: string): PromotionDisplayStatus {
  if (status !== "ACTIVE" || !approved) return status as PromotionStatus;
  if (approved.validFrom > today) return "SCHEDULED";
  if (approved.validTo && approved.validTo < today) return "EXPIRED";
  return "ACTIVE";
}
export const DISPLAY_LABELS: Record<PromotionDisplayStatus, { label: string; tone: "zinc" | "green" | "amber" | "indigo" | "red" }> = {
  DRAFT: { label: "Draft", tone: "zinc" },
  ACTIVE: { label: "Running", tone: "green" },
  SCHEDULED: { label: "Scheduled", tone: "indigo" },
  EXPIRED: { label: "Expired", tone: "zinc" },
  PAUSED: { label: "Paused", tone: "amber" },
  ARCHIVED: { label: "Archived", tone: "zinc" },
};

export const VERSION_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "amber" },
  APPROVED: { label: "Approved — in use", tone: "green" },
  SUPERSEDED: { label: "Superseded", tone: "zinc" },
  REJECTED: { label: "Rejected", tone: "red" },
} as const;
export type PromotionVersionStatus = keyof typeof VERSION_STATUSES;

export const APPLY_MODES = {
  AUTO: { label: "Automatic", help: "Applied to every eligible quotation line." },
  CODE: { label: "With a code", help: "Applied only when its code is entered on the quotation." },
} as const;
export type ApplyMode = keyof typeof APPLY_MODES;

export const DISCOUNT_TYPES = { PERCENT: "% off", AMOUNT_PER_UNIT: "₹ off per base unit" } as const;
export const STACKING = {
  EXCLUSIVE: "Exclusive — the single best discount wins (never combined)",
  STACKABLE: "Stackable — combined with other stackable rules and promotions",
} as const;

export const REDEMPTION_STATUSES = {
  RESERVED: { label: "Reserved", help: "On an issued quotation; counts towards limits until it expires or is released." },
  REDEEMED: { label: "Used", help: "The quotation became a Sales Order." },
  RELEASED: { label: "Released", help: "Rejected, cancelled, revised, expired or the order was cancelled — no longer counts." },
} as const;

/** Header lifecycle actions (versions have their own). */
export const PROMOTION_ACTIONS = {
  activate: { from: ["DRAFT", "PAUSED"], to: "ACTIVE", label: "Switch on" },
  pause: { from: ["ACTIVE"], to: "PAUSED", label: "Pause" },
  archive: { from: ["DRAFT", "ACTIVE", "PAUSED"], to: "ARCHIVED", label: "Archive" },
} as const satisfies Record<string, { from: readonly PromotionStatus[]; to: PromotionStatus; label: string }>;
export type PromotionAction = keyof typeof PROMOTION_ACTIONS;
export const canPromotionMove = (status: string, action: PromotionAction) => (PROMOTION_ACTIONS[action].from as readonly string[]).includes(status);

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,29}$/;
export const MAX_CODES_PER_QUOTATION = 5;
export const MAX_LIST_IDS = 200;

// ── Schemas ────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const ids = z.array(z.string().uuid()).max(MAX_LIST_IDS).default([]).transform((a) => [...new Set(a)]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optNum = (min: number, max: number) => z.union([z.literal(""), z.null(), z.coerce.number().min(min).max(max)]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const optInt = (max: number) => z.union([z.literal(""), z.null(), z.coerce.number().int().min(1).max(max)]).optional().transform((v) => (v === "" || v === undefined ? null : v));

export const promotionCodeSchema = z.string().trim().toUpperCase().regex(CODE_RE, "3–30 letters, digits, - or _ (starting with a letter or digit)");

export const promotionHeaderSchema = z
  .object({
    name: text(150).min(1, "Enter a name"),
    description: text(2000).optional().nullable(),
    objective: text(300).optional().nullable(),
    ownerUserId: z.string().uuid().optional(),
  })
  .strict();

/** The commercial terms of a version (validated again on the server against the company's data). */
export const promotionTermsSchema = z
  .object({
    validFrom: isoDate,
    validTo: isoDate.nullable().optional(),
    discountType: z.enum(["PERCENT", "AMOUNT_PER_UNIT"]),
    value: z.coerce.number().positive("Enter a discount above 0").max(1_000_000),
    stacking: z.enum(["EXCLUSIVE", "STACKABLE"]),
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
    productIds: ids,
    categoryIds: ids,
    excludedProductIds: ids,
    customerIds: ids,
    priceListIds: ids,
    salesChannelIds: ids,
    campaignIds: ids,
    segmentEvaluationId: z.string().uuid().nullable().optional(),
    minQuantity: optNum(0.001, 1_000_000_000),
    minLineValue: optNum(0.01, 100_000_000_000),
    maxRedemptions: optInt(10_000_000),
    maxRedemptionsPerCustomer: optInt(1_000_000),
    changeNote: text(300).optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.discountType === "PERCENT" && v.value > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "At most 100%" });
    if (v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "Ends before it starts" });
    if (v.maxRedemptions && v.maxRedemptionsPerCustomer && v.maxRedemptionsPerCustomer > v.maxRedemptions) ctx.addIssue({ code: "custom", path: ["maxRedemptionsPerCustomer"], message: "More than the total limit" });
    const both = v.productIds.filter((p) => v.excludedProductIds.includes(p));
    if (both.length) ctx.addIssue({ code: "custom", path: ["excludedProductIds"], message: "A Style can't be both included and excluded" });
  });
export type PromotionTerms = z.infer<typeof promotionTermsSchema>;

export const promotionCreateSchema = promotionHeaderSchema.extend({ code: promotionCodeSchema, applyMode: z.enum(["AUTO", "CODE"]), terms: promotionTermsSchema }).strict();

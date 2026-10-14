import { z } from "zod";
import { BILLING_CYCLES } from "./subscription.schema";

/** Platform SaaS Phase 5 (PLAT-026/027): coupons (= offers). */

export const COUPON_DISCOUNT_TYPES = ["PERCENT", "FIXED_AMOUNT", "FREE_MONTHS", "TRIAL_EXTENSION"] as const;
export type CouponDiscountTypeValue = (typeof COUPON_DISCOUNT_TYPES)[number];

export const COUPON_DISCOUNT_TYPE_LABELS: Record<CouponDiscountTypeValue, string> = {
  PERCENT: "Percentage off",
  FIXED_AMOUNT: "Fixed amount off",
  FREE_MONTHS: "Free extra months",
  TRIAL_EXTENSION: "Longer free trial",
};

const optionalDate = z
  .union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date")])
  .optional()
  .transform((v) => (v ? v : null));

const optionalPositiveInt = z
  .union([z.literal(""), z.null(), z.coerce.number().int().min(1, "Must be at least 1")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "Code must be at least 3 characters")
      .max(40)
      .regex(/^[A-Z0-9_-]+$/i, "Use letters, numbers, - and _ only")
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(1, "Name is required").max(100),
    description: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null),
    discountType: z.enum(COUPON_DISCOUNT_TYPES),
    discountValue: z.coerce.number().positive("Value must be more than 0"),
    currencyCode: z.string().trim().length(3).default("INR").transform((v) => v.toUpperCase()),
    validFrom: optionalDate,
    validUntil: optionalDate,
    maxRedemptions: optionalPositiveInt,
    maxRedemptionsPerCompany: z.coerce.number().int().min(1, "Must be at least 1").default(1),
    billingCycles: z.array(z.enum(BILLING_CYCLES)).default([]),
    planIds: z.array(z.string().uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.discountType === "PERCENT" && v.discountValue > 100) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "A percentage can't be more than 100" });
    }
    if ((v.discountType === "FREE_MONTHS" || v.discountType === "TRIAL_EXTENSION") && !Number.isInteger(v.discountValue)) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Use a whole number" });
    }
    if (v.discountType === "FREE_MONTHS" && v.discountValue > 36) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "At most 36 free months" });
    }
    if (v.discountType === "TRIAL_EXTENSION" && v.discountValue > 365) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: "At most 365 extra trial days" });
    }
    if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Must be on or after the start date" });
    }
  });
export type CouponInput = z.infer<typeof couponSchema>;

/** Preview of a payment coupon before the payment is saved. */
export const couponPreviewSchema = z.object({
  code: z.string().trim().min(1, "Enter a coupon code"),
  companyId: z.string().uuid(),
  planId: z.string().uuid("Select a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
  amount: z.coerce.number().min(0),
});
export type CouponPreviewInput = z.infer<typeof couponPreviewSchema>;

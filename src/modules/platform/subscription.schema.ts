import { z } from "zod";
import { ENTITLEMENT_PACKAGE_KEYS } from "@/config/module-entitlements";

/** Platform SaaS Phase 4 (PLAT-021/022): plan catalog + manual subscription management. */

// "" and null must be tried before coerce, which would turn "" into 0.
const optionalPrice = z
  .union([z.literal(""), z.null(), z.coerce.number().min(0, "Price can't be negative")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const optionalMaxUsers = z
  .union([z.literal(""), z.null(), z.coerce.number().int().min(1, "Max users must be at least 1")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const subscriptionPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
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
  monthlyPrice: optionalPrice,
  annualPrice: optionalPrice,
  currencyCode: z.string().trim().length(3).default("INR").transform((v) => v.toUpperCase()),
  trialDays: z.coerce.number().int().min(0).max(365).default(14),
  maxUsers: optionalMaxUsers,
  isActive: z.boolean().default(true),
  isDefaultTrialPlan: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  modules: z.array(z.enum(ENTITLEMENT_PACKAGE_KEYS as [string, ...string[]])).default([]),
});
export type SubscriptionPlanInput = z.infer<typeof subscriptionPlanSchema>;

export const BILLING_CYCLES = ["MONTHLY", "ANNUAL"] as const;
export const PAYMENT_METHODS = ["BANK_TRANSFER", "CHEQUE", "UPI", "CASH", "CARD", "OTHER"] as const;

export const changePlanSchema = z.object({
  planId: z.string().uuid("Select a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const recordPaymentSchema = z.object({
  planId: z.string().uuid("Select a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
  periods: z.coerce.number().int().min(1).max(36).default(1),
  amount: z.coerce.number().min(0, "Amount can't be negative"),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date"),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200).optional().transform((v) => v || null),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
  // Phase 5: optional coupon. `amount` is the price before the discount.
  couponCode: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

/** Manual correction of the period end: extend a trial, grant time, or remove the expiry. */
export const adjustPeriodSchema = z
  .object({
    noExpiry: z.boolean().default(false),
    periodEndsAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
      .optional(),
    isTrial: z.boolean().optional(),
    reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500),
  })
  .refine((v) => v.noExpiry || !!v.periodEndsAt, { message: "Pick an end date or choose no expiry", path: ["periodEndsAt"] });
export type AdjustPeriodInput = z.infer<typeof adjustPeriodSchema>;

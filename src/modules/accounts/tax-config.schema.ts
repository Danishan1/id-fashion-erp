import { z } from "zod";

export const taxTypeSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
});

export type TaxTypeInput = z.infer<typeof taxTypeSchema>;

export const taxTypeStatusSchema = z.object({ isActive: z.boolean() });

export const taxRateSchema = z.object({
  taxTypeId: z.string().uuid("Tax type is required"),
  name: z.string().min(1, "Name is required").max(200),
  ratePercentage: z.coerce.number().min(0, "Rate cannot be negative").max(100, "Rate cannot exceed 100%"),
  effectiveFrom: z.string().min(1, "Effective-from date is required"),
  effectiveTo: z.string().optional().or(z.literal("")),
});

export type TaxRateInput = z.infer<typeof taxRateSchema>;

export const taxRateStatusSchema = z.object({ isActive: z.boolean() });

import { z } from "zod";
import { ENTITLEMENT_PACKAGE_KEYS } from "@/config/module-entitlements";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null));

export const updateCompanyDetailsSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200),
  legalName: optionalText(200),
  taxRegistrationNo: optionalText(100),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
});
export type UpdateCompanyDetailsInput = z.infer<typeof updateCompanyDetailsSchema>;

export const suspendCompanySchema = z.object({
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(1000),
});

export const setModuleEntitlementSchema = z.object({
  packageKey: z.enum(ENTITLEMENT_PACKAGE_KEYS as [string, ...string[]]),
  isEnabled: z.boolean(),
});

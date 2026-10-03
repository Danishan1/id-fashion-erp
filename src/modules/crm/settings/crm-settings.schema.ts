import { z } from "zod";
import { LEAD_STATUS_COLORS } from "./crm-defaults";

const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, numbers and underscores, starting with a letter.");

export const createLeadStatusSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  key: keySchema.optional(),
  kind: z.enum(["OPEN", "CONVERTED", "LOST"]).default("OPEN"),
  color: z.enum(LEAD_STATUS_COLORS).default("neutral"),
});
export const updateLeadStatusSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(["OPEN", "CONVERTED", "LOST"]).optional(),
  color: z.enum(LEAD_STATUS_COLORS).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
});
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });

export const createLeadSourceSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  key: keySchema.optional(),
});
export const updateLeadSourceSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});

export const leadDuplicateRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        rule: z.enum(["EMAIL", "PHONE", "COMPANY_AND_EMAIL", "COMPANY_AND_PHONE"]),
        action: z.enum(["WARN", "BLOCK", "OFF"]),
      })
    )
    .min(1),
});

export const contactDuplicateRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        rule: z.enum(["EMAIL", "PHONE", "MOBILE", "WHATSAPP", "NAME_AND_COMPANY", "NAME_AND_EMAIL"]),
        action: z.enum(["WARN", "BLOCK", "FLAG", "OFF"]),
      })
    )
    .min(1),
});

export const createOptionValueSchema = z.object({
  listKey: z.enum(["contact_department", "contact_designation", "contact_role"]),
  value: z.string().trim().min(1, "Value is required").max(100),
});
export const updateOptionValueSchema = z.object({
  value: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

/** "Hot Lead!" → "hot_lead" */
export function keyFromName(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(k) ? k : `x_${k}`.slice(0, 40);
}

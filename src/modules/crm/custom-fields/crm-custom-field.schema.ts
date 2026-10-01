import { z } from "zod";
import { CRM_CUSTOM_FIELD_TYPES } from "./crm-custom-field-types";

const optionSchema = z.object({ value: z.string().trim().min(1).max(100), label: z.string().trim().min(1).max(100) });

export const createCustomFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Label is required").max(80),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,49}$/, "Key: lowercase letters, numbers and underscores, starting with a letter.")
      .optional(),
    fieldType: z.enum(CRM_CUSTOM_FIELD_TYPES as [string, ...string[]]),
    description: z.string().trim().max(300).optional().or(z.literal("")),
    options: z.array(optionSchema).max(200).optional(),
    isRequired: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const needsOptions = v.fieldType === "DROPDOWN" || v.fieldType === "MULTI_SELECT";
    if (needsOptions && (!v.options || v.options.length === 0)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least one option." });
    }
    if (v.options && new Set(v.options.map((o) => o.value)).size !== v.options.length) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Option values must be unique." });
    }
  });

/** Key and type are fixed once created — changing them would corrupt stored values. */
export const updateCustomFieldSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(300).optional().or(z.literal("")),
    options: z.array(optionSchema).max(200).optional(),
    isRequired: z.boolean().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict()
  .refine((v) => !v.options || new Set(v.options.map((o) => o.value)).size === v.options.length, {
    message: "Option values must be unique.",
    path: ["options"],
  });

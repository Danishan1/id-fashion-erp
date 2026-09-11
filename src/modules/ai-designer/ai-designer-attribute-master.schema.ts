import { z } from "zod";

/**
 * Masters -> AI Design -> Product Design. Options are a plain ordered list
 * of short strings, entered/edited as one field — matches the original
 * hardcoded `DesignAttributeDef.options` shape exactly (see
 * design-attribute-catalog.ts), just now DB-backed and admin-editable.
 */
export const createProductDesignAttributeSchema = z.object({
  categoryName: z.string().trim().min(1, "Category is required").max(100),
  attributeKey: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(50)
    .regex(/^[a-zA-Z][a-zA-Z0-9]*$/, "Key must be a single camelCase word, e.g. \"neckline\""),
  attributeLabel: z.string().trim().min(1, "Label is required").max(100),
  options: z.array(z.string().trim().min(1)).min(1, "At least one option is required"),
  sortOrder: z.number().int().default(0),
});
export type CreateProductDesignAttributeInput = z.infer<typeof createProductDesignAttributeSchema>;

export const updateProductDesignAttributeSchema = z.object({
  attributeLabel: z.string().trim().min(1).max(100).optional(),
  options: z.array(z.string().trim().min(1)).min(1).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateProductDesignAttributeInput = z.infer<typeof updateProductDesignAttributeSchema>;

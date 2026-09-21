import { z } from "zod";
import {
  TARGET_CUSTOMER_VALUES,
  isValidAgeGroup,
  isValidProductCategory,
  type TargetCustomer,
} from "@/core/ai-designer/catalogs/customer-catalog";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";

/**
 * One suggested garment for one customer segment. Every value the AI
 * returns here must be one of the real catalog values already used
 * throughout this module (productCategory/ageGroup per TargetCustomer,
 * environmentKey from the fixed environment list) — never a value the AI
 * invented — enforced below in validateProductSuggestionsResponse(), the
 * same "positional zip-back + real catalog validation" discipline already
 * proven for Replicate Design's Compatibility Check this session.
 */
const suggestionItemSchema = z.object({
  productCategory: z.string().min(1),
  priorityRank: z.number().int().min(1),
  ageGroup: z.string().min(1),
  environmentKey: z.string().min(1),
  reasoning: z.string().min(1),
});

const suggestionGroupSchema = z.object({
  targetCustomer: z.enum(TARGET_CUSTOMER_VALUES),
  items: z.array(suggestionItemSchema).min(1).max(5),
});

export const productSuggestionsResponseSchema = z
  .object({
    groups: z.array(suggestionGroupSchema).min(1).max(6),
    overallSummary: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    for (const [groupIndex, group] of data.groups.entries()) {
      const customer = group.targetCustomer as TargetCustomer;
      for (const [itemIndex, item] of group.items.entries()) {
        if (!isValidProductCategory(customer, item.productCategory)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groups", groupIndex, "items", itemIndex, "productCategory"],
            message: `"${item.productCategory}" is not a real product category for ${customer} — use one of the exact category names given for this customer.`,
          });
        }
        if (!isValidAgeGroup(customer, item.ageGroup)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groups", groupIndex, "items", itemIndex, "ageGroup"],
            message: `"${item.ageGroup}" is not a real age group for ${customer} — use one of the exact age groups given for this customer.`,
          });
        }
        if (!getEnvironmentByKey(item.environmentKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["groups", groupIndex, "items", itemIndex, "environmentKey"],
            message: `"${item.environmentKey}" is not one of the exact allowed environment keys.`,
          });
        }
      }
    }
  });

export type ProductSuggestionsResponse = z.infer<typeof productSuggestionsResponseSchema>;

export function validateProductSuggestionsResponse(
  input: unknown
): { success: true; data: ProductSuggestionsResponse } | { success: false; error: string } {
  const result = productSuggestionsResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

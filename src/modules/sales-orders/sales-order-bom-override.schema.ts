import { z } from "zod";

export const SALES_ORDER_BOM_OVERRIDE_REASONS = [
  "CUSTOMER_REQUIREMENT",
  "BUYER_APPROVAL",
  "SPECIFICATION_CHANGE",
  "QUALITY_REQUIREMENT",
  "OTHER",
] as const;

/**
 * One row per changed BOM line, per the model's own nullable-pair shape:
 *   originalMaterialId null                    -> pure addition
 *   effectiveMaterialId null                   -> removal
 *   both set, different materialId              -> replace
 *   both set, same materialId                   -> quantity/wastage/uom-only
 * At least one of the two must be set (a "do nothing" override is rejected
 * outright); Add/Replace additionally requires a real quantity + unit, since
 * the Effective BOM resolver has nothing to fall back to for a genuinely new
 * material line.
 */
export const proposeSalesOrderBomOverrideSchema = z
  .object({
    originalMaterialId: z.string().uuid().nullable().default(null),
    effectiveMaterialId: z.string().uuid().nullable().default(null),
    effectiveQuantityPerUnit: z.number().positive().nullable().default(null),
    wastagePercentage: z.number().min(0).max(100).nullable().default(null),
    colorId: z.string().uuid().nullable().default(null),
    uomId: z.string().uuid().nullable().default(null),
    reason: z.enum(SALES_ORDER_BOM_OVERRIDE_REASONS).default("OTHER"),
    remarks: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((data) => data.originalMaterialId !== null || data.effectiveMaterialId !== null, {
    message:
      "An override must either target an existing material (originalMaterialId, to replace/remove/adjust it) or add a new one (effectiveMaterialId) — at least one is required.",
    path: ["originalMaterialId"],
  })
  .refine(
    (data) => {
      const isAddOrReplace = data.effectiveMaterialId !== null && data.effectiveMaterialId !== data.originalMaterialId;
      if (!isAddOrReplace) return true;
      return data.effectiveQuantityPerUnit !== null && data.uomId !== null;
    },
    {
      message: "Adding a new material or replacing one with a different material requires both a quantity per unit and a unit of measure.",
      path: ["effectiveQuantityPerUnit"],
    }
  );

export type ProposeSalesOrderBomOverrideInput = z.infer<typeof proposeSalesOrderBomOverrideSchema>;

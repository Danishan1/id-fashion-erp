import { z } from "zod";

export const bomItemSchema = z.object({
  materialId: z.string().uuid("Material is required"),
  colorId: z.string().uuid().optional().or(z.literal("")),
  quantityPerUnit: z.coerce.number().positive("Quantity per unit must be greater than 0"),
  wastagePercentage: z.coerce.number().min(0).max(100).default(0),
  uomId: z.string().uuid("Unit is required"),
  notes: z.string().max(500).optional().or(z.literal("")),
});
export type BomItemInput = z.infer<typeof bomItemSchema>;

export const bomSchema = z.object({
  notes: z.string().max(500).optional().or(z.literal("")),
  items: z.array(bomItemSchema),
});
export type BomInput = z.infer<typeof bomSchema>;

import { z } from "zod";

export const MATERIAL_CATEGORIES = [
  "FABRIC",
  "TRIMS",
  "ZIPS",
  "BUTTONS",
  "ACCESSORIES",
  "PACKAGING",
  "OTHER",
] as const;

export const productSchema = z.object({
  styleCode: z.string().min(1, "Style code is required").max(30),
  styleName: z.string().min(1, "Style name is required").max(200),
  designNumber: z.string().max(50).optional().or(z.literal("")),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  gender: z.string().max(30).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  hsnSacCode: z.string().max(30).optional().or(z.literal("")),
  customerId: z.string().uuid().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const materialSchema = z.object({
  styleCode: z.string().min(1, "Item code is required").max(30),
  styleName: z.string().min(1, "Name is required").max(200),
  materialCategory: z.enum(MATERIAL_CATEGORIES),
  baseUomId: z.string().uuid().optional().or(z.literal("")),
  defaultSupplierId: z.string().uuid().optional().or(z.literal("")),
  reorderLevel: z.coerce.number().min(0).optional(),
  unitCost: z.coerce.number().min(0).optional(),
  description: z.string().max(1000).optional().or(z.literal("")),
  hsnSacCode: z.string().max(30).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export type MaterialInput = z.infer<typeof materialSchema>;

export const generateVariantsSchema = z.object({
  colorIds: z.array(z.string().uuid()).min(1, "Select at least one color"),
  sizeIds: z.array(z.string().uuid()).min(1, "Select at least one size"),
});
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>;

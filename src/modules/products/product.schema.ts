import { z } from "zod";

export const productSchema = z.object({
  styleCode: z.string().min(1, "Style code is required").max(30),
  styleName: z.string().min(1, "Style name is required").max(200),
  category: z.string().max(100).optional().or(z.literal("")),
  season: z.string().max(50).optional().or(z.literal("")),
  gender: z.string().max(30).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  hsnSacCode: z.string().max(30).optional().or(z.literal("")),
  customerId: z.string().uuid().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const generateVariantsSchema = z.object({
  colorIds: z.array(z.string().uuid()).min(1, "Select at least one color"),
  sizeIds: z.array(z.string().uuid()).min(1, "Select at least one size"),
});
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>;

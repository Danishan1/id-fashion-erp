import { z } from "zod";

const codeNameSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  isActive: z.coerce.boolean().default(true),
});

export const brandSchema = codeNameSchema;
export type BrandInput = z.infer<typeof brandSchema>;

export const categorySchema = codeNameSchema;
export type CategoryInput = z.infer<typeof categorySchema>;

export const seasonSchema = codeNameSchema;
export type SeasonInput = z.infer<typeof seasonSchema>;

export const productFittingSchema = codeNameSchema;
export type ProductFittingInput = z.infer<typeof productFittingSchema>;

export const productTypeSchema = codeNameSchema;
export type ProductTypeInput = z.infer<typeof productTypeSchema>;

export const designSchema = codeNameSchema;
export type DesignInput = z.infer<typeof designSchema>;

export const designPatternSchema = codeNameSchema;
export type DesignPatternInput = z.infer<typeof designPatternSchema>;

export const patternSchema = codeNameSchema;
export type PatternInput = z.infer<typeof patternSchema>;

import { z } from "zod";

export const colorSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  hexValue: z.string().max(10).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});
export type ColorInput = z.infer<typeof colorSchema>;

export const sizeSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.coerce.boolean().default(true),
});
export type SizeInput = z.infer<typeof sizeSchema>;

export const unitSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  conversionFactor: z.coerce.number().positive().default(1),
});
export type UnitInput = z.infer<typeof unitSchema>;

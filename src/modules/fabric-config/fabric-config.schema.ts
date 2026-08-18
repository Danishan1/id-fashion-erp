import { z } from "zod";

export const fabricGsmSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  isActive: z.coerce.boolean().default(true),
});
export type FabricGsmInput = z.infer<typeof fabricGsmSchema>;

export const fabricDyeSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  pantone: z.string().max(30).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});
export type FabricDyeInput = z.infer<typeof fabricDyeSchema>;

export const fabricWeaveTypeSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  isActive: z.coerce.boolean().default(true),
});
export type FabricWeaveTypeInput = z.infer<typeof fabricWeaveTypeSchema>;

export const fabricWidthSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  unit: z.string().max(10).default("cm"),
  isActive: z.coerce.boolean().default(true),
});
export type FabricWidthInput = z.infer<typeof fabricWidthSchema>;

export const fabricCompositionSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  isActive: z.coerce.boolean().default(true),
});
export type FabricCompositionInput = z.infer<typeof fabricCompositionSchema>;

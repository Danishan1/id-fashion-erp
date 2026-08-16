import { z } from "zod";

export const WAREHOUSE_TYPES = [
  "RAW_MATERIAL",
  "FABRIC",
  "TRIMS",
  "WIP",
  "FINISHED_GOODS",
  "DISPATCH",
  "REJECT",
] as const;

export const warehouseSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(WAREHOUSE_TYPES),
  isActive: z.boolean().default(true),
});
export type WarehouseInput = z.infer<typeof warehouseSchema>;

export const warehouseLocationSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  zone: z.string().max(50).optional().or(z.literal("")),
  rack: z.string().max(50).optional().or(z.literal("")),
  bin: z.string().max(50).optional().or(z.literal("")),
});
export type WarehouseLocationInput = z.infer<typeof warehouseLocationSchema>;

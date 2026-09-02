import { z } from "zod";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

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

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const warehouseUpdateSchema = warehouseSchema.partial();
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;

export const warehouseLocationSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  zone: z.string().max(50).optional().or(z.literal("")),
  rack: z.string().max(50).optional().or(z.literal("")),
  bin: z.string().max(50).optional().or(z.literal("")),
  // Which kind of material this room/section is dedicated to — reuses
  // Product's own category list (not a new enum). Advisory only, see
  // warehouse.service.ts.
  materialCategory: z.enum(MATERIAL_CATEGORIES).optional().or(z.literal("")),
});
export type WarehouseLocationInput = z.infer<typeof warehouseLocationSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const warehouseLocationUpdateSchema = warehouseLocationSchema.partial();
export type WarehouseLocationUpdateInput = z.infer<typeof warehouseLocationUpdateSchema>;

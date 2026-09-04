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

// A WarehouseLocation's own category is a superset of Product's raw-material
// list (MATERIAL_CATEGORIES) plus the 4 non-raw-material WarehouseType
// values — a physical room/section can be dedicated to a production STAGE
// (WIP/Finished Goods/Dispatch/Reject), not just a material sub-category
// (2026-09-04). Deliberately a separate list from MATERIAL_CATEGORIES, not
// a widening of it — Product's own materialCategory (an actual raw
// material's type) must never accept these 4, since a raw material is never
// itself "WIP" or "Finished Goods".
export const LOCATION_MATERIAL_CATEGORIES = [...MATERIAL_CATEGORIES, "WIP", "FINISHED_GOODS", "DISPATCH", "REJECT"] as const;

export const warehouseLocationSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  zone: z.string().max(50).optional().or(z.literal("")),
  rack: z.string().max(50).optional().or(z.literal("")),
  bin: z.string().max(50).optional().or(z.literal("")),
  // Which kind of material or production stage this room/section is
  // dedicated to — reuses Product's own MaterialCategory enum column, but
  // validated against the wider LOCATION_MATERIAL_CATEGORIES list above.
  // Advisory only, see warehouse.service.ts.
  materialCategory: z.enum(LOCATION_MATERIAL_CATEGORIES).optional().or(z.literal("")),
  // Free-text note, only meaningful (and only ever rendered/edited in the
  // UI) when materialCategory = "OTHER" — not enforced required here since
  // materialCategory itself isn't required either; warehouse.service.ts
  // forces this back to null whenever materialCategory isn't OTHER, so a
  // stale note can never survive a re-tag even via a direct API call.
  materialCategoryOther: z.string().max(100).optional().or(z.literal("")),
});
export type WarehouseLocationInput = z.infer<typeof warehouseLocationSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const warehouseLocationUpdateSchema = warehouseLocationSchema.partial();
export type WarehouseLocationUpdateInput = z.infer<typeof warehouseLocationUpdateSchema>;

export const warehouseSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  // Array, not a single value — a physical warehouse routinely stores more
  // than one material kind in different rooms/sections.
  type: z.array(z.enum(WAREHOUSE_TYPES)).min(1, "Select at least one type"),
  isActive: z.boolean().default(true),
  // Optional locations to create in the same request, staged client-side
  // before the warehouse itself has an id (see WarehousesListClient's Create
  // modal) — created via the same nested-write path as a normal Warehouse
  // create, never read/used by updateWarehouse.
  locations: z.array(warehouseLocationSchema).optional(),
});
export type WarehouseInput = z.infer<typeof warehouseSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const warehouseUpdateSchema = warehouseSchema.partial();
export type WarehouseUpdateInput = z.infer<typeof warehouseUpdateSchema>;

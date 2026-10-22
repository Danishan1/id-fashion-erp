import { z } from "zod";

// Finished Goods Inventory module (FGI-030) -- a single destination line for
// a Putaway action: move this much of the staging quantity into this real
// warehouse location.
export const putawayAllocationLineSchema = z.object({
  warehouseLocationId: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
});
export type PutawayAllocationLineInput = z.infer<typeof putawayAllocationLineSchema>;

export const putawayStockSchema = z.object({
  productId: z.string().uuid(),
  productVariantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  // The staging status this action moves stock out of -- a real input, not
  // hardcoded to SALEABLE, since REJECTED staging stock is a real scenario
  // too (e.g. putting away damaged stock into a dedicated reject location).
  stockStatus: z.enum(["SALEABLE", "REJECTED"]),
  // Splitting one staging balance across N real locations in one action is
  // the whole point of Putaway -- at least one destination line is required,
  // more than one is the common, intended case.
  allocations: z.array(putawayAllocationLineSchema).min(1, "At least one destination location is required"),
});
export type PutawayStockInput = z.infer<typeof putawayStockSchema>;

// Unlocated stock (2026-10-22): bulk "set location" for many not-yet-put-away
// rows at once. Each row is one staging balance moved (whole or part) into
// one location of the same warehouse.
export const bulkPutawayRowSchema = z.object({
  productId: z.string().uuid(),
  productVariantId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  stockStatus: z.enum(["SALEABLE", "REJECTED"]),
  warehouseLocationId: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
});

export const bulkPutawaySchema = z.object({
  rows: z.array(bulkPutawayRowSchema).min(1, "Select at least one row").max(500, "At most 500 rows at a time"),
});
export type BulkPutawayInput = z.infer<typeof bulkPutawaySchema>;

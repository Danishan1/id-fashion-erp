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

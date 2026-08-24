import { z } from "zod";

export const STOCK_MOVEMENT_TYPES = ["TRANSFER", "ADJUSTMENT", "RETURN_TO_SUPPLIER"] as const;

export const stockMovementItemSchema = z.object({
  productId: z.string().uuid("Material is required"),
  uomId: z.string().uuid("Unit is required"),
  // TRANSFER/RETURN_TO_SUPPLIER: must be positive (checked below by the
  // header refine, since the sign rule depends on movementType). ADJUSTMENT:
  // any nonzero number, sign carries the meaning (found vs written off).
  quantity: z.coerce.number().refine((n) => n !== 0, "Quantity cannot be zero"),
  remarks: z.string().max(500).optional().or(z.literal("")),
});
export type StockMovementItemInput = z.infer<typeof stockMovementItemSchema>;

export const createStockMovementSchema = z
  .object({
    movementType: z.enum(STOCK_MOVEMENT_TYPES),
    warehouseId: z.string().uuid("Warehouse is required"),
    toWarehouseId: z.string().uuid().optional().or(z.literal("")),
    supplierId: z.string().uuid().optional().or(z.literal("")),
    // Required for ADJUSTMENT (see refine below); optional context otherwise.
    reason: z.string().max(500).optional().or(z.literal("")),
    remarks: z.string().max(1000).optional().or(z.literal("")),
    items: z.array(stockMovementItemSchema).min(1, "At least one line item is required"),
  })
  .refine((input) => input.movementType !== "TRANSFER" || !!input.toWarehouseId, {
    message: "A destination warehouse is required for a Transfer.",
    path: ["toWarehouseId"],
  })
  .refine((input) => input.movementType !== "TRANSFER" || input.toWarehouseId !== input.warehouseId, {
    message: "The destination warehouse must be different from the source warehouse.",
    path: ["toWarehouseId"],
  })
  .refine((input) => input.movementType !== "RETURN_TO_SUPPLIER" || !!input.supplierId, {
    message: "A supplier is required for a Return to Supplier.",
    path: ["supplierId"],
  })
  .refine((input) => input.movementType !== "ADJUSTMENT" || !!input.reason, {
    message: "A reason is required for a Stock Adjustment.",
    path: ["reason"],
  })
  .refine((input) => input.movementType === "ADJUSTMENT" || input.items.every((item) => item.quantity > 0), {
    message: "Quantity must be greater than 0 for a Transfer or Return to Supplier.",
    path: ["items"],
  });
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

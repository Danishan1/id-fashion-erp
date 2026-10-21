import { z } from "zod";

export const STOCK_MOVEMENT_TYPES = ["TRANSFER", "ADJUSTMENT", "RETURN_TO_SUPPLIER"] as const;

// Finished Goods Inventory module (FGI-014, Decision 2/§4.4) -- a single
// StockMovement document is tagged, from creation, as moving either
// RAW_MATERIAL or FINISHED_GOODS stock. Defaults to RAW_MATERIAL so every
// existing caller (which never sends this field) keeps behaving exactly
// as before. Zod has no DB access, so this field only drives the
// per-line SHAPE requirement below (variant required/forbidden); the REAL
// cross-check -- that every line's actual Product.itemType genuinely
// matches this stated family -- happens at the service layer
// (stock-movement.service.ts's assertItemFamilyConsistency()).
export const STOCK_MOVEMENT_ITEM_FAMILIES = ["RAW_MATERIAL", "FINISHED_GOODS"] as const;

export const stockMovementItemSchema = z.object({
  productId: z.string().uuid("Material is required"),
  uomId: z.string().uuid("Unit is required"),
  // TRANSFER/RETURN_TO_SUPPLIER: must be positive (checked below by the
  // header refine, since the sign rule depends on movementType). ADJUSTMENT:
  // any nonzero number, sign carries the meaning (found vs written off).
  quantity: z.coerce.number().refine((n) => n !== 0, "Quantity cannot be zero"),
  remarks: z.string().max(500).optional().or(z.literal("")),
  // Which room/section within the SOURCE warehouse this line's stock comes
  // from — traceability only, passed straight through to the shared ledger's
  // own existing warehouseLocationId (see inventory.service.ts). Not
  // validated against real per-location stock (StockBalance has no location
  // dimension) — see the advisory, non-blocking category-mismatch warning in
  // the UI instead.
  warehouseLocationId: z.string().uuid().optional().or(z.literal("")),
  // Finished Goods Inventory module (FGI-014) -- required when the
  // document's own itemFamily is FINISHED_GOODS, forbidden otherwise (see
  // createStockMovementSchema's own refine()s below).
  productVariantId: z.string().uuid().optional().or(z.literal("")),
  // Destination-side location for a Transfer of finished goods -- mirrors
  // warehouseLocationId's own optional-traceability-only shape.
  toWarehouseLocationId: z.string().uuid().optional().or(z.literal("")),
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
    // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
    // Omitting it just means this call gets no idempotency protection.
    idempotencyKey: z.string().min(1).max(200).optional(),
    // Finished Goods Inventory module (FGI-014) -- see
    // STOCK_MOVEMENT_ITEM_FAMILIES's own doc comment above for why this
    // defaults to RAW_MATERIAL.
    itemFamily: z.enum(STOCK_MOVEMENT_ITEM_FAMILIES).default("RAW_MATERIAL"),
  })
  .refine((input) => input.movementType !== "TRANSFER" || !!input.toWarehouseId, {
    message: "A destination warehouse is required for a Transfer.",
    path: ["toWarehouseId"],
  })
  // Finished Goods Inventory module (FGI-031) -- a same-warehouse Transfer
  // used to be blocked for EVERY item family, but FinishedGoodsStockBalance
  // (unlike StockBalance) has a real location dimension, so a Finished Goods
  // Transfer genuinely can move stock between two locations within the SAME
  // warehouse -- a real, useful case the original raw-material-only design
  // never needed to express. Raw material keeps the EXACT original rule
  // (destination warehouse must differ) unchanged -- it has no location-
  // level balance to actually move, so a same-warehouse "transfer" there
  // would be a meaningless no-op, not a fix. For Finished Goods, a
  // same-warehouse Transfer is only valid when at least one line's own
  // location genuinely changes (never a zero-op transfer of a location into
  // itself) -- "" and undefined both normalize to "no location set" for this
  // comparison, matching how the rest of this schema treats an empty string.
  .refine(
    (input) => {
      if (input.movementType !== "TRANSFER") return true;
      if (input.toWarehouseId !== input.warehouseId) return true;
      if (input.itemFamily !== "FINISHED_GOODS") return false;
      const normalize = (v?: string) => v || null;
      return input.items.some((item) => normalize(item.warehouseLocationId) !== normalize(item.toWarehouseLocationId));
    },
    {
      message:
        "A Transfer must either move stock to a different warehouse, or (for Finished Goods) to a different location within the same warehouse.",
      path: ["toWarehouseId"],
    }
  )
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
  })
  // Finished Goods Inventory module (FGI-014) -- the per-line SHAPE half
  // of the item-type-family defense (the other half is the real,
  // DB-backed service-layer assertion -- see stock-movement.service.ts).
  .refine((input) => input.itemFamily !== "FINISHED_GOODS" || input.items.every((item) => !!item.productVariantId), {
    message: "A colour/size variant is required for every line of a Finished Goods stock movement.",
    path: ["items"],
  })
  .refine((input) => input.itemFamily !== "RAW_MATERIAL" || input.items.every((item) => !item.productVariantId), {
    message: "A colour/size variant cannot be set on a raw-material stock movement line.",
    path: ["items"],
  })
  .refine((input) => input.itemFamily !== "FINISHED_GOODS" || input.movementType !== "RETURN_TO_SUPPLIER", {
    message: "Return to Supplier is not valid for a Finished Goods stock movement.",
    path: ["movementType"],
  });
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

// Receive an in-transit raw-material Transfer: the receiver picks where each
// line is put away in the destination warehouse.
export const receiveStockMovementSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        toWarehouseLocationId: z.string().uuid("Pick a destination location"),
      })
    )
    .min(1, "At least one line is required"),
});
export type ReceiveStockMovementInput = z.infer<typeof receiveStockMovementSchema>;

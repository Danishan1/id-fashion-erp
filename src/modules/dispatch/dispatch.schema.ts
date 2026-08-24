import { z } from "zod";

export const dispatchItemInputSchema = z.object({
  salesOrderItemId: z.string().uuid("Order line is required"),
  dispatchedQuantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
});

export type DispatchItemInput = z.infer<typeof dispatchItemInputSchema>;

export const dispatchSchema = z.object({
  salesOrderId: z.string().uuid("Sales order is required"),
  warehouseId: z.string().uuid("Warehouse is required"),
  dispatchDate: z.string().min(1, "Dispatch date is required"),
  deliveryAddress: z.string().min(1, "Delivery address is required").max(1000),
  transporterName: z.string().max(200).optional().or(z.literal("")),
  vehicleNumber: z.string().max(100).optional().or(z.literal("")),
  trackingNumber: z.string().max(200).optional().or(z.literal("")),
  items: z.array(dispatchItemInputSchema).min(1, "At least one line is required"),
});

export type DispatchInput = z.infer<typeof dispatchSchema>;

// Same shape as create, minus salesOrderId — which order a Dispatch fulfills
// never changes once created.
export const updateDispatchSchema = dispatchSchema.omit({ salesOrderId: true });

export type UpdateDispatchInput = z.infer<typeof updateDispatchSchema>;

export const cartonItemInputSchema = z.object({
  dispatchItemId: z.string().uuid("Dispatch line is required"),
  productVariantId: z.string().uuid().optional().or(z.literal("")),
  quantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
});

export type CartonItemInput = z.infer<typeof cartonItemInputSchema>;

// A carton's own number is assigned by the service (1..N in array order) —
// removes a whole class of client-side numbering bugs, and matches this
// project's "server derives what it safely can" discipline.
export const cartonInputSchema = z.object({
  items: z.array(cartonItemInputSchema).min(1, "A carton needs at least one item"),
});

export type CartonInput = z.infer<typeof cartonInputSchema>;

// Full replace of a Dispatch's cartons — simplest correct way to apply an
// edit without hand-diffing which cartons changed, same pattern as Sales/
// Purchase Order's own replaceItems().
export const setCartonsSchema = z.object({
  cartons: z.array(cartonInputSchema),
});

export type SetCartonsInput = z.infer<typeof setCartonsSchema>;

// Hold and Cancel are separate, body-less POST endpoints (not a single
// generic status-change route) specifically so Cancel can be gated on its
// own "cancel" RBAC action, distinct from Hold's "edit" — matching every
// other Phase 7 module's dedicated-cancel-route shape, not Sales Order's
// single edit-gated status route (which predates Dispatch's own distinct
// "cancel" grant even existing as a meaningfully different permission).

export const deliverDispatchSchema = z.object({
  receivedByName: z.string().max(200).optional().or(z.literal("")),
});

export type DeliverDispatchInput = z.infer<typeof deliverDispatchSchema>;

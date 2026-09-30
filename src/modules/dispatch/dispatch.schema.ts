import { z } from "zod";

// Extra Dispatch Quantity (2026-09-30) — suggested reason values a line's
// extra (beyond the sale order's own remaining quantity) is being shipped.
// Reused client-side for the UI's own dropdown and by reports, so this list
// is the single source of truth rather than duplicated.
export const EXTRA_DISPATCH_REASONS = [
  "CUSTOMER_REQUEST",
  "REPLACEMENT",
  "FREE_FOC",
  "SAMPLE",
  "PROMOTIONAL",
  "PACKING_ADJUSTMENT",
  "OTHER",
] as const;

export const EXTRA_DISPATCH_REASON_LABELS: Record<(typeof EXTRA_DISPATCH_REASONS)[number], string> = {
  CUSTOMER_REQUEST: "Customer Request",
  REPLACEMENT: "Replacement",
  FREE_FOC: "Free / FOC",
  SAMPLE: "Sample",
  PROMOTIONAL: "Promotional",
  PACKING_ADJUSTMENT: "Packing Adjustment",
  OTHER: "Other",
};

export const dispatchItemInputSchema = z
  .object({
    salesOrderItemId: z.string().uuid("Order line is required"),
    dispatchedQuantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
    // Both optional at the Zod layer — "reason is required whenever the
    // SERVER-COMPUTED extra quantity is > 0" can't be expressed here (the
    // Regular/Extra split is only known once the service reads the order's
    // own cumulative Regular total), so that rule is enforced in
    // dispatch.service.ts. The one rule Zod CAN express from input shape
    // alone — remarks required when reason is OTHER — is enforced below.
    extraDispatchReason: z.enum(EXTRA_DISPATCH_REASONS).optional(),
    extraDispatchRemarks: z.string().max(1000).optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.extraDispatchReason === "OTHER" && !val.extraDispatchRemarks?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extraDispatchRemarks"],
        message: 'Remarks are required when Extra Dispatch Reason is "Other".',
      });
    }
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

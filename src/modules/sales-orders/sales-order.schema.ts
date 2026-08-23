import { z } from "zod";

export const salesOrderItemBreakdownSchema = z.object({
  productVariantId: z.string().uuid("Variant is required"),
  orderedQuantity: z.coerce.number().int().positive("Quantity must be greater than 0"),
});

export type SalesOrderItemBreakdownInput = z.infer<typeof salesOrderItemBreakdownSchema>;

export const salesOrderItemSchema = z.object({
  productId: z.string().uuid("Style is required"),
  sampleRequestId: z.string().uuid().optional().or(z.literal("")),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  notes: z.string().max(500).optional().or(z.literal("")),
  breakdown: z.array(salesOrderItemBreakdownSchema).min(1, "At least one size/color line is required"),
});

export type SalesOrderItemInput = z.infer<typeof salesOrderItemSchema>;

export const salesOrderSchema = z.object({
  customerId: z.string().uuid("Customer is required"),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  orderDate: z.string().min(1, "Order date is required"),
  requiredShipDate: z.string().optional().or(z.literal("")),
  items: z.array(salesOrderItemSchema).min(1, "At least one style line is required"),
});

export type SalesOrderInput = z.infer<typeof salesOrderSchema>;

// Same shape as create, plus the same override-reason field confirm uses —
// editing a Confirmed order re-runs the sample-approval gate (see
// updateSalesOrder()), so a blocked edit needs the same override path.
export const updateSalesOrderSchema = salesOrderSchema.extend({
  overrideReason: z.string().max(500).optional().or(z.literal("")),
});

export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

// Confirming with a sample-approval-gate override requires a reason — audited
// alongside the confirmation itself.
export const confirmSalesOrderSchema = z.object({
  overrideReason: z.string().max(500).optional().or(z.literal("")),
});

export type ConfirmSalesOrderInput = z.infer<typeof confirmSalesOrderSchema>;

// CANCELLED is reachable from both DRAFT and CONFIRMED; the service's own
// ALLOWED_TRANSITIONS map enforces which is legal from the current status.
// IN_PRODUCTION/PARTIALLY_DISPATCHED/DISPATCHED/INVOICED/CLOSED are
// deliberately excluded — not reachable via this generic endpoint in 5A.
export const salesOrderStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED"]),
});

export type SalesOrderStatusChangeInput = z.infer<typeof salesOrderStatusChangeSchema>;

import { z } from "zod";

export const purchaseOrderItemSchema = z.object({
  productId: z.string().uuid("Raw material is required"),
  uomId: z.string().uuid("Unit is required"),
  orderedQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  notes: z.string().max(500).optional().or(z.literal("")),
  // Set only by generatePurchaseOrdersForShortfall() in
  // material-request.service.ts — absent from every direct PO creation,
  // which is completely unaffected.
  materialRequestItemId: z.string().uuid().optional(),
});
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid("Supplier is required"),
  orderDate: z.string().min(1, "Order date is required"),
  expectedDeliveryDate: z.string().optional().or(z.literal("")),
  items: z.array(purchaseOrderItemSchema).min(1, "At least one line item is required"),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

// Same shape as create — editing an APPROVED order reverts it to DRAFT
// (forcing re-approval) rather than needing an override-reason escape hatch,
// since there's no approval-gate concept to bypass here (unlike Sales
// Orders' sample-approval gate).
export const updatePurchaseOrderSchema = purchaseOrderSchema;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const purchaseOrderStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED"]),
});
export type PurchaseOrderStatusChangeInput = z.infer<typeof purchaseOrderStatusChangeSchema>;

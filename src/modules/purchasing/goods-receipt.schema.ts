import { z } from "zod";

export const fabricRollInputSchema = z.object({
  rollNumber: z.string().min(1, "Roll number is required").max(100),
  rollQuantity: z.coerce.number().positive("Roll quantity must be greater than 0"),
  batchNo: z.string().max(100).optional().or(z.literal("")),
  gsmId: z.string().uuid().optional().or(z.literal("")),
  dyeId: z.string().uuid().optional().or(z.literal("")),
  weaveTypeId: z.string().uuid().optional().or(z.literal("")),
  widthId: z.string().uuid().optional().or(z.literal("")),
  compositionId: z.string().uuid().optional().or(z.literal("")),
  warehouseLocationId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});
export type FabricRollInput = z.infer<typeof fabricRollInputSchema>;

export const goodsReceiptItemSchema = z.object({
  purchaseOrderItemId: z.string().uuid("Line item is required"),
  receivedQuantity: z.coerce.number().positive("Received quantity must be greater than 0"),
  warehouseId: z.string().uuid("Warehouse is required"),
  warehouseLocationId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  // Optional — not every material needs roll tracking (buttons/zippers
  // received by simple quantity don't). Required at the service layer when
  // the line's product is materialCategory FABRIC.
  rolls: z.array(fabricRollInputSchema).optional().default([]),
});
export type GoodsReceiptItemInput = z.infer<typeof goodsReceiptItemSchema>;

export const goodsReceiptSchema = z.object({
  receivedDate: z.string().min(1, "Received date is required"),
  items: z.array(goodsReceiptItemSchema).min(1, "At least one line item is required"),
  // Optional, client-generated (one value per real submit attempt, reused
  // verbatim on a retry of the SAME attempt) — see CF-5 in the independent
  // hardening audit. Omitting it just means this particular call gets no
  // idempotency protection, not a rejected request.
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const cancelGoodsReceiptSchema = z.object({
  reason: z.string().min(1, "A reason is required").max(500),
});
export type CancelGoodsReceiptInput = z.infer<typeof cancelGoodsReceiptSchema>;

export const reverseGoodsReceiptLineSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  reason: z.string().min(1, "A reason is required").max(500),
  // Required when the line has rolls (ambiguous otherwise which physical
  // roll the reversal applies to); omitted when it doesn't.
  fabricRollId: z.string().uuid().optional().or(z.literal("")),
});
export type ReverseGoodsReceiptLineInput = z.infer<typeof reverseGoodsReceiptLineSchema>;

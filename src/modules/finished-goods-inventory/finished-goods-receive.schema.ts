import { z } from "zod";

// Finished Goods Receive (2026-10-22): receive pending receipt lines into a
// location. Whole or part of a line; a location is required whenever the
// warehouse has locations (checked in the service).
export const receiveFinishedGoodsLineSchema = z.object({
  receiptItemId: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  warehouseLocationId: z.string().uuid().nullable().optional().or(z.literal("")),
  remarks: z.string().trim().max(500).optional().nullable(),
});

export const receiveFinishedGoodsSchema = z.object({
  lines: z.array(receiveFinishedGoodsLineSchema).min(1, "Select at least one line").max(500, "At most 500 lines at a time"),
});
export type ReceiveFinishedGoodsInput = z.infer<typeof receiveFinishedGoodsSchema>;

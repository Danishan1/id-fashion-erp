import { z } from "zod";

export const CUSTOM_INVOICE_CREDIT_NOTE_TYPES = ["OVERALL_DISCOUNT", "PRODUCT_WISE", "PRODUCT_RETURN"] as const;

export const customInvoiceCreditNoteItemInputSchema = z.object({
  customInvoiceItemId: z.string().uuid(),
  // Required for PRODUCT_RETURN (the returned quantity — amount is derived
  // server-side from the line's own effective per-unit rate).
  quantity: z.coerce.number().positive().optional(),
  // Required for PRODUCT_WISE (a directly-specified reduction amount).
  amount: z.coerce.number().positive().optional(),
});

export const customInvoiceCreditNoteSchema = z
  .object({
    creditNoteDate: z.string().min(1, "Credit note date is required"),
    type: z.enum(CUSTOM_INVOICE_CREDIT_NOTE_TYPES),
    reason: z.string().max(1000).optional().or(z.literal("")),
    // Required for OVERALL_DISCOUNT only.
    amount: z.coerce.number().positive().optional(),
    // Required (non-empty) for PRODUCT_WISE/PRODUCT_RETURN only.
    items: z.array(customInvoiceCreditNoteItemInputSchema).default([]),
  })
  .refine((d) => d.type !== "OVERALL_DISCOUNT" || (d.amount && d.amount > 0), {
    message: "Amount is required for an overall-discount credit note",
    path: ["amount"],
  })
  .refine((d) => d.type === "OVERALL_DISCOUNT" || d.items.length > 0, {
    message: "At least one item line is required",
    path: ["items"],
  })
  .refine((d) => d.type !== "PRODUCT_RETURN" || d.items.every((i) => i.quantity && i.quantity > 0), {
    message: "A returned quantity is required for every line on a product-return credit note",
    path: ["items"],
  })
  .refine((d) => d.type !== "PRODUCT_WISE" || d.items.every((i) => i.amount && i.amount > 0), {
    message: "An amount is required for every line on a product-wise credit note",
    path: ["items"],
  });

export type CustomInvoiceCreditNoteInput = z.infer<typeof customInvoiceCreditNoteSchema>;

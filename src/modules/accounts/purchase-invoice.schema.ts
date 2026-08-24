import { z } from "zod";

// Unlike Sales Invoice, quantity AND unitPrice are both real user input here —
// a supplier invoice can cover a subset of a PO's lines and routinely bills
// at a different price than the PO (rate revision, negotiated discount).
export const purchaseInvoiceLineInputSchema = z.object({
  purchaseOrderItemId: z.string().uuid("Order line is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
  taxRateId: z.string().uuid().optional().or(z.literal("")),
});

export type PurchaseInvoiceLineInput = z.infer<typeof purchaseInvoiceLineInputSchema>;

export const purchaseInvoiceSchema = z.object({
  purchaseOrderId: z.string().uuid("Purchase order is required"),
  supplierInvoiceNumber: z.string().max(100).optional().or(z.literal("")),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  lines: z.array(purchaseInvoiceLineInputSchema).min(1, "At least one line is required"),
});

export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>;

// Same shape as create — editing a DRAFT invoice can change quantity/price/tax
// per line, never which Purchase Order it's linked to.
export const updatePurchaseInvoiceSchema = purchaseInvoiceSchema;

export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

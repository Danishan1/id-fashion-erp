import { z } from "zod";

// Quantity/unitPrice are always derived server-side from the linked
// SalesOrderItem/breakdown — never accepted from the client. The only real
// per-line input is which TaxRate (if any) applies.
export const salesInvoiceLineInputSchema = z.object({
  salesOrderItemId: z.string().uuid("Order line is required"),
  taxRateId: z.string().uuid().optional().or(z.literal("")),
});

export type SalesInvoiceLineInput = z.infer<typeof salesInvoiceLineInputSchema>;

export const salesInvoiceSchema = z.object({
  salesOrderId: z.string().uuid("Sales order is required"),
  invoiceDate: z.string().min(1, "Invoice date is required"),
  lines: z.array(salesInvoiceLineInputSchema).min(1, "At least one line is required"),
  // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export type SalesInvoiceInput = z.infer<typeof salesInvoiceSchema>;

// Same shape as create — editing a DRAFT invoice can only change which tax
// rate applies per line, never the linked order/items themselves.
export const updateSalesInvoiceSchema = salesInvoiceSchema;

export type UpdateSalesInvoiceInput = z.infer<typeof updateSalesInvoiceSchema>;

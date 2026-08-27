import { z } from "zod";

// Unlike Sales Invoice, quantity AND unitPrice are both real user input here —
// a supplier invoice can cover a subset of a PO's lines and routinely bills
// at a different price than the PO (rate revision, negotiated discount).
//
// Every line is EXACTLY one of two shapes: a PO-linked line
// (purchaseOrderItemId set — the original, unchanged shape) or a
// direct/"party bill" line (description + expenseAccountId set, no PO
// backing — a service/expense bill from a supplier, e.g. freight,
// consulting, rent). Enforced here, not just by the DB CHECK constraint,
// so a malformed request gets a clean 400 naming the actual problem.
export const purchaseInvoiceLineInputSchema = z
  .object({
    purchaseOrderItemId: z.string().uuid().optional().or(z.literal("")),
    description: z.string().max(500).optional().or(z.literal("")),
    expenseAccountId: z.string().uuid().optional().or(z.literal("")),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
    taxRateId: z.string().uuid().optional().or(z.literal("")),
  })
  .superRefine((line, ctx) => {
    const isPoLinked = !!line.purchaseOrderItemId;
    const isDirect = !!line.expenseAccountId;
    if (isPoLinked === isDirect) {
      ctx.addIssue({
        code: "custom",
        message: isPoLinked
          ? "A line cannot be both linked to a purchase order item and carry a direct expense account."
          : "A line must either be linked to a purchase order item, or be a direct expense line with an Expense Account (and Description).",
      });
      return;
    }
    if (isDirect && !line.description) {
      ctx.addIssue({ code: "custom", path: ["description"], message: "Description is required for a direct expense line." });
    }
  });

export type PurchaseInvoiceLineInput = z.infer<typeof purchaseInvoiceLineInputSchema>;

export const purchaseInvoiceSchema = z
  .object({
    // Nullable — a standalone "party/direct bill" with no backing Purchase
    // Order supplies supplierId directly instead (see the refine below).
    purchaseOrderId: z.string().uuid().optional().or(z.literal("")),
    // Required only when purchaseOrderId is absent — when a PO is linked,
    // the supplier is always derived from the order server-side and this
    // field is ignored, matching every other "never trust a client-supplied
    // derivable value" case in this project.
    supplierId: z.string().uuid().optional().or(z.literal("")),
    supplierInvoiceNumber: z.string().max(100).optional().or(z.literal("")),
    invoiceDate: z.string().min(1, "Invoice date is required"),
    lines: z.array(purchaseInvoiceLineInputSchema).min(1, "At least one line is required"),
    // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .superRefine((input, ctx) => {
    if (!input.purchaseOrderId && !input.supplierId) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Supplier is required for a direct bill with no purchase order." });
    }
    if (!input.purchaseOrderId && input.lines.some((line) => line.purchaseOrderItemId)) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "A line cannot be linked to a purchase order item when no purchase order is selected.",
      });
    }
  });

export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>;

// Same shape as create — editing a DRAFT invoice can change lines/quantity/
// price/tax, never which Purchase Order (or lack thereof) it's linked to.
export const updatePurchaseInvoiceSchema = purchaseInvoiceSchema;

export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

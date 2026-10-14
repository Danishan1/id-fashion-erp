import { z } from "zod";
import { isValidStateCode } from "@/lib/gst";

export const CUSTOM_INVOICE_TYPES = ["TAX_INVOICE", "PROFORMA_INVOICE"] as const;

export const customInvoiceItemInputSchema = z.object({
  productId: z.string().uuid().optional().or(z.literal("")),
  itemName: z.string().min(1, "Item name is required").max(300),
  hsnCode: z.string().max(20).optional().or(z.literal("")),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPrice: z.coerce.number().min(0, "Price cannot be negative"),
  gstPercentage: z.coerce.number().min(0).max(100).default(0),
});
export type CustomInvoiceItemInput = z.infer<typeof customInvoiceItemInputSchema>;

export const customInvoiceSchema = z
  .object({
    invoiceDate: z.string().min(1, "Invoice date is required"),
    invoiceType: z.enum(CUSTOM_INVOICE_TYPES).default("TAX_INVOICE"),
    hasDueDate: z.coerce.boolean().default(false),
    dueDate: z.string().optional().or(z.literal("")),
    invoiceSeriesId: z.string().uuid("Invoice series is required"),
    invoiceNumber: z.string().min(1, "Invoice number is required").max(100),
    customerId: z.string().uuid("Client is required"),
    // Optional classification against the existing Chart of Accounts (an
    // INCOME-type account) — see the schema.prisma comment on
    // CustomInvoice.incomeAccountId for why this reuses that master instead
    // of a new "Category" lookup.
    incomeAccountId: z.string().uuid().optional().or(z.literal("")),
    discountPercentage: z.coerce.number().min(0, "Discount cannot be negative").max(100, "Discount cannot exceed 100%").default(0),
    isReverseCharge: z.coerce.boolean().default(false),
    items: z.array(customInvoiceItemInputSchema).min(1, "At least one item is required"),
    notes: z.array(z.string().min(1).max(1000)).default([]),
    advancePaymentTitle: z.string().max(200).optional().or(z.literal("")),
    advancePaymentAmount: z.coerce.number().min(0).optional(),
    payableAmountTitle: z.string().max(200).optional().or(z.literal("")),
    payableAmountValue: z.coerce.number().min(0).optional(),
    termsAndConditions: z.string().max(5000).optional().or(z.literal("")),
    placeOfSupplyStateCode: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .refine((val) => !val || isValidStateCode(val), {
        message: "Invalid Indian GST State Code for Place of Supply. Must be a valid 2-digit state code (01-38, 97).",
      }),
  })
  .refine((d) => !d.hasDueDate || !!d.dueDate, {
    message: "Due date is required when 'Set Payment Due Date' is enabled",
    path: ["dueDate"],
  })
  .refine((d) => !(d.advancePaymentAmount && d.advancePaymentAmount > 0 && !d.advancePaymentTitle), {
    message: "Advance Payment Title is required when an amount is entered",
    path: ["advancePaymentTitle"],
  })
  .refine((d) => !(d.advancePaymentTitle && !(d.advancePaymentAmount && d.advancePaymentAmount > 0)), {
    message: "Advance Payment amount is required when a title is entered",
    path: ["advancePaymentAmount"],
  });

export type CustomInvoiceInput = z.infer<typeof customInvoiceSchema>;

// Editing is only ever allowed while DRAFT (see service) — same full-replace
// shape as create, no separate partial-update schema needed.
export const updateCustomInvoiceSchema = customInvoiceSchema;
export type UpdateCustomInvoiceInput = CustomInvoiceInput;

import { z } from "zod";
import { extractStateCodeFromGstin, isValidStateCode } from "@/lib/gst";
import { isValidHsn } from "@/lib/payables-gst";

/**
 * GST invoice block shared by the Tax Invoice, Supplier Bill and Supplier
 * Adjustment request types (2026-10-28). Client totals are never accepted —
 * computeGstInvoice() works them out from these lines.
 */

const decimals = (n: number, places: number) => Math.abs(Math.round(n * 10 ** places) - n * 10 ** places) < 1e-6;

const money = (label: string) =>
  z.coerce
    .number({ message: `${label} is required` })
    .min(0, `${label} can't be negative`)
    .max(9_999_999_999_999, `${label} is too large`)
    .refine((n) => decimals(n, 2), `${label} can have at most 2 decimal places`);

const percent = (label: string) =>
  z.coerce
    .number({ message: `${label} is required` })
    .min(0, `${label} must be between 0 and 100`)
    .max(100, `${label} must be between 0 and 100`)
    .refine((n) => decimals(n, 2), `${label} can have at most 2 decimal places`);

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());

const optionalUuid = z.string().uuid().optional().or(z.literal(""));

export const gstInvoiceLineSchema = z
  .object({
    description: z.string().trim().min(1, "Description is required").max(500),
    isForStock: z.boolean().default(false),
    purposeId: optionalUuid,
    expenseAccountId: optionalUuid,
    productId: optionalUuid,
    hsnCode: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || isValidHsn(v), "HSN/SAC must be 4, 6 or 8 digits"),
    mrp: optional(money("MRP")),
    rate: money("Rate"),
    quantity: z.coerce
      .number({ message: "Quantity is required" })
      .positive("Quantity must be greater than 0")
      .max(999_999_999, "Quantity is too large")
      .refine((n) => decimals(n, 4), "Quantity can have at most 4 decimal places"),
    discountPercentage: optional(percent("Discount %")),
    discountAmount: optional(money("Discount")),
    gstRate: percent("GST %"),
  })
  .superRefine((line, ctx) => {
    if (line.productId && !line.isForStock) {
      ctx.addIssue({ code: "custom", path: ["productId"], message: "Pick a stock item only on a line marked 'For stock'." });
    }
  });
export type GstInvoiceLineInput = z.infer<typeof gstInvoiceLineSchema>;

export const gstInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(60),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid invoice date"),
  isItcApplicable: z.boolean().default(true),
  isReverseCharge: z.boolean().default(false),
  // Defaults to our own state when left empty.
  placeOfSupplyStateCode: z
    .string()
    .trim()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isValidStateCode(v), "Pick a valid place of supply"),
  // Filled from the supplier/payee; an override must be a valid GSTIN.
  payToGstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || extractStateCodeFromGstin(v) !== null, "GSTIN is not valid"),
  isRawMaterialForProduction: z.boolean().default(false),
  lines: z.array(gstInvoiceLineSchema).min(1, "Add at least one invoice line").max(200, "At most 200 lines"),
});
export type GstInvoiceInput = z.infer<typeof gstInvoiceSchema>;

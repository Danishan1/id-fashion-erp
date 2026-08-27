import { z } from "zod";

// isDefault exists as a reserved column on the model (unused, always false)
// for a possible future "pre-select the default series" convenience — not
// exposed here since nothing reads it yet, and exposing a boolean field this
// form's Active/Inactive toggle doesn't also resend would let that toggle
// silently reset it on every save.
export const invoiceSeriesSchema = z.object({
  name: z.string().min(1, "Series name is required").max(100),
  prefix: z.string().min(1, "Prefix is required").max(20),
  fiscalYearLabel: z.string().min(1, "Fiscal year label is required").max(20),
  isActive: z.coerce.boolean().default(true),
});
export type InvoiceSeriesInput = z.infer<typeof invoiceSeriesSchema>;

import { z } from "zod";

export const customInvoicePaymentSchema = z.object({
  paymentDate: z.string().min(1, "Payment date is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  paymentTypeId: z.string().uuid().optional().or(z.literal("")),
  referenceNote: z.string().max(500).optional().or(z.literal("")),
});
export type CustomInvoicePaymentInput = z.infer<typeof customInvoicePaymentSchema>;

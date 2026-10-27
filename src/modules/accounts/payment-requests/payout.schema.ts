import { z } from "zod";

export const paymentRequestPayoutSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Payment date is required"),
  amount: z.coerce
    .number({ message: "Amount is required" })
    .positive("Amount must be greater than 0")
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Amount can have at most 2 decimal places"),
  paymentTypeId: z.string().uuid("Payment type is required"),
  bankAccountId: z.string().uuid().optional().or(z.literal("")),
  // UTR / cheque number. Required when the money leaves a bank (not cash).
  referenceNumber: z.string().trim().max(100).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  // Cash withdrawal only: the cash payment type the money goes into.
  toPaymentTypeId: z.string().uuid().optional().or(z.literal("")),
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type PaymentRequestPayoutInput = z.infer<typeof paymentRequestPayoutSchema>;

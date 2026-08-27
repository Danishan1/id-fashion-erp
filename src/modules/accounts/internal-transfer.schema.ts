import { z } from "zod";

export const internalTransferSchema = z.object({
  transferDate: z.string().min(1, "Transfer date is required"),
  fromPaymentTypeId: z.string().uuid("From account is required"),
  fromBankAccountId: z.string().uuid().optional().or(z.literal("")),
  toPaymentTypeId: z.string().uuid("To account is required"),
  toBankAccountId: z.string().uuid().optional().or(z.literal("")),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  narration: z.string().max(500).optional().or(z.literal("")),
  // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type InternalTransferInput = z.infer<typeof internalTransferSchema>;

import { z } from "zod";

export const PAYMENT_TYPE_KINDS = ["CASH", "BANK", "CHEQUE", "CARD", "UPI", "OTHER"] as const;

export const paymentTypeSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(PAYMENT_TYPE_KINDS).default("CASH"),
  isActive: z.coerce.boolean().default(true),
});
export type PaymentTypeInput = z.infer<typeof paymentTypeSchema>;

export const bankAccountSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  bankName: z.string().min(1, "Bank name is required").max(200),
  accountNumber: z.string().min(1, "Account number is required").max(50),
  ifscCode: z.string().max(20).optional().or(z.literal("")),
  branch: z.string().max(200).optional().or(z.literal("")),
  accountHolderName: z.string().max(200).optional().or(z.literal("")),
  upiId: z.string().max(100).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

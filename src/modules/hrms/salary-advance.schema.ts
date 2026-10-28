import { z } from "zod";

/** Salary Management slice 5 (2026-10-28): Advance Salary. */
export const requestSalaryAdvanceSchema = z.object({
  amount: z.coerce
    .number({ message: "Amount is required" })
    .positive("Amount must be more than 0")
    .max(10_000_000, "Amount is too large")
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Amount can have at most 2 decimal places"),
  installments: z.coerce.number().int("Installments must be a whole number").min(1, "At least 1 installment").max(24, "At most 24 installments"),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
  /** A fresh id per form, so a retried submit doesn't raise a second request. */
  requestKey: z.string().min(8).max(100),
});
export type RequestSalaryAdvanceInput = z.infer<typeof requestSalaryAdvanceSchema>;

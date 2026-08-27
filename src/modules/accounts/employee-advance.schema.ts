import { z } from "zod";

export const employeeAdvanceSchema = z.object({
  advanceDate: z.string().min(1, "Advance date is required"),
  employeeId: z.string().uuid("Employee is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  paymentTypeId: z.string().uuid("Payment type is required"),
  bankAccountId: z.string().uuid().optional().or(z.literal("")),
  purpose: z.string().max(500).optional().or(z.literal("")),
  // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type EmployeeAdvanceInput = z.infer<typeof employeeAdvanceSchema>;

export const employeeAdvanceSettlementSchema = z.object({
  settlementDate: z.string().min(1, "Settlement date is required"),
  expenseAccountId: z.string().uuid("Expense account is required"),
  description: z.string().min(1, "Description is required").max(500),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  taxRateId: z.string().uuid().optional().or(z.literal("")),
});
export type EmployeeAdvanceSettlementInput = z.infer<typeof employeeAdvanceSettlementSchema>;

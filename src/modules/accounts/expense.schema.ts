import { z } from "zod";

// One flat row, single line — confirmed with the user (no child items table,
// no "Expense Report" multi-line shape).
export const expenseSchema = z.object({
  expenseDate: z.string().min(1, "Expense date is required"),
  accountId: z.string().uuid("Expense account is required"),
  supplierId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().min(1, "Description is required").max(500),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  taxRateId: z.string().uuid().optional().or(z.literal("")),
  // TDS (Tax Deducted at Source) — a plain percentage, computed on the base
  // `amount` (not the GST-inclusive total), matching standard Indian TDS
  // practice. Optional — most expenses have none.
  tdsPercentage: z.coerce.number().min(0, "TDS% cannot be negative").max(100, "TDS% cannot exceed 100%").optional(),
  paymentTypeId: z.string().uuid("Payment type is required"),
  bankAccountId: z.string().uuid().optional().or(z.literal("")),
  referenceNumber: z.string().max(100).optional().or(z.literal("")),
  // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

// Same shape as create — editing a DRAFT expense can change any field,
// never which company/branch it belongs to.
export const updateExpenseSchema = expenseSchema;

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

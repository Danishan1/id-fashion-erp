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
  paymentTypeId: z.string().uuid("Payment type is required"),
  bankAccountId: z.string().uuid().optional().or(z.literal("")),
  referenceNumber: z.string().max(100).optional().or(z.literal("")),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

// Same shape as create — editing a DRAFT expense can change any field,
// never which company/branch it belongs to.
export const updateExpenseSchema = expenseSchema;

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

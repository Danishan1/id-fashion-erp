import { z } from "zod";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

export const chartOfAccountSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  accountType: z.enum(ACCOUNT_TYPES),
  parentAccountId: z.string().uuid().optional().or(z.literal("")),
});

export type ChartOfAccountInput = z.infer<typeof chartOfAccountSchema>;

export const chartOfAccountStatusSchema = z.object({ isActive: z.boolean() });

export type ChartOfAccountStatusInput = z.infer<typeof chartOfAccountStatusSchema>;

export const accountLedgerQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type AccountLedgerQuery = z.infer<typeof accountLedgerQuerySchema>;

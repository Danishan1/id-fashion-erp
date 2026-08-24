import { z } from "zod";

export const journalLineSchema = z
  .object({
    accountId: z.string().uuid("Account is required"),
    debitAmount: z.coerce.number().min(0, "Cannot be negative").default(0),
    creditAmount: z.coerce.number().min(0, "Cannot be negative").default(0),
    description: z.string().max(500).optional().or(z.literal("")),
  })
  .refine((line) => (line.debitAmount > 0) !== (line.creditAmount > 0), {
    message: "Each line must have either a debit or a credit amount (not both, not neither).",
  });

export type JournalLineInput = z.infer<typeof journalLineSchema>;

export const journalSchema = z.object({
  journalDate: z.string().min(1, "Journal date is required"),
  narration: z.string().max(1000).optional().or(z.literal("")),
  lines: z.array(journalLineSchema).min(2, "At least two lines are required for a double-entry journal."),
});

export type JournalInput = z.infer<typeof journalSchema>;

export const reverseJournalSchema = z.object({
  narration: z.string().max(1000).optional().or(z.literal("")),
});

export type ReverseJournalInput = z.infer<typeof reverseJournalSchema>;

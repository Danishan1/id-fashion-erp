import { z } from "zod";

// baseCurrencyCode is deliberately not editable here — every posted
// financial document (Sales/Purchase Invoice, Payment, Expense) freezes its
// own currencyCode/exchangeRate at creation time under the assumption that
// the company's base currency doesn't change after the fact. Changing it
// after real transactions exist would silently misrepresent every
// historical report; if that's ever genuinely needed it's a data-migration
// decision, not a settings-page edit.
export const companySettingsSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  legalName: z.string().max(200).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(50).optional().or(z.literal("")),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  addressLine: z.string().max(500).optional().or(z.literal("")),
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

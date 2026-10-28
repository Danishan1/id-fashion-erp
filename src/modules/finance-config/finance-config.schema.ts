import { z } from "zod";

export const PAYMENT_TYPE_KINDS = ["CASH", "BANK", "CHEQUE", "CARD", "UPI", "OTHER"] as const;

export const paymentTypeSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(PAYMENT_TYPE_KINDS).default("CASH"),
  isActive: z.coerce.boolean().default(true),
});
export type PaymentTypeInput = z.infer<typeof paymentTypeSchema>;

export const FINANCIAL_ACCOUNT_KINDS = [
  "CURRENT",
  "SAVINGS",
  "CASH",
  "FIXED_DEPOSIT",
  "RECURRING_DEPOSIT",
  "CREDIT_CARD",
  "LOAN_GIVEN",
  "INVESTMENT",
] as const;
export type FinancialAccountKindKey = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

export const FINANCIAL_ACCOUNT_KIND_LABELS: Record<FinancialAccountKindKey, string> = {
  CURRENT: "Current Account",
  SAVINGS: "Savings Account",
  CASH: "Cash in Hand",
  FIXED_DEPOSIT: "Fixed Deposit",
  RECURRING_DEPOSIT: "Recurring Deposit",
  CREDIT_CARD: "Credit Card",
  LOAN_GIVEN: "Loan Given",
  INVESTMENT: "Investment",
};

/** Kinds held at a bank: bank name and account (or card) number are required. */
const BANK_HELD: ReadonlySet<string> = new Set(["CURRENT", "SAVINGS", "FIXED_DEPOSIT", "RECURRING_DEPOSIT", "CREDIT_CARD"]);

const optionalNumber = (max: number) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().min(0).max(max).optional());

export const bankAccountSchema = z
  .object({
    code: z.string().min(1, "Code is required").max(30),
    name: z.string().min(1, "Name is required").max(200),
    accountKind: z.enum(FINANCIAL_ACCOUNT_KINDS).default("CURRENT"),
    bankName: z.string().max(200).optional().or(z.literal("")),
    accountNumber: z.string().max(50).optional().or(z.literal("")),
    ifscCode: z.string().max(20).optional().or(z.literal("")),
    branch: z.string().max(200).optional().or(z.literal("")),
    accountHolderName: z.string().max(200).optional().or(z.literal("")),
    upiId: z.string().max(100).optional().or(z.literal("")),
    maturityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
    interestRate: optionalNumber(100),
    creditLimit: optionalNumber(9_999_999_999_999),
    // Optional on purpose: the plain Edit form doesn't send it, and an edit must
    // never quietly re-activate a deactivated account (only the toggle sends it).
    isActive: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!BANK_HELD.has(v.accountKind)) return;
    if (!v.bankName) ctx.addIssue({ code: "custom", path: ["bankName"], message: "Bank name is required for this kind of account." });
    if (!v.accountNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["accountNumber"],
        message: v.accountKind === "CREDIT_CARD" ? "Card number (or last 4 digits) is required." : "Account number is required.",
      });
    }
  });
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

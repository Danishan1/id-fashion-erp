/**
 * Payments Request hub (2026-10-27) — one entry per request type. Client-safe
 * (no Prisma import): the hub UI, the create form and the service all read
 * this file, so adding a request type means adding one entry here.
 *
 * `available: false` types are listed in the hub as "coming soon" and refused
 * by the API until their own skill (.claude/skills/<skill>) is built — they
 * need fields or postings the foundation doesn't have yet.
 */

export const PAYMENT_REQUEST_GROUPS = ["SALARY", "EXPENDITURE", "SUPPLIER", "INTERNAL_TRANSFER"] as const;
export type PaymentRequestGroupKey = (typeof PAYMENT_REQUEST_GROUPS)[number];

export const PAYMENT_REQUEST_TYPES = [
  "SALARY",
  "ADVANCE_REMINDER",
  "INVESTMENT",
  "TAX_INVOICE",
  "VOUCHER_SINGLE",
  "VOUCHER_MULTIPLE",
  "SUPPLIER_ON_ACCOUNT",
  "SUPPLIER_BILL",
  "SUPPLIER_ADJUSTMENT",
  "LOAN",
  "IMPREST",
  "FIXED_DEPOSIT",
  "CASH_WITHDRAWAL",
  "RECURRING_DEPOSIT",
  "BANK_TRANSFER",
  "CREDIT_CARD",
] as const;
export type PaymentRequestTypeKey = (typeof PAYMENT_REQUEST_TYPES)[number];

export const PAYMENT_MODES_OF_TRANSFER = ["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "CASH", "CARD", "OTHER"] as const;
export type PaymentModeOfTransferKey = (typeof PAYMENT_MODES_OF_TRANSFER)[number];

/** How the pay-to is picked: a registered supplier, an employee, or a typed name. */
export type PayToKind = "SUPPLIER" | "EMPLOYEE" | "TEXT";

export interface PaymentRequestTypeDef {
  type: PaymentRequestTypeKey;
  group: PaymentRequestGroupKey;
  label: string;
  description: string;
  payTo: PayToKind;
  /** Label of the pay-to field, e.g. "Who is the payto for the investment?". */
  payToLabel: string;
  /** Default routing until the Approval Matrix (payment-request-approval-matrix) overrides it. */
  routing: "APPROVAL_THEN_PAY" | "DIRECT_TO_ACCOUNTANT";
  showModeOfTransfer: boolean;
  available: boolean;
  /** The planning skill that finishes this type. */
  skill: string;
}

export const PAYMENT_REQUEST_GROUP_LABELS: Record<PaymentRequestGroupKey, string> = {
  SALARY: "Salary",
  EXPENDITURE: "Expenditure Payment",
  SUPPLIER: "Suppliers Payment",
  INTERNAL_TRANSFER: "Internal Transfer",
};

export const PAYMENT_REQUEST_TYPE_DEFS: Record<PaymentRequestTypeKey, PaymentRequestTypeDef> = {
  SALARY: {
    type: "SALARY",
    group: "SALARY",
    label: "Salary Request",
    description: "Created in bulk from the finalised salary sheet, or one at a time. Goes straight to the accountant.",
    payTo: "EMPLOYEE",
    payToLabel: "Employee",
    routing: "DIRECT_TO_ACCOUNTANT",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-salary",
  },
  ADVANCE_REMINDER: {
    type: "ADVANCE_REMINDER",
    group: "EXPENDITURE",
    label: "Request Advance Payment",
    description: "Just a reminder — money to pay in advance; adjusted when the bill comes.",
    payTo: "TEXT",
    payToLabel: "Pay to Name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-advance-reminder",
  },
  INVESTMENT: {
    type: "INVESTMENT",
    group: "EXPENDITURE",
    label: "Request Investment Payment",
    description: "Money paid out as an investment.",
    payTo: "TEXT",
    payToLabel: "Who is the payto for the investment?",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: true,
    skill: "payment-request-investment",
  },
  TAX_INVOICE: {
    type: "TAX_INVOICE",
    group: "EXPENDITURE",
    label: "Request for Tax Invoice (Non-Supplier)",
    description: "A GST tax invoice from someone who is not a registered supplier.",
    payTo: "TEXT",
    payToLabel: "Payto",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: true,
    available: false,
    skill: "payment-request-tax-invoice",
  },
  VOUCHER_SINGLE: {
    type: "VOUCHER_SINGLE",
    group: "EXPENDITURE",
    label: "Voucher Single Purpose (Other Than Bill)",
    description: "One purpose, no bill.",
    payTo: "TEXT",
    payToLabel: "Payto",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-voucher-single",
  },
  VOUCHER_MULTIPLE: {
    type: "VOUCHER_MULTIPLE",
    group: "EXPENDITURE",
    label: "Voucher Multiple Purpose (Other Than Bill)",
    description: "Several purposes in one voucher, no bill.",
    payTo: "TEXT",
    payToLabel: "Payto",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-voucher-multiple",
  },
  SUPPLIER_ON_ACCOUNT: {
    type: "SUPPLIER_ON_ACCOUNT",
    group: "SUPPLIER",
    label: "Payment Request on Account",
    description: "Advance to a registered supplier, adjusted against their bills later.",
    payTo: "SUPPLIER",
    payToLabel: "Registered supplier",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: true,
    skill: "payment-request-supplier-on-account",
  },
  SUPPLIER_BILL: {
    type: "SUPPLIER_BILL",
    group: "SUPPLIER",
    label: "Payment Request Against Supplier's Bill",
    description: "Book the supplier's bill and pay it.",
    payTo: "SUPPLIER",
    payToLabel: "Supplier",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: true,
    available: false,
    skill: "payment-request-supplier-bill",
  },
  SUPPLIER_ADJUSTMENT: {
    type: "SUPPLIER_ADJUSTMENT",
    group: "SUPPLIER",
    label: "Adjustment Against Payment on Account",
    description: "Book a bill against money already paid on account — no new payment.",
    payTo: "SUPPLIER",
    payToLabel: "Supplier",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-supplier-adjustment",
  },
  LOAN: {
    type: "LOAN",
    group: "INTERNAL_TRANSFER",
    label: "Request Loan Payment",
    description: "Money the company lends.",
    payTo: "TEXT",
    payToLabel: "Loan Payto Name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-loan",
  },
  IMPREST: {
    type: "IMPREST",
    group: "INTERNAL_TRANSFER",
    label: "Request Imprest Payment",
    description: "Imprest money given to an employee, settled later with bills.",
    payTo: "EMPLOYEE",
    payToLabel: "Payto Name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-imprest",
  },
  FIXED_DEPOSIT: {
    type: "FIXED_DEPOSIT",
    group: "INTERNAL_TRANSFER",
    label: "Request Fixed Deposits (Savings)",
    description: "Move money from a bank into a fixed deposit.",
    payTo: "TEXT",
    payToLabel: "FD account name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-fixed-deposit",
  },
  CASH_WITHDRAWAL: {
    type: "CASH_WITHDRAWAL",
    group: "INTERNAL_TRANSFER",
    label: "Request Cash Payment",
    description: "Withdraw cash from the bank into cash in hand.",
    payTo: "TEXT",
    payToLabel: "Cash Payto Name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: true,
    skill: "payment-request-cash-withdrawal",
  },
  RECURRING_DEPOSIT: {
    type: "RECURRING_DEPOSIT",
    group: "INTERNAL_TRANSFER",
    label: "Request For RDS Payment",
    description: "Monthly recurring deposit installment.",
    payTo: "TEXT",
    payToLabel: "RDS account name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-recurring-deposit",
  },
  BANK_TRANSFER: {
    type: "BANK_TRANSFER",
    group: "INTERNAL_TRANSFER",
    label: "Request Internal Transfer Within Banks",
    description: "Move money between the company's own bank accounts.",
    payTo: "TEXT",
    payToLabel: "Which bank account",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-bank-transfer",
  },
  CREDIT_CARD: {
    type: "CREDIT_CARD",
    group: "INTERNAL_TRANSFER",
    label: "Request Credit Card Payment",
    description: "Pay a company credit card bill.",
    payTo: "TEXT",
    payToLabel: "Credit card account name",
    routing: "APPROVAL_THEN_PAY",
    showModeOfTransfer: false,
    available: false,
    skill: "payment-request-credit-card",
  },
};

export const PAYMENT_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved — To Pay",
  PARTIALLY_PAID: "Part Paid",
  PAID: "Paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function typesOfGroup(group: PaymentRequestGroupKey): PaymentRequestTypeDef[] {
  return PAYMENT_REQUEST_TYPES.map((t) => PAYMENT_REQUEST_TYPE_DEFS[t]).filter((d) => d.group === group);
}

/** Overdue is derived, never stored: due date passed and money still owed. */
export function isPaymentRequestOverdue(status: string, paymentDueDate: string, todayIso: string): boolean {
  return (status === "APPROVED" || status === "PARTIALLY_PAID") && paymentDueDate.slice(0, 10) < todayIso;
}

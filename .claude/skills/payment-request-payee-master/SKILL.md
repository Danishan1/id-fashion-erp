---
name: payment-request-payee-master
description: Plan for a lightweight Payee master (non-supplier pay-to names with optional GSTIN, state, PAN and bank details) used by expenditure payment requests so "GST/VAT number fetched from pay-to" works, plus the Purpose master (purpose name / sub-category) used by vouchers, tax invoice lines and loan requests.
---

# Payee & Purpose masters

Part of `accounts-payment-requests-plan`. Depends on: foundation. Needed by: tax-invoice, vouchers,
advance-reminder, investment, loan.

## Why
Spec says "Payto" + "GST/VAT number (fetched from payto)" for non-supplier tax invoices. Suppliers already
have `taxRegistrationNo`; casual pay-to names (landlord, electrician, CA, investment party) don't exist anywhere.

## Payee master (`Payee`, `payees`)
companyId, code (master-code counter, prefix `PAY`), name (required, unique per company case-insensitive),
`payeeType` (INDIVIDUAL/BUSINESS/GOVERNMENT/OTHER), gstin (validate 15-char format; state = first 2 digits via
`extractStateCodeFromGstin`), stateCode (manual when no GSTIN), pan, phone, email, address,
bankDetailsJson {accountName, accountNumber, ifsc, upi}, isActive, soft delete.

Pay-to picker in forms = combined search over Suppliers (tagged "Supplier"), Employees (tagged "Employee",
only where the type allows) and Payees, plus "+ New payee" inline modal; free-text pay-to still allowed for
reminder-type requests (`payToName` only).

## Purpose master (`ExpensePurpose`)
companyId, code, name, `purposeGroup` (EXPENDITURE / LOAN / INVESTMENT / VOUCHER), parentId (sub-category),
default `expenseAccountId` (→ ChartOfAccount, validated with `assertValidExpenseAccount`), isActive. A purpose
pre-fills the GL account so a requester never needs to know accounts; accountant can change it at approval.

## API / UI
`/api/v1/payees`, `/api/v1/expense-purposes` (CRUD + `/status`); Masters → Finance Config tabs "Payees",
"Purposes" (`SimpleLookupManager` for purposes; DataTable + modal for payees). RBAC `masters_finance`;
inline "+ New payee" from a request needs `masters_finance.create` else hidden.

## Reuse
`finance-config` module patterns, `previewNextMasterCode`/`advanceMasterCodeSequence`, `src/lib/gst.ts`,
`isActive` optional-on-update rule (don't `.default(true)` — see CLAUDE.md P3 fix).

## Tests
GSTIN format + state extraction; duplicate name rejected; cross-company id → NOT_FOUND; deactivated payee
not selectable for new requests but still shown on old ones; purpose default account must be valid expense account.

## Done checklist (built 2026-10-28)
- [x] schema + migration `20261028110000_payees_and_expense_purposes` (+ rollback; CHECK not-own-parent);
      `payment_requests.payee_id`
- [x] `src/modules/finance-config/payee-purpose.service.ts` + routes `/api/v1/payees`, `/api/v1/expense-purposes`,
      `/api/v1/expense-purposes/expense-accounts`; Finance Config tabs "Payees" and "Purposes"
- [x] pay-to on typed-name request types: pick a Payee (searchable) or type a name (inline in `PaymentRequestForm`,
      not a separate `PayToPicker.tsx` — only one form uses it so far; extract when the second one needs it)
- [x] tests: payee-purpose.service.test.ts + payee pick on a request; full suite 3672 green; live check

As built:
- Codes are typed (lookup-manager suggests one from the name) — no master-code counter.
- GSTIN format checked; its first 2 digits become the state. Duplicate name (any case) refused.
- Payee/Purpose lists readable with masters_finance.view OR payment_requests.view (raisers need the pickers);
  create/edit stay masters_finance.
- "+ New payee" inline from a request is not built yet (create it in Masters first).
- Purpose: one level of sub-category, same group as parent; default expense account validated
  (active, EXPENSE, not COGS).

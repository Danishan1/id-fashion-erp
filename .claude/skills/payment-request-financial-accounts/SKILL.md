---
name: payment-request-financial-accounts
description: Plan for turning Bank Accounts into real financial accounts (kinds CURRENT/SAVINGS/CASH/FD/RD/CREDIT_CARD/LOAN/INVESTMENT) each with its own ledger sub-account, plus the new control accounts payment requests need (Salaries Payable, Advances Paid, GST-RCM, Investments). Use before building Internal Transfer requests, Salary or Investment payouts.
---

# Financial accounts & ledger sub-accounts

Part of `accounts-payment-requests-plan`. Depends on: nothing. Needed by: salary, investment, loan, FD, RD,
cash withdrawal, bank transfer, credit card, accountant payout.

## Problem today
`BankAccount` (finance-config master) has no kind and no ledger account. Every bank posts to one `BANK`
control account and every cash to `CASH`, so `InternalTransfer` refuses bank→bank (Dr BANK / Cr BANK) and
FD/RD/credit card/loan balances can't exist.

## Fields to add on `BankAccount`
- `accountKind` enum `FinancialAccountKind`: CURRENT, SAVINGS, CASH, FIXED_DEPOSIT, RECURRING_DEPOSIT,
  CREDIT_CARD, LOAN_GIVEN, INVESTMENT (default CURRENT for existing rows). No LOAN_TAKEN — user decided loan
  requests are only money we lend.
- `ledgerAccountId` FK ChartOfAccount (@unique) — auto-created child account under the right parent:
  CURRENT/SAVINGS → parent BANK (ASSET); CASH → CASH; FD/RD/LOAN_GIVEN/INVESTMENT → new ASSET parents
  `FD`, `RD`, `LOAN-GIVEN`, `INVESTMENTS`; CREDIT_CARD → new LIABILITY parent `CC-PAY`
- optional: `maturityDate`, `interestRate`, `openingBalance` (FD/RD/loan), `creditLimit` (card)
- Bank-number fields become optional for CASH/INVESTMENT kinds (Zod refine per kind)

## New system control accounts (seed + `ensure…` upsert on first use, like `ensureExpensesPayableAccount`)
`SALARY-PAY` (LIABILITY Salaries Payable), `EXP-SALARY` (exists), `ADV-PAID` (ASSET Advances to parties),
`SUP-ADV` (ASSET Advance to Suppliers — required, user decision), `GST-RCM-PAY` (LIABILITY),
`INVESTMENTS`, `FD`, `RD`, `LOAN-GIVEN`, `CC-PAY` parents.

## Posting rule change (careful — shared code)
Add one resolver `resolveMoneyAccount(companyId, paymentType, bankAccountId?)` in a new
`src/modules/accounts/money-account.ts`: if a bankAccount with a `ledgerAccountId` is given use it, else fall
back to CASH/BANK by `paymentType.type` (today's rule). Switch Expense payment, Payment post, Internal
Transfer, Employee Advance issue to it. Existing balances keep living on BANK/CASH — document that the old
BANK balance is not split retroactively (or offer a one-off opening journal per bank).

## Migration
Additive: enum, nullable `account_kind` default 'CURRENT', `ledger_account_id`; backfill job creates one child
account per existing bank row (code `BANK-<code>`) — no journals moved.

## UI
Masters → Finance Config → Bank Accounts: Kind select, kind-specific fields, read-only "Ledger account" link
to `/accounts/ledger?accountId=`. Pickers in requests filter by kind (e.g. FD request lists only FD accounts).

## RBAC
`masters_finance` (unchanged).

## Reuse
`finance-config.service.ts` / repository, `chart-of-account.service.ts`, `SimpleLookupManager` tab (or a small
custom form if kind fields are too many).

## Tests
child account created per kind under the right parent; resolver picks bank ledger, falls back correctly;
bank→bank transfer now posts Dr bankB / Cr bankA; inactive bank refused.

## Done checklist
- [ ] enum + columns + backfill + verified by SQL
- [ ] resolver used by every money-moving service, old tests still green
- [ ] Bank Accounts UI with kind
- [ ] trial balance still balances after backfill

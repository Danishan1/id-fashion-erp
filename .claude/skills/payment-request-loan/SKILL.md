---
name: payment-request-loan
description: Plan for Internal transfer → Request Loan Payment — loan amount, purpose sub-category, purpose name, loan pay-to, from bank account, due date, voice remark, remark, file; posts to a LOAN_GIVEN (asset) or LOAN_TAKEN repayment (liability) financial account — needs the user's answer which one.
---

# Request Loan Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, payee-master, accountant-payout.

## Fields (spec)
Loan Amount (2 dp), Purpose sub category (select — Purpose master, purposeGroup LOAN, parent/child), Purpose
Name (select/text within sub category), Loan Payto Name (PayToPicker: Payee/Employee/Supplier), From Account
(bank account select, kinds CURRENT/SAVINGS/CASH — **pre-selected at request time**, accountant may change at
payout), Payment Due Date (default today), Voice Remark, Remark, upload file (optional).

## ⚠ Open question (ask before building)
"Loan payment" = (A) we **lend** money (staff loan / party loan) → Dr LOAN-GIVEN <party> / Cr bank, or
(B) we **repay** a loan we took (EMI) → Dr LOAN-TAKEN <lender> [+ Dr interest expense split] / Cr bank.
Plan supports both via a required `loanDirection` field (GIVEN / REPAYMENT) and a "Loan account" select of
`BankAccount` kind LOAN_GIVEN / LOAN_TAKEN; for REPAYMENT add optional principal/interest split (interest → EXP-INTEREST).

## Routing / payout
APPROVAL_THEN_PAY; full payout only. Payout handler posts an `InternalTransfer` from the From Account to the loan
financial account (InternalTransfer already Dr to / Cr from — works once financial-accounts gives each its ledger;
interest split needs one extra journal line → extend InternalTransfer with optional `chargesAccountId/amount`
or post a plain Journal via `postJournalCore` with sourceModule INTERNAL_TRANSFER).

## Tests
GIVEN journal; REPAYMENT with interest split; from-account must be money account; full payout only.

## Done checklist
- [ ] user answer recorded here
- [ ] loan financial accounts usable
- [ ] form + payout
- [ ] tests

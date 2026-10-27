---
name: payment-request-loan
description: Plan for Internal transfer → Request Loan Payment (the company LENDS money) — loan amount, purpose sub-category, purpose name, loan pay-to, from bank account, due date, voice remark, remark, file; payout posts Dr Loan Given (asset) / Cr bank.
---

# Request Loan Payment (loan given by us)

Part of `accounts-payment-requests-plan`. Depends on: foundation, approval-matrix, financial-accounts,
payee-master, accountant-payout.
User decision (2026-10-27): **we lend** — no EMI/repayment-of-our-own-loan flow.

## Fields (spec)
Loan Amount (2 dp), Purpose sub category (select — Purpose master, purposeGroup LOAN, parent/child), Purpose
Name (select/text within sub category), Loan Payto Name (PayToPicker: Employee / Payee / Supplier — required),
From Account (bank account select, kinds CURRENT/SAVINGS/CASH — chosen at request, accountant may change at
payout), Payment Due Date (default today), Voice Remark, Remark, upload file (optional — loan agreement).

## Loan account
One `BankAccount` of kind LOAN_GIVEN per borrower, auto-created on first payout if missing (name "Loan — <pay-to>",
ledger under `LOAN-GIVEN` parent). Form shows the borrower's current outstanding loan (ledger balance).

## Routing / payout
Approval Matrix (default APPROVAL_THEN_PAY); full payout only. Payout = `InternalTransfer` From Account → loan
account: **Dr LOAN-GIVEN-<borrower> / Cr bank**. No P&L impact.

## Out of scope (note)
Loan recovery (borrower pays back / salary deduction for staff loans) is a receipt-side flow — later
(Dr bank / Cr LOAN-GIVEN; interest → income).

## Tests
loan account auto-created once per borrower; journal exact; from-account must be a money account; partial refused;
outstanding shown.

## Done checklist
- [ ] form + payout
- [ ] auto loan account
- [ ] tests

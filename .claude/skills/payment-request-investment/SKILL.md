---
name: payment-request-investment
description: Plan for Expenditure → Request Investment Payment — amount and investment pay-to; posts to an Investment financial account (asset), not an expense.
---

# Request Investment Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, payee-master, accountant-payout.

## Fields (spec + common)
- Amount (required, 2 dp)
- "Who is the payto for the investment?" — required; PayToPicker over Payees (+ new) — e.g. mutual fund, broker, party
- Investment account — select of `BankAccount` kind INVESTMENT (create inline if user has `masters_finance.create`);
  **not in spec** but needed for the ledger — confirm, else auto-create one INVESTMENT account per payee
- Payment Due Date (default today), Voice Remark, Remark, files (optional)
- Purpose (optional, purposeGroup INVESTMENT)

## Routing
APPROVAL_THEN_PAY (management usually approves investments; suggest approvalLimit setting).

## Journal (payout)
Dr <investment ledger account> / Cr bank. Investment is an ASSET — never shows in P&L.
Redemption/return of investment = out of scope (receipt side) — note as follow-up.

## Tests
payout journal uses investment ledger; expense accounts never touched; partial payouts allowed (installments).

## Done checklist
- [ ] form + validation
- [ ] payout handler
- [ ] tests

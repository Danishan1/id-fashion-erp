---
name: payment-request-recurring-deposit
description: Plan for Internal transfer → Request For RDS Payment (recurring deposit installment) — RDS amount, RDS account name select, due date, voice remark, remark, upload; payout moves money to an RD financial account.
---

# Request RDS (Recurring Deposit) Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.
⚠ Confirm with user: "RDS" = Recurring Deposit Scheme (assumed).

## Fields (spec)
RDS amount (2 dp), RDS account name (select `BankAccount` kind RECURRING_DEPOSIT, required), Due Date (default
today), Voice Remark, Remark, upload (optional).

## Improvement
RD = monthly installments: offer "Repeat monthly" → auto-create next month's request (or a schedule list on
the RD account: installment amount + day of month; a daily job creates the request N days before). v1: manual.

## Routing / payout
Default APPROVAL_THEN_PAY (often pre-approved — allow DIRECT_TO_ACCOUNTANT in type settings). Full payout.
Journal: Dr RD-<acct> / Cr bank via InternalTransfer.

## Tests
only RD-kind accounts; journal; (v2) schedule creates one request per month, idempotent.

## Done checklist
- [ ] form + payout
- [ ] tests
- [ ] decision on recurring schedule recorded

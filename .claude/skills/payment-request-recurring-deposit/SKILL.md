---
name: payment-request-recurring-deposit
description: Plan for Internal transfer → Request For RDS Payment (recurring deposit installment) — RDS amount, RDS account name select, due date, voice remark, remark, upload; payout moves money to an RD financial account.
---

# Request RDS (Recurring Deposit) Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.
User decision (2026-10-27): RDS = Recurring Deposit; the **accountant creates the request manually every month**.

## Fields (spec)
RDS amount (2 dp), RDS account name (select `BankAccount` kind RECURRING_DEPOSIT, required), Due Date (default
today), Voice Remark, Remark, upload (optional).

## Monthly creation (manual)
No auto-schedule. Help the accountant: "Copy last month's RD request" button (same account + amount, due date +1
month) and a warning if an RD request for the same account already exists in the same month.

## Routing / payout
Default APPROVAL_THEN_PAY (often pre-approved — admin can set DIRECT_TO_ACCOUNTANT for RECURRING_DEPOSIT in the Approval Matrix). Full payout.
Journal: Dr RD-<acct> / Cr bank via InternalTransfer.

## Tests
only RD-kind accounts; journal; copy-last-month pre-fills; same-month duplicate warning.

## Done checklist
- [ ] form + payout
- [ ] tests
- [ ] copy-last-month + duplicate warning

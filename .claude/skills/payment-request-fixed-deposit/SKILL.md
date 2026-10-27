---
name: payment-request-fixed-deposit
description: Plan for Internal transfer → Request Fixed Deposits (Savings) — FD amount, FD account name, due date, voice remark, remark, upload; payout moves money from a bank to an FD financial account (asset).
---

# Request Fixed Deposit

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.

## Fields (spec)
FD amount (2 dp), FD account name (select `BankAccount` kind FIXED_DEPOSIT; "+ new FD account" inline with bank,
FD no, maturity date, interest % — needs `masters_finance.create`), Due Date (default today), Voice Remark,
Remark, upload (optional — FD receipt usually comes after; allow upload on the request later).

## Routing / payout
APPROVAL_THEN_PAY; full payout only. Payout modal asks the source bank (CURRENT/SAVINGS). Handler posts an
`InternalTransfer` source bank → FD ledger: Dr FD-<acct> / Cr bank. FD maturity/interest receipt = out of scope (v2:
"FD matured" receipt request: Dr bank / Cr FD + Cr interest income).

## Tests
only FD-kind accounts selectable; journal Dr FD / Cr bank; partial payout refused.

## Done checklist
- [ ] form + payout
- [ ] tests

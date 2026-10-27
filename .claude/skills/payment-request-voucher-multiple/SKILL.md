---
name: payment-request-voucher-multiple
description: Plan for Expenditure → Voucher Multiple Purpose (Other Than Bill) — amount, pay-to, due date, receipt/voucher YES/NO and a purpose/amount line table that must add up to the amount; posts as a multi-line Expense.
---

# Voucher — Multiple Purpose (Other Than Bill)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master, voucher-single (shares print),
tax-invoice (ExpenseLine table), accountant-payout.

## Fields (spec)
Amount, Payto, Payment Due Date (default today), "Do you have any receipt/voucher?" YES/NO (default NO; YES ⇒
files required, same rule as advance-reminder), Voice Remark, Remark.

## Added (needed to make "multiple purpose" real — confirm with user)
Lines: Purpose (select, required), Description (optional), Amount (2 dp, > 0). Rules: ≥ 2 lines (else use single
voucher — soft hint, not a block), **sum of lines = Amount** (server-enforced), no GST.

## Ledger / journal
Expense with `ExpenseLine` per purpose (one Dr per line account, merged by account) / Cr EXP-PAY on first payout;
payouts Dr EXP-PAY / Cr bank.

## Tests
sum mismatch refused; YES without files refused; journal merges same-account lines; print lists every line.

## Done checklist
- [ ] line table UI
- [ ] validation (sum, files)
- [ ] Expense multi-line mapping
- [ ] tests

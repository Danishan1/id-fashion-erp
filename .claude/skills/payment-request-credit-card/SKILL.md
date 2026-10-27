---
name: payment-request-credit-card
description: Plan for Internal transfer → Request Credit Card Payment — amount, credit card account name, due date, voice remark, remark, upload (statement); payout pays the card bill from a bank, reducing the card liability.
---

# Request Credit Card Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.

## Fields (spec)
Amount (2 dp), Credit card account name (select `BankAccount` kind CREDIT_CARD — card name, last 4 digits,
bank, credit limit), Due Date (default today — suggest card statement due date), Voice Remark, Remark, upload
(statement PDF, optional).

## Related gap (note, not in this skill's scope)
Card **spends** must also be recordable: Expense/voucher payout with payment type CARD + card account ⇒ Cr
card liability instead of bank. Comes for free once `resolveMoneyAccount` uses the card's ledger (financial-accounts).
Show card outstanding (ledger balance) on this form.

## Routing / payout
APPROVAL_THEN_PAY; partial payout allowed (minimum due vs full). Journal: Dr CC-<card> (liability) / Cr bank.

## Tests
only CREDIT_CARD kinds; journal reduces liability; outstanding shown; card spend via expense credits the card.

## Done checklist
- [ ] form + payout
- [ ] card spend path verified
- [ ] tests

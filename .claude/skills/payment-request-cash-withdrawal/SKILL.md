---
name: payment-request-cash-withdrawal
description: Plan for Internal transfer → Request Cash Payment — cash amount, cash pay-to name, due date, voice remark, remark, upload; payout is a bank-to-cash InternalTransfer (cash withdrawal for the petty-cash box / named cash holder).
---

# Request Cash Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.

## Fields (spec)
Cash amount (2 dp), Cash Payto Name (who collects the cash — Employee picker or text; or a CASH-kind financial
account like "Factory Petty Cash"), Due Date (default today), Voice Remark, Remark, upload (optional).

## Clarify
If the cash is handed to a person to spend → that's imprest (`payment-request-imprest`); this request is
bank → cash-in-hand movement. UI hint on both forms.

## Routing / payout
APPROVAL_THEN_PAY; full payout. Payout handler: `InternalTransfer` from bank (picked in modal) to the CASH
financial account (default company CASH): Dr CASH-<acct> / Cr bank. Already supported today (BANK→CASH works
even without financial-accounts) — this skill mostly wraps the existing `createInternalTransfer` + post.

## Tests
from must be bank, to must be cash; journal; no P&L impact.

## Done checklist
- [ ] form + payout
- [ ] hint vs imprest
- [ ] tests

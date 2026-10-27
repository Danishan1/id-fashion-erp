---
name: payment-request-bank-transfer
description: Plan for Internal transfer → Request Internal Transfer Within Banks of the Project — amount, which bank account (to), due date, voice remark, remark, upload; bank-to-bank InternalTransfer, which today is refused because all banks share one BANK ledger account.
---

# Request Internal Transfer Within Banks

Part of `accounts-payment-requests-plan`. Depends on: **financial-accounts (hard dependency)**, foundation, accountant-payout.

## Fields (spec)
Amount (2 dp), Which bank account (= destination, select CURRENT/SAVINGS kinds), Due Date (default today), Voice
Remark, Remark, upload (optional). Added: From bank account (optional at request, required at payout; must
differ from destination).

## Current blocker
`internal-transfer.service.ts` refuses same-control-account transfers (BANK→BANK = Dr BANK / Cr BANK no-op).
After financial-accounts gives each BankAccount its own ledger account, InternalTransfer must compare
**ledger accounts**, not payment-type kinds — update that validation and its tests.

## Routing / payout
APPROVAL_THEN_PAY; full payout; UTR required. Journal: Dr bank-to ledger / Cr bank-from ledger.

## Tests
same from/to refused; bank→bank posts two different ledger accounts; old CASH↔BANK transfers still work.

## Done checklist
- [ ] InternalTransfer validation switched to ledger accounts
- [ ] form + payout
- [ ] tests

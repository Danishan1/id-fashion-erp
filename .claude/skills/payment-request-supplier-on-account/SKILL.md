---
name: payment-request-supplier-on-account
description: Plan for Suppliers payment → Payment Request on Account — amount, registered supplier, due date, voice remark, remarks; after approval the accountant's payout creates a posted PAYMENT_OUT Payment with zero allocations (on-account), adjustable later.
---

# Supplier — Payment Request on Account

Part of `accounts-payment-requests-plan`. Depends on: foundation, accountant-payout.

## Fields (spec)
Amount (2 dp), Registered supplier (select, active suppliers only), Payment Due Date (default today), Voice
Remark, Remarks. Show supplier's current outstanding (posted unpaid purchase invoices) and unallocated
on-account balance beside the picker (reuse `listOutstandingInvoicesForParty` in `payment.service.ts`) so the
requester sees if a bill already exists (then suggest "Payment Against Bill").

## Routing
APPROVAL_THEN_PAY.

## Payout
Handler creates `Payment` (direction PAYMENT_OUT, supplierId, amount = payout amount, allocations []) and posts it
in the same tx (`postPaymentInTx`), stores `paymentId` on the payout row (many payouts ⇒ many payments).
Journal = existing: Dr AP / Cr bank. **Improvement option**: post to `SUP-ADV` (Advance to suppliers) instead
of AP so AP never shows a debit balance; then allocation must move SUP-ADV → AP. Bigger change to `allocatePayment`
(today "no new journal") — recommend keep Dr AP for v1, list as follow-up. Decide with user.

## Later use
The resulting unallocated payment is what `payment-request-supplier-adjustment` consumes.

## Tests
inactive supplier refused; payout creates posted payment with zero allocations; unallocated balance visible;
partial payouts create separate payments.

## Done checklist
- [ ] form with outstanding info
- [ ] payout handler via Payment
- [ ] tests

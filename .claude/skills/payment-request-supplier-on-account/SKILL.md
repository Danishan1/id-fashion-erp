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
User decision (2026-10-27): post to a separate **Advance to Suppliers** account.
Journal: **Dr SUP-ADV / Cr bank** (not AP). Needs a flag `isAdvance` on `Payment` so `postPayment` debits
SUP-ADV instead of AP for supplier advances made through this request. `allocatePayment` must then post a
reclass journal **Dr AP / Cr SUP-ADV** for the allocated amount (today it posts nothing) — only for advance
payments; older on-account payments keep current behaviour. Supplier advance balance = unallocated amount of
that supplier's advance payments (shown on supplier ledger / outstanding).

## Later use
The resulting unallocated payment is what `payment-request-supplier-adjustment` consumes.

## Tests
inactive supplier refused; payout creates posted payment with zero allocations and Dr SUP-ADV; later allocation posts Dr AP / Cr SUP-ADV; unallocated balance visible;
partial payouts create separate payments.

## Done checklist
- [ ] form with outstanding info
- [ ] payout handler via Payment
- [ ] tests

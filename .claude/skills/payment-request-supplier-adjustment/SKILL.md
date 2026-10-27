---
name: payment-request-supplier-adjustment
description: Plan for Suppliers payment → Adjustment Against Payment on Account — same fields as the supplier-bill request, but instead of paying cash it books the bill and allocates an existing unallocated on-account payment to it (no money moves).
---

# Supplier — Adjustment Against Payment on Account

Part of `accounts-payment-requests-plan`. Depends on: supplier-bill, supplier-on-account.

## Fields
Exactly the supplier-bill fields (reuse the same form component with `mode="ADJUSTMENT"`), plus a required
**"Adjust against" picker**: the supplier's POSTED payments with unallocated balance (amount, date, number,
unallocated) — one or several, with amount to use per payment. Mode of Transfer hidden (no cash).

## Validation
sum of chosen allocations ≤ each payment's unallocated and ≤ bill Grand Total; supplier must match; if bill >
adjustments, remaining stays payable on the purchase invoice (user can raise a normal payment request later —
show the leftover clearly).

## Flow
Approval (configurable; default APPROVAL_THEN_PAY) → on approval: post the direct-bill PurchaseInvoice (shared
with supplier-bill) **and** call `allocatePayment()` for each chosen payment in the same transaction (extract
`allocatePaymentInTx`). Request goes straight to `PAID` (no payout row; or one payout row with
`kind=ADJUSTMENT`, amount = adjusted, no journal) — the accountant has nothing to pay.

## Journal
Purchase invoice post: Dr expense/COGS [+ITC] / Cr AP. Allocation: none (existing rule — on-account payment
already debited AP). If SUP-ADV option from supplier-on-account is adopted, allocation posts Dr AP / Cr SUP-ADV.

## Tests
over-allocation refused; payment of another supplier refused; invoice becomes PAID/PARTIALLY_PAID; no
cash/bank journal line created.

## Done checklist
- [ ] adjust-against picker
- [ ] allocatePaymentInTx
- [ ] approval handler
- [ ] tests

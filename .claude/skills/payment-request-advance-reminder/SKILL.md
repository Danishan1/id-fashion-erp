---
name: payment-request-advance-reminder
description: Plan for Expenditure → Request Advance Payment ("Just a Reminder") — amount, pay-to name, due date default today, invoice/voucher YES/NO with conditional number/date/required files; posts to an Advances-to-parties asset and is later adjusted against the real bill.
---

# Request Advance Payment (Just a Reminder)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master, accountant-payout.

## Fields (spec)
| Field | Rule |
|---|---|
| Amount | required, > 0, 2 dp |
| Pay to Name | required; PayToPicker (Supplier/Payee) or free text |
| Payment Due Date | optional, default today |
| Voice Remark / Remark | optional |
| Do you have any Invoice/Voucher? | YES/NO radio, **default NO** |
| Invoice/Voucher Number | shown if YES, optional |
| Invoice/Voucher Date | shown if YES, optional, not future |
| Upload files | shown if YES, **required if YES** (≥1 file; PDF/JPG/PNG) |

Validation must be server-side too: `hasInvoice=true` ⇒ at least one non-voice attachment before submit
(two-step: create request then upload ⇒ submit gate, or multipart create like `expenses/upload-bill`).

## Meaning (confirmed by user 2026-10-27)
"Reminder" = money must go out but no expense classification yet. Accountant pays it as an **advance**.

## Routing / status
Default APPROVAL_THEN_PAY (configurable). Standard statuses + extra derived flag `adjustmentStatus`
(UNADJUSTED / PARTIALLY_ADJUSTED / ADJUSTED) from linked settlements.

## Journal
- Payout: Dr ADV-PAID (sub-ledger by pay-to) / Cr bank-cash.
- Adjustment later ("Adjust advance" action on the request, or from Tax Invoice / Voucher request "adjust
  against advance"): Dr expense [+ GST-ITC] / Cr ADV-PAID. Reuse EmployeeAdvanceSettlement *pattern* (not the
  model — that one is employee-only); new `PaymentRequestAdjustment` rows (amount ≤ unadjusted).
- If pay-to is a registered Supplier: steer to Supplier on Account (posts to SUP-ADV) — hint in UI.

## API/UI
Form in `/accounts/payment-requests/new?type=ADVANCE_REMINDER`; detail shows Adjust Advance modal.

## Tests
YES without files refused; NO hides invoice fields and ignores them; due date defaults today; payout journal;
adjustment cap; adjustment journal.

## Done checklist
- [ ] form + conditional validation
- [ ] payout handler (ADV-PAID)
- [ ] adjustment action + journal
- [ ] tests

---
name: payment-request-voucher-single
description: Plan for Expenditure → Voucher Single Purpose (Other Than Bill) — amount, pay-to, purpose name, "is pay-to same as beneficiary" checkbox with beneficiary, due date; posts as a single-purpose Expense without a tax invoice.
---

# Voucher — Single Purpose (Other Than Bill)

Part of `accounts-payment-requests-plan`. Depends on: foundation, payee-master, accountant-payout.

## Fields (spec + common)
| Field | Rule |
|---|---|
| Amount | required, 2 dp |
| Payto | required (PayToPicker / free text) |
| Purpose name | required, select from Purpose master (purposeGroup VOUCHER/EXPENDITURE) |
| Is payto same as beneficiary? | checkbox, default checked |
| Beneficiary | required when unchecked (text or picker); when checked = payto copied |
| Payment Due Date | default today |
| Voice Remark, Remark, files | optional |

No GST (it's "other than bill") — taxRate forced null, ITC impossible.

## Ledger
Expense (single line): account = purpose.defaultExpenseAccountId (accountant can change), supplierId if payto is
a supplier, description = "<purpose> — beneficiary <name>". Beneficiary stored on request (typeDataJson) and
shown on the payment voucher print.

## Journal
Same as today's Expense: first payout Dr expense / Cr EXP-PAY (accrual) then Dr EXP-PAY / Cr bank. TDS optional
(accountant can set at approval for contractor-type payments).

## Print
Add "Payment Voucher" PDF (reuse `src/core/documents/slip-pdf.tsx`-style template): number, date, pay-to, beneficiary,
purpose, amount in words, signatures (prepared/approved/paid/receiver).

## Tests
checkbox copies payto; unchecked without beneficiary refused; no tax accepted; voucher PDF renders.

## Done checklist
- [ ] form + validation
- [ ] Expense creation mapping
- [ ] voucher PDF
- [ ] tests

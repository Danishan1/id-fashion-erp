---
name: payment-request-accountant-payout
description: Plan for the accountant's "To Pay" queue and the Pay action on any approved payment request — full/partial payouts, payment type, bank account, UTR/reference, payment proof upload, and how each request type's payout handler calls the existing Expense/Payment/PurchaseInvoice/InternalTransfer/EmployeeAdvance services in one transaction.
---

# Accountant payout (Pay action + queue)

Part of `accounts-payment-requests-plan`. Depends on: foundation, approval-matrix, financial-accounts.

## Queue UI
`/accounts/payment-requests?tab=to-pay`: APPROVED + PARTIALLY_PAID requests, sorted by due date, overdue
highlighted (derived), filters group/type/pay-to/due range, totals per mode. Bulk select → "Pay selected" for
same-type requests (salary, vouchers) creates one payout per request (not one combined journal).

## Pay modal fields
paymentDate (default today, not future), amount (default remaining, ≤ remaining, 2 dp), paymentTypeId,
bankAccountId (required when paymentType ≠ CASH; filtered to CURRENT/SAVINGS/CASH kinds), referenceNumber
(UTR/cheque no — required for NEFT/RTGS/IMPS/CHEQUE), notes, payment proof file (optional) + voice note.
Partial pay allowed except types that create a one-shot transfer (FD/RD/bank transfer/credit card/loan — full only).

## Payout handler contract
`registry[type].payout(tx, actor, request, payoutInput) → { journalId, linkedDocId }`. Every handler must run
inside ONE `prisma.$transaction` with the request's guarded `paidAmount` increment
(`updateMany where paidAmount <= amount - payAmount`) and status recompute. Existing services open their own
transactions — **extract `…InTx` variants** (e.g. `recordExpensePaymentInTx`, `postPaymentInTx`,
`postInternalTransferInTx`, `issueEmployeeAdvanceInTx`, `postPurchaseInvoiceInTx`) keeping the public
functions as thin wrappers. Don't call PermissionService inside InTx variants (route + request service assert).

| Group | Handler creates / uses |
|---|---|
| Salary | Dr SALARY-PAY / Cr bank per employee (payroll accrual done at request creation) |
| Expenditure | an Expense in APPROVED state on first payout (internal `createApprovedExpenseInTx`), then `recordExpensePaymentInTx` |
| Supplier on account | Payment PAYMENT_OUT marked advance, zero allocations, posted Dr SUP-ADV / Cr bank |
| Supplier bill | PurchaseInvoice (direct lines) posted at approval → Payment allocated to it at payout |
| Adjustment | no cash: `allocatePayment` only (no payout row amount moved; marks request PAID) |
| Internal transfer types | InternalTransfer posted (from/to = financial accounts), or EmployeeAdvance issued (imprest) |

## Self-approval / segregation
Pay = `payment_requests.post` with `resourceContext.createdBy` (creator can't pay own request unless SUPER_ADMIN).
Whether an approver may also pay comes from the request's Approval Matrix rule (`approverMayPay`, default false).

## Idempotency
Pay modal sends `idempotencyKey` (UUID per modal open); `PaymentRequestPayout @@unique([companyId, idempotencyKey])`, P2002 → return existing.

## Tests
partial then full → PAID; over-pay refused; concurrent pay race (guard count=0 → rollback); bank required for
non-cash; full-only types reject partial; each handler's journal lines exact; cancel blocked once paid.

## Done checklist (built 2026-10-27)
- [x] payout service `payout.service.ts` + `POST /api/v1/payment-requests/:id/payouts` + Pay modal + "Payments made"
      table; the To Pay tab already existed. Migration `20261027160000_payment_request_payouts` (+ `payments.is_advance`).
- [x] handlers for the types that can be raised today:
      SUPPLIER_ON_ACCOUNT → posted Payment (isAdvance) Dr SUP-ADV / Cr Cash-Bank;
      CASH_WITHDRAWAL → posted InternalTransfer, Dr CASH / Cr BANK (full only);
      INVESTMENT → journal Dr INVESTMENTS / Cr Cash-Bank (one control account until financial-accounts).
      Every other type refuses "not available yet" until its own skill registers a handler in `PAYOUT_HANDLERS`.
- [x] `allocatePayment` on an advance Payment posts Dr AP / Cr SUP-ADV for the allocated part.
- [x] `reverseJournal` refuses PAYMENT_REQUEST-sourced journals.
- [x] approver-may-pay enforced (`mayPayAfterApproving`); Super Admin exempt, like its other overrides.
- [x] payment proof: uploaded on the request's own Files & Voice Remarks (no separate payout attachment target).
- [x] tests (payout.service.test.ts + advance reclass test), full suite 3650 green, live payouts checked in the DB.

As built (difference from the plan above): no `…InTx` extraction of the existing services. Each handler creates its
document directly in POSTED state inside the payout transaction and posts the journal through `postJournalCore`
(the same engine) — the existing services' own DRAFT→POST flows and permission checks are untouched. A new type adds
a handler; it never edits another module's service.

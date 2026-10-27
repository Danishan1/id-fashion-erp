---
name: payment-request-accountant-payout
description: Plan for the accountant's "To Pay" queue and the Pay action on any approved payment request — full/partial payouts, payment type, bank account, UTR/reference, payment proof upload, and how each request type's payout handler calls the existing Expense/Payment/PurchaseInvoice/InternalTransfer/EmployeeAdvance services in one transaction.
---

# Accountant payout (Pay action + queue)

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts.

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
| Supplier on account | Payment PAYMENT_OUT, zero allocations, posted |
| Supplier bill | PurchaseInvoice (direct lines) posted at approval → Payment allocated to it at payout |
| Adjustment | no cash: `allocatePayment` only (no payout row amount moved; marks request PAID) |
| Internal transfer types | InternalTransfer posted (from/to = financial accounts), or EmployeeAdvance issued (imprest) |

## Self-approval / segregation
Pay = `payment_requests.post` with `resourceContext.createdBy` (creator can't pay own request unless SUPER_ADMIN).
Approver may also pay (allowed — confirm with user if they want approver ≠ payer).

## Idempotency
Pay modal sends `idempotencyKey` (UUID per modal open); `PaymentRequestPayout @@unique([companyId, idempotencyKey])`, P2002 → return existing.

## Tests
partial then full → PAID; over-pay refused; concurrent pay race (guard count=0 → rollback); bank required for
non-cash; full-only types reject partial; each handler's journal lines exact; cancel blocked once paid.

## Done checklist
- [ ] InTx extractions with old tests unchanged
- [ ] payout service + route + modal + queue tab
- [ ] payment proof attachment
- [ ] tests + live check of one request per group

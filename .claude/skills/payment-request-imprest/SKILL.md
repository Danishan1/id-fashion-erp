---
name: payment-request-imprest
description: Plan for Internal transfer → Request Imprest Payment — imprest amount, pay-to name, due date, voice remark, remark, "do you have any document?"; after approval the payout issues an Employee Advance (existing imprest module with settlements).
---

# Request Imprest Payment

Part of `accounts-payment-requests-plan`. Depends on: foundation, accountant-payout. Reuses the existing
Employee Advance module (`employee-advance.service.ts`, `/accounts/employee-advances`).

## Fields (spec)
Imprest Amount (2 dp), Payto Name (**Employee picker only** — user decision 2026-10-27: imprest is never given
to non-employees; inactive employees not selectable), Due Date (default today), Voice
Remark, Remark, "Do you have any document?" YES/NO (default NO; YES ⇒ file required).
Default: requester may raise for themselves (pre-select own linked Employee via `User.employeeId`).

## Routing / payout
APPROVAL_THEN_PAY. Payout = create EmployeeAdvance (amount = payout amount, paymentType/bank from payout modal,
purpose = remark) and issue it in the same tx (`issueEmployeeAdvanceInTx`): Dr EMP-ADV / Cr bank-cash. Full payout
only (one advance per request). Settlements/bills afterwards happen in the existing Employee Advance screen
(link shown on the request: "Settle bills →").

## Improvement
Show per-employee open imprest balance on the form (sum of ISSUED/PARTIALLY_SETTLED unsettled) and warn when
raising a new one while old is unsettled (configurable block).

## Tests
payout creates ISSUED advance with exact journal; YES without file refused; unsettled warning; request links to advance.

## Done checklist
- [ ] issueEmployeeAdvanceInTx extraction
- [ ] form + payout handler
- [ ] open-balance warning
- [ ] tests

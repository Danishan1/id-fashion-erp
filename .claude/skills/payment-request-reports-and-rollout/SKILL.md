---
name: payment-request-reports-and-rollout
description: Plan for the payment-request reports (register, due/overdue, payee-wise, TDS, GST input ITC/RCM, salary payout, imprest/advance aging), the navigation/menu rollout replacing the old Expenses entry, data migration of existing expenses, notifications, and the final QA pass.
---

# Reports, rollout and QA

Part of `accounts-payment-requests-plan`. Build last.

## Reports (`src/modules/reports/`, `registerReport()` + page meta, category Expenses/Payables)
- Payment Request Register (all types, status, approver, payer, due, paid) — totals exclude CANCELLED/REJECTED
- Due & Overdue Payments (APPROVED/PARTIALLY_PAID by due date, ageing buckets)
- Pay-to / Payee-wise summary
- TDS deducted register (Expense.tdsAmount, by pay-to + PAN)
- GST Input register: ITC claimed, ITC not claimed, RCM liability, raw-material flag, place of supply
- Salary payout by month (requested vs paid vs pending)
- Advances & imprest outstanding (ADV-PAID unadjusted, EMP-ADV unsettled)
- Financial accounts balances (FD/RD/loan/credit card)
Use `parseReportDateRange`, `round2`, `validateStatusFilter`, branch scope — Phase 10 lessons.

## Navigation / UX
Accounts hub: "Expenses & Payment Requests" card → `/accounts/payment-requests` (4 group tabs + My / To approve
/ To pay). Keep Expenses, Payments, Internal Transfers, Employee Advances, Purchase Invoices pages as the
ledger documents (links from each request). Dashboard tiles: "Requests to approve", "Payments due today".

## Notifications
In-app (`NotificationService`): approver on new request, requester on approve/reject/paid, accountant on
approved/direct request, overdue digest daily (worker job, once per request per day).

## Data migration
Existing `Expense` rows stay as they are (not converted). Optional: show them in the register as "Legacy
expense" via a union view. No historical journal touched.

## RBAC rollout
Sync permission catalog (`scripts/sync-permission-catalog.mjs`), grant per role, update `permission-groups.ts`
labels, sidebar `modules` for the new page so `route-modules.ts` gates it.

## Final QA (erp-qa-uat agent)
One request of every type end-to-end; journal per type hand-checked; trial balance balanced; self-approval and
self-pay blocked; partial payouts; voice + files on every type; Excel upload; credit note; branch scoping;
role matrix (requester / approver / accountant / viewer).

## Done checklist
- [ ] reports registered + reconciled to ledger
- [ ] nav + dashboard tiles
- [ ] notifications
- [ ] CLAUDE.md section written (this module's history)
- [ ] full QA report saved in docs/accounts/

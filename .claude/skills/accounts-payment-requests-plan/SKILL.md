---
name: accounts-payment-requests-plan
description: Master index for the Accounts → Expenses → "Payments Request" redesign (Salary, Expenditure, Supplier and Internal Transfer requests with voice remark/remark, approval→accountant payout). Use first whenever working on payment requests, expenses redesign, salary payout, supplier bill/on-account/credit note, imprest, FD/RD/loan/credit card/bank transfer requests — it lists every planning skill in build order with dependencies so no spec point is missed.
---

# Payments Request — master plan (index)

Full audit + gap analysis: `docs/accounts/PAYMENT_REQUESTS_PLAN.md`. Each row below is its own skill
(`.claude/skills/<name>/SKILL.md`) with exact fields, validations, status flow, journal, schema/API/UI/RBAC,
reuse, tests and a done-checklist. Build one skill at a time, tick its checklist, stop for user review.

## Rules for every skill
- Planning skills: read the skill + the docs file before coding; never skip a spec field. If a skill lists an
  "open question", ask the user (AskUserQuestion) before building that part.
- Every request: Voice Remark (optional) + Remark (optional) + due date (default today) + files.
- Reuse the existing posting engines (Expense, Payment, PurchaseInvoice, InternalTransfer, EmployeeAdvance,
  `postJournalCore`); never write a second journal engine. All money 2 dp, server-side totals only.
- Follow CLAUDE.md conventions: company + branch scoping, self-approval guard, idempotency keys, audit log,
  hand-written migrations verified by SQL, `key={id}` on detail panels, tsc/eslint/vitest + live check.

## Build order
| # | Skill | Spec item | Depends on |
|---|---|---|---|
| 1 | `payment-request-foundation` | hub, types, statuses, routing, common fields, RBAC | — |
| 2 | `payment-request-financial-accounts` | bank kinds + ledger per bank/FD/RD/card/loan/investment | — |
| 3 | `payment-request-payee-master` | pay-to master w/ GSTIN, purpose master | 1 |
| 4 | `payment-request-gst-invoice-lines` | shared invoice table, CGST/SGST/IGST, ITC, RCM, place of supply | 1, 3 |
| 4a | `payment-request-approval-matrix` | who approves which type / amount, approver-may-pay rule | 1 |
| 5 | `payment-request-accountant-payout` | To-Pay queue, Pay modal, payout handlers, InTx extractions | 1, 2, 4a |
| 6 | `payment-request-salary` | a. Salary Request (bulk from salary sheet, direct to accountant) | 1, 2, 5 |
| 7 | `payment-request-voucher-single` | b4 Voucher Single Purpose | 1, 3, 5 |
| 8 | `payment-request-advance-reminder` | b1 Request Advance Payment (reminder) | 1, 3, 5 |
| 9 | `payment-request-investment` | b2 Request Investment Payment | 1, 2, 3, 5 |
| 10 | `payment-request-tax-invoice` | b3 Tax Invoice (Non-Supplier) — adds ExpenseLine | 3, 4, 5 |
| 11 | `payment-request-voucher-multiple` | b5 Voucher Multiple Purpose | 7, 10 |
| 12 | `payment-request-excel-upload` | b6 Upload Expense Other Than Salary | 7, 8, 9 |
| 13 | `payment-request-supplier-on-account` | c1 Payment Request on Account | 1, 5 |
| 14 | `payment-request-supplier-bill` | c2 Payment Against Supplier's Bill | 4, 5 |
| 15 | `payment-request-supplier-adjustment` | c3 Adjustment Against Payment on Account | 13, 14 |
| 16 | `payment-request-supplier-credit-note` | c4 Update Supplier Credit Note | 1, 14 |
| 17 | `payment-request-cash-withdrawal` | d4 Request Cash Payment | 2, 5 |
| 18 | `payment-request-imprest` | d2 Request Imprest Payment | 5 |
| 19 | `payment-request-bank-transfer` | d6 Transfer Within Banks | 2, 5 |
| 20 | `payment-request-fixed-deposit` | d3 Fixed Deposits | 2, 5 |
| 21 | `payment-request-recurring-deposit` | d5 RDS Payment | 2, 5 |
| 22 | `payment-request-credit-card` | d7 Credit Card Payment | 2, 5 |
| 23 | `payment-request-loan` | d1 Loan Payment (we lend) | 2, 3, 5 |
| 24 | `payment-request-reports-and-rollout` | reports, nav, notifications, QA | all |

Steps 2 and 3 can run in parallel with 1's UI work; 7–9, 13 and 17–22 are independent once 1/2/5 exist.

## Spec coverage checklist (tick when its skill is done)
- [x] Foundation hub built (2026-10-27)
- [x] Approval Matrix built (2026-10-27)
- [x] Accountant Payout built (2026-10-27) — Investment, Supplier on Account and Cash Payment can be paid
- [x] Financial Accounts built (2026-10-28) — per-account ledgers, bank-to-bank transfers
- [x] Payee & Purpose masters built (2026-10-28)
- [x] GST invoice lines built (2026-10-28) — calculator, schema, journal builder, editor (used once Tax Invoice / Supplier Bill are built)
- [ ] a Salary (bulk auto + single, no approver)
- [ ] b1 Advance reminder · [ ] b2 Investment · [ ] b3 Tax invoice non-supplier · [ ] b4 Voucher single
- [ ] b5 Voucher multiple · [ ] b6 Excel upload
- [ ] c1 On account · [ ] c2 Against bill · [ ] c3 Adjustment · [ ] c4 Supplier credit note
- [ ] d1 Loan · [ ] d2 Imprest · [ ] d3 FD · [ ] d4 Cash · [ ] d5 RDS · [ ] d6 Bank-to-bank · [ ] d7 Credit card
- [ ] Voice remark + remark on every request type

## Decisions (user, 2026-10-27)
1. **Loan** = we LEND money only (Dr LOAN-GIVEN / Cr bank). No EMI-repayment flow. (`payment-request-loan`)
2. **RDS** = Recurring Deposit. The accountant raises it manually each month; no auto-schedule.
3. **Advance reminder**: payout posts to "Advance to party" (ADV-PAID), adjusted when the bill arrives. Accepted.
4. **Salary**: bulk requests come from the salary module (Salary Sheet), and a single salary request can also
   be created from Payment Requests. Both, as planned.
5. **Approval**: a separate **Approval Matrix** module decides who approves which request type (with optional
   amount slabs) and whether the approver may also pay → new skill `payment-request-approval-matrix`.
6. **Supplier on-account** posts to a separate **Advance to Suppliers** (SUP-ADV) asset; adjusting it against a
   bill posts Dr AP / Cr SUP-ADV.
7. **One invoice per request** (tax invoice, supplier bill, adjustment).
8. **Imprest** = employees only.

Still open (ask when building): bank bulk NEFT file for salary payout?

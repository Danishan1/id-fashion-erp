---
name: payment-request-salary
description: Plan for Salary Request (group a) — auto bulk-created one request per employee when the HRMS salary month is finalised, plus a single manual create; goes directly to the accountant (no approver); Salaries Payable accrual journal and per-employee payout.
---

# Salary Request

Part of `accounts-payment-requests-plan`. Depends on: foundation, financial-accounts, accountant-payout.

## Spec
Auto bulk-created by the salary module; goes **directly to accountant to pay, no approver**; single create
option too. Voice remark + remark optional (as every request).

## Source of truth
`src/modules/hrms/attendance-team.service.ts`: `finaliseSalaryMonth()` writes `AttendanceMonthClose`
(`snapshotJson.rows: SalaryRow[]`, `netPay`, `grossMonthly`, `deductionAmount`, `overtimePay`). Never recompute
salary in Accounts — read the frozen snapshot.

## Fields (per request)
employeeId (pay-to = employee; show code/name/bank from Employee), amount = `netPay` (editable only by
`payment_requests.edit` before payout, with remark required when changed), salaryYear, salaryMonth,
`sourceModule = ATTENDANCE_MONTH_CLOSE`, `sourceRecordId = closeRow.id`, paymentDueDate (default: 7th of next
month, configurable later), remark, voice remark. Breakdown (gross, deductions, OT) stored in typeDataJson for display.
Rows with `netPay` null (no fixed salary) or 0 → skipped and listed in a "not created" report.

## Creation
- **Bulk**: button "Create Salary Requests" on the Salary Sheet page after finalise (and optionally automatic
  inside `finaliseSalaryMonth` — recommend explicit button so HR finalising ≠ money obligation by surprise; ask
  user). One request per employee, idempotency key `salary:<closeId>:<employeeId>` → re-run is safe.
- **Single**: New → Salary Request: pick employee + month (must be a finalised month unless "Ad-hoc salary"
  checkbox → requires remark), amount.
- Duplicate guard: one non-cancelled salary request per (employee, year, month) unless ad-hoc.

## Routing / status
`DIRECT_TO_ACCOUNTANT` → created as `APPROVED`. Partial pay allowed (salary in installments).

## Journal
- On bulk creation (accrual, one journal per month): Dr EXP-SALARY (sum gross earned) / Cr SALARY-PAY (sum
  net) / Cr other deductions accounts if any (v1: only net — keep simple, ask user re: PF/ESI/TDS later).
  Simpler v1 option: no accrual; payout posts Dr EXP-SALARY / Cr bank. **Recommend accrual** (shows payable).
- On payout: Dr SALARY-PAY / Cr bank-or-cash (via `resolveMoneyAccount`).

## RBAC
Bulk create from salary sheet needs `hrms_attendance_salary.edit` AND `payment_requests.create`. Salary
requests visible only with `payment_requests.view_all` + `hrms_attendance_salary.view` (salary is sensitive);
requester list hides them otherwise.

## UI
Salary Sheet page: "Create Salary Requests" (disabled until finalised, shows count/total, already-created
state). Payment Requests → Salary tab: month filter, "Pay all" bulk payout, bank export later (ask: NEFT bulk file?).

## Reuse
`getSalarySheet`, `AttendanceMonthClose`, `exportSalarySheetXlsx`, Employee bank fields, payout handler.

## Tests
bulk creates N requests, skips null/0 netPay, idempotent re-run, duplicate month refused, starts APPROVED,
accrual journal balanced, payout journal Dr SALARY-PAY, salary rows hidden without salary permission.

## Done checklist
- [ ] SALARY-PAY account + accrual
- [ ] bulk + single create
- [ ] salary sheet button
- [ ] permission-scoped visibility
- [ ] tests + live run on a finalised month

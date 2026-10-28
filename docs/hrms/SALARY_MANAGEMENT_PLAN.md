# HRMS → Salary Management — agreed plan (2026-10-28)

Reference: `D:\office-data\Project\indradhar\internal_project` (indradhar.in/company/salary-management).
Builds on the existing ERP attendance engine (`attendance-month.service.ts`) and leave balances
(`leave-balance.service.ts`). Replaces the current single-page Salary Sheet (`/attendance/salary-sheet`).

## Decisions (user, 2026-10-28)

| # | Question | Decision |
|---|---|---|
| Q1 | Salary formula | **Reference formula** (allowances, PF, ESIC, TDS, surcharge, edu cess, late-fee interest, advance installment, arrears, extra days). Day counting comes from the ERP attendance engine (same 1 / 0.75 / 0.5 bands, sandwich rule, auto paid leave). |
| Q2 | Employee salary setup | Needed (follows from Q1). |
| Q3 | Advance salary | Employee requests; recovered in **installments**; routed as an **Expenditure** payment request (approval matrix + accountant payout). |
| Q4 | Paid ↔ Unpaid leave | Changes the **real leave balance** (current month first, then carry-forward; refund on Unpaid). Every change recorded. |
| Q5 | "Full day" bulk adjust | Counts the day as Present = 1 for salary only; attendance pages keep showing real hours. (Assumed — confirm if wrong.) |
| Q6 | Approval | **Maker-checker**: whoever generated/edited the run can't approve it (Super Admin exempt). |
| Q7 | Month lock | **Lock** attendance / adjustments / leave for a finalised month; admin can **Reopen** with a reason (recorded). |

## Reference formula (to keep exactly)

```
perDay        = (base + allowances) / daysInMonth
overtimePay   = overtimeRatePerHour × Σ approved overtime hours
pf            = employeePF% × base            (cap: apply PFSetting.maxLimit — reference stores but ignores it; ask before enabling)
esic          = employeeESIC% × (base + allowances)
gross         = base + allowances + overtimePay
earnedGross   = round(gross / daysInMonth × (present + paidLeave + extra))
totalDeduct   = otherDeductions + pf + esic
net           = max(0, round(earnedGross + arrears − (totalDeduct + installment + tds + surcharge + eduCess + lateFeeInterest)))
```
If an employee has no punches at all in the month: pf, esic, deductions and installment are 0.
HRA / Conveyance shown prorated by present days on the slip.

Reference bugs NOT carried over: advance never completes (isInstallment always false); arrears double-added on
re-generate; approved rows still editable; history page re-runs the calculation; projectId lost on create.

## Slices (build order)

1. **Employee Salary Setup** — `EmployeeSalarySetting` (base, PF/ESIC setting, PAN, TDS, surcharge, edu cess,
   late-fee interest, OT rate, bank details) + allowance / deduction lines; PF and ESIC masters.
2. **Manage Attendance** — month view per employee with cards (Working Days, Worked Hours "Xh Ym / Yh Monthly
   Total", Paid Weekends, Company Holidays). Bulk adjust (tick days → 9h / fixed hours / office time / full day)
   stored in a separate `SalaryAttendanceAdjustment` table (old/new value, reason, who, when) — real sessions
   never touched; removable. Paid ↔ Unpaid leave conversion with balance deduct/refund + history row.
3. **Generate Salary** — `SalaryRun` (company × month, DRAFT → APPROVED → FINALISED) + `SalaryRunLine` per
   employee holding system values and edited values (Present, Paid Leave, Extra Days, Arrears + reason) with an
   edit history table. Attendance Summary (Name / Present / Holiday / Weekend / Paid Leave / Unpaid Leave /
   Absent / Total / Attendance %). Pending regularizations block generation. Maker-checker approve. Finalise
   spends auto paid leave, records advance installments, locks the month. Reopen with reason.
4. **Salary History** — finalised runs only, read-only; Salary Slip PDF (reference layout) and Excel.
5. **Advance Salary** — employee self-request (amount, reason, installments) → `PaymentRequest` type
   `SALARY_ADVANCE` (Expenditure group) → approval matrix → accountant payout (Dr Salary Advance / Cr bank).
   Installments deducted by the salary run; completed when fully recovered.
6. **Salary payout** — the on-hold `payment-request-salary` skill: one SALARY payment request per finalised line.

## Progress

- [x] **Slice 1 — Employee Salary Setup** (2026-10-28). Tables `hrms_salary_statutory_settings` (PF/ESIC, one
  table with `kind`), `hrms_employee_salary_settings`, `hrms_employee_salary_components`; migration
  `20261028150000_hrms_salary_setup` (+ rollback). Service `src/modules/hrms/salary-setup.service.ts`; APIs
  `/api/v1/salary/{pf-settings,esic-settings,employee-setups}`; page `/salary/setup` (Employees / PF / ESIC tabs)
  and `/salary/setup/[employeeId]` (form + full-month estimate). Base salary is written through to
  `Employee.fixedMonthlySalary`; OT rate is saved on `EmployeeAttendanceProfile`. RBAC module `hrms_salary_setup`
  (MANAGEMENT: view/create/edit/export). PAN / bank account are masked in the audit log.
- [x] **Slice 2 — Manage Attendance** (2026-10-28). `hrms_salary_attendance_adjustments` (salary-only overlay:
  FIXED_HOURS / OFFICE_TIME / FULL_DAY, reason, actual hours snapshot; removed rows kept; one active per day via
  partial unique index) and `hrms_leave_payment_changes`; migration `20261028170000_hrms_salary_attendance_adjustments`
  (+ rollback). `computeEmployeesMonth(..., { applySalaryAdjustments: true })` applies the overlay — every attendance
  screen leaves it off. `switchLeaveDayPayment()` in leave-balance.service moves the balance (Paid→Unpaid refunds to
  the month it came from; Unpaid→Paid takes remaining then carry-forward, refused if short). Nobody can adjust or
  re-pay their own attendance. Only working days (not holiday / weekly off / future / pre-joining / full leave) can be
  adjusted. Screens `/salary/attendance` and `/salary/attendance/[employeeId]?month=`. RBAC `hrms_salary_attendance`
  (MANAGEMENT: view/view_all/edit).
- [x] **Slice 3 — Generate Salary** (2026-10-28). Tables `hrms_salary_runs` (one per company-month, DRAFT →
  APPROVED → FINALISED; Send back / Reopen → DRAFT with a reason), `hrms_salary_run_lines` (frozen setup snapshot,
  system day counts, edited Present / Paid Leave / Extra Days / Arrears kept separately, amounts), `..._line_edits`,
  `..._events`; migration `20261028190000_hrms_salary_runs` (+ rollback). Formula: `salary-calculator.ts` (reference,
  verbatim; PF/ESIC wage ceiling applied only when set). Days come from `computeEmployeesMonth(..., { applySalaryAdjustments: true })`
  plus auto paid leave for zero-hour workdays (balance). Generate needs the month ended, no pending regularizations,
  and the month not finalised on the old Salary Sheet (which now also refuses a month that has a run). Regenerate
  keeps edits. Approve = maker-checker (generator or an editor can't approve; Super Admin exempt). Finalise spends the
  auto paid leave (stored per line, so Reopen gives it back). Lock: `assertSalaryMonthOpen()` (salary-month-lock.ts)
  refuses salary adjustments, leave Paid/Unpaid, manual/corrected sessions, leave approval, regularization approval
  and overtime decisions in an APPROVED or FINALISED month. RBAC `hrms_salary_generate` (MANAGEMENT all; ACCOUNTS_MANAGER
  view/approve/reject/post/export as checker). Advance installment = 0 until slice 5.
- [x] **Slice 4 — Salary History** (2026-10-28). No new tables. `salary-history.service.ts` lists FINALISED runs
  only, straight from the stored lines (never recalculated). Scope: `hrms_salary_history.view_all` sees everyone;
  without it only the caller's own employee (`User.employeeId`) — a manager does not see the team's salaries.
  Every self-service role gets `view` (own slips). Slip PDF `salary-slip-pdf.tsx` (reference layout; amount in words
  `src/lib/amount-in-words.ts`, Indian lakh/crore; bank account masked), Excel `salary-report-xlsx.ts` (company-wide
  only). Screen `/salary/history`; APIs `/api/v1/salary/history`, `.../slips/[lineId]/pdf`, `.../runs/[runId]/export`.

## RBAC
New sub-modules: `hrms_salary_setup`, `hrms_salary_attendance`, `hrms_salary_generate` (view/create/edit/approve
/export), `hrms_salary_history`, `hrms_salary_advance`. Employees get own-advance create/view.

# Attendance Module — Port Plan (old project → Fashion ERP)

Status: **PLAN ONLY — waiting for approval. No code written.**
Date: 2026-10-23

Sources:
- `D:\office-data\Project\indradhar\internal_project\ATTENDANCE_MODULE_DETAILS.md` (spec)
- The old project's real code (`solopreneur-backend`, `solopreneur-frontend`), which was read in full. Where the code and the spec disagree, **the code wins**.

## Decisions already taken (by you)

| # | Question | Answer |
|---|---|---|
| D1 | Copy old bugs or fix them? | **Same rules, bugs fixed.** Every fix is listed in §6. |
| D2 | How do employees punch? | **Selfie + GPS geofence + face AI**, same as the old project. |
| D3 | Leave model | **The old project's monthly model.** Monthly quota per employee, carry-forward, Paid/Unpaid, Full/Half/Quarter days, sandwich Sunday, Leave Not Taken, Emergency Leave. |
| D4 | Salary | **Attendance salary sheet.** Days, overtime and calculated pay from the employee's fixed monthly salary. No payslips and no PF/ESIC. |

## Hard rule kept

Only attendance and HRMS-attendance code changes. Shared pieces are reused, not modified, with three small exceptions, each a "registration line" rather than a behaviour change:
- **Attachment targets:** one entry in `src/core/attachments/attachment-targets.ts` so regularization documents can use the shared `AttachmentsPanel`.
- **Worker:** one start call in `src/core/jobs/worker.ts`, for the overtime and monthly-leave-credit jobs.
- **Sidebar and RBAC grants:** new links in `navigation.ts` and grants in `rbac.ts`, both for the HRMS modules only.

Tables owned by other modules are **not** altered:
- `Employee`, `Branch`, `User`, `HolidayMaster`, `ShiftMaster`.
- The shared `RelatedModule` enum.

Attendance-specific data lives in new `hrms_*` tables that point to them.

---

## 1. What the old project really does (verified in code)

The spec document is wrong in places. This is what the code actually does:

- **Sessions.** Every punch IN creates a new row, so a day can have several sessions. Day totals use the interval-union (no double counting).
- **Overnight and long sessions.**
  - A session belongs to its check-in date (IST). The "18:00 overnight" setting exists but is unused, and the effect is the same.
  - A session over 18 h is flagged, not capped.
- **Day status.** Status comes from **worked hours against the employee's shift hours**, with a 15-minute tolerance. There is no HALF_DAY enum value, no late mark and no grace time.

  | Worked hours (vs shift hours) | Status | Present | Absent |
  |---|---|---|---|
  | ≥ shift − 15 min | Full Present | 1 | 0 |
  | ≥ 75% of shift − 15 min | Semi-full Present | 0.75 | 0.25 |
  | ≥ 50% of shift − 15 min | Half Present | 0.5 | 0.5 |
  | otherwise | Low Hours | 0 | 1 |

  Holiday and weekend days count as paid. Working on them adds "extra payable days".
- **Punch rules.**
  - A selfie is required.
  - GPS must be a valid coordinate, not (0,0), with phone accuracy ≤ 50 m.
  - The punch is checked against **all active office locations** using Haversine distance (R = 6,371,000 m). The radius is max(10, radius), default 100 m, and the nearest location wins.
  - If there is no office location set up, the punch is refused.
  - IN is refused when a session is already open ("You are already logged in…").
  - OUT is refused when there is no IN.
- **Face AI (browser side).**
  - Uses face-api.js with three models: tiny face detector (input 320, score 0.6), 68 landmarks, recognition net.
  - Each employee has up to 3 enrolled photos.
  - The match needs distance ≤ 0.45 in 3 consecutive frames.
  - Models are cached in IndexedDB and descriptors in sessionStorage.
  - The server checks that the matched photo id belongs to that employee.
- **Overtime.**
  - Every punch OUT queues a background job.
  - The job computes OT = worked hours − shift hours. A record is created only if OT > 0, and only when the employee has an OT rate.
  - Status starts Pending; admin approves or rejects.
- **Outdoor punch.** A punch outside every location is flagged (`isLoginFromOffice=false`).
  - The admin can **approve** it, or **reject** it. Rejecting **trims the times to admin-entered values** and saves the original times in a rejection record.
  - The employee can **accept** the trim, or **clarify** with a reason and proof (status In Process).
  - The admin can then approve the clarification, which **restores the original times**, or reject it. The admin can also **cancel** the rejection, which restores the times as well.
- **Regularization, 6 types.**
  - Missed Punch, Missed Logout, Change Login and Change Logout check that out > in, the session is ≤ 18 h, and there is no overlap with other sessions.
  - Leave Not Taken un-takes granted leaves and gives the quota back.
  - Emergency Leave creates past granted leaves: Paid while quota lasts, Unpaid after that.
  - Approval runs in one transaction. A repeat decision with the same result is idempotent; a different decision on an already-decided request returns 409.
  - Pending regularizations block salary generation.
- **Leave.**
  - Multi-day apply, one row per day, with a Full / First-half / Second-half / Q1–Q4 duration (1, 0.5 or 0.25 day).
  - Sandwich Sunday can be included.
  - On approval: Paid if remaining + carry-forward ≥ the day fraction. The quota is deducted from remaining first, then from carry-forward. Otherwise the day is Unpaid.
  - The monthly job copies the balance forward.
  - Admins can change an employee's allocated quota and carry-forward.
- **Salary link.**
  - Per-day pay = monthly gross ÷ calendar days.
  - Deduction = (absent + unpaid) × per-day pay.
  - **A zero-hour workday with no leave automatically uses remaining quota as paid leave**, saved as Auto Leave History.
  - A weekend or holiday between two leave/absent days becomes a **sandwich leave** (+1 absent).
  - OT pay = approved OT hours × OT rate.
- **Scope.** Admin, Manager and HR see the whole company; normal users see their reporting tree.
- **Other.**
  - Holidays are a company calendar.
  - Weekends are set per employee, with an "apply to everyone" option.
  - Admins can correct times singly or in bulk.
  - There is a photo audit page (selfies, address, distance in metres) and XLSX exports.
  - Emails go out on leave apply and on leave decision.

---

## 2. Gap table: old feature → this ERP today → what we build

| # | Old project feature | Here today | Gap / plan |
|---|---|---|---|
| 1 | Daily punch IN/OUT by the employee | **Missing.** Only admin manual entry (`attendance.service.ts` `recordAttendance`) | New self-punch screen and service |
| 2 | Several sessions per day | **Partly.** `AttendanceRecord` holds one in/out per day (unique per employee+date) | Keep the day row. Add a child table `hrms_attendance_sessions`. The day row's in/out become first-in / last-out, kept in sync so the dashboard and reports keep working |
| 3 | Interval-union hours, live hours, 18 h flag, overlap check | **Missing** | Pure calculator file plus unit tests |
| 4 | Hours-based day status (Full / 0.75 / Half / Low) | **Missing.** There is only a late flag (`computeIsLate`) | Add the status engine. **Keep** the ERP's late flag (shift grace) as an extra column |
| 5 | Selfie on punch | **Missing** | Stored with the ERP's private `FileStorage`, not Cloudinary |
| 6 | GPS geofence against many office locations | **Missing.** `Branch` has no lat/lng | New `hrms_attendance_locations` table (name, lat, lng, radius, address, optional link to a Branch) |
| 7 | Face AI enrolment (3 photos) and matching | **Missing** | Enrolment page, `hrms_employee_face_photos`, browser matching with the same thresholds |
| 8 | Photo audit (selfie, address, distance) | **Missing** | New page |
| 9 | Overtime auto-calculation, approve/reject | **Missing** | `hrms_overtime_records` plus a BullMQ job in the existing worker |
| 10 | OT rate per employee | **Missing.** `Employee` has no rate | Stored in a new `hrms_employee_attendance_profiles` table |
| 11 | Outdoor reject / accept / clarify / restore / cancel | **Missing** | `hrms_outdoor_rejections` plus screens |
| 12 | Regularization, 6 types | **Partly.** `AttendanceCorrectionRequest` covers set-in/out times only | Extend the same table additively (type, session, date range, leave type). Proof upload through `AttachmentsPanel` (`ATTENDANCE_CORRECTION` already exists in `RelatedModule`) |
| 13 | Shift Login/Logout per employee | **Here.** `ShiftMaster` + `Employee.shiftId` (with grace minutes) | Reuse. Shift hours = end − start, with overnight wrap |
| 14 | Weekends per employee | **Missing** | Stored in the attendance profile. Company default plus "apply to all" in settings |
| 15 | Holiday calendar | **Here.** `HolidayMaster` (Masters → HR Config) | Reuse as is. The attendance settings page links to it |
| 16 | Monthly leave quota, carry-forward, Paid/Unpaid | **Different.** `LeaveType.annualDays` gives a yearly live balance, plus yearly `LeaveBalanceCarryForward` | Per D3, replace with monthly balances (`hrms_leave_balances`). Old leave requests stay readable |
| 17 | Leave per day with Full/Half/Quarter, sandwich Sunday | **Missing.** `LeaveRequest` is start–end only | `hrms_leave_days` child rows under the existing `LeaveRequest` |
| 18 | Leave policy (title, value, Monthly/Quarterly/Half-yearly/Yearly) | **Partly.** `LeaveType` (name, annualDays) | Add `allocationType` and `quotaPerPeriod` to `LeaveType` (additive) |
| 19 | Monthly leave credit job | **Missing** | Worker job on the 1st of each month (IST) |
| 20 | Admin quota override | **Missing** | Leave Balances page |
| 21 | Team dashboard (today's cards and table) | **Partly.** `getAttendanceSummaryForDate`: present/late/missing | Cards for Present, Absent, On Leave, Half Day, Outside, plus table |
| 22 | Monthly team matrix, coloured, XLSX | **Missing** | New page and XLSX export (existing exceljs helper) |
| 23 | Personal month calendar | **Missing** | New page |
| 24 | Admin single and bulk time correction | **Partly.** Manual record entry exists | Single and bulk correct, with overlap check (see fix F8) |
| 25 | Salary sheet | **Missing.** There is no payroll, and `Employee.fixedMonthlySalary` is reference-only | Read-only monthly sheet, plus a "Finalise month" action that writes Auto Leave History |
| 26 | Scope: admin = all, manager = team, user = own | **Here.** `hrms-scope.ts` (`view_all` → all, else self + HRMS team from the reporting hierarchy) | Reuse unchanged |
| 27 | Emails on leave / decisions | **Different.** The ERP has in-app notifications only | In-app notifications for every event. No email (the ERP has no mail setup) |
| 28 | Mobile app (Expo) | Not in the ERP | Out of scope. The punch screen is built mobile-first and works in the phone browser |
| 29 | Reports | Daily Attendance, Monthly Summary, Leave Register (`hr-attendance.reports.ts`) | Update them to the new status engine. Add Overtime, Outdoor Punch, Leave Balance and Salary Sheet reports |

---

## 3. Schema changes (all additive, one migration per phase)

New enums:
- `AttendanceSessionStatus` (PRESENT, PRESENT_FROM_OUTSIDE, REMOTE)
- `AttendanceSessionSource` (SELF_PUNCH, MANUAL, REGULARIZATION)
- `LeaveDurationType` (FULL, F_HALF, S_HALF, QR1–QR4)
- `LeavePaymentType` (PAID, NOT_PAID)
- `LeaveAllocationType` (MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY)
- `RegularizationType` (the 6 types)
- `OutdoorRejectionStatus` (PENDING, IN_PROCESS, APPROVED, REJECTED)
- `OvertimeStatus` (PENDING, APPROVED, REJECTED)
- `Weekday`

New tables:

| Table | Main fields |
|---|---|
| `hrms_attendance_settings` (1 per company) | `defaultWeekends`, `gpsAccuracyMeters` 50, `maxSessionHours` 18, `statusToleranceMinutes` 15, `faceMatchThreshold` 0.45, `faceMatchFrames` 3. Defaults are the old project's fixed values |
| `hrms_attendance_locations` | `name`, `code`, `latitude`, `longitude`, `radiusMeters` (≥10, default 100), `address`, `branchId?`, `isActive` |
| `hrms_employee_attendance_profiles` (1 per employee) | `weekends Weekday[]`, `overtimeRatePerHour`, `requireFace` |
| `hrms_employee_face_photos` | employee, storage key, ≤ 3 per employee |
| `hrms_attendance_sessions` | `attendanceRecordId`, `checkInAt`, `checkOutAt?`; in/out lat/lng/accuracy/address; in/out matched location; in/out distance in metres; `isLoginFromOffice`, `isLogoutFromOffice`; in/out selfie storage key; matched face photo id; `status`; `source`; `isExcessive` |
| `hrms_overtime_records` | employee, date, hours Decimal(5,2), reason, status, decidedBy/At. Unique (employee, date) |
| `hrms_outdoor_rejections` | `sessionId`, original in/out, rejected reason/by/at, status, clarification reason, revoked by/at. Proof goes through attachments |
| `hrms_leave_balances` | employee, leave type, year, month, allocated, used, remaining, carryForward. Unique (employee, type, year, month) |
| `hrms_leave_days` | `leaveRequestId`, date, duration, `paymentType`, `isSandwich`, `taken` |
| `hrms_auto_leave_history` | employee, leave type, year, month, used, pre-remaining. Unique (employee, type, year, month) |

Added columns, all nullable or defaulted, on HRMS-owned tables only:
- `AttendanceCorrectionRequest`:
  - `type` (default CHANGE_LOGIN_LOGOUT behaviour for old rows → mapped to MISSED_PUNCH/CHANGE_*);
  - `sessionId?`, `dateFrom?`, `dateTo?`, `leaveTypeId?`.
- `LeaveType`: `allocationType`, `quotaPerPeriod`.

Data backfill:
- Each existing `AttendanceRecord` with a punch-in gets one MANUAL session, so history keeps working.

Not touched: `Employee`, `Branch`, `User`, `HolidayMaster`, `ShiftMaster`, `RelatedModule`.

---

## 4. Services, routes and pages

**Service files** (`src/modules/hrms/`):
- `attendance-calculator.ts` (pure): IST day, merge intervals, finalised and live hours, 18 h flag, overlap check, Haversine, shift hours with overnight wrap, day status (Full / 0.75 / Half / Low), late flag.
- `attendance-punch.service.ts`: punch IN and OUT, geofence, selfie, face-id check, queues the OT job.
- `attendance-session.service.ts`: admin single and bulk correction; keeps the day row in sync.
- `overtime.service.ts`, plus `overtime.worker.ts` (job `overtime.calculate`).
- `outdoor-attendance.service.ts`: list unverified, approve, reject-with-trim, accept, clarify, admin decision, cancel.
- `regularization.service.ts`: the 6 types. This extends the existing `attendance-correction.service.ts`.
- `leave-balance.service.ts`: monthly credit job, admin override, deduct and refund helpers.
- `leave.service.ts`: rewritten to apply per day (duration, sandwich) and approve with Paid/Unpaid.
- `attendance-month.service.ts`: one engine for the personal calendar, team matrix, dashboard counts and salary sheet, so every screen agrees.
- `salary-sheet.service.ts`: preview, and finalise (Auto Leave History).
- `attendance-locations.service.ts`, `attendance-settings.service.ts`, `face-enrolment.service.ts`.

**API** (`/api/v1/attendance/...`):
- `punch`
- `sessions/[id]`, `sessions/bulk-correct`
- `today`, `my-month`, `team-day`, `team-month` (+ `export/xlsx`)
- `photos`
- `outdoor`, `outdoor/[id]/{approve,reject,accept,clarify,decide,cancel}`
- `overtime`, `overtime/[id]/{approve,reject}`
- `regularizations` (existing correction routes extended)
- `locations`, `settings`, `profiles/[employeeId]`, `face-photos/[employeeId]`
- `selfie/[sessionId]/[in|out]` (private, scope-checked)
- `salary-sheet`, `salary-sheet/finalise`

Leave routes:
- `leave-requests` (extended: days, durations, sandwich)
- `leave-balances`, `leave-balances/[id]` (admin override)

**Pages** (HRMS sidebar group):

| Page | Purpose |
|---|---|
| My Attendance `/attendance/my` | Punch button (camera + face + GPS), today's sessions and live hours, month calendar, own OT, own outdoor rejections to accept or clarify |
| Team Attendance `/attendance` | Today's cards (Present, Absent, On Leave, Half Day, Outside) and table. Replaces the current list; manual entry kept |
| Monthly Records `/attendance/records` | Coloured matrix plus XLSX |
| Outdoor Punches `/attendance/outdoor` | Approve / reject-with-trim / bulk approve; clarification decisions |
| Punch Photos `/attendance/photos` | Selfie audit with distance |
| Regularizations `/attendance-corrections` | Existing page extended to 6 types, with proof upload |
| Overtime `/attendance/overtime` | |
| My Leaves / Leave Approvals `/leave-requests` | Extended: multi-day picker, duration per day, sandwich Sunday, live balance |
| Leave Balances `/leave-balances` | Admin quota override |
| Leave Types | Gains allocation type and quota |
| Attendance Settings `/attendance/settings` | Office locations with a map-free lat/lng plus "use my location" button; defaults; weekends apply-to-all; holiday link |
| Face Enrolment `/attendance/face-enrolment` and `[employeeId]` | |
| Salary Sheet `/attendance/salary-sheet` | |

**Face AI library:** `@vladmandic/face-api`, the maintained drop-in fork of face-api.js with the same models and API. The old `face-api.js` 0.22 is abandoned and doesn't build cleanly with React 19. Only the 3 needed model files (~6.5 MB) are copied to `public/models`.

**Note:** camera and GPS work only on HTTPS (or localhost). That is a deployment requirement.

---

## 5. RBAC (no new modules, no new actions)

**Who sees what:**
- **Self-service** (punch, own calendar, apply leave, raise regularization, clarify outdoor) needs `hrms_attendance.view + create` and `hrms_leave.view + create`. These are granted to every internal role except `EXTERNAL_UNIT_USER`. The existing scope already limits a non-`view_all` user to themself plus their HRMS team.
- **Team approvals** (leave, regularization, outdoor, overtime) need `approve` / `reject`.
  - Granted to MANAGEMENT (company-wide via `view_all`, which it already has) and to manager-type roles: PRODUCTION_MANAGER, SAMPLING_MANAGER, STORE_MANAGER, ACCOUNTS_MANAGER, QC_MANAGER, DISPATCH_MANAGER.
  - These managers act on their own reporting team only.
  - The self-approval guard is kept.
- **Admin / HR** gets:
  - `hrms_attendance.edit`: settings, locations, profiles, face enrolment, leave quotas.
  - `hrms_attendance.override`: time corrections.
  - `hrms_attendance.export`: XLSX and salary sheet.

  These go to SUPER_ADMIN (already has everything) and MANAGEMENT (gains `override`).

**Rollout:** the permission keys already exist, so the role grants are rolled out with a small idempotent script in the same "only add, never remove" style as `sync-permission-catalog.mjs`.

---

## 6. Calculation mapping, and the bugs we fix (D1)

| Old logic | Here | Fix applied |
|---|---|---|
| F1 Leave approval deducts 1.0 for every day | Deduct the real fraction (1 / 0.5 / 0.25) | Yes |
| F2 Approval uses this month's balance, not the leave's own month | Deduct from the balance of the leave day's month | Yes |
| F3 Monthly job: remaining = allocated + prev remaining **and** carryForward = prev remaining (counted twice); drops prev carry; ignores Quarterly/Yearly | New month: `allocated` = policy quota for that period; `carryForward` = prev remaining + prev carryForward; `remaining` = allocated. Quarterly / Half-yearly / Yearly credit only at period start | Yes |
| F4 One balance row per user per month (only one leave type) | One balance per employee **per leave type** per month | Yes (with one leave type it behaves the same) |
| F5 OT re-calc resets an Approved record to Pending | Approved / Rejected records are never changed by the job | Yes |
| F6 No shift → all hours counted as OT; overnight shift → negative standard hours | No shift → no OT record; overnight shift wraps +24 h | Yes |
| F7 Punch OUT overwrites an already-closed session | OUT only closes the open session; no open session → "Cannot mark OUT without IN" | Yes |
| F8 Admin correction has no overlap check | Overlap and 18 h checks, same as regularization | Yes |
| F9 Outdoor punch never marked "Outside" at punch time | Marked PRESENT_FROM_OUTSIDE when outside every location (the spec's stated intent) | Yes |
| F10 Salary counts Pending / Rejected leaves | Only granted, taken leave days count | Yes |
| F11 Salary OT sums **all approved OT ever** | Only OT dated in that month | Yes |
| F12 Salary uses the **generating admin's** shift hours | Each employee's own shift hours | Yes |
| F13 Emergency Leave creates leave on weekends and holidays too | Skip weekends and holidays | Yes |
| F14 Sandwich Sunday flag ignored on the server | Server adds the sandwich Sunday when ticked | Yes |
| F15 Holiday month lookup off by one; holidays stored per admin | The company-wide `HolidayMaster` | Yes |
| F16 Day boundaries mix server time and UTC | Asia/Kolkata everywhere (also fixes the existing `computeIsLate` local-time use) | Yes |

Kept exactly as in the old project:
- Day-status thresholds (1 / 0.75 / 0.5 / 0, 15-minute tolerance).
- Interval union.
- The 18 h flag (flag, not cap).
- Haversine (R = 6,371,000 m; radius ≥ 10, default 100; nearest wins).
- GPS ≤ 50 m.
- Face 0.45 / 3 frames.
- The deduction order (remaining, then carry-forward).
- The Paid/Unpaid rule.
- Auto-paid-leave on zero-hour workdays.
- Weekend / holiday sandwich in salary.
- Per-day pay = gross ÷ calendar days.
- Pending regularizations block salary finalise.
- Outdoor trim / restore behaviour.
- The 409 on a second decision.

The ERP's existing **late flag (shift grace)** is kept as an extra column; it changes no number.

---

## 7. Build order (each phase ends with tests + browser check)

| Phase | What gets built |
|---|---|
| 1. Foundation | Migration (settings, locations, profiles, sessions + backfill); calculator with full unit tests; settings, locations and weekends pages |
| 2. Punching | Self-punch with selfie + GPS; face enrolment + face matching; My Attendance page; photo audit; day-row sync |
| 3. Overtime | Records, worker job, approve/reject page, own OT view |
| 4. Outdoor | Approve / reject-trim / accept / clarify / restore / cancel |
| 5. Regularization | 6 types on the existing corrections page, proof upload, transactional approval, notifications |
| 6. Leave | Monthly balances, leave-type allocation, credit job, per-day apply (duration, sandwich), Paid/Unpaid approval, admin override, Leave Not Taken / Emergency Leave wired into regularization |
| 7. Views and money | Team dashboard cards, monthly matrix + XLSX, personal calendar, updated and new reports, salary sheet + finalise (Auto Leave History) |
| 8. Final check | Full test run, tsc, eslint, build, end-to-end browser walk-through, CLAUDE.md note |

I'll stop after each phase only if you want me to; otherwise I'll build straight through, committing per phase.

---

## 8. Tests and verification

**Unit tests:**
- The calculator: merge, live hours, 18 h flag, overlap, Haversine, shift wrap, every status band.
- Punch rules: duplicate IN, OUT without IN, outside → Outside, nearest location, no locations → refused, accuracy > 50 m refused.
- OT: no rate → skip, no shift → skip, never touches an approved record.
- Each regularization type: validation and approval effect, idempotent and 409.
- Outdoor trim and restore.
- Leave: fractions; deduct remaining then carry; Unpaid; sandwich; credit job for Monthly and Quarterly; Leave Not Taken refund; Emergency Leave.
- Salary sheet figures on a hand-checked month.
- Scope: own / team / all.

**Browser check against the dev DB (desktop and phone size):**
- Enrol 3 photos.
- Punch IN inside a location, then OUT. Check hours and the OT record.
- Punch with a far GPS → Outside → reject-trim → clarify → approve → times restored.
- Missed Punch regularization → new session.
- Apply Fri–Mon with sandwich Sunday → approve → balance deducted correctly → Leave Not Taken refund.
- Team matrix and XLSX.
- Salary sheet totals match by hand.

**Limits stated honestly:**
- Face matching runs in the browser, as in the old project, so the server cannot prove a face matched. It stores the selfie for audit.
- GPS can be faked by a determined user.

Other checks: existing attendance, leave, dashboard and report tests keep passing; tsc, eslint and build stay clean.

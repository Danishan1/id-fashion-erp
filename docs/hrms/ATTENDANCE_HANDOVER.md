# Attendance Module — Handover Report (work done / work left)

Written: 2026-10-24. This is for whoever continues the build.

**Read first:**
- `docs/hrms/ATTENDANCE_MODULE_PLAN.md`, the approved plan. It has the gap table, the bug-fix list F1–F16 and the phases.
- `D:\office-data\Project\indradhar\internal_project\ATTENDANCE_MODULE_DETAILS.md`, the spec of the old system. Where it disagrees with the old code, the **code** was followed; the plan §1 lists the differences.
- `CLAUDE.md` for project rules (Prisma 7 non-interactive migration workaround, stale dev-server gotchas, etc.).

## 0. Where the work is

| Item | Value |
|---|---|
| Worktree | `D:\office-data\claude-projects\fashion-erp\.claude\worktrees\happy-napier-55f9e2` |
| Branch | `claude/happy-napier-55f9e2` (base `main` @ `00844a0`) |
| Commits | **None. Everything is uncommitted.** The user's rule: commit, push to `main` and pull into the main folder `D:\office-data\claude-projects\fashion-erp` only when the user asks. |
| `.env` | Copied from the main folder (gitignored). |
| Dependencies | `npm ci` done in the worktree. One new dependency: `@vladmandic/face-api@1.7.15` (exact pin in package.json). |
| Database | **Migration already applied** to the shared dev DB `fashion_erp`: `prisma/migrations/20261023100000_attendance_module_port/migration.sql`. Applied with `db execute` + `migrate resolve --applied` and verified by query. `npx prisma generate` done. The main folder's running dev server (if any) has a stale Prisma client — restart it before testing there. |
| Known unrelated drift | `migrate diff` always shows `ALTER TABLE "sample_requests" DROP COLUMN "color"`. This is pre-existing drift; never include it in a migration. |

## 1. User decisions (fixed, don't re-ask)

1. Same rules as the old project, **with its bugs fixed** (F1–F16 in the plan).
2. Punching = **selfie + GPS geofence + face AI** (face-api; up to 3 enrolled photos; threshold 0.45; 3 consecutive matching frames).
3. Leave = the **old project's monthly model**: quota per allocation period, carry-forward, Paid/Unpaid, Full/Half/Quarter days, sandwich, Leave Not Taken, Emergency Leave.
4. Salary = **read-only attendance salary sheet** with pay calculated from `Employee.fixedMonthlySalary` (+ travel + dearness allowance) and the OT rate. No payslips, no PF/ESIC.
5. Hard rule: **don't change other modules**. Shared files may get small registrations only (see §5).

## 2. What is DONE (code written)

### Phase 1 — Foundation ✅
- **Schema.** All attendance tables were added in one migration:
  - New tables: `hrms_attendance_settings`, `hrms_attendance_locations`, `hrms_employee_attendance_profiles`, `hrms_employee_face_photos`, `hrms_attendance_sessions`, `hrms_overtime_records`, `hrms_outdoor_rejections`, `hrms_leave_balances`, `hrms_leave_days`, `hrms_auto_leave_history`, `hrms_attendance_month_closes`.
  - Additive columns on HRMS-owned tables:
    - `AttendanceCorrectionRequest` gained `type`, `sessionId`, `dateFrom`, `dateTo`, `leaveTypeId`, `remark`.
    - `LeaveType` gained `allocationType`, `quotaPerPeriod`.
  - The migration also adds:
    - a partial unique index (only one open SELF_PUNCH session per employee);
    - CHECK constraints (checkout after checkin; OT ≥ 0; leave balances ≥ 0);
    - a backfill turning each existing `AttendanceRecord` that has a punch-in into one MANUAL session.
  - `Employee`, `Branch`, `User`, `HolidayMaster`, `ShiftMaster` and `RelatedModule` are **not** altered; only Prisma back-relation lines were added.
- **Calculator.** `src/modules/hrms/attendance-calculator.ts` is pure and client-safe, with 19 passing tests in `attendance-calculator.test.ts`. It covers:
  - IST helpers;
  - interval union and finalised/live hours;
  - the 18 h flag;
  - the overlap check;
  - Haversine and the geofence (radius max(10, r), default 100, nearest wins);
  - shift hours with overnight wrap;
  - day status bands (1 / 0.75 / 0.5 / 0 with a 15-minute tolerance);
  - OT = worked − shift (no shift → no OT);
  - late in IST;
  - leave fractions and Paid/Unpaid deduction planning.
- **Settings.**
  - Service: `attendance-settings.service.ts` + `.schema.ts` (settings, office locations, per-employee profile with weekly off and OT rate, "apply weekly off to everyone", scoped employee picker).
  - Page: `/attendance/settings`, with tabs General / Office Locations / Employees / Holidays & Shifts.
- **RBAC.** In `src/config/rbac.ts`:
  - `HRMS_SELF_SERVICE` (view + create on hrms_attendance and hrms_leave) goes to MERCHANDISER, PRODUCTION_SUPERVISOR, PRODUCTION_WORKER, ACCOUNTS_EXECUTIVE and WAREHOUSE_USER.
  - `HRMS_TEAM_APPROVER` (+ approve/reject) goes to SAMPLING/PRODUCTION/QC/STORE/ACCOUNTS/DISPATCH managers.
  - MANAGEMENT gains `hrms_attendance.override`.
  - Backfill script `scripts/backfill-attendance-rbac.mjs`: the dry run says it will grant 138 rows. **NOT yet run for real** (see §4).
- Shared route helper: `src/modules/hrms/hrms-route.ts`.

### Phase 2 — Punching ✅ (code), ⚠️ not browser-verified
- `attendance-session.core.ts`: linked employee (`User.employeeId`), day-row create, `syncDayRecord` (keeps the day row's punchIn/punchOut = first in / last out), image/proof saving through the shared `FileStorage`.
- `attendance-punch.service.ts` (`punch`, `getMyAttendanceToday`). Rules:
  - a selfie is required;
  - coordinates must be valid and not (0,0);
  - GPS accuracy must be ≤ the setting (50 m);
  - the face photo must belong to the employee (required when `requireFace`);
  - no active locations → refused;
  - IN is refused while a session is open;
  - OUT closes only the open session (F7);
  - a punch outside every location is marked PRESENT_FROM_OUTSIDE immediately (F9);
  - the selfie file is deleted if the database write fails.
- `attendance-session.service.ts`: manual add (MANUAL source), single and bulk time correction with order/18 h/overlap checks (F8), session list for the photo audit.
- `face-enrolment.service.ts`: up to 3 photos, delete, private file serving (the employee themself or HR with `edit`), selfie serving (HRMS scope).
- `attendance.service.ts`: the old `recordAttendance` now creates a MANUAL session, and `computeIsLate` now uses IST. In `attendance.service.test.ts`, dates were changed to `+05:30`.
- Client:
  - `_shared/FacePunchCamera.tsx`: dynamic import of `@vladmandic/face-api/dist/face-api.esm.js`; models in `public/models/face-api/` (tiny detector, 68 landmarks, recognition — copied from node_modules); descriptors cached in sessionStorage.
  - Pages: `/attendance/my` (tabs Today / My Month / My Overtime / Outdoor Rejections), `/attendance/face-enrolment/[employeeId]` (upload or camera capture), `/attendance/photos` (photo audit + "Correct times" modal).
- `next.config.ts`: a **second header rule** for `/attendance/:path*` allows `camera=(self), geolocation=(self)`. Every other page still blocks both.

### Phase 3 — Overtime ✅ (code)
- `overtime.service.ts` (recalculate, list, approve/reject with a self-approval guard and a notification).
- `attendance-events.ts` → `onAttendanceDayChanged` recalculates OT **right after the commit**. This is a deviation from the old BullMQ job; the formula is the same, and the worker isn't needed for it.
- An approved or rejected record is never touched again (F5).
- Page `/attendance/overtime`.

### Phase 4 — Outdoor ✅ (code)
- `outdoor-attendance.service.ts` covers: list unverified; bulk approve (session status becomes **REMOTE** = "approved outside"); reject = trim the times + save the originals; employee accept / clarify (with a proof file); admin approve (restores the originals) or reject; cancel (restores).
- Page `/attendance/outdoor`; the employee side is the "Outdoor Rejections" tab on My Attendance.

### Phase 5 — Regularization (6 types) ✅ (code)
- `attendance-correction.service.ts` + `.schema.ts` rewritten: MISSED_PUNCH, MISSED_LOGOUT, CHANGE_LOGIN, CHANGE_LOGOUT, LEAVE_NOT_TAKEN (refund), EMERGENCY_LEAVE (past working days only, F13).
  - Validation happens at create and again at approve.
  - Approval runs in one transaction.
  - A repeated identical decision is a no-op; a conflicting one returns 409.
  - `countPendingRegularizations` blocks finalising the salary month.
- Proof documents use the shared `AttachmentService` (unchanged), called from **our own scope-checked routes** `/api/v1/attendance-corrections/[id]/documents[/attachmentId]`. `attachment-targets.ts` was deliberately NOT modified, because it checks branch scope but not HRMS team scope.
- `/attendance-corrections` page rewritten (My / Team tabs, type-specific form, session picker, document upload).

### Phase 6 — Monthly leave ✅ (code)
- `leave-balance.service.ts` covers:
  - `ensureBalance`, which builds missing months; carry = previous remaining + previous carry (F3 — no double count);
  - quota credited only in the period's first month (MONTHLY / QUARTERLY / HALF_YEARLY / YEARLY);
  - `deductLeaveDay` (remaining first, then carry; PAID or NOT_PAID; F1/F2);
  - `refundLeaveDay` (exact refund);
  - `cascadeAvailability` (later months' carry follows any change);
  - monthly credit for a company or for all companies;
  - list (lazy-credits the shown month) and admin adjust.
- `leave.service.ts`:
  - `createLeaveRequest` is now **day-wise**, with per-day duration and sandwich weekly-offs added server-side (F14); weekly offs and holidays are refused; overlapping leave is refused.
  - `approveLeaveRequest` deducts each day from that day's month.
  - New `getLeaveDayInfo`; `listLeaveRequests` gained `mine`.
  - The old yearly `getLeaveBalance` / `runLeaveCarryForward` are kept for legacy routes only.
- `leave.schema.ts` and `leave.repository.ts` updated (days include, `findById`).
- Worker:
  - New `attendance-jobs.worker.ts` (job `leave.monthly-credit` every 6 h, idempotent).
  - Registered in `src/core/jobs/worker.ts`.
- Pages: `/leave-requests` rewritten (apply modal with live balance), `/leave-balances` (new; adjust + run monthly credit), `/leave-types` (allocation type + days per period; the old carry-forward panel removed).

### Phase 7 — Views & money ✅ (code)
- **Month engine.** `attendance-month.service.ts`:
  - Per day: code P / SP / HP / LH / A / L / H / W / S; holidays and weekly offs paid; extra payable for work on an off day.
  - Sandwich rule; only approved, taken leave counts (F10).
  - Legacy leave requests with no day rows are treated as full paid days.
  - Month summary + OT for the month only (F11).
  - Each employee's own shift hours (F12); no shift → 8 h.
- **Team views.** `attendance-team.service.ts`: team day cards, team month grid + XLSX, salary sheet (live preview, or the frozen snapshot once finalised), finalise month (blocked until the month has ended and while regularizations are pending; writes AutoLeaveHistory; needs view_all + edit), salary XLSX.
- **Pages:**
  - `/attendance` rewritten as Team Attendance (cards + table + manual "Record Attendance");
  - `/attendance/records` (coloured month grid + Excel);
  - `/attendance/salary-sheet`.
- **Reports** (`src/modules/reports/hr-attendance.reports.ts` + page-meta): Daily Attendance and Monthly Summary rebuilt on the month engine; Leave Register uses day fractions; new Overtime Register and Outdoor Punch Register.
- **Sidebar** (`navigation.ts`, HRMS group):
  - Attendance group: My Attendance, Team Attendance, Monthly Records, Regularization, Outdoor Punches*, Overtime*, Punch Photos*, Salary Sheet**, Attendance Settings***.
  - Leave group: Leave Requests, Leave Balances, Leave Types***.
  - Gates: \* approve, \*\* export, \*\*\* edit. To support these, `src/app/(dashboard)/layout.tsx` now also computes the `edit` and `export` action sets.

### API routes added (all under `src/app/api/v1/`)
- `attendance/`:
  - `settings`, `settings/apply-weekends`, `locations`, `locations/[id]`, `profiles`, `profiles/[employeeId]`, `employees`
  - `punch`, `me/today`, `me/month`, `me/sessions`
  - `sessions` (GET list, POST manual), `sessions/[id]` (PATCH correct), `sessions/bulk-correct`, `sessions/[id]/selfie/[side]`
  - `face-photos/[employeeId]`, `face-photos/file/[photoId]`
  - `overtime`, `overtime/[id]/approve`, `overtime/[id]/reject`
  - `outdoor` (GET list / POST bulk approve), `outdoor/[sessionId]/reject`, `outdoor-rejections`, `outdoor-rejections/[id]/[action]` (accept / clarify / approve / reject / cancel; GET `proof`)
  - `team-day`, `team-month`, `team-month/export/xlsx`
  - `salary-sheet` (GET, POST = finalise), `salary-sheet/export/xlsx`
- `attendance-corrections/[id]/documents`, `attendance-corrections/[id]/documents/[attachmentId]`
- `leave-balances`, `leave-balances/[id]`, `leave-balances/credit`
- `leave-requests/day-info`

## 3. Current check status

- `npx tsc --noEmit` (with `NODE_OPTIONS=--max-old-space-size=6144`): **clean** at the last run. The only error was `LayoutProps` in `src/app/layout.tsx`, a Next-generated type that appears before any build; ignore it.
- ESLint: one `react-hooks/set-state-in-effect` error in `FacePunchCamera.tsx` was **just fixed** (no setState in the geolocation effect; a `noGeolocation` message is rendered instead). **The re-run was interrupted — run eslint again.**
- Tests: only `attendance-calculator.test.ts` was run (19/19). **The full suite has NOT been run since the rewrites.**

## 4. What is LEFT (in order)

1. **Lint.** Run `NODE_OPTIONS="--max-old-space-size=6144" npx eslint .` and fix anything new (0 errors expected).
2. **Run `npx vitest run` and fix the failures.** Expected to need updates:
   - `src/modules/hrms/leave.service.test.ts`: `createLeaveRequest` / `approveLeaveRequest` were rewritten. The new input is `{employeeId?, leaveTypeId, days:[{date,duration}], includeSandwich, reason}`; there is no `LEAVE_BALANCE_EXCEEDED` any more (short balance → NOT_PAID).
   - `src/modules/hrms/attendance-correction.service.test.ts`: rewritten for the 6 types. The approve/reject return values come from `AttendanceCorrectionRepository.findById`, and both use guarded `updateMany`.
   - `src/modules/hrms/attendance.service.test.ts`: dates now carry `+05:30`. Check every `new Date("…")` in it got the suffix.
   - Possibly navigation, rbac and module-entitlement tests, and `dashboard.service.test.ts`.
3. **Write new unit tests (mocked Prisma, the project's usual pattern):**
   - punch rules: duplicate IN, OUT without IN, outside → PRESENT_FROM_OUTSIDE, no locations, bad accuracy, face required;
   - overtime: no rate / no shift → none; approved never changed;
   - outdoor: trim, restore, cancel;
   - each regularization type, plus idempotent repeats and 409;
   - leave balance: credit months, deduct remaining then carry, NOT_PAID, refund, cascade;
   - month engine: status bands, sandwich, leave + hours combination;
   - salary sheet arithmetic on a hand-checked month.
4. **Apply the RBAC grants:** `node --experimental-strip-types --no-warnings scripts/backfill-attendance-rbac.mjs`. Additive only. Then restart the dev server (the PermissionService cache).
5. **Browser verification.** Start the dev server for this worktree (skill `run-fashion-erp` / `.claude/launch.json`). Restart first: stale Prisma client; maybe wipe `.next`. Then check:
   - Settings: add an office location (or use "Use my current location"), set an OT rate and a shift for a test employee, enrol 3 face photos.
   - Link a test user to that employee (`User.employeeId`). Punch IN/OUT at `/attendance/my`. Check the selfie, distance, hours, and the OT record after OUT.
   - Fake a far GPS (DevTools sensors): Outside → reject with trim → employee clarify → approve → original times restored. Also test cancel.
   - Each regularization type end to end.
   - Leave: create a type with a quota → balances → apply Fri + Mon with sandwich → approve → Paid/Unpaid correct → Leave Not Taken refund.
   - Team Attendance cards, Monthly Records grid + Excel, Salary Sheet + Excel, finalise on a past month.
   - Reports: Daily / Monthly / Overtime Register / Outdoor Punch Register.
   - Phone width (375 px) for My Attendance.
   - The face models load (check the console). In a **production build**, check the CSP doesn't block face-api: production `script-src` has no `'unsafe-eval'`; the WebGL backend should be fine — verify.
6. **Known gaps / decisions to keep in mind:**
   - There is no dedicated face-enrolment list page; Settings → Employees links to `/attendance/face-enrolment/[id]`.
   - Editing a leave type through SimpleLookupManager resets the legacy `annualDays` to 0. It is only used by the legacy yearly routes `leave-requests/balance` and `carry-forward`, which are no longer in the UI.
   - The dashboard "My Team" view (`dashboard.service.ts`) was left untouched; it still counts `punchIn`, which stays in sync.
   - Camera and GPS need HTTPS (or localhost).
   - Face matching runs in the browser (same as the old system). The selfie is stored for audit.
   - There is no email; all alerts are in-app notifications.
   - The Expo mobile app was not ported (out of scope).
7. **Docs.** Add a dated "Attendance module port" section to `CLAUDE.md`. Summarise the tables, the services, the deviations (inline OT, REMOTE = approved outside, document routes instead of attachment-targets, shared-file touches in §5) and the gotchas.
8. **Commit and push only when the user asks.**

## 5. Shared files touched (outside HRMS code)

| File | Change |
|---|---|
| `prisma/schema.prisma` | New models/enums + back-relation lines only. |
| `src/config/rbac.ts` | HRMS grants only. |
| `src/components/layout/navigation.ts` | HRMS group links only. |
| `src/app/(dashboard)/layout.tsx` | Also computes `edit`/`export` action sets for sidebar gating. |
| `src/core/jobs/worker.ts` | Starts `startAttendanceJobsWorker()`. |
| `next.config.ts` | Permissions-Policy override for `/attendance/*` only. |
| `package.json` / lockfile | `@vladmandic/face-api`. |
| `public/models/face-api/*` | 6 model files (~7 MB). |
| `src/modules/reports/hr-attendance.reports.ts`, `src/modules/reports/page-meta/hr-attendance.page-meta.ts` | Attendance reports. |

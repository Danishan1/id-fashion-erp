# CRM Phase 10 — Calendar & Appointments

Status: implemented, tested and verified (2026-10-07). Phase 11 is not started.

## 1. Existing systems reused

| Area | What was reused |
|---|---|
| Calendar | None in the ERP (no calendar model, UI or date library). One reusable calendar component was built (`CrmCalendar`, day / week / month). |
| Appointment | Phase 09 already had an `APPOINTMENT` activity type. An appointment **is** a `crm_activities` row of that type, extended with the columns below. No separate appointment table. |
| Employee / user | ERP `users`. The assignee must be an active user of the company with `crm.view` (Phase 09's `assertAssignable`). No CRM employee or calendar entity. |
| Time zone | No ERP time-zone library or user setting. `crm-timezone.ts` uses the runtime's `Intl` time-zone database (the ICU data Node and browsers ship) with no hand-written DST rules. The business zone stays Asia/Kolkata (`crm-dates.ts`, `date-format.ts`). |
| Availability | None in the ERP; `ShiftMaster` / `HolidayMaster` are HR attendance data. One conflict check (`findConflicts`) runs inside the booking transaction. |
| Reminder | Phase 09 reminder columns and the existing worker job `processDueActivityReminders`: one claim per reminder (PENDING → SENT), so never sent twice. |
| Notification | ERP `notifications` via `createNotification` (in-app bell). |
| Activity | Phase 09 activity service: links to records, access rules, presentation, My Tasks. Generic activity actions on appointment rows are routed to the appointment service. |
| Timeline | `crm_events` and `CrmTimeline`. Linked activities' events already show on contact, company and opportunity timelines, so `appointment.*` events appear there with no timeline change. |
| Audit | `writeAuditLog`, in the same transaction (`runCrmMutation`). |
| Event bus | `runCrmMutation` writes `crm_events` rows in the same transaction as the change, then calls in-process subscribers after commit (`dispatchCrmEvents`). |
| Scheduler | Existing BullMQ worker (Phase 09 job). Nothing new. |
| Permissions | Existing `crm.view` / `create` / `edit`, plus `view_all` for other employees' calendars. No new roles or permissions. |
| Preferences | Phase 08 `crm_user_preferences`. New keys: `calendar.view`, `calendar.timezone`, `calendar.employee`. |
| Option lists | `crm_option_values` (Settings → Form options). New lists: appointment types, cancellation reasons, no-show reasons. |

## 2. Files

**New — module** (`src/modules/crm/appointments/`):

- `appointment-registry.ts` — statuses, transitions, actions, option lists, event names and payload type.
- `appointment.schema.ts`
- `crm-appointments.service.ts` — the central appointment service.
- `appointments.unit.test.ts`, `appointments.integration.test.ts`

Also `src/modules/crm/core/crm-timezone.ts`.

**New — API** (`src/app/api/v1/crm/appointments/`):

- `route.ts`, `calendar/`, `availability/`, `meta/`
- `[id]/route.ts`
- `[id]/confirm`, `reschedule`, `cancel`, `complete`, `no-show`, `assign`
- `route.test.ts`

**New — UI:**

- `src/components/crm/appointments/`: `CrmCalendar`, `AppointmentForm`, `AppointmentDetail` (with the reschedule / cancel / no-show / complete dialogs), `AppointmentPanel`, `useAppointmentLookups`, `appointment-types`, `appointment-components.test.tsx`.
- `src/app/(dashboard)/crm/calendar/`: `page.tsx`, `_components/CalendarClient.tsx`, `calendar-client.test.tsx`.

**Changed:**

- `prisma/schema.prisma`; `BusinessRuleError.ts` (`CRM_APPOINTMENT_CONFLICT`, 409).
- `crm-event-types.ts` (the `appointment.*` events).
- Activities:
  - `activity-registry.ts` — appointment statuses and option lists.
  - `activity-due.ts` — "open" includes open appointments.
  - `crm-activities.service.ts` — exported helpers; delegation; reminder text in the appointment's zone.
  - `crm-activity.repository.ts` — new columns selected.
- `crm-preference-registry.ts`; `crm-settings.schema.ts` (see the fix below).
- Activity UI: `ActivityPanel` ("+ Appointment" opens the appointment form), `ActivityComposer` (no Appointment type there), `ActivityDetail` (appointment rows show the appointment detail).
- Contact, company and opportunity pages: new **Appointments** section.
- `navigation.ts`: **Calendar** menu item.
- Tests adjusted: `crm-registries.test.ts`, `activities.unit.test.ts`.

**Phase 09 fix:** Settings → Form options refused new values for the activity outcome lists. The option-value schema listed only the Phase 04–06 lists; it now accepts every registered list.

## 3. Database changes

Migration `20261009100000_crm_appointments`. **No new table.**

New columns on `crm_activities`: `timezone`, `video_link`, `appointment_type`, `confirmed_at` / `confirmed_by_user_id`, `cancelled_at` / `cancelled_by_user_id` / `cancel_reason`, `no_show_at` / `no_show_by_user_id` / `no_show_reason`. `due_at` / `end_at` stay the start and end, as UTC instants.

**Constraints:**

- `crm_activities_status_check` is replaced: appointment statuses are allowed only on appointments, and task statuses only on other activities.
- New: a timed appointment must have an end; video links must be `http(s)`; a time zone is never blank.

**Data conversion of existing appointments:**

- PENDING / IN_PROGRESS → SCHEDULED.
- The time zone is set to Asia/Kolkata.
- A timed appointment without an end gets one hour.
- Cancelled appointments get `cancelled_at`.

**Indexes** (partial, live appointments only):

- `crm_activities_appt_calendar_idx` `(company_id, due_at)` — company calendar windows.
- `crm_activities_appt_assignee_idx` `(company_id, assigned_to_user_id, due_at)` — My calendar, one employee's calendar, conflict checks.

Contact, company and opportunity filters use the existing `crm_activity_links_entity_idx`. With 20,000 rows, `EXPLAIN` showed the calendar query using `crm_activities_appt_calendar_idx`.

## 4. APIs

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/crm/appointments` | List: search (title, location, type, contact, company, opportunity, employee), filters, sort (`startAt`, `createdAt`, `updatedAt`, `title`), paging. |
| GET | `/api/v1/crm/appointments/calendar` | Everything overlapping `[from, to)` (at most 62 days, at most 1,000 rows, `truncated` flag) with the same filters. |
| GET | `/api/v1/crm/appointments/availability` | `assignedToUserId` plus either `startAt` + `endAt`, or date, time and `timezone`; optional `excludeId`. Returns `{ available, conflicts }`. Titles the caller can't open show as "Busy". |
| GET | `/api/v1/crm/appointments/meta` | Statuses with their transitions, actions, reminders, option lists, default zone and duration. |
| POST | `/api/v1/crm/appointments` | Create. Returns 409 `CRM_APPOINTMENT_CONFLICT` with `details.conflicts` when the employee is busy; resend with `allowConflict: true` to book anyway. |
| GET / PATCH / PUT / DELETE | `/api/v1/crm/appointments/{id}` | Edit details, related records, times (recorded as a reschedule) or employee. DELETE removes a mistaken appointment (its creator or a manager; never a completed one). |
| POST | `…/{id}/confirm`, `reschedule`, `cancel`, `complete`, `no-show`, `assign` | Lifecycle actions. |

Filters: `from`, `to`, `assignedToUserIds`, `mine`, `statuses`, `appointmentTypes` (`|`-separated), `contactId`, `companyId`, `opportunityId`, `leadId`, `when=upcoming|past`.

**Activity API (Phase 09), changed behaviour for appointment rows:**

- Create with type `APPOINTMENT` → `createAppointment`, using business time, a one-hour default length and the conflict check.
- Complete, cancel and assign → the appointment service.
- Reschedule → the appointment's own reschedule, keeping its length.
- Reopen, and status or time edits through `PATCH /activities/{id}` → refused with a message pointing to the appointment actions.

## 5. Appointment lifecycle

```
SCHEDULED ─confirm─▶ CONFIRMED ─complete─▶ COMPLETED
    │                    │
    ├─reschedule─▶ RESCHEDULED ─confirm─▶ CONFIRMED
    ├─cancel────▶ CANCELLED
    └─no-show───▶ NO_SHOW
```

| From | Allowed to |
|---|---|
| Scheduled | Confirmed, Rescheduled, Completed, Cancelled, No show |
| Confirmed | Rescheduled, Completed, Cancelled, No show |
| Rescheduled | Confirmed, Rescheduled, Completed, Cancelled, No show |
| Completed / Cancelled / No show | — (final; book a new appointment) |

- The table lives in `APPOINTMENT_TRANSITIONS` and is the only place the lifecycle is defined. The service checks every action against it; the UI shows only the actions the server returns in `allowed`.
- **Rescheduled** means "moved, needs confirming again". Every move goes there.
- **No-show** is allowed only once the start time has passed.
- Confirm, cancel, complete and no-show are idempotent: repeating them changes nothing.

## 6. Calendar implementation

**Views**

- One component, `CrmCalendar`, renders day (time grid, one column), week (seven columns, Monday start) and month (6 × 7 grid; "+N more" opens the day).
- Overlapping appointments share a column in lanes. An appointment crossing midnight is split between days.
- A red line marks now; the grid opens at the earliest appointment of the period, or at 08:00.

**Navigation**

- Previous / Today / Next, a date picker, and Day / Week / Month / List tabs.
- Clicking a day header opens that day; clicking an empty slot creates an appointment at that time.

**Filters**

- **Employee:** My calendar (default), everyone visible, or a specific employee (with `crm.view_all`).
- Status, type, a contact / company / opportunity (searchable picker), and free-text search.
- View, time zone and employee choice are remembered per user.

**Loading:** only the visible window is requested (`calendarRange` gives that period's start and end in the viewer's zone). The server returns appointments overlapping it; the start-time lower bound keeps the index scan short.

**Time zones**

- Each appointment stores UTC instants plus the zone its times were entered in.
- The calendar draws everything in the chosen display zone (default Asia/Kolkata). The detail shows the appointment's own zone and "Your time" in the viewer's zone when they differ.
- A time skipped by a DST change is refused. A repeated time resolves to its first occurrence.

**Drag and drop**

- Drag to another time (day / week, 15-minute snap) or another day (month, same time of day).
- The drop calls the same `POST …/reschedule` (in the appointment's own zone, with its version). It never writes start / end directly.
- The appointment moves at once and shows as pending. If the server refuses, it goes back and the reason is shown. A busy employee opens "Move anyway?"; Keep puts it back. A version conflict refreshes the calendar.

**List view:** the shared CRM table with search, filters (status, upcoming / past, type, employee, assigned to me), sort and paging.

## 7. CRM integration

**Contact, company and opportunity pages**

- A new **Appointments** section shows Upcoming and Past.
- "+ Appointment" pre-fills the record:
  - an opportunity also fills its company and contact;
  - a contact also fills its company.
- Clicking an appointment opens its detail with Confirm / Reschedule / Complete / Mark as no-show / Edit / Cancel.

**Relationship rules**

- An appointment can be with a contact, a company, an opportunity, or any valid combination.
- A contact must belong to the chosen company, and an opportunity's company must be the chosen company.
- Archived, merged or invisible records are refused.
- Lead appointments from Phase 09 still work, on their own.

**Activities**

- Appointments remain activities. They appear in the record's Activities panel, the Activities list and My Tasks (open appointments count as open), and open the appointment detail there.
- The Activities panel's "+ Appointment" uses the appointment form.

**Timeline:** `appointment.*` events show on the appointment's history and on the timeline of every linked contact, company and opportunity. Completing an appointment updates "last activity" on those records.

## 8. Automation events

`appointment.created`, `appointment.updated`, `appointment.assigned`, `appointment.confirmed`, `appointment.rescheduled`, `appointment.cancelled`, `appointment.completed`, `appointment.no_show` — stored in `crm_events` (`entity_type = ACTIVITY`, `entity_id` = appointment id).

Payload (`AppointmentEventPayload`, `schemaVersion: 1`):

```text
{ schemaVersion, appointmentId, contactId, companyId, opportunityId, leadId,
  employeeId, status, previousStatus, startAt, endAt, timezone, location,
  hasVideoLink, appointmentType, actorId, occurredAt, …extra }
```

Extras by event:

- rescheduled: `previousStartAt`, `previousEndAt`, `previousTimezone`, `reason`, `rescheduleCount`
- cancelled / no_show: `reason`
- completed: `outcome`, `note`
- assigned: `previousEmployeeId`
- updated: `changes`
- created: `conflictConfirmed`

**Reliability:** events are written in the same transaction as the change, so a failed change (validation, version conflict, busy employee, a database error) leaves no event. The `crm_events` row id is the unique event id consumers use for idempotency. In-process subscribers run only after commit.

## 9. Tests

| Kind | Coverage |
|---|---|
| Unit | Time zones: IST / London / New York, DST gap and repeated hour, 25-hour day, day boundary, reminder offset across zones. Lifecycle table (valid and invalid), actions per status, overlap rule (exact / partial / containing / adjacent). Schemas (zone, link, reminder, update pairing, calendar window cap). |
| API | All 11 routes: permission per route, arguments passed through, 400 / 403 / 409 mapping. |
| Integration (13, real Postgres) | **Relations:** contact → company auto-fill; opportunity → contact + company; company-only; invalid relationships refused. **Time:** UTC storage, London summer and winter, midnight crossing, end ≤ start, DST gap, bad zone and link. **Lifecycle:** every listed transition, invalid ones refused, no-show only after the start, history kept, stale version refused. **Conflicts:** exact, partial, adjacent, other employee, booking for someone else, allow-conflict, reschedule into a conflict, cancelled frees the slot, availability endpoint, titles hidden from others; three concurrent bookings of one slot → exactly one wins. **Reminders:** scheduled, recalculated on reschedule and reminder change, cancelled on cancel, delivered once when the job runs twice, IST-labelled. **Events:** exact sequence, unique ids, payload fields, none on validation / version / conflict failure or on a rolled-back transaction. **Timeline:** contact, company and opportunity. **Calendar:** window, employee / mine / contact / status / type filters, search by location, employee or contact, visibility, overlap at the window start, list sort. **Phase 09 API:** routing and refusals. **Edit:** relations, times, employee, zone-only change. |
| UI (17) | **Calendar:** periods (DST week = 169 h), lanes and midnight split, day / week / month rendering in IST and London, slot click, drag (time and day), locked events. **Form:** prefill, payload with zone, conflict → Book anyway, start keeps length, live busy warning, field errors, opportunity prefill. **Detail:** actions by status and permission, confirm with version, cancel with reason. **Calendar page:** window query, drag success, rollback on refusal, busy-slot keep / move anyway, view switching. |
| Regression | Full suite: **162 files, 2,527 tests**, covering Phases 02–09 and the board / list. `tsc` is clean; ESLint 0 errors (12 existing warnings elsewhere). |

**Databases:**

- Fresh: all migrations, then the seed.
- Upgrade: the Phase 08 / 09 database plus Phase 09-style appointments, converted correctly. The new constraints reject an appointment status on a task and a `javascript:` link.

**Browser e2e (Chromium):**

- created from an opportunity (company and contact pre-filled);
- conflict on a contact page → Book anyway;
- week-view drag → Rescheduled 13:30–14:30;
- month / day views and the London time zone;
- confirm → complete with outcome and next step;
- no-show from the list;
- cancel with a reason from a contact page;
- `appointment.*` on the opportunity, contact and company timelines;
- no page errors.

## 10. Known limitations

- **Not built** (out of scope per spec §68): calendar sync (Google / Outlook), video integrations (Zoom / Meet / Teams), email / SMS / WhatsApp confirmations, public booking, recurring appointments, AI scheduling.
- **Reminders** are in-app only, through the existing worker (needs Redis and `npm run worker`).
- **Attendees:**
  - One assigned employee per appointment; no attendee lists.
  - Conflicts consider that employee's open appointments and scheduled meetings with an end time.
  - Working hours, holidays and leave (HRMS) aren't used yet.
- **Conflict policy:** warn and require explicit confirmation (no ERP policy existed). It can't yet be configured per role.
- **Time-zone defaults:** there's no per-user time-zone profile. The calendar's zone is a remembered choice, and new appointments default to the calendar's zone.
- **Calendar views:** all-day appointments (only Phase 09 legacy ones) show only in the month view. The calendar loads at most 1,000 appointments per window and says so when truncated.
- **Leads:** lead appointments (Phase 09) are supported, but the form can't create a new one for a lead. Leads have no appointments panel.

## 11. Future extension points

- **Workflow automation:** consume `appointment.*` rows from `crm_events`, using the event id as the idempotency key. Examples:
  - created → WhatsApp confirmation;
  - completed → follow-up task through `createActivity`;
  - no_show → callback task assigned to the employee.
  The in-process `subscribeCrmEvent("appointment.no_show", …)` hook is available for best-effort reactions.
- **Email / WhatsApp / SMS confirmation:** a messaging adapter sends on `appointment.created` / `rescheduled`. A reply calls `confirmAppointment` as a system actor, which emits `appointment.confirmed`.
- **Calendar sync:** map `due_at` / `end_at` / `timezone` / `location` / `video_link` to external events. Use `source` + `external_ref` (already on activities, unique per source) for idempotent import.
- **Public booking:** `checkAvailability` (plus HRMS working hours / holidays) for free slots, then `createAppointment`.
- **Automated follow-ups / no-show automation:** react to `appointment.no_show` / `appointment.completed`. The payload carries the contact, company, opportunity and employee.
- **New lifecycle steps or reasons:** one entry in `APPOINTMENT_TRANSITIONS` / `APPOINTMENT_STATUSES` (plus the status CHECK), and the option lists in Settings.

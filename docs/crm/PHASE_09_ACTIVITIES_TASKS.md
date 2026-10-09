# CRM Phase 09 — Activities, Tasks & Follow-ups

Status: implemented, tested and verified (2026-10-06). Phase 10 is not started.

**Phase 08 (Opportunity Board) is not in the repository yet** (the last commit is Phase 07). The board integration and the Phase 08 regression are therefore deferred. The activity APIs are ready for the board to use.

## 1. Existing systems reused

| Area | What was reused |
|---|---|
| Task service | None exists in the ERP (confirmed in Phase 00 and again now). Activities are new and live in one CRM service. |
| Activity service | None in the ERP. The CRM **notes** (`crm_notes`, `crm-notes.service`) remain the notes system; the "+ Note" button on a record opens its Notes section. |
| User / employee | ERP `users`. Assignees must be active users of the company with `crm.view`. The assignee picker uses `/api/v1/users`. No CRM user, team or role system. |
| Permissions | Existing `crm` permissions: view / create / edit (plus `view_all` for visibility). No new permission module. |
| Timeline | `crm_events` via `runCrmMutation` and the shared `CrmTimeline` / `/api/v1/crm/events`.<br>A new CRM record type `ACTIVITY` carries the `activity.*` events. A record's timeline includes the events of the activities linked to it. Phase 07 stage history is untouched. |
| Audit | `writeAuditLog` (AuditLog), written in the same transaction as the change. |
| Notification | ERP `notifications` table and `NotificationService.createNotification`. It now accepts a transaction client so a reminder and its notification commit together. Shown by the existing bell. |
| Scheduler | Existing BullMQ worker (`npm run worker`) and CRM queue. New job scheduler `crm-activity-reminders` runs every minute and calls `processDueActivityReminders`. |
| Calendar | None in the ERP. The Appointment type exists as an activity. A calendar UI is Phase 10. |
| Dates | `crm-dates.ts` business time zone (IST), extended with `businessDateTime` / `businessDateParts`. |
| Settings | Outcome suggestions are admin option lists (`crm_option_values`) under Settings → Form options. |

## 2. Files

**New — module** (`src/modules/crm/activities/`):

- `activity-registry.ts` — types, statuses, priorities, reminders, outcome lists.
- `activity-due.ts` — derived due state, reminder time, filters.
- `activity.schema.ts`
- `crm-activity.repository.ts`
- `crm-activities.service.ts`
- `activities.unit.test.ts`
- `activities.integration.test.ts`

**New — API** (`src/app/api/v1/crm/activities/`):

- `route.ts`, `meta/`, `my-counts/`, `bulk/`
- `[id]/route.ts` (GET / PATCH / PUT / DELETE)
- `[id]/complete`, `reopen`, `cancel`, `reschedule`, `assign`, `history`
- `route.test.ts`

**New — UI:**

- `src/components/crm/activities/`: `ActivityComposer`, `ActivityPanel`, `ActivityList` (rows), `ActivityDetail` (+ modal), `ActivityBadges`, `useActivityLookups`, `activity-types`, `activity-components.test.tsx`.
- Pages:
  - `src/app/(dashboard)/crm/activities/` — list, `[id]` detail, `_components`.
  - `src/app/(dashboard)/crm/my-tasks/`.

**Changed:**

- **Database and core:**
  - `prisma/schema.prisma`; new migration `20261007100000_crm_activities`.
  - `src/core/notifications/NotificationService.ts` — optional transaction.
- **CRM core:** `crm-entity-types.ts` (ACTIVITY), `crm-event-types.ts` (`activity.*` events), `crm-dates.ts`, `crm-entity-access.ts` (ACTIVITY access), `src/app/api/v1/crm/events/route.ts` (activity scope on record timelines).
- **CRM modules:**
  - Contact and company merge services: activities move to the survivor.
  - `contact-registry.ts`: outcome lists added; contact, company and opportunity registries drop their Phase 09 placeholders.
  - CRM worker and queue (`crm-import.worker.ts`, `crm-import.queue.ts`): reminder job.
- **UI:**
  - Contact, Company and Opportunity detail pages: new "Activities & tasks" section.
  - `CrmTimeline`: rows from related records name their source.
  - Navigation: My Tasks and Activities added.
- **Tests:** existing tests updated for the new entity type and placeholders.

## 3. Database (`prisma/migrations/20261007100000_crm_activities`)

All changes are additive.

- **Enums:** `CrmEntityType` + `ACTIVITY`; `RelatedModule` + `CRM_ACTIVITY` (the target of a notification).
- **`crm_activities` (new):**
  - **What and who:** type, subject, description, status, priority; created-on record (`entity_type`, `entity_id`); assignee; `source` + `external_ref` + `metadata` for future integrations.
  - **When:**
    - `due_at` + `all_day`, `end_at`;
    - `original_due_at`, `reschedule_count`;
    - reminder offset, `reminder_at`, `reminder_state` (PENDING / SENT / CANCELLED), `reminder_sent_at`.
  - **Result:** outcome, direction, duration, location; completed by / at.
  - **Housekeeping:** soft delete, version, timestamps.
  - **CHECK constraints:** status, priority, reminder state, direction; completed ⇔ `completed_at`; end ≥ start; non-negative offset and duration; `metadata` is an object.
  - **Indexes:** assignee + status + due; status + due; created-on record; type; creator. Partial index on scheduled reminders. Partial unique (company, source, external_ref) so an integration logs each item once.
- **`crm_activity_links` (new):** polymorphic links (activity ↔ record, `is_primary`). Unique (activity, type, id); index (company, type, id, activity).
- **No overdue column.** Overdue is always derived.

## 4. APIs

All under `/api/v1/crm/activities`. Permissions: list, read, meta and counts need `crm.view`; create needs `crm.create`; every change needs `crm.edit`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/activities` | List with server-side search and paging. Filters: `types`, `statuses`, `priorities`, `assignedToUserIds`, `unassigned`, `mine=assigned\|created`, `due=overdue\|today\|tomorrow\|upcoming\|no_due_date\|completed`, `dueFrom`/`dueTo`, `state=open\|closed`, `relatedType`, `entityType`+`entityId` (one record's activities). Sort: `dueAt`, `createdAt`, `completedAt`, `updatedAt`, `subject`. |
| POST | `/activities` | Create. `mode: schedule` (assignee, due date/time, end time, reminder, priority) or `mode: log` (occurred date/time, outcome, direction, duration). Optional `links`, `source` + `externalRef`. |
| GET | `/activities/{id}` | Detail: due state, record links, permissions. |
| PATCH / PUT | `/activities/{id}` | Edit subject, description, priority, status (pending / in progress), outcome… Due date changes are recorded as a reschedule; assignee changes as an assignment. |
| DELETE | `/activities/{id}` | Soft delete by the creator or a manager. Completed activities can't be deleted. |
| POST | `/activities/{id}/complete` | Outcome, note, completed time. Idempotent. |
| POST | `/activities/{id}/reopen` | Completed / cancelled → pending; a future reminder is re-armed. |
| POST | `/activities/{id}/cancel` | Cancel with a reason. |
| POST | `/activities/{id}/reschedule` | New date / time / reminder and a reason. The original due date is kept. |
| POST | `/activities/{id}/assign` | Assign or reassign; the assignee is notified. |
| GET | `/activities/{id}/history` | The activity's own events. |
| POST | `/activities/bulk` | `assign`, `complete`, `reschedule`, `priority`, `cancel`. Each record is validated and saved on its own and reported in `skipped[]`. |
| GET | `/activities/meta`, `/activities/my-counts` | Composer data; My Tasks counts. |
| GET | `/api/v1/crm/events?entityType&entityId` *(changed)* | A record's timeline now also contains its activities' events. |

## 5. Activity architecture

- **Model.** One `crm_activities` row per task, call, meeting, appointment or logged message. Types are in a registry, stored as text, so adding a type is one entry:
  - **schedulable:** Task, Call, Meeting, Appointment, Other;
  - **loggable:** Call, Meeting, Email, SMS, WhatsApp, Other.

  Notes stay in `crm_notes`.
- **Relationships.**
  - Each activity is created on one CRM record (lead, contact, company or opportunity) and linked through `crm_activity_links`.
  - An activity on an opportunity is linked automatically to its company and contact; one on a contact or lead, to its company.
  - Records the user can't see are skipped. Extra links can be passed via the API.
  - Validation: the record exists and is visible; it isn't archived or merged; the assignee is an active user with CRM access; the type and mode are valid; dates and reminders are valid.
  - On a contact or company merge, links move to the survivor.
- **Task lifecycle.**
  - Pending → In progress → Completed, or Cancelled. Reopen goes back to Pending.
  - Logged activities are saved as Completed at the time they happened.
  - Completing keeps the due date. It is idempotent and cancels a pending reminder.
  - A reschedule keeps `original_due_at`, counts reschedules and records from / to / reason. A meeting keeps its length.
  - Every step writes AuditLog and an `activity.*` event in the same transaction, and bumps the linked records' "last activity". Calls and messages also set a lead's "last contacted".
- **Overdue.** Derived in the business time zone:
  - a timed item is overdue once its time passes;
  - an all-day item, once its day ends.

  The same logic serves both the UI (`dueState`) and the database filters (`dueFilterWhere`).
- **Reminders.**
  - `reminder_at` is the due time minus the offset (all-day items: 09:00 on the due day). A reminder already in the past is refused.
  - The worker job claims each due reminder with a conditional update (PENDING → SENT) in the same transaction as its ERP notification and `activity.reminder_sent` event. Retries and parallel workers therefore can't send it twice.
  - Reminders of completed, cancelled or deleted activities are marked CANCELLED. Rescheduling re-arms the reminder.
- **Visibility.**
  - Users with `crm.view_all` see everything.
  - Everyone else sees activities assigned to them or created by them, plus all activities on records they can open.
- **Timeline.**
  - Events: `activity.created`, `.updated`, `.assigned`, `.rescheduled`, `.completed`, `.reopened`, `.cancelled`, `.deleted`, `.reminder_sent`, `.call_logged`, `.meeting_logged`, `.message_logged`, `.logged`.
  - They are stored on the activity and shown on every linked record's timeline (newest 500 activities per record), next to the existing notes and Phase 07 stage changes.

## 6. UI

- **Activity composer:**
  - Type chips, and a Schedule / Log choice where the type allows both.
  - Fields: subject, description, assignee, due date and time, end time (meetings and appointments), reminder, priority, outcome (admin suggestions), direction, duration, location.
  - Opened from a record, the record is filled in; from the list, a record picker appears.
- **Record panel ("Activities & tasks")** on Contact, Company and Opportunity pages:
  - Quick buttons: + Task, + Log call, + Meeting, + Appointment, + Log message, + Note.
  - Open / Completed / All tabs with server-side paging.
  - Tick to complete or reopen; click to open the detail.
- **Activity detail** (dialog and `/crm/activities/{id}`):
  - Shows all fields, the related records and the reminder state.
  - Actions: Complete (outcome + note), Reopen, Reschedule (reason), Reassign, Edit, Cancel, Delete.
  - Includes the activity's own history.
- **Activities list** (`/crm/activities`):
  - Views: My open tasks, Due today, Overdue, Upcoming, Completed, Calls & meetings, All.
  - Filters: type, status, priority, related type, due range; an assignee picker; search.
  - Sortable subject / due columns, server-side paging, and bulk complete / reschedule / assign / priority / cancel.
- **My Tasks** (`/crm/my-tasks`): Overdue, Due today, Upcoming, No due date and Recently completed sections, each with counts and "show more". Related records are links.
- **Settings → Form options:** "Call outcomes" and "Meeting outcomes" lists.

## 7. Tests

| Suite | Count | Covers |
|---|---|---|
| Unit — `activities.unit.test.ts` | 9 | Registry; due state and overdue in IST, including the date-line case; reminder times; quick-filter conditions; create / update / action / bulk / filter schemas; visibility scope. |
| Integration (real Postgres) — `activities.integration.test.ts` | 10 | Task on an opportunity: links, assignee notification, audit, events, and all three record timelines.<br>Invalid type, record, hidden or archived record, assignee, reminder, mode.<br>Due-state filters; complete (idempotent) / reopen / cancel / no delete when completed; reschedule history and original due date; assignment rules and visibility.<br>Logged call / meeting / WhatsApp and external-ref idempotency.<br>Reminders sent exactly once with concurrent runs, and deleted ones cancelled; bulk results; soft delete; contact merge. |
| API — `activities/route.test.ts` | 6 | Permission per route, filters and sort passed through, 400 / 403 / 404 / 409 mapping. |
| UI — `activity-components.test.tsx` | 8 | Composer (pre-filled record, task payload, log call, required record); tick-to-complete; record panel tabs and quick adds; detail reschedule; completed actions. |
| Regression | — | Full suite **151 files, 2444 tests passed**, including Phases 02–07, the timeline and events API, merges, the navigation and the company-scoping contract.<br>`tsc` clean; ESLint 0 errors (12 existing warnings elsewhere). |

**Databases:**

- Fresh DB: all migrations, then the seed.
- Upgrade: the Phase 07 database migrated cleanly.

**Browser e2e (Chromium, upgraded DB):**

1. On an opportunity: created a task (due tomorrow 11:00, 30-minute reminder, High) and logged a call (Interested). The timeline showed "Activity scheduled" and "Call logged".
2. Rescheduled the task to +3 days 15:00 with a reason ("Rescheduled 1×"; reminder re-armed).
3. The task showed on the deal's contact and company pages.
4. An overdue task appeared in My Tasks → Overdue; ticking it moved it to Recently completed.
5. The Activities list views worked.
6. No page errors.

## 8. Known limitations (deferred on purpose)

- **Calendar:** no day / week / month calendar, attendees, time-zone choice per appointment, confirmations or no-shows (Phase 10). Appointments are activities with a start, end and location.
- **Integrations:** no email, SMS, WhatsApp or telephony integration (Phases 11–12+). Messages can be logged by hand or via the API (`source` + `externalRef`).
- **Reminder delivery:** reminders are delivered in-app only (the ERP has no email / SMS sender). They need the worker and Redis (`npm run worker`), as imports already do. The notification bell lists them but doesn't link to the activity; the bell wasn't changed.
- **Lead follow-up date:** a lead's `next_follow_up_at` is not set automatically from tasks. Leads support activities through the API; their page has no panel yet.
- **Visibility without `view_all`:** in the global list, users see activities assigned to or created by them. Others' activities on their records appear on the record pages.
- **Recurring tasks, sub-tasks, participants / attendees, a team "My team" view** are not built.
- **Bulk actions** run in the request (up to 200 ids), record by record, not as a background job.

## 9. Extension points

- **Email / WhatsApp / SMS:** `createActivity(actor, { type: "EMAIL" | "WHATSAPP" | "SMS", source: "GMAIL", externalRef: messageId, metadata })`. It is idempotent per source and reference, and the events land on the timeline automatically.
- **Telephony:** log calls with `source` = provider, `durationMinutes`, `direction`, and outcome mapped to the call-outcome list. Recording URLs go in `metadata`.
- **Sequences / workflows (Phases 17–18):**
  - Workflows can create tasks through the same `createActivity` service, acting as a user with access to the record.
  - They can consume `activity.*` events from `crm_events`.
  - The in-process event bus is available for best-effort hooks.
- **Calendar integrations (Phase 10):** `due_at` / `end_at` / `location` / `source` / `external_ref` map to calendar events; Appointment is already a type.
- **Notifications:** the reminder job calls `createNotification`, so adding email or push delivery is a channel change in NotificationService, not in activities.
- **New types / outcomes:** one entry in `ACTIVITY_TYPES` or in the option lists.
- **AI follow-up suggestions:** read open / overdue activities through `listActivities` filters.

## CLAUDE.md entry (appended on your machine)

```markdown
## CRM rebuild — Phase 09 Activities, Tasks & Follow-ups (2026-10-06)
- All activity writes go through `src/modules/crm/activities/crm-activities.service.ts` (create/log, update, complete, reopen, cancel, reschedule, assign, delete, bulk). Types/statuses/priorities/reminders: `activity-registry.ts` (text columns — add a type there). Overdue is derived (`activity-due.ts`), never stored.
- `crm_activities` + `crm_activity_links` (polymorphic; deal → its company/contact linked automatically). Events `activity.*` are stored on CrmEntityType ACTIVITY; `/api/v1/crm/events` adds linked activities' events to a record timeline. Notes stay in `crm_notes`.
- Reminders: worker job `activity.reminders` every minute → `processDueActivityReminders` (claims PENDING→SENT with the ERP notification in one transaction — never send twice). Assignees = active ERP users with crm.view.
- Report: `docs/crm/PHASE_09_ACTIVITIES_TASKS.md`.
```

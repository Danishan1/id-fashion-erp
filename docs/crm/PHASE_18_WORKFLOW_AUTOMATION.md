# CRM Phase 18 — Workflow Automation Engine

Date: 2026-10-13 · Branch: `crm-build-v2` (not committed)

A workflow has three parts:
- **Trigger**: when something happens in the CRM (lead created, stage changed, message received…).
- **Enrolment conditions**: which records the trigger applies to.
- **Steps**: a graph of condition, branch, action, wait, goal and exit steps.

Only published versions run. A published version can never change. Every run is stored as an execution with a full step trace.

This phase builds the backend engine plus a basic, form-based management and test UI. The visual canvas is Phase 19 and is **not** started here.


**User guide** (for workflow builders and testers): [workflows/README.md](workflows/README.md).

---

## 1. Existing systems inspected

| Area | What exists | Used for |
|---|---|---|
| `crm_events` + `runCrmMutation` (Phase 01) | Each change, its AuditLog row and its events are written in one transaction | The **transactional outbox**: workflows read triggers from here, never from in-memory callbacks |
| `crm-event-bus.ts` | Subscribers that run after the transaction commits, best effort | Only a "kick" to make things faster; never needed for correctness |
| BullMQ worker (`crm-import.worker.ts`, queue `crm-lead-ingest-<db hash>`) | Job schedulers via `upsertJobScheduler` | The `workflow.tick` job, every 15 s |
| `PermissionService` / `crm`, `crm_settings` modules | ERP RBAC | Workflow permissions and the run-as identity check |
| `crm-entity-access.ts`, `crmOwnerWhere` | Record visibility | Test runs and manual runs only on records the user can see |
| Lead / contact / company / opportunity / activity / appointment / conversation / note / tag services (Phases 02–11) | All CRM writes | Every workflow action calls these. No direct table writes |
| `TemplateService` + `template-usage.ts` (Phase 12) | Rendering and usage providers | The message action, `{{…}}` interpolation in texts, and blocking template archive while a live workflow uses it |
| `sendConversationMessage` (Phase 11) | Sending with DND/consent checks and idempotency by client message id | The message action |
| `NotificationService` | ERP notifications | The notify-user action |
| `encryptSecret` / `decryptSecret` | AES-GCM using AUTH_SECRET | Webhook signing secrets |
| `crm-timezone.ts` (Phase 10) | IANA time zone maths, DST safe | Waits |
| Request context (`AsyncLocalStorage`) | Correlation id on every event | Recursion protection (`wfexec:<executionId>`) |

## 2. Existing systems reused (nothing duplicated)

There are no new users, roles, permissions, queues, schedulers, providers, audit tables or notification systems. One new `BusinessRuleError` code was added (`CRM_WORKFLOW_INVALID`, 422), along with `WORKFLOW` as a CRM entity type (for the workflow's own timeline and events), and one small export (`runWithRequestContext`).

## 3. Files created

Backend, `src/modules/crm/workflows/`:
- `workflow-registry.ts`: statuses, transitions, node types, waits, re-entry modes, limits (client-safe).
- `workflow-fields.ts`: whitelisted condition fields per record type, plus operators.
- `workflow-triggers.ts`: the trigger registry (event → trigger, payload match).
- `workflow-action-catalog.ts`: the action registry (params, entities, permission, side effect, retryable).
- `workflow-conditions.ts`: the condition engine (zod schema, validate, evaluate, explain).
- `workflow-definition.ts`: the definition schema plus structural validation (references, reachability, cycles, params).
- `workflow-context.ts`: record snapshots for conditions (one query per record type, tags and custom fields).
- `workflow-waits.ts`: computes when a wait ends (duration, time of day, record date; time zone and DST aware).
- `workflow-webhook.ts`: signed webhook calls with SSRF protection.
- `workflow-actions.ts`: action runners, all through existing services.
- `workflow-engine.ts`: dispatcher (outbox → executions), executor, retries, stale-lock recovery, tick.
- `crm-workflows.service.ts`: management (CRUD, draft/publish/lifecycle, versions, test, manual run, executions, secret, meta).
- `workflow.schema.ts`: API input schemas.
- `workflow-kick.ts`: optional "tick now" after triggering events.
- `workflow-template-usage.ts`: template usage provider.
- `workflow-engine-units.test.ts` (30 tests) and `workflows.integration.test.ts` (10 tests).

API:
- `src/app/api/v1/crm/workflows/route.ts`
- `workflows/meta/route.ts`
- `workflows/[...path]/route.ts`
- `workflow-executions/route.ts`
- `workflow-executions/[...path]/route.ts`

The `[...path]` catch-all routes keep the folder nesting shallow.

UI (`src/components/crm/workflows/` + `src/app/(dashboard)/crm/workflows/`):
- `workflow-types.ts`
- `ConditionBuilder.tsx`
- `WorkflowEditor.tsx`
- `WorkflowsListClient.tsx`
- `WorkflowDetailClient.tsx`
- `ExecutionTrace.tsx`
- `ExecutionDetailClient.tsx`
- `ExecutionsListClient.tsx`
- Pages: `/crm/workflows`, `/crm/workflows/[id]`, `/crm/workflows/executions`, `/crm/workflows/executions/[id]`

DB: `prisma/migrations/20261013100000_crm_workflow_engine/migration.sql`.

## 4. Files modified

- `prisma/schema.prisma`: `WORKFLOW` added to `CrmEntityType`, 5 new models, plus relations on Company and User (additions only).
- `src/core/errors/BusinessRuleError.ts`: `CRM_WORKFLOW_INVALID`.
- `src/core/logging/requestContext.ts`: `runWithRequestContext()`.
- `src/modules/crm/core/crm-event-types.ts`: `workflow.*` events.
- `crm-entity-types.ts` and `crm-entity-access.ts`: WORKFLOW entity (visibility requires `crm_settings.view`).
- `crm-route.ts`: route params may be `string[]` (catch-all routes); imports the kick.
- `src/modules/crm/imports/crm-import.queue.ts` / `crm-import.worker.ts`: `workflow.tick` job, scheduled every 15 s.
- `src/modules/crm/templates/crm-templates.service.ts`: registers the workflow template usage provider.
- `src/components/layout/navigation.ts`: CRM → Workflows (requires `crm_settings` view).
- `src/modules/crm/core/crm-registries.test.ts`: WORKFLOW added to the expected entity types.

## 5. Database changes

| Table | Purpose |
|---|---|
| `crm_workflows` | Name, lifecycle status, pointers to the published and draft versions, run-as user, encrypted webhook secret, optimistic `version` |
| `crm_workflow_versions` | The graph (JSONB) and its hash. Partial unique indexes allow at most one draft and one published version per workflow. A **trigger** (`crm_workflow_versions_guard`) refuses any change to a non-draft version's definition, hash or trigger, refuses deletes once published, and refuses a return to draft |
| `crm_workflow_executions` | One run on one record: status, current node, next run time, lock, retry count, depth / parent (recursion), mode LIVE / TEST, outcome. **Unique `(company_id, idempotency_key)`** |
| `crm_workflow_execution_steps` | Trace rows: input, output, branch, error, attempt. Unique idempotency key per step |
| `crm_workflow_event_log` | Which `crm_events` rows the dispatcher has already evaluated (exactly once) |

The migration is hand-written and additive. Nothing in an existing table changes, except the new enum value.

## 6. Workflow definition and versioning

```
{ schemaVersion: 1,
  trigger: { type, entityType? (manual), conditions },
  entryNodeId,
  nodes: [ CONDITION | BRANCH | ACTION | WAIT | GOAL | EXIT ],
  settings: { timezone, reentry: ONCE|AFTER_FINISH|ALWAYS, exitConditions?, allowWorkflowTriggers } }
```

Nodes point to each other by id. The graph must be acyclic and every node must be reachable.

The editor, the API and the engine all validate with the same zod schema plus `validateDefinitionStructure`.

**Lifecycle**
- Statuses: DRAFT, PUBLISHED, PAUSED, DISABLED, ARCHIVED.
  - Pause: new triggers are ignored and running executions hold.
  - Disable / archive: running executions are cancelled.
  - Restore: back to DRAFT.
- Editing a published workflow saves a **new draft version** (v N+1). The live version keeps running until you publish.
- Publishing marks the old version SUPERSEDED. Executions keep the version they started on.

## 7. Trigger architecture

Every CRM write already writes `crm_events` in the same transaction (the outbox). The dispatcher (`dispatchWorkflowEvents`, every tick) works like this:

1. It reads unprocessed triggering events. It looks back 24 hours (so a worker outage of up to a day loses nothing), or to the earliest publish time if that is later. Events from before a workflow was published never start it.
2. For each event, it **claims** the event (insert into `crm_workflow_event_log`) and creates the executions in the **same transaction**. The execution idempotency key is `evt:<eventId>:<workflowId>`.
3. It then checks, per workflow: payload match (e.g. "lead imported" = channel CSV/XLSX), record type, recursion, re-entry, hourly rate limit, and enrolment conditions.

Running two schedulers at once is safe; this is tested.

The kick after commit only shortens the delay.

Available triggers: 38 across leads, contacts, companies, opportunities, tasks, appointments, conversations, tags, and manual. Triggers whose phase doesn't exist (forms, bulk jobs, custom objects, date triggers) are listed as unavailable in `/meta`, with the reason.

## 8. Condition engine

- Whitelisted fields only: record fields, trigger payload, `event.*`, `execution.*` and the record's custom fields.
- Operators: 24, each restricted to the field types it works on.
- Logic: AND / OR / NOT, nested up to depth 4, at most 50 conditions.
- No expressions or JavaScript.
- An unknown or missing value counts as empty and is never an error.

`explainGroup` gives the plain-English "why" used by test runs.

## 9. Action registry

17 actions:
- **Records:** assign owner, add tags, remove tags.
- **Leads:** change status, update.
- **Companies:** change status.
- **Opportunities:** move stage, change status, update.
- **Tasks and notes:** create task, add note.
- **Appointments:** change appointment status.
- **Conversations:** assign, change status, send message (template).
- **Other:** notify a user, call a webhook.

Each action declares params, the record types it fits, its side-effect class, the permission it needs, and whether it may be retried.

Every runner calls the existing CRM service, so audit, timeline, visibility, DND/consent and optimistic locking all apply.

Duplicate protection:
- Tasks are idempotent through `source=WORKFLOW` and `externalRef=<step key>`.
- Messages use a client message id derived from the step key.

Not available, listed with the reason: sequences, bulk actions, custom objects.

## 10. Waits and scheduling

Wait modes:
- **DURATION:** minutes, hours or days.
- **UNTIL_TIME:** HH:mm, optionally only on chosen weekdays, in the workflow's time zone. DST-safe; a skipped wall-clock time moves one hour later.
- **UNTIL_FIELD:** a date on the record ± an offset. If the date is in the past, the workflow continues now; if there is no date, it also continues.

The maximum wait is 365 days. A wait is persisted (`next_run_at`), never held in memory, so it survives restarts and deploys.

## 11. Execution model

`runExecution` claims the execution with a lock token (stale locks are recovered after 10 minutes), then walks the graph:

- Exit conditions are checked before every step.
- At most 50 steps run per pass and 300 per execution.
- Each step writes its own row.

Statuses: QUEUED, RUNNING, WAITING, PAUSED, COMPLETED, FAILED, CANCELLED, EXITED. Outcomes are recorded separately (GOAL_REACHED, …).

Failures:
- A transient failure (version conflict, lock, rate limit) is retried up to 3 times, at 1 min, 5 min and 30 min.
- Actions that are not retryable (messages, webhooks, notes) are **never** automatically resent when the outcome is unknown.
- `onError: CONTINUE` records the failure and moves on.
- A failed execution can be retried by a person from the step that failed. A message that actually went out is not sent twice, because of the idempotent message id.

## 12. Recursion and loop protection

- No cycles in the graph.
- Actions run inside `runWithRequestContext({ requestId: "wfexec:<id>" })`, so the events they cause are recognisable.
  - A workflow is never started by events from its own executions.
  - Other workflows ignore events made by workflows unless they opt in with `allowWorkflowTriggers`.
- Maximum depth of 3.
- At most 20 starts per record per hour per workflow.

## 13. Security

- Workflows are configuration: viewing them needs `crm_settings.view`; changing them needs `crm_settings.edit`.
- **Execution identity:** the user who publishes becomes the run-as user. At publish time they must hold every permission the actions need. Before every action that permission is re-checked live, and if the user has been deactivated the execution fails with `RUN_AS_INVALID`.
- Test runs and manual runs require that the person can see the record.

Webhook rules:
- https only, on standard ports, with no credentials in the URL.
- DNS is resolved once and every address must be public (loopback, private, link-local and metadata ranges, CGNAT and IPv6 private ranges are blocked). The connection is pinned to the vetted address.
- No redirects, a 10 s timeout, and the response is capped at 64 KB.
- Each request is signed with HMAC-SHA256 using a per-workflow secret, encrypted at rest. Revealing or rotating the secret needs edit rights and is audited.
- Allow-list: `CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS`. Local http: `CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP=true`.

Secrets never appear in logs, traces or the API (only on explicit reveal). Template variables are rendered by the Phase 12 engine, never `eval`.

## 14. Test mode

**Test run** executes the draft or the published version on a real record:
- Conditions are evaluated for real.
- Every action returns `SIMULATED` with a description of what it would do.
- Waits are skipped.
- Nothing is changed, sent or called.

The execution is stored with `mode=TEST`, hidden from the live list and never counted. The response also says whether the record matches the enrolment conditions, and why.

## 15. Audit and timeline

Every workflow change writes an AuditLog row plus a `workflow.*` event on the workflow's own timeline (created, draft_saved, published, paused, resumed, disabled, archived, restored, duplicated, secret_rotated, execution_started (manual), execution_failed, execution_cancelled).

Actions write their own audit and timeline entries through their services; the actor is the run-as user and the correlation id is `wfexec:…`.

## 16. API

```
GET    /api/v1/crm/workflows                     list (?statuses=&triggers=&search=)
POST   /api/v1/crm/workflows                     create { name, description?, trigger, entityType? }
GET    /api/v1/crm/workflows/meta                triggers, actions, fields, lookups, limits, unavailable items
GET    /api/v1/crm/workflows/{id}
PATCH  /api/v1/crm/workflows/{id}                { version, name?, description? }
PUT    /api/v1/crm/workflows/{id}/draft          { version, definition, changeNote? } → { workflow, issues }
DELETE /api/v1/crm/workflows/{id}/draft          { version }
POST   /api/v1/crm/workflows/{id}/validate       → { valid, errors, warnings }
POST   /api/v1/crm/workflows/{id}/publish        { version } (422 CRM_WORKFLOW_INVALID, details.errors)
POST   /api/v1/crm/workflows/{id}/pause|resume|disable|archive|restore   { version }
POST   /api/v1/crm/workflows/{id}/duplicate      { name? }
POST   /api/v1/crm/workflows/{id}/test           { entityType, entityId, source?, triggerPayload? }
POST   /api/v1/crm/workflows/{id}/run            { entityType, entityId }
GET    /api/v1/crm/workflows/{id}/versions[/{versionId}]
GET    /api/v1/crm/workflows/{id}/executions
GET    /api/v1/crm/workflows/{id}/webhook-secret (reveal, edit) · POST (rotate)
GET    /api/v1/crm/workflow-executions           (?workflowId=&statuses=&entityType=&entityId=&mode=)
GET    /api/v1/crm/workflow-executions/{id}      with steps
POST   /api/v1/crm/workflow-executions/{id}/cancel|pause|resume|retry
```

## 17. Tests

- `workflow-engine-units.test.ts`, 30 tests: conditions (logic, nesting, dates, whitelist, no expressions), definition validation (cycles, dangling references, unreachable nodes, wrong record type), waits (duration, time of day, weekdays, DST, record date), webhook SSRF (11 blocked addresses, 3 allowed, URL rules, signature), trigger mapping and payload match, and retry flags.
- `workflows.integration.test.ts`, 10 tests against a real migrated Postgres:
  - immutable published versions (the DB trigger refuses changes) and draft v2;
  - publish validation (private webhook, loop, required params, unknown template);
  - exactly-once start, enrolment conditions, real task/note/tag actions, a persisted 2-day wait resumed by the scheduler;
  - a three-way concurrent dispatch race;
  - recursion protection and ONCE re-entry;
  - pause holds and disable cancels;
  - a runtime failure gives FAILED plus an event, and a retry from that step completes;
  - test mode creates nothing;
  - audit and events.

## 18. Regression

- `tsc --noEmit` clean.
- ESLint clean on all new and changed files.
- Full vitest: 165 files, 2,576 passed, 171 skipped (DB tests without `CRM_IT_DATABASE_URL`), 0 failed.

## 19. Known limitations and missing dependencies

**Missing earlier phases.** These are reported, not faked; the registries list them as unavailable.
- **Phase 13–16 (forms, bulk engine, custom objects).**
  - No `form.submitted`, `import.completed` or `bulk_job.completed` triggers.
  - No bulk or custom-object actions.
  - Contract: emit a crm_event, add one `WORKFLOW_TRIGGERS` entry (and one action runner).
- **Phase 17 (sequences).**
  - No enroll/stop-sequence action.
  - Contract: an action runner calling the future `SequenceService.enroll(actor, sequenceId, contactId)`.

**Other limitations.**
- **Date / schedule triggers** ("3 days before close date") are not built. Use a Wait "until a date on the record".
- **Message sending** uses the contact's latest conversation on the template's channel. There is no "start a new conversation" action yet (listed as unavailable).
- **Executions run in the shared CRM worker queue** (concurrency 1). A long lead import delays workflow ticks.
- **No visual canvas.** The editor is form-based plus JSON. That is Phase 19.
- **Not yet verified in a browser** in this environment. The device's dev server needs a restart, and the migration must be applied with `npx prisma migrate deploy`.

## How to try it

1. Apply the migration with `npx prisma migrate deploy`, then restart `npm run dev` (which also starts the worker).
2. Go to CRM → Workflows → New workflow, and choose the trigger "Lead created".
3. Add an action step "Create task" (Call "Call {{lead.full_name}}", assign to: the record's owner), then a Wait of 2 days, then "Add note".
4. Run a **Test run** on an existing lead. Every step shows as simulated and nothing is created.
5. Click **Publish**, then create a lead. Within about 15 seconds an execution appears under Executions and the task exists.

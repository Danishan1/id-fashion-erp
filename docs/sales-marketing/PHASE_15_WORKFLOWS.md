# Sales & Marketing — Phase 15 Workflow integration (2026-11-06)

Spec: `docs/sales-marketing/ref/15.md`. Scope confirmed with the user on 2026-11-06:

- **Engine: an S&M orchestrator.** A small, durable layer with five registered workflow types. Steps are fixed, settings are typed, entry conditions are allow-listed, definitions are versioned and can be switched on and off. There is no graph editor and no arbitrary code, SQL or HTTP. The layer reuses the CRM condition engine, notifications and CRM tasks.
- **Workflows: all four groups.**
  - A. Qualified enquiry → approved quotation.
  - B. Accepted quotation → Sales Order.
  - C. Campaign readiness.
  - D. Budget exceptions.
  - E. Attribution and bulk-job follow-up.
- **Automation: "coordinate, people act".** Workflows check, create tasks, notify, remind, escalate and record. Approvals, conversion and campaign launch stay with people, on the existing screens. The workflow detects the result.
- **Permissions: new module `sales_workflows`.**
  - view = monitor.
  - edit = configure, switch on/off, start on a record.
  - approve = retry, resolve, cancel.

Out of scope (later phases): public webhooks and APIs (16), BI (17), AI (18).

## 1. What exists and is reused

| Concept | Existing | Reused / introduced |
|---|---|---|
| Condition engine (AND/OR/NOT, allow-listed fields and operators) | `src/modules/crm/workflows/workflow-conditions.ts` (CRM Phase 18) | Reused as-is: `validateConditionGroup`, `evaluateGroup` and the `ConditionBuilder` UI, with S&M field lists |
| CRM workflow builder (graph, webhooks) | CRM Phase 18 | **Not** reused for S&M: it is lead/deal oriented, and its free graph and webhook actions break the "no arbitrary actions" rule. The S&M layer is a separate, fixed-step orchestrator |
| Approvals | Quotation approval (S3), campaign approval (Phase 08) | Reused: workflows wait on them and remind authorised approvers. There is no second approval system |
| Conversion to Sales Order | Phase 04 `convertQuotation` / `getConversionPlan` | Reused: the plan's blockers go into the task; duplicate orders are already prevented there |
| Tasks | CRM activities (`createActivity`, `completeActivity`, `cancelActivity`) | Extended: parent types `ENQUIRY` and `QUOTATION` (same pattern as Phase 08 `CAMPAIGN`). Workflow tasks use `source = SM_WORKFLOW` and `externalRef = <instance>:<key>` |
| Notifications | `createNotification` | Reused. A key is saved in the same transaction, so each notification is sent once |
| Event source | Committed rows: `buyer_enquiry_activities`, `quotation_events`, `sales_performance_events`, `marketing_budget_alerts`, `marketing_attribution_runs`, `bulk_jobs` | Read as an outbox from checkpoints. There is no new event bus |
| Background jobs | BullMQ worker (`npm run worker`) | New queue `sales-workflows`, ticking every 30 s |
| Re-runs | Phase 13 `requestRun`, Phase 14 `retryBulkJob` | Called by the operator action "retry processing", as the person |
| Audit | `writeAuditLog` | Definitions, versions, instance lifecycle and operator actions |

## 2. Data model

Migration: `20261110090000_sm_workflows_phase15`. Rollback: `prisma/rollback/20261110090000_sm_workflows_phase15.down.sql`.

| Table | Purpose |
|---|---|
| `sm_workflow_definitions` | One row per company and workflow type. INACTIVE/ACTIVE, active version, run-as user (the activator), optimistic `version` |
| `sm_workflow_definition_versions` | Settings and entry conditions. DRAFT → ACTIVE → SUPERSEDED. At most one DRAFT and one ACTIVE (partial unique indexes). A trigger freezes settings once a version is ACTIVE |
| `sm_workflow_instances` | One run on one record. Status, current step, next run, lease (`lock_token`/`locked_at`), attempts, trigger source and event key, correlation id `smwf:<id>`, context, `watch_keys` (GIN), outcome, error, compensation status. Only one live instance per definition and record (partial unique index). CHECK: completed/cancelled ⇔ `completed_at` set |
| `sm_workflow_step_runs` | History: one row per step attempt, plus operator and compensation rows |
| `sm_workflow_event_log` | Processed events, unique on (source, source_key). Purged after 30 days |
| `sm_workflow_checkpoints` | Last-seen timestamp per source |

`CrmEntityType` gains `ENQUIRY` and `QUOTATION`. Permissions `sales_workflows.view/edit/approve` are granted as follows: SUPER_ADMIN all; MANAGEMENT view/edit/approve; VIEWER view. MERCHANDISER is deliberately left out, because instance lists name records across owners.

## 3. Workflow types and their exact steps

All types are registered in `sm-workflow-registry.ts` (client-safe) and implemented in `sm-workflow-impls.ts`.

| Type | Starts on | Steps | Ends |
|---|---|---|---|
| `quotation_follow_up` | `enquiry.qualified` | check owner (none → notify escalation users, wait) → quotation task for the owner → wait for a quotation on the enquiry (reminders, escalation) → follow its approval (PENDING: remind approvers, excluding the preparer and submitter; DRAFT: remind the owner) → close the task | QUOTED; QUOTATION_CLOSED (rejected / cancelled); ENQUIRY_CLOSED |
| `quotation_to_order` | `quotation.accepted` | check the accepted revision with `getConversionPlan` (an existing order skips ahead) → conversion task (blockers listed) → wait for the Sales Order (reminders, escalation; CONVERTED without an order → needs attention `RECONCILE_ORDER`) → record the order and notify → close the task | CONVERTED; NOT_ACCEPTED (the acceptance was withdrawn) |
| `campaign_readiness` | `campaign.submitted` | check → readiness: audience resolves, channels have no problems, content approved at its current version, budget planned with no open alerts (task "Get campaign X ready") → follow the campaign approval (remind approvers, excluding requester and owner) → ready: notify the owner, remind if late → close the task | LAUNCHED (a person activated it); CAMPAIGN_CLOSED |
| `budget_exception` | `budget.alert_raised` | check the alert is still open → review task on the campaign and notify reviewers → wait | CLEARED (the alert cleared), REVIEWED (task completed) or CAMPAIGN_CLOSED. Never changes a budget or financial record |
| `processing_follow_up` | `attribution.run_finished` (FAILED, or unattributed share above a threshold); `bulk.job_finished` (FAILED / COMPLETED_WITH_ERRORS) | record the exception → notify → wait for a successful re-run or retry, or for a person | RESOLVED_BY_RERUN / RESOLVED_BY_RETRY / RESOLVED_MANUALLY; NO_EXCEPTION on a manual start without one |

Each type lists its "never does" boundaries on its definition page. No workflow approves, prices, issues, converts, launches, posts or changes amounts.

## 4. Events (contract v1)

- **Schema.** `smWfEventSchema` (strict, `schemaVersion: 1`) defines `source`, `sourceKey`, `type` (24 allow-listed types), `companyId`, `entityType`, `entityId`, `occurredAt`, `actorUserId`, `data` and `keys`. `data` holds small scalar facts only. `keys` are the watch keys used to wake instances.
- **Ingestion.** No API posts events. They are built only from committed rows:
  - Each source is read from its checkpoint minus a 5-minute overlap, in batches of 2,000.
  - Each event is validated; an invalid event is counted and skipped.
  - Each event is de-duplicated through `sm_workflow_event_log`.
- **Dispatch.** For each event, the dispatcher:
  - starts every ACTIVE definition whose triggers match the event, provided the event is after activation and the entry conditions match (CRM condition engine on a per-type snapshot);
  - wakes every live instance whose `watch_keys` include one of the event's keys.

## 5. Approvals, authorisation, separation of duties

- Approval decisions stay in the quotation and campaign modules.
- Workflows remind people with the module's `approve` permission, never the preparer, submitter, requester or owner.
- A workflow never calls an approve action.
- **Run-as checks.** The run-as user is the activator. Activation requires them to hold the type's required permissions, plus `crm.view/create` when tasks are on. These are checked again before every step. If the check fails, the instance moves to NEEDS_ATTENTION (`RUN_AS_INVALID`) and a person can retry after re-activation.
- **Task assignees.** A task goes to the record's owner only if the owner can use CRM. Otherwise the workflow notifies instead.
- **Notifications.** Recipients are filtered to active users of the company who hold the related module's view permission. In-app notifications only, so nothing claims an external delivery.
- **Manual start.** Needs `sales_workflows.edit` and the record must be visible to the person under its own module's rules.
- **Tenancy.** Every query is scoped by `companyId`, and instance IDs from another company return 404.

## 6. Reliability guarantees

| Guarantee | How |
|---|---|
| Duplicate events don't start twice | Event log unique (source, source_key); instance idempotency key `evt:<source:key>:<definitionId>`; partial unique "one live instance per definition + record"; a manual start returns the existing one |
| Two workers never run one instance | Lease: `lock_token` taken with a conditional update; stale after 5 min. Operator actions refuse while a live lease is held |
| Crash mid-step | The lease expires, then the step re-runs. Tasks are idempotent through externalRef and the context map; notifications through the key saved in their transaction |
| Transient errors | Retry after 1, 5 and 30 min (RETRY_PENDING), then FAILED. Business errors (validation, permission, not found) fail at once, without retries. Messages from unknown or DB errors are never stored raw |
| Lifecycle | `SM_WF_TRANSITIONS`, checked on every change; terminal states are final |
| Compensation | On cancel, only the open CRM tasks the workflow created are cancelled. Business records are never "undone". The result is shown (`compensation_status` NONE/DONE/FAILED) |
| Versioning | Running instances keep the version they started on; an ACTIVE version is frozen by a DB trigger |

## 7. APIs and UI

APIs live under `/api/v1/sales-marketing/workflows`:

- `GET` lists the definitions.
- `GET metrics`.
- `definitions/[key]`:
  - `GET` the definition;
  - `PUT` saves the draft;
  - `POST` with `validate | activate | deactivate | start`.
- `instances`: `GET` with `statuses`, `workflowKey`, `entityId`, `search` and paging.
- `instances/[id]`:
  - `GET` the instance;
  - `POST` with `retry | resolve | cancel | retry_processing`. A note is required for resolve.

UI — Sales & Marketing → **Workflows** (`/sales-marketing/workflows`; layout gated on `sales_workflows.view`):

- **Metric tiles:**
  - running;
  - waiting (with how many are on an approval);
  - needs attention;
  - completed in 30 days, with completion rate;
  - average approval wait and retries;
  - processing lag: overdue runs, event-read lag and failed undos.
- **Workflows tab:** one card per type, showing on/off, version, run-as, counts and unpublished changes.
- **Definition page:**
  - typed settings form (numbers, switches, people pickers) and the condition builder;
  - check, save draft, undo;
  - switch on / off, with a confirmation that explains run-as;
  - version history, steps, triggers, "never does" and the permissions needed;
  - "Start on a record" with an enquiry, quotation or campaign search.
- **Running & history tab:** filters by workflow, record and status chips; paged.
- **Instance page:**
  - status, outcome, error and the record link;
  - plan with done / current / pending steps;
  - references (quotation, Sales Order);
  - CRM tasks and the readiness checklist;
  - step history;
  - operator actions with a confirm dialog and a note (required to resolve).

Navigation: S&M section "Workflows" and module-map entry (phase 15).

## 8. Notifications, audit, observability

- **Notifications:** quotation tasks, approver reminders, escalations, the conversion record, campaign ready, budget reviewers, processing exceptions. Each is sent once per key.
- **Audit:** draft saves, activation and deactivation (old → new), instance start, completion and needs-attention, and every operator action with its note and compensation result.
- **Logs:** structured JSON for crashed runs. The correlation id `smwf:<id>` is passed as the request context for every step, so downstream audit rows carry it.
- **Metrics:** the endpoint above, including queue latency (oldest overdue run) and event lag (oldest checkpoint).

## 9. Tests run (sandbox, 2026-11-06)

| Suite | Result |
|---|---|
| `sm-workflows.integration.test.ts` (real Postgres) | 10/10 |
| `sm-workflows.units.test.ts` | 12/12 |
| `sm-workflow-screens.test.tsx` (jsdom) | 5/5 |
| Full suite `npx vitest run` | 336 files passed, 2 skipped; 4,334 tests passed, 9 skipped |
| `tsc` (sandbox slice config), `eslint` on changed files | clean |

The integration test covers:

- definitions, validation, activation (the activator's permissions) and the frozen version;
- B end to end: the event starts it once, re-reading the events (checkpoint reset) starts nothing, and a manual start returns the live one. After a person converts through Phase 04, the order is recorded and the task completed;
- B reconciling an existing order;
- a crash after a step (lease, then re-run without duplicate tasks or notifications), a concurrent run refused, cancel with compensation, tenant isolation and permission denial;
- A with exactly one approver reminder, never to the submitter;
- C readiness → approval → launch, with the workflow never activating the campaign;
- D completing when reviewed and when the alert clears;
- E resolved by an attribution re-run;
- run-as permission revoked → NEEDS_ATTENTION → retry;
- per-company isolation.

**Bug found by these tests and fixed:** `ctx.notify` built the saved context from the step's starting data. It dropped what the step had just added (task map, order number), so B lost its order number and D never saw its task completed. It now builds on the current `ctx.data`.

## 10. Acceptance criteria

All §21 criteria are met, with these qualifications:

- **"Approval decisions use the existing approval framework":** met by design. There is no generic approval framework in the repository, so workflows wait on the module approvals (quotation, campaign) and only remind.
- **"Accepted quotation conversion reuses Phase 04":** met. Conversion is a person's action, because it needs the colour × size split. The workflow coordinates and detects it; it does not convert.
- **"Phases 01–14 continue to function":** the full suite passes (4,334; Phase 14 had 4,307, and the 27 new tests are this phase's).

Nothing in a workflow is mocked. In the test only, the person's actions (convert, approve, activate, complete a task) are performed by the test through the real services.

## 11. Deployment and operations

1. Run `npx prisma migrate deploy`, then `npx prisma generate`.
2. Run `node scripts/sync-permission-catalog.mjs`, then grant `sales_workflows.*` to any custom roles.
3. Restart the app **and** the worker (`npm run worker`). The worker runs the `sales-workflows` tick every 30 s.
4. Open S&M → Workflows, review each type's settings, and switch on the ones you want. The person who switches it on becomes the run-as user and must keep the needed permissions.

Recovery:

- **Stuck run:** the lease expires after 5 minutes and the run continues on the next tick.
- **FAILED / NEEDS_ATTENTION:** fix the cause, then use Retry, Mark resolved (with a note) or Cancel. Cancel also cancels the workflow's open tasks.
- **Run-as user left or lost permissions:** someone with the permissions switches the workflow on again, then retries the affected runs.
- **Rollback:** apply the down file. Running workflows stop; business records are unaffected.

## 12. Known limitations

- **Possible source stall.** A source can stall if more than 2,000 events share the 5-minute overlap window (the checkpoint can't advance past a full batch of the same timestamps). This is very unlikely at current volumes and shows as event lag on the metrics tile.
- **Fixed workflow types.** New types need code (registry + implementation). This is intentional: there is no free-form builder for S&M.
- **Manual start coverage.** Manual start is offered for enquiries, quotations and campaigns. Budget alerts, attribution runs and bulk jobs start from their events only.
- **Notifications are in-app only.** Email and SMS for workflow notices are not added.
- **Timer granularity.** Escalation timers follow the 30-second tick and each step's re-check interval (at most 6 hours for waiting steps), not exact clock times.

## 13. Phase 16 readiness

The versioned event contract (`smWfEventSchema`, v1) and the event log are the natural feed for outbound webhooks. The instance and definition DTOs, and the correlation id, are stable shapes for a public API. Phase 16 should publish these contracts rather than reading S&M tables directly, and should keep "people act" boundaries for any inbound actions.

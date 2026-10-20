# Phase 14: Reusable Bulk Action Engine

Status: implemented on 2026-10-14. See the report at the end for what is tested and what is limited.

Users can apply one action to many records in the background. Examples:

- assign 3,000 leads to a new owner;
- export every contact that matches a filter;
- move 200 opportunities to a stage;
- start a workflow on a list of leads.

Every record is processed separately by the existing CRM service, so each one gets its own outcome: succeeded, skipped (with the reason) or failed (with the reason). Users can follow progress, cancel, retry failed records, and download an error report or an export file.

The engine is generic. CRM leads, contacts, companies and opportunities are its first users, and other modules plug in the same way (see "How to register a bulk action").

---

## 1. What was already there, and what was reused

| Need | Reused | Not created |
|---|---|---|
| Background processing | Existing BullMQ + Redis (`src/core/jobs/queue.ts`) and the existing worker process (`npm run worker`, `src/core/jobs/worker.ts`) | A second queue system or scheduler. One new BullMQ queue runs on the same infrastructure. |
| Recurring maintenance | `upsertJobScheduler`, the same pattern as the CRM import / workflow ticks | — |
| Per-record changes | The CRM services: `assignLead`, `changeLeadStatus`, `updateLead`, `changeLeadTags`, `archiveLead`, `restoreLead`, the matching contact / company / opportunity functions, `changeOpportunityStage`, `updateOpportunity` | Direct table writes |
| Filters | The list pages' query string, `parse*FilterParams` and `build*Where` (the same code the list API uses, including visibility and merged-record exclusion) | A second filter language |
| Permissions | `PermissionService` + existing modules: `crm.view`, `crm.edit`, `crm.export`, `crm_settings.edit` | New roles or permissions |
| Audit / timeline | `runCrmMutation` inside each service (per record) and `writeAuditLog` (per job) | A second audit system |
| Tags | `applyEntityTagChange` through the `change*Tags` services | A second tagging system |
| Export files | `saveFile` / `readStoredFile` (private storage outside `public/`, content-type verification, 20 MB cap) and `buildXlsxBuffer` | A second file store |
| Workflow enrolment | `runWorkflowManually` (Phase 18), including its re-entry rules | — |
| Messages | The Phase 18 action runner `message.send` → `TemplateService.renderTemplate` → `sendConversationMessage` (Phases 11/12), with do-not-contact / consent checks and an idempotent message id | A second sender |
| Notifications | `createNotification` (sent to the requester when a job finishes) | — |

The older synchronous bulk endpoints (`POST /api/v1/crm/{leads,contacts,companies,opportunities}/bulk`, at most 500 records) and their buttons in the list bulk bar still work unchanged. The engine sits next to them for large or asynchronous jobs.

---

## 2. Data model (`prisma/migrations/20261014100000_bulk_action_engine`)

**`bulk_jobs`**: one row per request.

- `entity_type` and `action_key` are registry keys, never table or service names.
- `selection_mode` is `IDS`, `PAGE` or `FILTER`. `selection` is `{ requested }` for ids, or `{ filterQuery, filter, matched }` for a filter. A retry adds `{ retryOf, rootJobId }`.
- `params` holds the validated parameters. `summary` is a readable version ("Owner → Priya Shah").
- Counters: `total_count`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`. They are recalculated from the items, never incremented blindly.
- `idempotency_key` is unique per company + requester. Sending the same request again returns the existing job.
- Worker lease for crash recovery: `lock_token`, `locked_at` and `run_count`.
- `result` holds the job's output. For an export this is `{ file: { storageKey, fileName, mimeType, sizeBytes, rowCount, expiresAt } }`. `storageKey` never leaves the server.
- `error_code` and `error_message` are a job-level failure, written in user-safe words.
- Cancellation: `cancel_requested_at` and `cancel_requested_by`.
- Retries: `retry_of_job_id` links to the job being retried.
- Timestamps: `created_at`, `started_at`, `finished_at`.

**`bulk_job_items`**: one row per target record. The snapshot is taken at submit.

- `sequence` and `entity_id` are each unique within a job.
- `status`, `attempts` and `processed_at`.
- `message` and `error_code`: the user-facing reason.
- `result`: small per-record output, such as a message id or a workflow execution id. An export row is kept here only until the file is written.

**Job statuses:**

```
QUEUED → VALIDATING → RUNNING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED
   └──────────── cancel ───────→ CANCEL_REQUESTED → CANCELLED
```

- **COMPLETED**: no record failed (some may have been skipped).
- **COMPLETED_WITH_ERRORS**: some records failed and some succeeded or were skipped.
- **FAILED**: either the job failed as a whole, or every record failed.

**Item statuses:** `PENDING → PROCESSING → SUCCEEDED | SKIPPED | FAILED`, or `CANCELLED` (shown as "Not processed").

---

## 3. Flow

1. **Capabilities.** `GET /api/v1/bulk-actions/capabilities?entityType=LEAD` returns the actions for that entity:
   - each action's availability for this user, and the reason if it isn't available;
   - its parameter fields, with options resolved for this user (users, statuses, stages, tags, templates, workflows).
2. **Preview.** `POST /api/v1/bulk-actions/preview` changes nothing. It:
   - validates the parameters, including `prepare()` (owner active, status active, template active…);
   - resolves the selection;
   - returns the count, summary, warnings, sample record names and the confirmation the action needs.
3. **Submit.** `POST /api/v1/bulk-jobs` runs the same validation, then in one transaction:
   - creates the job and one item per record;
   - writes the audit row.

   It then sends a queue message (best effort). The response is `202` with the job. A repeated `idempotencyKey` returns `200` with the existing job.
   - `IDS` / `PAGE`: ids are de-duplicated. Records that don't exist or aren't visible to the user are left out, with a warning.
   - `FILTER`: the list query string is parsed and resolved as the user (with their visibility) at submit time. The ids are fixed then: records created later are not included. If more records match than the action's limit, the request is refused with a message asking to narrow the filter.
   - Actions with `confirmation: "type_count"` (archive, send message) require `confirmCount` to equal the number of records.
4. **Worker** (`bulk-engine.ts → processBulkJob`):
   - **Claim**: takes the job with a 3-minute lease in Postgres (`UPDATE … WHERE locked_at IS NULL OR locked_at < now-3min`). Only one worker processes a job at a time; a second gets nothing.
   - **VALIDATING**: re-checks everything that may have changed since submit: the requester is still active, still has view and action permissions, the action is still available, and the parameters are still valid. If any check fails, the job is FAILED with the reason and every pending item becomes "Not processed". No record is touched.
   - **Recovery of PROCESSING items** (left by a crashed run): if the action is retry-safe they go back to PENDING. Otherwise they become FAILED / `OUTCOME_UNKNOWN` ("check the record before retrying"). This applies to workflow enrolment.
   - **RUNNING**: processes items in batches of 50, as the requester. Before each batch it checks for cancellation and renews the lease. During slow actions (sends) it also renews every 10 records. Each item calls the handler, and the outcome or a sanitised error is stored on the item. Counters are refreshed after each batch.
   - **finalize()**: for example, writes the export file.
   - **Finish**: sets the final status, writes an audit row and notifies the requester.
5. **Recovery tick** (worker, every minute, `recoverBulkJobs`):
   - re-sends queue messages for jobs QUEUED for more than a minute, for example when Redis was down at submit;
   - resumes VALIDATING / RUNNING / CANCEL_REQUESTED jobs whose lease expired because the worker crashed or restarted;
   - deletes expired export files.
6. **Cancel**:
   - A job no worker has started yet is CANCELLED immediately.
   - A running job becomes CANCEL_REQUESTED and stops after the record in progress. Remaining records become "Not processed".

   Nothing already done is rolled back.
7. **Retry failed** (`POST /{id}/retry`):
   - Creates a **new** job, linked by `retryOfJobId`, containing only the FAILED records that the person retrying can still see. The original job's report stays as it was.
   - A second retry request returns the existing retry.
   - Retries share the root job's idempotency keys (`bulk:<rootJobId>:<entityId>`), so a message whose outcome was unknown can never be sent twice.

### Workflows react to bulk changes (Phase 18)

A bulk job changes records through the same CRM services as a person does. Those services write the same `crm_events` (for example `lead.owner_changed`, `lead.status_changed`, `*.tag_added`, `opportunity.stage_changed`, `*.archived`). Phase 18 starts workflows from those events, so **every published workflow whose trigger matches runs for each record a bulk job changes**, exactly as if the change had been made by hand. Enrolment conditions, re-entry rules and the per-record rate limit apply as usual.

- **Traceability.** Every event a bulk job causes carries the correlation id `bulkjob:<jobId>`, so the record timeline and event log show which bulk job made the change.
- **Not suppressed.** This correlation id is deliberately different from the workflow prefix `wfexec:`. Workflow recursion protection treats bulk changes as ordinary user changes (depth 0), so they are never suppressed. *Allow changes made by other workflows* doesn't need to be on.
- **Rules that skip a record.** Records a bulk job skips (for example "Already assigned to this owner") are not changed, so they produce no event and no workflow run.
- **Timing.** Workflow runs start on the worker's next workflow tick (every 15 seconds). The dispatcher handles up to 200 events per tick, so the workflow runs for a 5,000-record job catch up within a few minutes.
- **"Start a workflow" bulk action.** It runs the chosen workflow directly. Its actions are tagged `wfexec:`, like any workflow run.

Tested in `bulk-actions.integration.test.ts`: *"bulk changes trigger workflows exactly like manual changes"*. A bulk assign and a bulk add-tags on 3 leads produce 6 events tagged with their bulk job. An "owner changed" workflow and a "tag added" workflow then each run once per lead (depth 0, completed), and their notes are added.

---

## 4. CRM actions (`src/modules/crm/bulk/`)

| Entity | Action key | Kind | Permission | Confirmation | Max | Notes |
|---|---|---|---|---|---|---|
| all four | `<entity>.assign` | assign | crm.edit | confirm | 5,000 | Owner or "Unassigned". Skips archived records and records already with that owner. |
| all four | `<entity>.add_tags` | tags | crm.edit | — | 5,000 | Existing tags and/or new names (created once). Skips records that already have them. |
| all four | `<entity>.remove_tags` | tags | crm.edit | — | 5,000 | Skips records that don't have the tags. |
| all four | `<entity>.archive` | archive | crm.edit | type the count | 5,000 | Soft archive. Can be restored. |
| all four | `<entity>.restore` | restore | crm.edit | confirm | 5,000 | Skips records that aren't archived. |
| all four | `<entity>.export` | export | crm.export | — | 20,000 | CSV or XLSX, in the background. See §5. |
| all four | `<entity>.enroll_workflow` | workflow | crm.edit + crm_settings.edit | confirm | 2,000 | Published workflows for that record type only. Re-entry "already in" becomes a skip. Not retry-safe. |
| all four | `<entity>.enroll_sequence` | sequence | — | — | — | **Unavailable**: sequences (Phase 17) don't exist yet. The reason is shown. |
| all four | `<entity>.delete` | delete | crm.delete | — | — | **Unavailable**: CRM records have no permanent delete. The reason ("use Archive") is shown. |
| Lead | `lead.change_status` | status | crm.edit | confirm | 5,000 | Active statuses except Converted. Skips converted leads and leads already in that status. |
| Lead | `lead.update_fields` | update | crm.edit | confirm | 5,000 | Allowlist: temperature, score, source, next follow-up date. |
| Contact | `contact.update_fields` | update | crm.edit | confirm | 5,000 | Allowlist: designation, department, source. |
| Company | `company.change_status` | status | crm.edit | confirm | 5,000 | |
| Company | `company.update_fields` | update | crm.edit | confirm | 5,000 | Allowlist: industry, company type, source. |
| Opportunity | `opportunity.change_stage` | stage | crm.edit | confirm | 5,000 | Uses `changeOpportunityStage`, so stage rules and required fields apply per record. |
| Opportunity | `opportunity.update_fields` | update | crm.edit | confirm | 5,000 | Allowlist: probability, expected close date. Closed opportunities fail with the reason. |
| Lead, Contact, Opportunity | `<entity>.send_template` | communication | crm.edit | type the count | 1,000 | Active template into the record's contact's latest conversation on its channel. Do-not-contact / consent are checked. The message id comes from the job item, so it is never sent twice. No new conversations are started. |

"Update fields" schemas are `strict()`. A field outside the allowlist is rejected, not ignored.

---

## 5. Export security

- Every text cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'` (formula / CSV injection), in both CSV and XLSX. Numbers and dates stay real numbers and dates.
- CSV: RFC 4180 quoting (commas, quotes, CR/LF), CRLF rows, UTF-8 BOM so Excel shows Unicode correctly.
- Rows are read **as the requester**, with the same visibility rule as the list. A record that became invisible or no longer exists is skipped.
- The file goes to the existing private storage (outside `public/`). The job only exposes the file name, size, row count and expiry.
- Download (`GET /api/v1/bulk-jobs/{id}/download`):
  - only the user who ran the export;
  - only while they still hold `crm.export`;
  - only until `expiresAt` (7 days).

  The response has `Content-Disposition: attachment`, `Cache-Control: no-store, private` and `X-Content-Type-Options: nosniff`. Each download writes an audit row.
- Once the file is written, the per-item copies of the rows are removed.
- When an export expires, the recovery tick deletes the file and the link stops working.

---

## 6. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/bulk-actions/capabilities?entityType=` | Actions, availability, reasons and fields for the current user |
| POST | `/api/v1/bulk-actions/preview` | `{ entityType, actionKey, selection, params }` → count, summary, warnings, sample, confirmation |
| GET | `/api/v1/bulk-jobs` | `?statuses=a,b&entityType=&mine=true&search=&page=&pageSize=`. Own jobs, plus every job of entity types the user administers (CRM: `crm_settings.edit`). |
| POST | `/api/v1/bulk-jobs` | `{ entityType, actionKey, selection: {mode:"IDS"\|"PAGE", ids} \| {mode:"FILTER", filterQuery}, params, idempotencyKey?, confirmCount? }` → 202 (200 for a duplicate) |
| GET | `/api/v1/bulk-jobs/{id}` | Detail, with `itemCounts`, `retries` and `download` (no storage key) |
| GET | `/api/v1/bulk-jobs/{id}/items` | `?statuses=FAILED,SKIPPED&page=` |
| GET | `/api/v1/bulk-jobs/{id}/errors` | CSV of failed, skipped and not-processed records with reasons (formula-safe) |
| GET | `/api/v1/bulk-jobs/{id}/download` | Export file (requester only) |
| POST | `/api/v1/bulk-jobs/{id}/cancel` | |
| POST | `/api/v1/bulk-jobs/{id}/retry` | `{ idempotencyKey? }` → the new (or existing) retry job |

**Access rules:**

- A job that belongs to someone else, and isn't administered by the caller, returns `404`, not `403`.
- Unknown entity types, unknown action keys, and actions belonging to another entity all return the same `VALIDATION_ERROR`.
- Unavailable actions are refused with their reason.
- The request body is capped at 1 MB. For more ids than that, use "all matching the filter".

---

## 7. UI

- **List pages** (Leads, Contacts, Companies, Opportunities):
  - A **Bulk actions** button in the toolbar, always visible.
  - A **More bulk actions…** button in the selection bar.
  - Both open the same dialog:
    1. **Records**: the ticked rows (the header checkbox ticks the page) or *all records matching the current search and filters*.
    2. **Action**: only available actions. Unavailable ones are listed under "Not available (n)" with the reason.
    3. **Settings**: fields from the server: user, select, tags (existing + new), number, date, text.
    4. **Review**: the count, summary, warnings, sample names, and the confirmation (checkbox, or typing the count).
    5. **Started**: a link to the job.
  - The old quick buttons (Assign / Change status / Tags / Archive, max 500, synchronous) are unchanged.
- **CRM → Bulk Jobs** (`/crm/bulk-jobs`) lists jobs with:
  - filters: status, record type, "started by me", and a search on the summary;
  - progress bars and result counts;
  - automatic refresh while a job runs (a 1-row check every 5 seconds).
- **Job detail** (`/crm/bulk-jobs/{id}`) refreshes every 2 seconds while the job runs, and pauses while the browser tab is hidden. It shows:
  - status, progress and counters (succeeded / skipped / failed / not processed);
  - the job error, the export download (or why it's not available), cancel, "Retry failed (n)" and "Download error report";
  - links to the original or retry job and to the list with the job's filter;
  - a per-record table with outcome filters and links to the records.
- When a job finishes, the requester gets a notification in the ERP bell.

---

## 8. How to register a bulk action

The engine never needs to change. A module adds one registration file.

1. **Register the entity** (once per record type) with `registerEntity()` from `src/modules/bulk-actions/bulk-registry.ts`:
   ```ts
   registerEntity({
     entityType: "SAMPLE_REQUEST",            // UPPER_SNAKE registry key
     label: "Sample request", pluralLabel: "Sample requests",
     viewPermission: { module: "sampling", action: "view" },
     adminPermission: { module: "sampling", action: "approve" }, // sees everyone's jobs
     parseFilterQuery: (q) => parseSampleFilterParams(new URLSearchParams(q)),
     resolveFilterIds: async (actor, filter, limit) => { /* same where-builder as the list API, as the actor */ },
     visibleIds: async (actor, ids) => { /* which ids the actor can see */ },
     recordLabels: async (companyId, ids) => new Map(/* id → "SR-0012 · Buyer" */),
     recordHref: (id) => `/sampling/${id}`,
     listHref: "/sampling",
   });
   ```
2. **Register each action** with `registerAction()`:
   ```ts
   registerAction({
     key: "sample_request.assign",            // lower.snake, must start with a registered entity
     entityType: "SAMPLE_REQUEST",
     kind: "assign",
     label: "Assign merchandiser",
     description: "Shown in the dialog.",
     permissions: [{ module: "sampling", action: "edit" }], // all required, checked at submit AND at start
     paramsSchema: z.object({ userId: z.string().uuid() }).strict(), // strict = field allowlist
     fields: async (actor) => [{ key: "userId", label: "Merchandiser", type: "user", options: await activeUsers(actor) }],
     confirmation: "confirm",                 // "none" | "confirm" | "type_count" (use type_count for destructive)
     destructive: false,
     retrySafe: true,                         // can a record whose outcome is unknown be re-run safely?
     cancellable: true,
     maxItems: 5000,
     prepare: async (actor, p) => ({ params: p, summary: `Merchandiser → ${await nameOf(p.userId)}` }), // validate referenced data
     executeItem: async (ctx) => {
       // ALWAYS call the module's existing service, as ctx.actor:
       const before = await loadVisible(ctx.actor, ctx.item.entityId);
       if (before.assigneeId === ctx.params.userId) return { status: "SKIPPED", message: "Already assigned." };
       await assignSampleRequest(ctx.actor, ctx.item.entityId, { userId: ctx.params.userId });
       return { status: "SUCCEEDED" };
     },
   });
   ```
   - Throw `BulkItemError(message, code)` or the service's `BusinessRuleError` for an expected failure. The message is shown to users. Any other error is stored as a generic "Unexpected error" and logged on the server.
   - Return `SKIPPED` with a reason for "nothing to do".
   - For cheap batch work (exports), implement `executeBatch` (one call per 50 items) and `finalize` (runs once at the end and returns the job's `result`).
   - Actions that aren't possible yet: set `unavailableReason`. They are listed with the reason and refused by the API.
   - For a side effect that must never repeat, derive its id from `ctx.idempotencyKey` (stable across recovery and retries).
3. **Load it**: import your registration function in `src/modules/bulk-actions/bulk-registrations.ts`.
4. **UI**: add `<BulkActionsButton entityType="SAMPLE_REQUEST" selectedIds={…} filterQuery={…} />` to the list page. Everything else (dialog, jobs list, detail, progress, cancel, retry, report, download) already works.
5. **Tests**: copy a case from `bulk-actions.integration.test.ts`.

---

## 9. Operations

- The worker must run: `npm run worker` (it is part of `npm run dev`).
  - If Redis is unreachable at submit time, the job is saved as QUEUED and the UI says it will start when the worker is reachable. The recovery tick sends it later.
- The queue name is `bulk-actions-<12 hex of sha256(DATABASE_URL)>` (override with `BULK_ACTION_QUEUE_NAME`).
- Limits:
  - mutations: 5,000 records per job;
  - workflow enrolment: 2,000;
  - messages: 1,000;
  - export: 20,000 rows / 20 MB;
  - absolute ceiling: 20,000;
  - request body: 1 MB.
- Processing: records are handled one at a time per job, in batches of 50, with two jobs in parallel per worker process. A 5,000-record assign typically takes a few minutes.
- Export files are kept for 7 days.

---

## 10. Tests

| File | Covers |
|---|---|
| `src/modules/bulk-actions/bulk-actions.unit.test.ts` (17) | Formula-injection sanitising (each trigger character), CSV quoting/BOM, user-safe error mapping (no SQL/IP/stack leak), selection and request schemas (strict, no smuggled keys, PAGE ≤ 500), registry validation, entity binding of handlers, capabilities by permission / static / dynamic availability |
| `src/modules/bulk-actions/bulk-actions.integration.test.ts` (13, real Postgres) | Registry security over the API, IDS selection with visibility + duplicates, skip reasons, events/audit/notification, FILTER snapshot + invalid filters, partial failure → COMPLETED_WITH_ERRORS, error report, retry (new linked job, once, root key), idempotent submit (concurrent), type-count confirmation, mid-run cancel without rollback, immediate cancel of queued job, crash recovery (expired lease, PROCESSING item re-run, attempts), lease prevents double processing, re-validation at start (owner deactivated, requester deactivated), CSV + XLSX export with injection protection, download restrictions (other admin, lost permission), expiry purge, job visibility (own vs admin, mine filter), lead status / opportunity stage through the services, workflow enrolment + re-entry skip, template guard (inactive refused; no contact → failed, nothing sent) |
| `src/modules/bulk-actions/bulk-queue.integration.test.ts` (2, real Postgres + Redis) | Submit → BullMQ → worker → COMPLETED; the recovery tick re-sends a lost message |
| `src/app/api/v1/bulk-jobs/route.test.ts` (5) | Session required, actor from the session only, 202/200, bad JSON → 400, catch-all 404s, download headers |
| `src/components/bulk/bulk-components.test.tsx` (3) | Dialog: actions + unavailable reasons, review, type-count gate, idempotency key, FILTER scope, "Unassigned" → null, server error display |

Run the integration tests with:

```
CRM_IT_DATABASE_URL=postgresql://…/crm_it npx vitest run src/modules/bulk-actions
```

Add `BULK_IT_REDIS_URL=redis://localhost:6379` to also run the queue test.

---

## 11. Known limitations

- **Sequence enrolment** is interface-only: the action is registered as unavailable until Phase 17 builds sequences.
- **Permanent delete** is unavailable by design: CRM records have no delete service. Use archive.
- **Messages** go only into an existing conversation (same rule as workflows). A successful real send (provider delivery) is covered by the Phase 11/12/18 tests of the reused path, not by a bulk-specific end-to-end test.
- **The jobs UI** lives under CRM (`/crm/bulk-jobs`), because the CRM is the only consumer so far. The API is not CRM-specific.
- **The workflow action "Run a bulk action" and the trigger "Bulk job completed"** remain unavailable in the workflow editor. They were not part of this phase.
- **Bulk "update fields"** covers a fixed allowlist per entity. Custom fields are not offered yet.
- **PAGE mode** is supported by the API. The UI sends ticked rows as `IDS`; ticking the header checkbox selects the page.

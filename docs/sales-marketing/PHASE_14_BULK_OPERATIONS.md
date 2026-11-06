# Sales & Marketing — Phase 14 Shared bulk operations and advanced processing (2026-11-06)

Spec: `docs/sales-marketing/ref/14.md`. Scope confirmed with the user on 2026-11-06:

- **Operations (all four groups):**
  - Enquiries & quotations: assign enquiry owner, export enquiries, export quotations, "check quotation drafts" (validate only).
  - Campaigns & promotions: export campaigns with budget figures, export promotions, pause promotions.
  - Attribution: recalculate several models at once through the Phase 13 run service.
  - Enquiry import from CSV / Excel through the existing import framework, with a validation preview.
- **Dry run:** per record. A dry-run job checks every record with the action's own rules and reports would-succeed / would-be-skipped / would-fail. "Run for real" then starts the real job on the would-succeed records. Actions that can't be dry-run say why.
- **Schedules:** for exports and recalculations only. Daily / weekly / monthly at a time, India time. Each run is a normal bulk job: no overlap, failures notified, pause / resume, audited.
- **Jobs screen:** Sales & Marketing → Bulk jobs, reusing the shared job list / detail components filtered to S&M record types. CRM keeps its own page.

Nothing new was built where something existed. The engine is the CRM Phase 14 Bulk Action Engine (`docs/crm/PHASE_14_BULK_ACTION_ENGINE.md`); the import is the Admin bulk-import framework (`src/modules/import/`). This phase extends both and registers S&M record types and actions on them.

Out of scope (later phases): workflow orchestration (15), public integrations / webhooks (16), general BI (17), AI (18).

## 1. What exists and is reused

| Concept | Existing | Reused / extended |
|---|---|---|
| Background jobs, items, lease, recovery, cancel, retry, error report, export download | `bulk_jobs`, `bulk_job_items`, `bulk-engine.ts`, `bulk-jobs.service.ts` (CRM Phase 14) | Extended: dry run, run-for-real, schedules, active-job limits, `keepAlive` |
| Action registry (no client-named services / tables / fields) | `bulk-registry.ts` | S&M registers 5 entity types, 8 actions |
| Export file (private storage, 7-day expiry, formula-safe) | `crm-bulk-export.ts` | Generalised into `bulk-export-file.ts`; CRM now calls it |
| Import (parse → dry-run validate → queued commit → per-row isolation → batch history) | `bulk-import.service.ts`, `import_batches`, `ImportBatchType` | New type `BUYER_ENQUIRY`, S&M routes and permissions |
| Per-record rules | each module's service | New exported *check* functions so dry run and real run share one rule set |
| Worker | `npm run worker` (`src/core/jobs/worker.ts`) | New tick `bulk.schedules` (every minute) on the bulk queue |

## 2. Data model (migration `20261109090000_bulk_operations_phase14`, rollback `prisma/rollback/20261109090000_bulk_operations_phase14.down.sql`)

- **`bulk_jobs`** gains three columns:
  - `dry_run` (boolean).
  - `dry_run_of_job_id` — the real job started from a dry run. A partial unique index allows one real run per dry run.
  - `schedule_id` — set when a schedule started the job.
- **`bulk_job_schedules`** — new table:
  - Fields: name; entity type; action key; saved list filter (`filter_query`); params; summary; frequency DAILY / WEEKLY / MONTHLY; `time_of_day` "HH:MM"; `day_of_week` (1 = Monday) or `day_of_month` (1–28); timezone (`Asia/Kolkata`); status ACTIVE / PAUSED; next / last run; last job and outcome; consecutive failures; owner; version (optimistic lock); `archived_at`.
  - CHECKs on the time format and the day fields.
- **`ImportBatchType`** gains `BUYER_ENQUIRY`.

## 3. Engine extensions (`src/modules/bulk-actions/`)

- **Action contract** (`bulk-types.ts`): optional `validateItem` (the dry run), `dryRunUnavailableReason`, `schedulable`, `keepAlive()` on the item context, new kinds `validate` and `recalculate`. The registry refuses `validateItem` without `executeItem`. Capabilities report `dryRun`, `dryRunUnavailableReason` and `schedulable`.
- **Dry run** (`bulk-engine.ts`):
  - A job with `dry_run` runs `validateItem` per record and never the batch path.
  - No finalize, so no export file is written.
  - Interrupted items are always re-run (a dry run changes nothing).
  - Notifications say "Dry run … nothing was changed".
- **Run for real** (`runBulkJobForReal`, `POST /api/v1/bulk-jobs/{id}/run-for-real`):
  - Only the dry run's requester, only after it finished (not cancelled), only once.
  - Starts a new job on the SUCCEEDED items with the same params, re-checking permission, availability, parameters and visibility.
  - Asks for the typed count when the action needs it.
  - Every record is checked again by the action when it runs.
- **Active-job limits** (`assertBulkCapacity`): 5 running jobs per user and 20 per company (queued / validating / running / cancelling), checked at submit, retry and run-for-real. Error `RATE_LIMITED`.
- **Lists**: `entityTypes` and `scheduleId` filters. The CRM page shows only CRM record types; the S&M page only S&M ones.

## 4. Schedules (`bulk-schedules.service.ts`, `bulk-schedule-time.ts`)

- **Create**: only for registered actions marked `schedulable`, over a list filter (never fixed ids). The handler, permissions, availability, filter and params are checked as the creator. At most 50 schedules per company.
- **When**: next run = first `HH:MM` India time (UTC+05:30, no DST) after now on a matching day. The calculation is pure and unit-tested.
- **Tick** (`runDueBulkSchedules`, worker `bulk.schedules`, every minute):
  - **Claim**: a due schedule is claimed by moving `next_run_at` forward with a guarded update, so two workers never start the same run. Missed runs are not replayed.
  - **No overlap**: while the previous job is still going, the run is skipped and recorded (`SKIPPED_OVERLAP`).
  - **Start**: otherwise the tick calls `createBulkJob` as the owner, with the idempotency key `sched:<id>:<due time>`.
  - **Nothing to do**: "nothing matched the filter" is recorded as `NOTHING_TO_DO`. It is not a failure.
- **Failures**: any failure to start, or a job that ends FAILED, counts up. Examples of failures to start: owner inactive, permission removed, action unavailable. The owner is notified. After 3 failures in a row the schedule pauses itself (audited, notified). Any success resets the count.
- **Manage**: the owner or an S&M administrator (`sales_marketing_settings.edit`) can manage a schedule. Pause; resume (re-checked as the owner; the failure count resets); edit name, rule and params (version-checked); delete (archived; past jobs stay).
- **API**: `GET/POST /api/v1/bulk-schedules`; `GET/PATCH/POST(action) /api/v1/bulk-schedules/{id}`.

## 5. Sales & Marketing registrations (`src/modules/sales-marketing/bulk/`)

**Entities** (`sm-bulk-entities.ts`): ENQUIRY, QUOTATION, CAMPAIGN, PROMOTION, ATTRIBUTION_MODEL.

- "All matching the filter" uses each list API's own filter schema and the where-builder now exported from its service: `buildSalesEnquiryListWhere`, `buildQuotationListWhere`, `buildCampaignListWhere`, `buildPromotionListWhere`.
- Visibility is exactly what the list shows: own / team / view_all and branch access for enquiries and quotations, the campaign scope, and company for promotions and models.
- Admin permission: `sales_marketing_settings.edit`.

**Actions** (`sm-bulk-actions.ts`) — each calls the module's own service as the requester:

| Action | Service | Dry run | Schedulable | Notes |
|---|---|---|---|---|
| `enquiry.assign` | `checkSalesEnquiryAssign` / `assignSalesEnquiry` | yes | no | Eligible owners only. Closed or cancelled enquiries fail with the reason; same owner is skipped; the owner is notified as by hand. |
| `enquiry.export` | list where-builder | n/a | yes | Stage, priority, owner, follow-up, value. |
| `quotation.export` | list where-builder | n/a | yes | Current revision, status, totals. |
| `quotation.check_drafts` | `checkQuotationDraft` (the issue / submit checks) | n/a (changes nothing) | no | "Ready to issue (₹…)" or "needs approval: …"; non-drafts skipped. |
| `campaign.export` | `measureBudgets` (Phase 12) | n/a | yes | Approved budget, actual spend, committed, in approval, remaining, used %. |
| `promotion.export` | approved version | n/a | yes | |
| `promotion.pause` | `checkPromotionAction` / `promotionAction` | yes | no | Already paused → skipped; the comment is kept on each promotion's history. |
| `attribution_model.recalculate` | `checkRunRequest` / `requestRun` + `executeRun` (Phase 13) | yes | yes | Last 30 / 90 / 365 days (moves with each scheduled run) or custom dates. Model busy → skipped. Idempotency key = the bulk item key, so a crashed record never queues a second run. The lease is renewed after each batch. Max 50 models. |

**Deliberately not offered:** bulk stage changes; bulk issue / approve / cancel of quotations; bulk campaign status changes; bulk deletes. Each needs per-record judgement or approval (spec: no generic mass edit).

## 6. Enquiry import (`enquiry-import.ts`, `enquiry-import.service.ts`)

- **Format**: one row = one enquiry with one line.
  - Party: customer code (optionally a buyer name) or prospect fields.
  - Enquiry: date, source, subject, priority, owner e-mail, next follow-up.
  - Line: style code or style name or description; colour; size code; target quantity / price / delivery; remarks.
  - The template (`GET …/imports/enquiries/template?format=xlsx|csv`) is generated from the same column spec the parser reads.
- **Rules**:
  - Codes and e-mails resolve to this company's records. Nothing is created implicitly: an unknown customer, style, size or owner fails the row.
  - Every row goes through `createSalesEnquiry`, so the owner must be eligible and the CRM link, customer / buyer / style / size checks and numbering all apply.
  - In validation the row runs with `{ dryRun: true }`: all checks, no write. This uses the new `validateBuyerEnquiryInput`.
- **Duplicates**: a row is refused when an enquiry already exists with the same customer (or prospect name), enquiry date, subject and style. While validating, a row is also refused when an earlier row of the same file has that key.
- **Flow**:
  1. Upload. Limits: 5 MB, 2,000 rows.
  2. Validate: a preview of every failing row with the reason. Nothing is written.
  3. Import. The file is re-parsed and re-checked from scratch, stored for audit, and queued. The worker creates rows one by one; a bad row never stops the others.
  4. Progress shows while the import runs. Then the result and a formula-safe CSV of failed rows with their values and reasons.
- **Permissions**: `sales_marketing.create`. Users see their own import batches; S&M administrators see all. Admin-portal batches and enquiry batches are kept apart (the Admin history lists only master types).
- **UI**: Sales & Marketing → Enquiries → Import.

## 7. Screens

- **Lists with bulk actions**: Enquiries, Quotations, Campaigns, Promotions, Attribution models.
  - Each has row checkboxes and **Bulk actions** (the shared dialog), plus a link to **Bulk jobs**.
  - The dialog's review step offers **Run now**, **Dry run first** (when supported) and **Save as a schedule** (schedulable actions over the filters).
  - The shared `DataTable` gained `onSearchChange` so "all matching the search" uses the typed search.
- **Sales & Marketing → Bulk jobs** (nav entry for every S&M module), with two tabs:
  - **Jobs**: S&M record types only.
  - **Schedules**: when, next / last run, last job, failures, pause / resume / delete, and that schedule's runs.
- **Job detail** (shared component):
  - A "Dry run" badge and banner; outcomes read *Would succeed / Would be skipped / Would fail*.
  - **Run for real (n)**, which asks for the typed count when needed.
  - Links back to the dry run or to the schedule that started the job.

## 8. Security notes

- **Clients** name only a registered entity type and action key; never a service, table or field. There is no generic mass assignment.
- **Per-record changes** run through the module services as the requester. Permissions, visibility, state rules, optimistic locks, audit and notifications apply per record.
- **Tenant isolation**: every lookup is company-scoped. Ids from another company are dropped as not visible.
- **Exports** are formula-injection safe, kept privately for 7 days, and downloadable only by the requester while they keep the export permission.
- **Abuse limits**: per-user and per-company active-job limits; per-action maximums (assign / pause 2,000, export 20,000, check 1,000, recalc 50); 50 schedules per company; the import is capped at 5 MB / 2,000 rows.
- **Schedules** run as their owner and re-check everything at every run. Losing a permission makes runs fail, and the schedule then pauses itself.

## 9. Tests

- **`bulk-schedule-time.test.ts`**: India-time next run (day boundary, weekly, monthly), description.
- **`sm-bulk-actions.test.ts`**: relative recalculation periods, filter query.
- **`sm-bulk.integration.test.ts`** (real DB):
  - Capabilities.
  - Assign dry run → run for real (once, requester only, notifications via the service).
  - Export dry run refused; permission enforced; filter selection and tenant isolation.
  - Campaign export with budget figures and formula safety.
  - Promotion pause through the service.
  - Quotation draft check changes nothing.
  - Attribution recalculation (dry run queues nothing; busy model skipped).
  - Schedules: not schedulable refused; visibility; due run as owner; overlap skipped; three failures pause; resume; version conflict; delete keeps past jobs.
  - Active-job limit.
  - Enquiry import validation (no writes, unknown code, in-file and existing duplicates, bad date) and commit.
- **`sm-bulk-screens.test.tsx`**: dry-run submit, schedule save, job detail "would" labels and run for real.
- **`bulk-actions.integration.test.ts`** (CRM): the rep is also denied the S&M admin permission, since S&M record types now share the engine.

## 10. Operations

- No new npm packages.
- The worker's bulk queue gets a second repeatable tick, `bulk.schedules`, every minute.
- Restart `npm run worker` after deploying.
- Apply the migration.

# CRM Phase 07 — Pipelines & Stages

Status: implemented, tested and verified (2026-10-06). Phase 08 (Opportunity Board) is not started.

## What this phase delivers

- **Pipelines.** Companies can have several sales pipelines (e.g. Sales, Export, Domestic).
  - Each pipeline has a name, a description and an active/archived status.
  - Exactly one pipeline is the default, and new opportunities start there.
- **Stages.** Each pipeline has its own ordered stages.
  - Each stage has a name, a description, a default probability and a status.
  - Each stage can list **required fields** and **transition rules**.
  - Each pipeline has exactly one default (start) stage.
- **One validation path for every stage change.** The opportunity page, the edit form, bulk actions, the API, pipeline transfer and stage/pipeline archiving all go through `crm-stage-transition.service.ts`. The backend is the authority.
- **Stage history.** Every applied move is stored in its own table: who, when, from/to pipeline and stage, from/to probability, whether the probability was stage-derived or manual, the source and the reason. It also appears on the timeline and in the AuditLog.
- **Safe archiving.** A stage or pipeline that is still used can only be archived after its opportunities are moved, with confirmation. An opportunity is never left without a stage.
- **Board and reporting data.** Aggregated endpoints for the Phase 08 board and for reports (no Kanban UI yet).
- **Configuration UI.** CRM Settings → **Pipelines & stages**: pipeline list, stage table with drag-and-drop and ↑/↓ reorder, probability, default stage, required fields, transition rules, archive/restore.

## Database changes (`prisma/migrations/20261006100000_crm_pipelines_stages`)

All changes are additive and back-filled.

| Table | Change |
|---|---|
| `crm_pipelines` | Added `name_key`, `description`, `archived_at`, `archived_by_user_id`, `updated_by_user_id`, `version`, `created_by_user_id`.<br>Partial unique indexes: one default per company; unique active name.<br>CHECK: the default can't be archived. |
| `crm_pipeline_stages` | Added `name_key`, `description`, `is_default`, `required_fields` (JSONB array), `transition_mode` (`ANY` / `ONLY_LISTED`), `archived_at`, `archived_by_user_id`, `updated_by_user_id`, `version`.<br>Partial unique indexes: one default per pipeline; unique active name per pipeline.<br>CHECKs on mode and on the array shape. |
| `crm_stage_transition_rules` (new) | One row per from-stage → to-stage pair, with `allowed`, extra `required_fields` and an optional `message`.<br>Unique on (from, to). |
| `crm_opportunity_stage_history` (new) | One row per applied move: `change_type` (INITIAL / STAGE_CHANGE / PIPELINE_TRANSFER / STAGE_REASSIGNED), `source`, from/to pipeline and stage (with stage names at the time), from/to probability, `probability_source`, `result`, `reason`, `changed_by_user_id`, `changed_at`. |
| `crm_opportunities` | Added `probability_source` (`STAGE` / `MANUAL`, with a CHECK).<br>The pipeline and stage foreign keys changed from `SET NULL` to **`RESTRICT`**, so a stage can never be deleted out from under a record. |

**Back-fill:**

- **Names and archive state:** `name_key` is filled. Rows with `is_active = false` become archived.
- **Defaults:**
  - Each company keeps or gets one default pipeline.
  - The first active stage of each pipeline becomes its default (this matches Phase 06 behaviour).
- **Probability source:** it is `STAGE` where the probability equals the stage default, otherwise `MANUAL`.
- **History:** rebuilt from the Phase 06 timeline. Each record gets an initial stage from `opportunity.created`, plus every `opportunity.stage_changed` event.

`is_active` is kept in sync with `archived_at`, so Phase 06 readers keep working.

## Architecture

### Components reused (nothing new of these kinds)

- **Core plumbing:**
  - `runCrmMutation`: one transaction for record + AuditLog + `crm_events`.
  - `crmRoute`: auth plus the existing `PermissionService`.
  - `BusinessRuleError`.
  - Optimistic locking via `version`.
- **Existing CRM modules:**
  - CRM visibility (`getCrmRecordScope` / `crmOwnerWhere`).
  - Custom fields (requirements can reference them).
  - ERP document links (requirements can reference them).
- **UI building blocks:** `crm-api` client, `Modal` / `FormField` / `Button`, the settings tab layout and the CRM timeline.

### Transition validation

`src/modules/crm/pipelines/crm-stage-transition.service.ts` has five parts:

- **`evaluateTransition(companyId, opportunity, request)`** is a pure check that writes nothing. It checks, in order:
  1. Record state: not archived, and open (unless it is an administrative reassignment).
  2. The target pipeline and stage exist, belong together, and are not archived.
  3. Transition rules for moves inside one pipeline: a blocked rule, or `ONLY_LISTED` with no "allowed" rule, refuses the move.
  4. Required fields: the destination stage's fields plus the allowed rule's extra fields. They are checked against the record, or against the values being saved in the same request when the edit form is used.
  5. Registered business validators (`registerStageTransitionValidator`).

  It returns `allowed`, reasons, missing fields and the resulting probability (value + source).
- **`assertTransitionAllowed`** turns a refusal into an error:
  - Rules or missing fields → **422 `CRM_STAGE_TRANSITION_BLOCKED`**, with `details.missingFields`, `details.reasons` and `details.fieldErrors` (the form highlights the fields).
  - Closed or archived record → `INVALID_STATE_TRANSITION`.
  - Unknown or archived target → `VALIDATION_ERROR`.
- **`transitionUpdate`** produces the column changes.
- **`recordTransition`** writes the history row, the AuditLog entry and the timeline event:
  - `opportunity.stage_changed`, or
  - the new `opportunity.pipeline_transferred`.
- **Stage-change API** (`POST /opportunities/{id}/stage`): auth and permission → load the record within visibility → evaluate → refuse or continue → versioned update (`RECORD_VERSION_CONFLICT` on a stale `version`) → history + audit + timeline, all in one transaction. A refused move writes nothing: no history, no event.

### Required fields

- **Registry:** `stage-requirements.ts` is client-safe. It defines three kinds of keys:
  - **Built-in:** `company`, `contact`, `amount`, `expectedCloseDate`, `requirement` (the opportunity's requirement/description), `owner`, `source`, `probability`.
  - **ERP documents:** `erp:any`, `erp:BUYER_ENQUIRY`, `erp:SAMPLE_REQUEST`, `erp:SALES_ORDER`.
  - **Custom fields:** `custom:<key>`.
- **Quotation** is listed as *unavailable* because the ERP has no quotation module. Adding a `QUOTATION` ERP document type makes `erp:QUOTATION` selectable without a migration.
- **Storage:** stages and rules store plain keys. Unknown keys are rejected on save. A deleted custom field never blocks a move.
- **Creating an opportunity** directly in a stage is checked against that stage's required fields (form/API). Lead conversion places records in the default stage without this check (see limitations).

### Probability

`resolveStageProbability` decides what happens to the probability when a record enters a stage:

- **Stage-derived (`STAGE`) or empty:** follows the new stage's default.
- **Set by hand (`MANUAL`):** kept, unless the user ticks "use the stage's default" (`useStageProbability`).
- **Explicit value:** used as given. It is `MANUAL` unless it equals the stage default.
- **Closed records** keep their probability when an admin reassigns them.
- **Changing a stage's default probability** never changes existing opportunities.

Every change is traceable through the history row (from/to probability and source).

### Stage archive and reassignment

`archiveStage` refuses three cases:

- the default stage (make another stage the default first);
- the last active stage;
- a stage that is still used, unless `reassignToStageId` (another active stage of the same pipeline) and `confirm: true` are given.

When it runs:

- **All** records move in one transaction: open, closed and archived.
- Each move gets a `STAGE_REASSIGNED` history row and a timeline event "(stage archived)".
- Transition rules and required fields are not applied, because the source stage is going away.
- Restore puts the stage back at the end of the order.

### Pipeline archive and transfer

**Archiving a pipeline:**

- The default pipeline can't be archived.
- A used pipeline needs `targetPipelineId` + `confirm`. Optionally pass `targetStageId` (otherwise the destination's default stage is used) and a `stageMap`.
- Each record gets a `PIPELINE_TRANSFER` history row (source `PIPELINE_ARCHIVE`) and an `opportunity.pipeline_transferred` event.

**Transferring an opportunity** (`POST /opportunities/{id}/transfer`):

- It moves into the chosen stage, or the destination's default stage.
- The destination stage's required fields apply. Transition rules don't, because they are per pipeline.
- The history row and timeline event include the optional reason.
- A record is never left in a stage of another pipeline.

### Board and reporting (`crm-pipeline-insights.service.ts`)

- **`GET /pipelines/{id}/board`** returns the stages in order, each with:
  - the record count;
  - the value total per currency (currencies are never added together);
  - up to `perStage` cards (`?status=OPEN|ALL`, `?ownerUserId`).

  It uses DB `groupBy` and one bounded query per stage.
- **`GET /pipelines/{id}/report?from&to`** returns:
  - the total count and value per currency;
  - open / won / lost / abandoned counts and values, and the win rate;
  - the open stage distribution (count, share, value);
  - **conversion by stage**. A record "reached" a stage if its current stage or any history entry is that stage or a later one. Conversion is reached(next) ÷ reached(this), and the last stage converts to Won. This is one SQL query.
- Both endpoints apply the viewer's CRM visibility (own records vs `crm.view_all`).
- The configuration screen loads only counts (`groupBy`), never the opportunities themselves.

## APIs

**Permissions:**

- Configuration reads use `crm_settings.view`; configuration writes use `crm_settings.edit`.
- Record operations use `crm.edit`.
- Validate, history, board and report use `crm.view`.
- The pipeline list (`GET /pipelines`) uses `crm.view`, because pickers need it.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/crm/pipelines` | Pipelines + stages (`?includeArchived=0`) |
| POST | `/api/v1/crm/pipelines` | Create (name, description, isDefault, stages[]) |
| GET / PATCH | `/api/v1/crm/pipelines/{id}` | Detail (stages, usage, rules, requirement options) / edit |
| POST | `/api/v1/crm/pipelines/{id}/default` | Set the default pipeline |
| POST | `/api/v1/crm/pipelines/{id}/archive` | Archive (target pipeline / stage / stageMap + confirm when used) |
| POST | `/api/v1/crm/pipelines/{id}/restore` | Restore |
| GET | `/api/v1/crm/pipelines/{id}/usage` | Opportunity counts per stage |
| GET | `/api/v1/crm/pipelines/{id}/board` | Board data |
| GET | `/api/v1/crm/pipelines/{id}/report` | Report data |
| GET / POST | `/api/v1/crm/pipelines/{id}/stages` | List / create stage |
| POST | `/api/v1/crm/pipelines/{id}/stages/reorder` | `{ ids }` = every active stage once |
| GET / PATCH | `/api/v1/crm/pipelines/{id}/stages/{stageId}` | Get / update (name, description, probability, requiredFields, transitionMode) |
| POST | `…/stages/{stageId}/default`, `/archive`, `/restore` | Default stage / archive with reassignment / restore |
| GET | `…/stages/{stageId}/usage`, `/config` | Counts / full stage configuration |
| PUT | `…/stages/{stageId}/required-fields` | `{ version, requiredFields }` |
| GET / PUT | `…/stages/{stageId}/transition-rules` | `{ version, transitionMode, rules[] }` (replaces all rules from the stage) |
| GET | `/api/v1/crm/settings/pipelines` | Settings list with counts |
| POST | `/api/v1/crm/opportunities/{id}/stage/validate` | Dry run: allowed, reasons, missingFields, probability |
| POST | `/api/v1/crm/opportunities/{id}/stage` | Change stage (now centrally validated; `useStageProbability`, `reason`) |
| POST | `/api/v1/crm/opportunities/{id}/transfer` | Move to another pipeline |
| GET | `/api/v1/crm/opportunities/{id}/stage-history` | Stage history |
| POST | `/api/v1/crm/opportunities/bulk` (`action: "stage"`) | Each record is validated and saved on its own. The response adds `blocked[]` (missing fields), and `skipped[]` gives the reasons. |

All pipeline and stage writes take a `version` (optimistic locking). A reorder based on a stale list returns `RECORD_VERSION_CONFLICT`.

## UI

- **CRM Settings → Pipelines & stages:**
  - **Pipelines:** list (default and archived badges, open counts), add / edit, make default, archive (destination + confirmation), restore.
  - **Stages:**
    - **Table:** drag handle and ↑/↓ reorder; columns for probability, start stage, required fields, allowed moves and opportunity counts.
    - **Actions:** edit (name, description, probability, required-field picker), Rules (mode + per-destination allow/block, message, extra requirements), archive (reassign + confirmation), restore.
  - People with only `crm_settings.view` see the screen read-only.
- **Opportunity page:**
  - **Change stage:** checks the move as soon as a stage is picked and lists what is missing (Save disabled). It keeps a hand-set probability unless "use the stage default" is ticked.
  - **New "Move to another pipeline" action:** shown when more than one pipeline is active.
  - **New "Stage history" section.**
  - **Probability label:** shows "(stage default)" or "(set by hand)".
- **Opportunity form:** new records start in the pipeline's default stage. A refused move shows inline field errors.

## Tests

| Suite | Covers |
|---|---|
| `src/modules/crm/pipelines/pipelines.unit.test.ts` (12) | Probability rules, requirement registry, schemas, error mapping, event registration |
| `src/modules/crm/pipelines/pipelines.integration.test.ts` (12, real Postgres) | Pipeline CRUD and duplicate names; one default (audited, used for new records, can't be archived); stage CRUD, reorder doesn't move records, default stage; probability source and history; required fields block and write nothing (incl. edit form and create); transition rules (blocked / only listed / extra fields); bulk per-record results; pipeline transfer; stage archive with reassignment (open, closed, archived records, never NULL) and restore; pipeline archive with stage map and restore; board and report aggregation with visibility and conversion; optimistic locking |
| `src/app/api/v1/crm/pipelines/route.test.ts` (6) | Every route's permission (crm vs crm_settings) and delegation; 422 / 403 envelopes |
| `src/app/(dashboard)/crm/settings/_components/PipelinesTab.test.tsx` (4) | Read-only view, ↑/↓ and drag-and-drop reorder payloads, stage form required fields (quotation unavailable), archive confirmation and default-stage guard |
| `opportunity-components.test.tsx` (+4) | Missing-field notice, manual probability / "use stage default", transfer refusal, stage history rendering |

**Regression:**

- Full suite: **147 files, 2408 tests passed**.
- This includes the Phase 02–06 unit, integration and route tests and the company-scoping contract test.
- `tsc` is clean. ESLint shows 0 errors (12 existing warnings elsewhere).

**Databases:**

- Fresh DB: all migrations applied, then the seed.
- Upgrade: the Phase 06 databases migrated with history and probability back-filled; no record has a NULL stage.

**Browser e2e (Chromium):**

1. Created the Export pipeline.
2. Set Company + Value as required for Qualified.
3. Reordered with ↑ and back.
4. Created a deal; the stage dialog showed "Fill these in first: Company, Estimated value" with Save disabled, and the direct API call returned 422.
5. Moved the deal to Export through the UI. History showed INITIAL → PIPELINE_TRANSFER.
6. Archived a used stage with reassignment; the record moved to Qualified and its stage was never NULL.
7. Board and report endpoints returned the expected counts.
8. No page errors.

## Limitations

- **No Kanban board UI, saved board views, cards, drag-drop board or bulk UI changes:** Phase 08. The board endpoint is ready.
- **Lead conversion** puts the opportunity in the default stage without checking its required fields. Admins should keep the start stage free of requirements; the configuration screen shows it as "Start stage".
- **Required fields apply when entering a stage.** Editing a record already in the stage may clear a field; it is checked again on the next move.
- **Transition rules apply inside one pipeline.** A pipeline transfer checks only the destination stage's required fields.
- **Conversion** counts records currently in the pipeline. Records transferred away are not counted in their old pipeline.
- **Refused moves are not stored.** The history `result` column exists for this, but nothing writes refusals; the UI shows them instead.
- **No stage-level "won / lost" kinds.** Status (Open / Won / Lost / Abandoned) stays separate from stage, as in Phase 06.
- **Hard delete** of pipelines and stages is intentionally unsupported (archive only; FKs are RESTRICT).

## Extension points

- `registerStageTransitionValidator(fn)` adds business checks, for example "a sales order is required before Closing" or credit checks.
- New requirement kinds: add an entry in `stage-requirements.ts`.
- Quotations: add a `QUOTATION` ERP doc type and provider; `erp:QUOTATION` becomes available automatically.
- Phase 08 board: `GET /pipelines/{id}/board` + `POST /opportunities/{id}/stage` (+ `/stage/validate` for drag previews).
- Workflows (Phase 18): consume `opportunity.stage_changed` and `opportunity.pipeline_transferred`. The payload includes `changeType`, `source`, from/to stage and pipeline, probability and source.
- Reports / forecasting (Phase 23): `crm_opportunity_stage_history` (indexed by opportunity and by pipeline + stage) and `getPipelineReport`.

## Assumptions

- "Status" for pipelines and stages is ACTIVE / ARCHIVED (derived from `archived_at`). `is_active` is kept only for compatibility.
- A pipeline created without stages gets the standard New → Closing stages.
- "Requirement" maps to the opportunity's requirement/description field. "Value" maps to the estimated value.
- Changing a stage via the edit form is validated against the values saved in the same request.

## CLAUDE.md entry (appended on your machine)

```markdown
## CRM rebuild — Phase 07 Pipelines & Stages (2026-10-06)
- Every opportunity stage/pipeline change goes through `src/modules/crm/pipelines/crm-stage-transition.service.ts` (`evaluateTransition` → `assertTransitionAllowed` → `transitionUpdate` + `recordTransition`): rules, required fields, history row, audit, timeline. Never update `stage_id`/`pipeline_id` directly.
- Config: `crm-pipelines.service.ts` (CRUD, one default pipeline / one default stage, reorder, archive with reassignment — never NULL a stage; FKs are RESTRICT). Required-field keys live in `stage-requirements.ts` (built-in, `erp:*`, `custom:*`).
- Probability: `probability_source` STAGE/MANUAL; `resolveStageProbability` keeps manual values.
- Refused moves → 422 `CRM_STAGE_TRANSITION_BLOCKED` with `details.missingFields`. Board/report data: `crm-pipeline-insights.service.ts` (no Kanban UI until Phase 08).
- Report: `docs/crm/PHASE_07_PIPELINES_STAGES.md`.
```

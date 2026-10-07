# CRM Phase 08 — Opportunity Board + List

Status: implemented, tested and verified (2026-10-07). Phase 09 (Activities) was delivered before this phase; Phase 10 is not started.

## 1. Existing components reused

| Area | Reused |
|---|---|
| Opportunity service / API (Phase 06) | `crm-opportunities.service.ts`, `/api/v1/crm/opportunities` list, detail, edit, assign, archive, bulk. |
| Filters | `parseOpportunityFilterParams` / `buildOpportunityWhere` / `buildOpportunityOrderBy`. The Board and the List send the **same query params** and the server parses them the same way. |
| Stage transition engine (Phase 07) | `POST /opportunities/{id}/stage`, which uses `crm-stage-transition.service.ts` (rules, required fields, probability, version, stage history). Every Board drop, every card "Change stage" and every bulk stage change goes through it. |
| Stage history | `crm_opportunity_stage_history` (Phase 07). Nothing new. |
| Board data | `getPipelineBoard` (Phase 07), extended rather than rebuilt. |
| Saved views | `crm_saved_views` (PRIVATE / SHARED only). Opening a view by default is a per-user preference. |
| UI | `CrmTable`, `CrmFilterBar`, `useCrmListState` (URL-synced filters), `CrmColumnPicker`, `CrmBulkBar`, `AssignOwnerModal`, `ChangeStageModal`, `ActionMenu`, `ConfirmModal`, `Toast`. |
| Permissions / visibility | `crm.view` / `crm.edit` / `crm.view_all` through `crmRoute` and `getCrmRecordScope`. No new permissions. |
| Audit | `writeAuditLog`. Each record keeps its own audit row; bulk operations add one summary row. |

## 2. Files

**New:**

- `prisma/migrations/20261008100000_crm_board_preferences/migration.sql`
- `src/modules/crm/preferences/crm-preference-registry.ts` — preference keys, each with its own value schema.
- `src/modules/crm/preferences/crm-preferences.service.ts`
- `src/app/api/v1/crm/preferences/route.ts`, `[key]/route.ts`, `route.test.ts`
- `src/components/crm/useCrmPreferences.ts` — load once, debounced silent save, flushed on unmount.
- `src/app/(dashboard)/crm/opportunities/_components/OpportunitiesWorkspace.tsx` — Board/List toggle.
- `src/app/(dashboard)/crm/opportunities/_components/OpportunityBoardClient.tsx`
- `src/app/(dashboard)/crm/opportunities/_components/useOpportunityFilters.ts` — shared filter definitions.
- `src/app/(dashboard)/crm/opportunities/_components/board-components.test.tsx`
- `src/modules/crm/opportunities/board-list.integration.test.ts`

**Changed:**

- `prisma/schema.prisma` — `CrmUserPreference` model, relations, board index.
- `crm-pipeline-insights.service.ts` — board: full filters, weighted value, average, per-column paging.
- `pipeline.schema.ts` — `boardQuerySchema`: `stageId`, `offset`.
- `opportunity.schema.ts` — `owner` sort field, bulk `update` action.
- `opportunity-filters.ts` — search by owner name, sort by owner.
- `crm-opportunities.service.ts` — bulk field update, labelled skips (visibility-scoped), bulk audit summary.
- `OpportunitiesListClient.tsx` — shared filters, persisted columns, default view, Update fields, per-record result.
- `OpportunityDialogs.tsx` — `BulkUpdateFieldsModal`, `BulkResultModal`.
- `opportunities/page.tsx` — renders the workspace.
- `CrmColumnPicker.tsx` — optional `label`.
- `CrmRecordDialogs.tsx` — `BulkResult.skipped[].label`, `operationId`.
- Tests: `pipelines.unit.test.ts`, `pipelines.integration.test.ts`, `opportunities.unit.test.ts`.

## 3. Database

One new table, `crm_user_preferences`: `id`, `company_id`, `user_id`, `key`, `value` (jsonb), timestamps.

- Unique on `(user_id, key)`, with an index on `company_id`. Foreign keys cascade with the company and the user.
- Why it exists: the ERP has no server-side user-preference store (the dashboard shell uses browser `localStorage` only). Board card fields, list columns and the default view must follow the user across devices.
- It holds presentation settings only, never business data. Unknown keys are rejected and each value is validated.

One new index, `crm_opportunities_board_idx` on `(company_id, pipeline_id, stage_id, stage_changed_at)`.

- It serves the board's per-column page query (`WHERE company/pipeline/stage … ORDER BY stage_changed_at DESC`) and the grouped totals.
- No other index was added.

No other tables or columns.

## 4. APIs

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/crm/pipelines/{id}/board` | Every list filter param plus `search`.<br>`perStage` (default 20), `stageId` + `offset` load one column's next page.<br>The legacy `status=OPEN\|ALL` and `ownerUserId` params still work. Default is open deals only. |
| POST | `/api/v1/crm/opportunities/{id}/stage` | Unchanged (Phase 07). Used for every drop. |
| GET | `/api/v1/crm/opportunities` | Search now includes the owner name; `sortBy=owner`. |
| POST | `/api/v1/crm/opportunities/bulk` | New `action: "update"` with `fields: { sourceId?, expectedCloseDate?, customFields? }`, strict.<br>Every bulk result now returns `skipped[].label` and `operationId`. |
| GET | `/api/v1/crm/preferences?prefix=` | The signed-in user's own preferences (`crm.view`). |
| PUT / DELETE | `/api/v1/crm/preferences/{key}` | Body `{ value }`. Always the signed-in user. |

The board response per stage contains `{ id, name, sortOrder, probability, isDefault, archived, requiredFields, count, values: [{ currencyCode, total, weighted, average }], records, hasMore }`.

## 5. Board implementation

**Pipeline and filters**

- The pipeline selector lists active pipelines only. The last choice is remembered (`opportunities.board.pipelineId`).
- Search and filters are the List's filters (owner, stage, status, company, contact, source, tags, closing, expected close, value, probability, origin, created, updated).
- Filters are applied server-side and kept in the URL, so switching Board ↔ List keeps them.

**Columns**

- Columns appear in stage `sortOrder`. An archived stage only appears while records still point at it.
- Each header shows the count, value, weighted value (Σ amount × probability) and average per currency.
- Header totals come from one grouped query over the filtered, visible set, never from the loaded cards.
- A summary line above the columns shows the board total.
- Each column loads 20 cards. "Load more (n)" fetches that column only (`stageId` + `offset`) and de-duplicates.

**Cards**

- Each card shows its name, number and the chosen fields. Available fields: company, contact, value, probability, expected close (with an overdue hint), owner, tags, status, source, last activity, created, and any active custom field (`cf:<key>`).
- The field choice is saved to `opportunities.board.cardFields`.
- The card action menu offers Open, Edit, Change stage (existing modal, which pre-validates on the server), Assign owner and Archive. The card name links to the detail page.

**States and layout**

- Loading: the board stays visible while it refreshes.
- Empty: a message for the board, plus a per-column hint.
- Errors: shown with "Try again". With no active pipeline, the board links to Settings.
- On tablets and wider, columns scroll horizontally. Below `md`, a Stage picker shows one full-width column.

## 6. Stage transition integration

- A drop sends `POST /opportunities/{id}/stage` with `{ stageId, pipelineId, version }`. The frontend checks nothing except "different column".
- **Optimistic:** the card moves at once and shows "saving…". It can't be dragged again until the server answers.
- **Success:** a toast confirms the move and the board reloads, so counts and values come from the server.
- **422 `CRM_STAGE_TRANSITION_BLOCKED`:**
  - The card goes back to its exact original position and the counts are restored.
  - A dialog lists the server's reasons and missing fields (labels from Phase 07), with **[Open Opportunity]**.
- **409 `RECORD_VERSION_CONFLICT`:**
  - The card is rolled back.
  - The dialog shows "This opportunity was updated by another user. Please refresh and try again." with **Refresh board**.
- **Anything else** (closed deal, permission, network failure): the card is rolled back and the server's message is shown.
- Stage history, probability rules and `opportunity.stage_changed` events are all Phase 07's. Nothing is duplicated.

## 7. Bulk behaviour

Available from the List: Assign, Change stage, Change status, Add/Remove tags, **Update fields** (new), Archive.

**How each action runs**

- **Change stage:** each record goes through the Phase 07 engine (`bulkChangeStage`); blocked records report what is missing.
- **Update fields:** only source, expected close date and custom fields can be changed (strict schema). Custom fields merge with the existing values.
- Each record is saved through `updateOpportunity`, with validation, version, its own audit row and timeline event. One record failing never stops the others.

**What the user sees**

- Partial results open a dialog listing each skipped record with its reason. Each record is shown as "OPP-… — name", linked to it.
- Records outside the user's visibility show "Not available": their names are never revealed.

**Audit summary**

Every bulk call writes one `audit_logs` row:

- `tableName` is `crm_opportunities` and `recordId` is the `operationId`.
- The actor and timestamp are recorded.
- `newValues` holds `{ bulkOperation, requested, updated, failed, opportunityIds, failures: [{ id, reason }] }`.

## 8. Saved views

- Users can create (PRIVATE or SHARED), open, update (own views), delete (own views) and **Set as my default**.
- The default is stored per user in `opportunities.list.defaultViewId`. "All opportunities" can also be the default.
- The default view opens on load unless the URL already has a search or filters, so shared links win.
- Deleting your default view clears the preference.
- Columns:
  - With no view open, the column choice is remembered (`opportunities.list.columns`).
  - A view keeps its own columns.

## 9. Testing

- **Unit:** preference registry (keys, value shapes); bulk `update` schema (safe fields only, at least one); owner search and sort; board query defaults.
- **Route:** preference routes (permissions; always the signed-in user).
- **Integration** (`board-list.integration.test.ts`, real Postgres):
  - preferences: per-user isolation, upsert, stale values ignored;
  - board: columns, totals, weighted and average values, visibility, tag/amount/owner-name/legacy filters, pipeline isolation;
  - column paging without duplicates;
  - the drop path: required fields block, stale version conflicts, history is recorded;
  - bulk update: custom-field merge, per-record skips, hidden-record labels not leaked, audit summary;
  - bulk stage through the engine; owner sort.
- **Component** (`board-components.test.tsx`):
  - columns and header totals, configurable and custom-field card fields;
  - drag success (body includes the version), optimistic placement, then reload;
  - 422 rollback to the original position with missing fields and the Open link;
  - 409 rollback with the conflict message; network-failure rollback;
  - same-column drop does nothing; no dragging without edit rights;
  - per-column Load more; preference saving; load error; bulk update and bulk result dialogs.
- **Regression:** the full suite passes (154 files, 2,469 tests) with the integration DB. This covers Phases 02–07 and 09.
- **Checks:** `tsc` is clean. `eslint` reports 0 errors (the 12 warnings are pre-existing, in AI modules).
- **Databases:**
  - Fresh database: every migration plus the seed.
  - Upgrade from Phase 09: the new migration only; data counts unchanged.
- **Browser (Chromium, real pointer drags):**
  - board totals; valid drag (history recorded);
  - blocked drag (dialog shows "Estimated value", the card stays put, server unchanged);
  - conflict rollback; server-side search;
  - persisted card fields;
  - bulk stage with a per-record report;
  - bulk update of the close date;
  - saved default view;
  - mobile single-column layout.
  - No page errors.

## 10. Limitations

- **Cards:** the order within a column is "most recently moved first". There is no manual reordering inside a stage, since no rank column exists.
- **Moving and refresh:**
  - Drag and drop moves within one pipeline. Moving to another pipeline uses the existing Transfer action on the detail page.
  - After a move, the whole board reloads its first pages, so extra pages loaded with "Load more" collapse back.
  - The board does not auto-refresh when someone else changes a record; the version check catches it on the next move.
- **Totals and filters:**
  - Totals are per currency; there is no FX conversion to a base currency.
  - Average counts only records that have a value.
  - The board's Status filter defaults to open deals and takes one status at a time (the shared filter control is single-select).
- **Saved views on the board:** the board uses the URL filters; it doesn't open saved views directly. Open a view in the List, then switch to Board.
- **Bulk field update:** source, expected close date and one custom field per run. Owner, stage, status and tags use their own bulk actions.
- **Accessibility:** keyboard users change stages with the card menu's "Change stage", not by dragging.

## 11. Extension points

- **New preferences:** add a key and schema in `crm-preference-registry.ts`; the API and `useCrmPreferences` need no other change.
- **New card fields:** add an entry to `BASE_CARD_FIELDS`. Custom fields appear automatically.
- **Activity indicators on cards:** Phase 09 data (next task, overdue count) can be added as card fields; this needs a count added to the board select.
- **More bulk actions:** add a schema variant in `bulkOpportunitySchema` and a branch in `bulkOpportunityAction`. Audit summary and labels come for free.
- **Board for other entities:** the `getPipelineBoard` pattern (grouped totals plus per-column pages) and `moveFailureNotice` can be reused.
- **Live updates:** the board's `reload()` is the hook for a future event stream or polling.

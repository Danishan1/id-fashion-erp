# Phase 21: CRM Operational Dashboard

Status: implemented on 2026-10-14. `/crm` replaces the Phase 01 shell (activity feed only) with a working dashboard. Each user can customise it.

**Inspection note.** There was no Phase 20 audit document in the repository or the project. The inspection below was done as part of this phase.

## 1. What was reused

| Need | Reused | Not created |
|---|---|---|
| Lead / opportunity counts and drill-downs | `buildLeadWhere`, `buildOpportunityWhere`, `leadFilterSchema` / `opportunityFilterSchema`, `leadFilterToParams` / `opportunityFilterToParams` | A second filter language. A number and its list link use the **same** filter object, so they always agree (tested). |
| Record visibility | `getCrmRecordScope` / `crmOwnerWhere` (crm.view = own, crm.view_all = everyone) | — |
| Tasks, follow-ups, appointments | `buildActivityWhere`, `dueFilterWhere`, `buildAppointmentWhere`, `CrmActivityRepository`, `labelsFor` / `presentActivity` | — |
| Recent activity | `crm_events` via `CrmEventRepository` + `presentCrmEvent` (same visibility rule as the company feed) | A second activity store |
| Pipelines and stages | `listPipelines` (active pipelines and stages, configured order and probability) | Hardcoded stages |
| Automation health | `crm_workflow_executions`, `bulk_jobs`, `crm_ingest_events`, `crm_messages`, `crm_channels` (counts only) | A monitoring table |
| Per-user customisation | CRM user preferences: new keys `dashboard.layout` and `dashboard.filters` | A settings table |
| UI | `CrmBadge`, `Button`, `Modal`, `FormField`, `ActivityComposer`, `ActivityDetailModal`, `CrmRecordPicker`, `ClientDateTime`, `formatCurrency` | A chart library (none is installed; the charts are small HTML components) |

## 2. API

`GET /api/v1/crm/dashboard` requires crm.view, and returns `Cache-Control: no-store`. It accepts:

- `range`: `today` | `7d` | `30d` | `month` | `custom`
- `from`, `to`: `YYYY-MM-DD` dates, for `custom` only (at most 366 days)
- `pipelineId`: defaults to the default active pipeline
- `owner`: `all` | `me` | `<userId>` (another user needs crm.view_all, otherwise 403)
- `widgets`: the visible widgets only; hidden ones are not computed

The response is:

```
{ generatedAt, timeZone: "Asia/Kolkata",
  filters: { range: { key, from, to, label, days }, owner, pipelineId, pipelineName },
  viewer: { viewAll, settingsView },
  widgets: { <key>: { status: "ok", data } | { status: "error", message } } }
```

- **Filter errors.** Invalid filters fail the whole request with a 400 and a clear message. This covers an unknown pipeline, a reversed or too-long range, an unknown widget, and an owner the user may not pick.
- **Widget errors.** Each widget is computed independently, in parallel. A failing widget returns its own `error` with a generic message, and the details are logged on the server. The rest of the dashboard still renders.
- **Aggregation.** Everything is done in the database: `count`, `groupBy`, and one grouped SQL query per time chart. Lists are capped at 5 to 12 rows. There are no per-row queries; activity labels are looked up in one batched query.
- **Speed.** Measured with 20,000 leads (dev server, every widget): about 200–260 ms.

### Supporting changes, needed for exact drill-downs

- **Lead filter `neverContacted`** (`?neverContacted=true`, meaning `lastContactedAt IS NULL`). It is also a "Contacted: Never contacted" filter in the lead list.
- **Lead list filter "Status group"** (`statusKinds`). It already existed in the API but was not in the UI.
- **Opportunity filter `closedAt`** (`?closedAtFrom=&closedAtTo=`). It is also a "Closed (won / lost)" date filter in the opportunity list.
- **Activities page URL parameters.** `/crm/activities?view=overdue|today|upcoming|completed&assignee=<userId>` opens that quick view for that assignee.
- **Workflows page URL parameter.** `/crm/workflows?new=1` opens "New workflow" for users with crm_settings.edit.
- **`RECORD_TYPES` exported from `ActivityComposer`.** It is reused by the quick "Add note" dialog.

## 3. Widgets, definitions and data sources

All periods are business days in **Asia/Kolkata**, the CRM's time zone; a lead created at 00:10 IST belongs to that day. Cards are labelled **Now** (a current total), **In period** (the selected range) or **Next 7 days**. Every value is a link to the matching list.

| Widget | Metric | Definition | Source |
|---|---|---|---|
| **Key figures** | Active leads (Now) | Status kind OPEN, not archived | `crm_leads`, `buildLeadWhere` |
| | New leads (In period) | Created in the range, archived ones included | same |
| | Open opportunities (Now) | Status OPEN in the selected pipeline | `crm_opportunities`, `buildOpportunityWhere` |
| | Open pipeline value (Now) | Sum of `amount` of those opportunities **per currency**. It is a CRM estimate, never an ERP order or invoice, and never summed across currencies. | same |
| | Won (In period) | Status WON with `closed_at` in the range: count and value per currency | same |
| | Overdue tasks (Now) | Open activities past their due time (all-day tasks: due before today) | `crm_activities`, `dueFilterWhere("overdue")` |
| | Follow-ups passed (Now) | Open-status leads whose next follow-up date is before today | `crm_leads` |
| | Appointments (Next 7 days) | Scheduled, confirmed or rescheduled appointments starting in the next 7 days | `buildAppointmentWhere` |
| **Pipeline** | Open by stage | Count and value per currency for each active stage, in the configured order | `crm_opportunities` grouped by stage |
| | Won / lost over time | Per day (ranges up to 45 days) or per Monday-week, by `closed_at` | SQL grouped by business day / week |
| | Win rate | won ÷ (won + lost + abandoned) closed in the period | grouped by status |
| **Leads** | New leads per day | Trend for the range, empty days shown as 0 | SQL grouped by business day / week |
| | By source | Leads created in the range, per source | `groupBy sourceId` |
| | By status | Current (non-archived) leads per configured status | `groupBy statusId` |
| **Leads needing attention** | Never contacted | Open-status leads with no last-contacted date (count and 5 oldest) | `crm_leads` |
| | Follow-up passed / today | Next follow-up before today / today (count, plus the 5 most overdue) | same |
| | Recently updated | The 5 most recently updated leads | same |
| **My work** | Overdue / Due today / Next 7 days / Upcoming appointments / Recently completed | Activities assigned to me (or to the owner the manager selected). Counts plus 5 items, each with type, related record, assignee, due date and priority. Clicking an item opens the activity, and the related record is linked. | `crm_activities` |
| **Recent activity** | Last 12 milestone events in the range | Allowlist: lead created / converted / status changed, opportunity created / stage changed / won / lost, task completed, call / meeting logged, appointment booked / cancelled / completed / no-show, conversation created, message received / failed. Users without view_all see only their own actions (the same rule as the company feed). | `crm_events` |
| **Automation & integrations** | Workflow runs in the period: completed, failed, running or waiting now, cancelled; the last 5 failures (workflow, short reason, link) | crm_settings.view only. Only the first line of the error, at most 160 characters; never payloads. | `crm_workflow_executions` |
| | Bulk jobs: in progress; failed or with errors in the period | Own jobs (or every job for crm_settings.edit) | `bulk_jobs` |
| | Failed / flagged lead captures, outbound messages not sent, paused channels | crm_settings.view only | `crm_ingest_events`, `crm_messages`, `crm_channels` |
| **Quick actions** | Create task, Log a call, Schedule appointment, Add note (needs crm.create); Add lead / contact / company, Create opportunity, Import leads (needs crm.create); Create workflow (needs crm_settings.edit) | Only the actions the user can perform are shown. Tasks, calls and appointments open the CRM's own activity composer; notes open a record picker plus a note box. | permissions from `getCrmPageContext` |

**Filters** sit in one row and apply to every widget:

- **Period**: Today, Last 7 days, Last 30 days (default), This month, or a custom range. An invalid custom range is flagged and never requested.
- **Pipeline**: shown only when there is more than one.
- **Owner**:
  - with view_all: Everyone, Owned by me, or a specific user;
  - otherwise: All my records or Owned by me.

The opportunity widgets follow the pipeline. Every widget follows the owner. My work follows a selected owner, otherwise it shows the viewer's own work. The header shows "Updated hh:mm · range · IST" and has a Refresh button. During a refresh the previous numbers stay on screen, dimmed, and an answer to an older request is never shown over a newer one. A preset period, the pipeline and the owner are remembered as the user's defaults.

**Customise** is a side panel where the user can:

- show or hide each widget;
- move widgets up and down;
- set half or full width;
- reset to the default layout.

The layout is saved per user. A saved layout keeps working when widgets are added or removed later: unknown keys are dropped and new widgets appear at the end.

**Accessibility:**

- Every card and list row is a real link or button with a visible focus ring.
- Charts have an `aria-label` summary, keyboard-focusable periods with a tooltip, and a "Show as table" view.
- Bar lists always show their values as text.
- Warnings use an icon and a label, never colour alone.
- The two-series colours (blue / orange) were validated for colour-blind separation in light and dark.

**Responsive:** one column on phones and tablets, two on desktop (full-width widgets span both). There is no horizontal scroll at 390 px or 820 px (tested).

## 4. Tests

| File | Covers |
|---|---|
| `src/modules/crm/dashboard/dashboard.integration.test.ts` (8, real Postgres, isolated company) | See the list below this table. |
| `src/modules/crm/dashboard/dashboard.unit.test.ts` (4) | Range presets in IST (including the UTC late-evening day change and the first of the month), custom-range validation, query parsing (unknown widget / owner / range refused), preference schemas |
| `src/components/crm/dashboard/dashboard-components.test.tsx` (8) | KPIs with scope labels and links, per-currency money, the warning icon, widget error isolation, one request for the visible widgets, stale responses ignored, defaults saved, owner choices by permission, invalid custom range not requested, customise (hide / move / resize / reset), layout resolution, chart tooltip / table / empty state, permission-aware quick actions, whole-request failure |
| `/tmp/claude-0/e2e/verify-dashboard.mjs` (browser, seeded disposable DB, 35 checks) | See the list below this table. |

What the database integration test covers:

- every KPI value against known fixtures, including archived records and closed dates;
- every drill-down link re-counted through the list API parser (KPIs, stages, sources, statuses, never-contacted);
- IST day boundaries (00:10 vs 23:50);
- custom range and weekly buckets;
- the owner filter, a rep's restricted visibility, and a refused foreign owner;
- pipeline stages and won / lost / win rate;
- an unknown pipeline refused;
- attention lists and the event allowlist;
- automation hidden without CRM settings access;
- requested-widgets-only;
- an empty company showing zeros with no errors.

What the browser e2e covers:

- data created through the real APIs;
- KPI values, per-currency value, won value;
- no widget errors;
- the drill-down list total equal to the KPI;
- period and owner filters, and My work following the owner;
- customise, persistence after reload, and reset;
- the composer quick action and the keyboard focus ring;
- no overflow at 820 px and 390 px;
- a MERCHANDISER user: own records only, health hidden, another owner refused with 403, only own owner options, no "Create workflow", their overdue and today tasks;
- no page errors.

Regression: full unit suite 2,613 passed; type-check clean; lint clean on changed files. All integration suites pass. The one failure in the first run was `lead-import`'s branch-numbering test, which fails only because the test database had no branch row. After adding a branch to that test database it passes (18/18). This is unrelated to the dashboard.

## 5. Known limitations and omitted metrics

- **No "team" filter.** The ERP has no sales-team model (departments belong to HR employees, not CRM users). The owner filter covers a single person.
- **No "conversion rate" or "stage conversion" chart on the dashboard.** The reliable version exists in the pipeline report (`getPipelineReport`, Phase 07), based on stage history. A dashboard version filtered by owner and period would need a separate definition, so it was left out rather than shown approximately.
- **No revenue from ERP orders or invoices.** Opportunity values are labelled as estimates. ERP-linked revenue belongs to the reports phase.
- **Fixed time zone.** All days use Asia/Kolkata, as everywhere else in the CRM. A per-user time zone is not applied to the dashboard.
- **Follow-up lists use dates, not times.** "Follow-up passed" means a follow-up *date* before today; a follow-up earlier today is counted under "today".
- **Recent activity drill-down.** It links to the Activity log filtered by the same dates. The log's own visibility rule applies.
- **The Pipeline selector appears only with two or more active pipelines.**
- **The dashboard is not live-updating.** It refreshes on filter change, on Refresh, and after a quick action. There is no polling.

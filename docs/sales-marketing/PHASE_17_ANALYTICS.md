# Sales & Marketing — Phase 17 Advanced Reporting & BI (2026-11-06)

Spec: `docs/sales-marketing/ref/17.md`. Scope confirmed with the user on 2026-11-06:

- **Data layer: live governed queries.** No warehouse and no copies of source records. Every report runs hand-written, parameterised, bounded SQL (or an existing governed service) over the authoritative tables, with the source module's visibility rules and an 8-second statement timeout. Pre-aggregation was to be added only if the performance test showed a need — it didn't (§9).
- **Sharing: private, chosen users, or company.** Whoever opens a shared report runs it with **their own** permissions and record scope.
- **Delivery: per-recipient run** on the Phase 14 schedule engine. Each recipient's copy is generated with that recipient's permissions. Delivery is an in-app notification plus a private, expiring (7-day) download; there are no email attachments. A recipient without access is skipped and the skip is logged.
- **Permissions: a new module, `sales_analytics`.**
  - view: run reports and dashboards;
  - create: save reports;
  - edit: share and schedule;
  - export: CSV / Excel.

  Every metric still needs its source module's permission, and drill-down re-checks it.

Out of scope (Phase 18): AI insights, predictions, natural-language analytics and recommendations. Also excluded: free-form SQL or formulas, financial posting, and a second scheduler, notifier or export framework.

## 1. Existing infrastructure reused, and what is new

| Need | Existing | Phase 17 |
|---|---|---|
| Booked / invoiced rules | Phase 05 `bookedOrderSql` / `bookedOrderWhere`, `BOOKED_ORDER_STATUSES`; invoiced = POSTED, PARTIALLY_PAID, PAID, CLOSED | Used as-is in the orders, invoices and funnel datasets. The order-value reconciliation uses `bookedOrderWhere` |
| Attribution / ROI | Phase 13 `attributionReport` (default model, current run, record scope) and Phase 12 actual spend | The `campaigns` dataset **wraps** `attributionReport`, so its numbers equal the Attribution & ROI screen. Ratios are recomputed from summed parts |
| Targets | Phase 05 `listTargets` + `targetActual` | The `targets` dataset wraps `listTargets(status: approved)` |
| Record scope | Enquiry team scope (`getSalesEnquiryScope`), quotation CRM scope (`crmOwnerSql`), branch scope (`PermissionService.getAllowedBranchIds`) | Applied inside every dataset's base query (§4) |
| Report Center | 75 reports incl. 13 S&M reports, CSV / Excel / PDF exports | Left unchanged. Analytics is the governed, cross-module layer; the Report Center keeps its fixed operational reports |
| Schedules | Phase 14 bulk schedule engine (owner-run jobs, no overlap, failure pause, audit) | New bulk entity `SM_ANALYTICS_REPORT` + schedulable action `analytics_report.deliver`. No new scheduler |
| Files | `saveFile` / `readStoredFile` (private storage, content sniffing), `buildSafeCsv`, `sanitizeSpreadsheetCell`, `exceljs` | Report files are built with these. No new export framework |
| Notifications | `createNotification` (in-app) | Delivery notice to each recipient |
| Worker | `sales-workflows` BullMQ queue | New hourly `sm-analytics.tick` (retention) on the same queue |

New code: `src/modules/sales-marketing/analytics/`:

| File | Purpose |
|---|---|
| `analytics-registry.ts` | Client-safe: datasets, metrics, limits, query schema, ratio / comparison helpers |
| `analytics-datasets.ts` | Parameterised SQL dataset bases |
| `analytics-service-datasets.ts` | Campaign and target datasets |
| `analytics-engine.ts` | Validation, aggregation, comparison, reconciliation and drill-down |
| `analytics-labels.ts` | Labels for dimension values and periods |
| `analytics-freshness.ts` | Freshness statuses |
| `analytics-periods.ts` | Relative periods |
| `analytics-export.ts` | CSV / Excel files |
| `analytics-reports.service.ts` | Saved reports, versions, sharing, run log, usage |
| `analytics-delivery.service.ts` | Per-recipient delivery, downloads, schedules |
| `analytics-bulk.ts` | Phase 14 registration |
| `analytics-dashboards.ts` + `.service.ts` | The four standard dashboards |
| `analytics.service.ts` | Catalogue, filter options, export |
| `analytics-maintenance.ts` | Retention |

New tables (migration `20261112090000_sm_analytics_phase17`; rollback `prisma/rollback/20261112090000_sm_analytics_phase17.down.sql`):

| Table | Purpose |
|---|---|
| `sm_analytics_reports` | Saved report definition (JSON, validated against the registry — never SQL), sharing PRIVATE / USERS / COMPANY, shared users, recipients, delivery format, optimistic `version`, soft delete |
| `sm_analytics_report_versions` | One row per saved change of the definition or name |
| `sm_analytics_runs` | Run log: user, source (INTERACTIVE / DASHBOARD / DRILL / EXPORT / DELIVERY), dataset, metric ids, row count, duration, status OK / DENIED / FAILED, slow flag. **No result data.** 90-day retention |
| `sm_analytics_deliveries` | One row per delivery run and recipient (unique `run_key` + recipient): DELIVERED / SKIPPED / FAILED, reason, private file key, expiry (7 days), downloaded-at |

Permission rows for `sales_analytics` are added by the migration:

| Role | Actions |
|---|---|
| SUPER_ADMIN | all |
| MANAGEMENT | view, create, edit, export |
| MERCHANDISER | view, create, export |
| VIEWER | view |

The module also appears in `rbac.ts`, permission groups, module entitlements, the S&M route type and the S&M navigation (Analytics).

## 2. Architecture

```
UI (/sales-marketing/analytics) ──► /api/v1/sales-marketing/analytics/*  (salesMarketingRoute: session → sales_analytics.<action>)
        │                                   │
        │                         validateQuery (zod + registry: dataset, metrics of THAT dataset, its dimensions, ≤731 days)
        │                         metricAccess  (each metric's extra source-module permission; hidden metrics are listed, never 0)
        │                                   │
        │             ┌─────────────── SQL datasets ──────────────┐     service datasets
        │             │ base(ctx) = parameterised SELECT with the │     campaigns → attributionReport (Phase 13)
        │             │ dataset's permission + record scope, or   │     targets   → listTargets (Phase 05)
        │             │ null (= "you can't see this")             │
        │             │ SELECT keys, SUM(parts) FROM (base) t     │
        │             │ GROUP BY keys  — ratios from summed parts │
        │             │ SET LOCAL statement_timeout = 8000        │
        │             └───────────────────────────────────────────┘
        │             totals = an ungrouped query (never a sum of rows); comparison = same query, shifted period
        │             reconciliation (orders / invoices) = independent Prisma aggregate on the source table
        └──► result: columns (metric id + version), rows (ids + labels), totals, compare/change, freshness, reconciliation, run log row
```

The client sends only registry keys: dataset, metric ids, dimension keys, filter **values** (bound as parameters), a grain, dates or a preset. It can never name a table, column, function or formula. Unknown keys in the query are refused (`.strict()`).

## 3. Metric registry and metric definitions

Each metric has the following fields:

- id and version;
- label, description, purpose and formula;
- numerator and denominator, for ratios;
- unit and aggregation (sum, count, ratio or avg);
- extra permissions;
- limitations, "not to be confused with", and higher-is-better.

The same registry drives the builder, the dashboards, exports, the glossary tab and the API catalogue.

Rules:

- **One dataset per metric.** A report uses one dataset, so metrics of different grains can never be mixed. The engine refuses a mix with a clear message.
- **Versions.** A change to a formula means a new version. A version can be marked `retired` (with `replacedBy`): it is refused with a message naming it, and a saved report using it must be edited. Every result, export and delivery lists the metric ids and versions it used.
- **Ratios** (acceptance rate, ROI, ROAS, attainment, success and failure rates, average order value, cost per order, budget use) are always recomputed from **summed parts**: in each row, in the totals and in the comparison. They are never averaged. A zero denominator gives **n/a** (null), never 0.
- **Money.** These values are never presented as each other:
  - revenue: booked order value, invoiced before / after GST;
  - cash collected;
  - quoted / accepted value;
  - attributed revenue;
  - spend;
  - budget;
  - targets.

  No profit metric exists (no cost-of-goods source); ROI is labelled **revenue-based**.

Executive KPIs (the Executive dashboard), with source and caveat:

| KPI | Calculation | Source | Caveat |
|---|---|---|---|
| Booked order value | SUM(sales_orders.base_total_amount) for booked statuses (Phase 05 rule: Confirmed onward, or On hold from a booked status), by order date | sales_orders | Total incl. charges as stored; reconciled against the source table |
| Invoiced value (before GST) | SUM(ROUND(subtotal × exchange rate, 2)) of posted invoices, by invoice date | sales_invoices | Revenue, not cash; no credit notes in the ERP |
| Cash collected | SUM(payments.amount) of posted customer receipts, by payment date | payments | Receipts, not allocations to specific invoices |
| Quoted value | SUM(taxable total) of issued quotation revisions, by IST issue date | quotation_revisions | A revised quotation counts once per issued revision |
| Enquiry funnel | Enquiries of the period counted once per stage reached | buyer_enquiries + activities, quotations, orders, invoices | Cohort: later stages may happen after the period; stages are hidden without their module's permission |

Full metric guide (generated from the registry):

### Enquiries (`enquiries`)

Grain: **one row per enquiry**. Source: buyer_enquiries (+ buyer_enquiry_activities for qualification history, quotations for quoting). Needs `sales_marketing.view`. Dates: Enquiry date — The enquiry's own business date. Dimensions: Period, Current stage, Source, Priority, Owner, Sales channel, Customer or prospect. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Enquiries received (`enquiry_count`, v1) | COUNT(enquiries) | Includes enquiries later cancelled in Merchandising. Not the same as: CRM leads (a separate CRM record), Qualified enquiries. |
| Qualified enquiries (`qualified_enquiry_count`, v1) | COUNT(enquiries with a STAGE_CHANGED → QUALIFIED activity) | Enquiries that went straight to a quotation without being marked Qualified are not counted here. Not the same as: Enquiries received. |
| Enquiry → quotation rate (`enquiry_quotation_rate`, v1) | quoted enquiries ÷ enquiries received | Recent enquiries may not have had time to be quoted. |

### Issued quotation revisions (`quotations`)

Grain: **one row per issued quotation revision (a revised quotation counts once per issued revision)**. Source: quotation_revisions (issued_at set) joined to its quotation (n:1). Needs `sales_quotations.view`. Dates: Issue date — When the revision was issued (India date); Decision date — When the customer's acceptance or rejection happened (India date); undecided revisions have none. Dimensions: Period, Customer decision, Owner, Sales channel, Customer. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Quotation revisions issued (`quotation_issued_count`, v1) | COUNT(revisions with issued_at) | — |
| Quoted value (before GST) (`quoted_value`, v1) | SUM(revision.taxable_total) | Company base currency Not the same as: Accepted value, Booked order value. |
| Revisions accepted (`quotation_accepted_count`, v1) | COUNT(revisions with status ACCEPTED) | Use the Decision date time field to count by when the customer decided. |
| Accepted value (before GST) (`accepted_value`, v1) | SUM(taxable_total WHERE status = ACCEPTED) | Company base currency Not the same as: Booked order value (an accepted quotation is not an order until converted). |
| Revisions rejected (`quotation_rejected_count`, v1) | COUNT(revisions with status REJECTED) | — |
| Quotation acceptance rate (`quotation_acceptance_rate`, v1) | accepted ÷ (accepted + rejected) | With the Issue date time field, recent periods have few decisions yet. |

### Booked Sales Orders (`orders`)

Grain: **one row per Sales Order**. Source: sales_orders (Phase 05 booked rule), base_total_amount. Needs `sales_orders.view`. Dates: Order date — The order's business date. Dimensions: Period, Sales rep (credited), Territory, Sales channel, Customer, Campaign set on the order (direct link, not attribution), Origin, Status. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Sales Orders booked (`booked_order_count`, v1) | COUNT(booked orders) | — |
| Booked order value (`booked_order_value`, v1) | SUM(sales_orders.base_total_amount) | Company base currency An order cancelled later drops out of past periods. Not the same as: Invoiced value, Cash collected, Accepted quotation value. |
| Average order value (`avg_order_value`, v1) | SUM(base_total_amount) ÷ COUNT(orders) | Company base currency |

### Sales invoices (`invoices`)

Grain: **one row per sales invoice (an order with several invoices appears several times — never joined back to order value)**. Source: sales_invoices (Phase 05 invoiced statuses: POSTED / PARTIALLY_PAID / PAID / CLOSED). Needs `accounts.view`. Dates: Invoice date — The invoice's accounting date. Dimensions: Period, Customer, Sales rep of the order, Payment status. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Invoices posted (`invoice_count`, v1) | COUNT(invoices) | — |
| Invoiced value (before tax) (`invoiced_value`, v1) | SUM(ROUND(subtotal_amount × exchange_rate, 2)) — identical to the Phase 05 INVOICED_VALUE target metric | Company base currency Credit notes / refunds are not recorded in this ERP yet, so this is gross of returns. Not recognised revenue: the ERP has no revenue-recognition schedule. Not the same as: Booked order value, Cash collected, Recognised revenue (not available). |
| Invoiced value (incl. tax) (`invoiced_value_incl_tax`, v1) | SUM(base_total_amount) | Company base currency |

### Customer receipts (`payments`)

Grain: **one row per posted customer receipt**. Source: payments (direction RECEIPT, status POSTED). Needs `accounts.view`. Dates: Payment date — The receipt's accounting date. Dimensions: Period, Customer. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Cash collected (`cash_collected`, v1) | SUM(payments.amount WHERE direction = RECEIPT AND status = POSTED) | Includes on-account receipts not yet allocated to an invoice. Not the same as: Invoiced value, Booked order value. |

### Enquiry funnel (cohort) (`funnel`)

Grain: **one row per enquiry (the cohort); each later stage is looked up per enquiry (counted once), never joined**. Source: buyer_enquiries → activities (qualified) → quotations / revisions (issued, accepted) → sales_orders (from that quotation) → sales_invoices → paid. Needs `sales_marketing.view`. Dates: Enquiry date — The cohort is defined by the enquiry date; later stages may happen after the period. Dimensions: Period, Owner, Sales channel, Source. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Received (`funnel_received`, v1) | COUNT(enquiries) | — |
| Qualified (`funnel_qualified`, v1) | COUNT(enquiries EXISTS qualified activity) | Not every process marks Qualified before quoting — the funnel isn't assumed to be linear. |
| Quotation issued (`funnel_quoted`, v1) — also needs `sales_quotations.view` | COUNT(enquiries EXISTS issued revision) | — |
| Quotation accepted (`funnel_accepted`, v1) — also needs `sales_quotations.view` | COUNT(enquiries EXISTS accepted revision) | — |
| Sales Order created (`funnel_ordered`, v1) — also needs `sales_orders.view` | COUNT(enquiries EXISTS non-draft, non-cancelled order with source revision of their quotation) | Orders entered directly (not from the quotation) can't be linked to the enquiry. |
| Invoiced (`funnel_invoiced`, v1) — also needs `accounts.view` | COUNT(enquiries EXISTS posted invoice of that order) | — |
| Paid (`funnel_paid`, v1) — also needs `accounts.view` | COUNT(enquiries EXISTS invoice status PAID / CLOSED) | Partly paid invoices don't count as paid. |

### Campaign performance (`campaigns`)

Grain: **one row per campaign (credit is already split between campaigns by the approved attribution model, so rows add up without double counting)**. Source: Phase 13 attribution report (marketing_attribution_credits of the current run) + Phase 12 actual spend + marketing_campaigns.planned_budget. Needs `marketing_attribution.view`. Dates: Conversion date — The business date of each credited conversion; spend by its own date. Dimensions: Campaign. Freshness: attribution.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Attributed revenue (`attributed_revenue`, v1) | SUM(credit weight × conversion value) for the campaign in the current run | Attribution, not proof of causation. Depends on the model and its last calculation (see freshness). Revenue, not profit. Not the same as: Booked order value, Profit. |
| Actual marketing spend (`marketing_spend`, v1) | SUM(approved expenses + posted purchase invoices linked to the campaign) | Committed (ordered, not invoiced) spend is excluded. Spend not linked to a campaign isn't counted. Not the same as: Planned budget, Committed spend. |
| Planned budget (`planned_budget`, v1) | SUM(marketing_campaigns.planned_budget) | Not pro-rated: compare with spend for the campaign's whole duration. |
| Budget utilisation (`budget_utilization`, v1) | actual spend ÷ planned budget | Meaningful when the period covers the whole campaign. n/a without a planned budget. |
| Revenue-based ROI (`campaign_roi`, v1) | (attributed revenue − spend) ÷ spend | Revenue-based, not profit-based (no cost of goods). n/a when spend is zero. Not the same as: Profit-based ROI (not available). |
| ROAS (`campaign_roas`, v1) | attributed revenue ÷ spend | n/a when spend is zero. |
| Credited orders (`credited_orders`, v1) | SUM(credit weight) for SALES_ORDER_BOOKED conversions | Fractional by design. |
| Cost per credited order (`cost_per_order`, v1) | spend ÷ credited orders | n/a without credited orders. |
| Messages delivered (`messages_delivered`, v1) | COUNT(MESSAGE_DELIVERED touchpoints) | Providers are not live-verified; SMTP has no delivery receipts. |

### Sales targets (`targets`)

Grain: **one row per target (its approved revision)**. Source: sales_targets / sales_target_revisions + Phase 05 targetActual (credited Sales Orders). Needs `sales_performance.view`. Dates: Target period — Targets whose own period overlaps the range. Dimensions: Target. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Target (`target_value`, v1) | approved revision target | Targets on a count metric are shown as counts. |
| Actual (credited) (`target_actual`, v1) | targetActual(target) | Uses the target's own period, not the report range. |
| Attainment (`target_attainment`, v1) | actual ÷ target | — |

### S&M workflows (`workflows`)

Grain: **one row per workflow instance**. Source: sm_workflow_instances (+ sm_workflow_step_runs for approval waits). Needs `sales_workflows.view`. Dates: Start date — When the workflow started (India date). Dimensions: Period, Workflow, Status. Freshness: workflow-events.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Workflows started (`workflow_count`, v1) | COUNT(instances) | — |
| Workflows completed (`workflow_completed`, v1) | COUNT(status = COMPLETED) | — |
| Workflows failed / needing attention (`workflow_problem`, v1) | COUNT(status IN (FAILED, NEEDS_ATTENTION)) | Current status, not history. |
| Average time to complete (`workflow_completion_hours`, v1) | AVG(completed_at − started_at) of COMPLETED | — |
| Average approval wait (`approval_wait_hours`, v1) | AVG(finished_at − started_at) of await_approval steps DONE | Only workflows with an approval step (quotation follow-up, campaign readiness). |

### S&M bulk jobs (`bulk`)

Grain: **one row per bulk job (item counts are per job)**. Source: bulk_jobs (S&M record types, dry_run = false). Needs `sales_marketing.view`. Dates: Created — When the job was requested (India date). Dimensions: Period, Record type, Action, Status. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Bulk jobs (`bulk_job_count`, v1) | COUNT(jobs) | Without sales_marketing_settings.edit you see your own jobs only. |
| Records processed (`bulk_items_processed`, v1) | SUM(processed_count) | — |
| Record success rate (`bulk_item_success_rate`, v1) | SUM(succeeded) ÷ SUM(succeeded + failed) | — |

### Outgoing S&M webhooks (`webhooks`)

Grain: **one row per delivery (one per subscription and event; retries are attempts of the same row)**. Source: crm_webhook_deliveries (event_source INTEGRATION, is_test false). Needs `sales_integrations.view`. Dates: Queued — When the delivery was queued (India date). Dimensions: Period, Event type, Status. Freshness: live.

| Metric (id, version) | Formula | Limitations |
|---|---|---|
| Webhook deliveries (`webhook_deliveries`, v1) | COUNT(deliveries) | — |
| Webhook failure rate (`webhook_failure_rate`, v1) | failed ÷ (delivered + failed) | Pending and cancelled deliveries are excluded. |

## 4. Dataset grain, joins, double counting and visibility

- **Grain.** Every dataset declares its grain (above), and every base query returns exactly one row per grain unit (`id, ref, tf, upd, d_<dimension>, p_<part>`). The engine only `SUM`s parts over those rows. It never joins two grains in one aggregate.
- **Funnel.** One row per enquiry of the period. Each stage is looked up **per enquiry** in a `LEFT JOIN LATERAL` that returns at most one row:
  - qualified = any STAGE_CHANGED → QUALIFIED activity;
  - quoted / accepted = any revision issued / accepted on any of its quotations;
  - ordered = a booked order made from one of its revisions;
  - invoiced / paid = that order's one active invoice is posted+ / paid.

  Two quotations or several orders still count once. This is tested: 2 issued revisions → `quotation_issued_count` 2 but `funnel_quoted` 1.
- **Invoices vs orders.** Invoice metrics live on the invoice dataset and order metrics on the order dataset. Invoice value is never joined back onto orders, and order value is never repeated per invoice.
- **Campaigns.** Credit is already split between campaigns by the approved attribution model (Phase 13). Rows add up to the total, and ROI is recomputed on the totals. The orders dataset's *Campaign* dimension is the order's own direct `campaign_id` link, labelled "direct link, not attribution".
- **Totals** come from an ungrouped query, so a row limit or hidden rows never change them.
- **Visibility.** It is applied inside each base query, with the viewer's own actor:

| Dataset | Rule |
|---|---|
| Enquiries / funnel | owner in the viewer's team (unowned: requester), unless `view_all`; plus branch |
| Quotations | CRM owner scope (`crmOwnerSql`) |
| Orders / invoices / receipts | allowed branches |
| Campaigns / targets | the wrapped service's own scope |
| Workflows | — |
| Bulk jobs | all S&M jobs for S&M admins, otherwise own |
| Webhooks | needs `sales_integrations.view` |

  Tenant isolation: every base filters `company_id = actor.companyId`, and every lookup (labels, options, saved reports, deliveries) is company-scoped.

## 5. Financial, currency and time handling

- **Currency.** Order, invoice and receipt amounts are the frozen base-currency amounts stored on each document (`base_total_amount`, `subtotal × exchange_rate`). Nothing is converted at today's rate. Quotation values are the revision's taxable total in the quotation currency; the company's quotations are in base currency today, and this is documented as a limitation. Every result and file states "Amounts in the company's base currency".
- **Time zone.** Asia/Kolkata. Business dates (enquiry, order, invoice, payment dates) are used as stored. Timestamps (quotation issue / decision, workflow start, job and webhook creation) are converted to India dates.
- **Grains.** Day, week (ISO Monday), month, quarter, year, **financial quarter / year**. Financial grains use `Company.fiscalYearStartMonth`, which is also used by Phase 05 targets. Labels look like "FY 2026-27" and "Q2 FY 2026-27".
- **Periods.** Fixed dates (inclusive, at most 731 days) or relative presets: last 7 / 30 days, this / last month, this / last quarter, calendar YTD, this / last financial year, last 12 full months. Presets are resolved on the server with the India date and the company's financial year, at each run. A saved "last month" report therefore moves forward.
- **Comparisons.**
  - previous period = the same length immediately before;
  - previous year = the same dates a year earlier (29 Feb → 28 Feb).

  Change % is null when the base is 0. When rows are grouped by period, only totals are compared, because periods can't be matched row by row.
- **Not available** (no source model in the ERP): credit notes / refunds, recognised revenue (vs invoiced), cost of goods / profit, forecast accuracy beyond Phase 06's own screen, and ad-platform spend that isn't recorded as an expense or invoice.

## 6. Dashboards

Four standard dashboards (`analytics-dashboards.ts`). Each widget is a governed query run with the viewer's own permissions for the chosen period preset.

| Dashboard | Default period | Widgets |
|---|---|---|
| Executive | This financial year | Booked order value, invoiced value (before GST), cash collected, quoted value (each vs previous period); bookings by month; enquiry funnel; top customers |
| Sales | This quarter | Enquiries, enquiry → quotation rate, quotation acceptance, average order value; bookings by rep and by channel; enquiries by stage; targets in the period |
| Marketing | This quarter | Attributed revenue, actual spend, revenue-based ROI, cost per credited order; campaign table; enquiries by source; bookings directly linked to a campaign |
| Operations | Last 30 days | Workflows started, workflows with a problem, bulk item success rate, webhook failure rate; workflows by type; bulk jobs by action; webhook deliveries by day |

How widgets behave:

- Widgets run one after another (bounded load) and fail independently.
- A widget whose data the viewer can't see shows **"Not available to you"** with the reason, never zero.
- Non-current freshness shows a badge on the widget.

## 7. Report builder, saved reports, sharing and drill-down

- **Builder** (Analytics → Report builder):
  - dataset (datasets without access are disabled and say why);
  - metrics of that dataset (up to 6; metrics without access are disabled with the reason);
  - up to 2 dimensions, a time grain when grouped by period, and the date field when a dataset has two (quotations: issued / decided);
  - period, comparison, and filters on the dataset's dimensions.

  Filter choices come from `/options`, company-scoped. Results show freshness, reconciliation, the metrics left out for lack of access, truncation, a chart and a table with totals.
- **Saved reports.**
  - A saved report is `{query, period: fixed | relative preset}`. It is validated on save and on every run.
  - Only the owner changes it (optimistic `version`; a stale save gets `RECORD_VERSION_CONFLICT`). Other users save a copy.
  - Every change of the definition or name writes a version row; every change is audited.
  - Saving needs `sales_analytics.create`. Sharing beyond "Only me" or adding recipients needs `.edit`.
  - People shared with, and recipients, must be active users of the company who can open Analytics.
  - Deleting is a soft delete: shared users lose the report and schedules stop delivering. The delivery history stays.
- **Sharing never widens access.** A shared report runs with the viewer's permissions and scope. Tested: a user without `accounts.view` opening a shared invoice report gets "permission denied", not the owner's numbers.
- **Drill-down** ("Records" on a row) re-runs the dataset's own base query **as the viewer**, filtered to that row's keys.
  - It returns up to 200 source records with reference, date, value and a link that opens the record in its module (which checks access again).
  - Funnel drill shows each enquiry's stages, limited to the stages the viewer may see.
  - Campaign and target rows link to the campaign or target.

## 8. Scheduled reports and delivery

1. The owner adds recipients and a format (Excel / CSV) to a saved report, then on the report clicks **Send now** or **Add schedule** (daily / weekly / monthly, HH:MM India time).
2. A schedule is a Phase 14 bulk schedule: entity `SM_ANALYTICS_REPORT`, filter `reportId=<id>`, action `analytics_report.deliver`. Each run is an ordinary bulk job started **as the owner**. Ownership and `sales_analytics.edit` are re-checked at every run; another user's filter resolves to nothing.
3. The job item runs the report once **per recipient**, as that recipient (their branch, team and permissions). For each recipient:
   - Not a company user, or can't open Analytics → **SKIPPED**, reason logged.
   - Can't see the dataset → **SKIPPED** with the reason.
   - Otherwise → the file is built, stored privately and a **DELIVERED** row is written (expiry +7 days). Metrics the recipient can't see are left out and noted. The recipient gets an in-app notification.
   - Any other error → **FAILED**. If nothing was delivered and something failed, the item fails, so the schedule's failure counter and auto-pause apply.
4. Idempotent: rows are unique on (run key, recipient), where the run key is the bulk item's idempotency key. A retried or recovered item never sends a second copy (tested: a second run gives `alreadyDone: 3`).
5. The recipient downloads from **Analytics → Deliveries**. The file is served only to that recipient, only until it expires, only while they can open Analytics, `Cache-Control: no-store`, and the download is audited.
6. The owner sees who received a copy and who was skipped (and why) — never the recipients' files.
7. Expired files are deleted hourly; the history row stays.

Pause, resume and remove go through the existing `/api/v1/bulk-schedules/[id]`. Schedules also appear on the Bulk Jobs page.

## 9. Exports

- `POST /export` (needs `sales_analytics.export`). The export is synchronous and bounded to the report's own rows (≤ 500) plus totals, run as the viewer. It is audited: format, dataset, metrics, row count, period and filter names.
- **Header block.** CSV: leading rows. Excel: an "About this report" sheet. It holds:
  - report name, dataset and grain;
  - period and comparison, filters;
  - time zone, currency, generated-at and for whom ("with their permissions");
  - freshness per source, the reconciliation result;
  - metrics left out for lack of access, a truncation note;
  - every metric's definition with its version.
- **Formula-safe.** Every text cell goes through `sanitizeSpreadsheetCell`: `= + - @ TAB CR` get a leading `'`. CSV is RFC 4180 with a BOM. Numbers stay numeric. Tested with `=HYPERLINK(...)`.
- Large background exports of records stay on Phase 14's bulk export. No second framework.

## 10. Freshness, reconciliation, data quality

Freshness is reported **per source**, never as one global timestamp:

| Source | Status | Details |
|---|---|---|
| Live datasets | CURRENT | Read at request time. Also reports the latest change of an included record |
| Attribution (campaign dataset) | REFRESHING | A run is queued or running |
| | FAILED | The newest run failed |
| | INCOMPLETE | The current run doesn't cover the requested range, or a touchpoint source hasn't synced for 36 h |
| | STALE | Calculated more than 36 h ago |
| | UNKNOWN | No calculation, or the viewer can't see attribution |
| | (always) | Actual spend is reported as live |
| Workflow dataset | STALE | The Phase 15 event reader is more than 10 min behind |

**Reconciliation.** For unfiltered order and invoice reports, the engine computes the total independently through Prisma on the source table (same booked / posted rule and branch scope) and shows "✓ checked" or "✗ does NOT match" with both figures. A mismatch is shown, never hidden. It is tested on fixtures and on 50k synthetic orders.

**Data quality made visible:**

- missing dimension values show as "Not set";
- metrics hidden for lack of access are listed;
- truncation is stated;
- n/a for an empty denominator;
- the funnel note that later stages may happen after the period.

**Known gaps:** see §5 "Not available"; providers not live-verified (Phase 10/16) are noted in metric limitations.

## 10a. Analysis features

| Feature | How | Assumptions / limits |
|---|---|---|
| Period-over-period, year-over-year | `compare` | Same definitions (metric versions shown); period-grouped rows compare totals only |
| Trend | group by period (any grain), line chart | Empty periods are not filled with zero rows |
| Funnel conversion | `funnel` dataset + funnel chart (% of previous stage) | Cohort by enquiry date |
| Target attainment | `targets` dataset | Target's own period, not the report range; value and count targets aren't summed together (total n/a) |
| Campaign / channel comparison | campaigns dataset; orders by channel | Attribution ≠ causation |
| Budget variance | budget utilisation = spend ÷ planned budget | Not pro-rated to the period |
| Ranking, top / bottom | sort by any metric (asc / desc), limit | — |
| Contribution % / Pareto | Not a separate metric: each row vs the total shown under it | Deferred: a contribution column (v2) |
| Outliers by rule | Not implemented in Phase 17 | Exception rules overlap Phase 18; documented, not built |
| Forecast accuracy | Stays on the Phase 06 Forecast screen | Not duplicated |

## 11. Performance

**Bounds:**

- range ≤ 731 days;
- ≤ 6 metrics, ≤ 2 dimensions;
- ≤ 500 rows (totals unaffected), ≤ 200 drill rows;
- `SET LOCAL statement_timeout = 8000` per query; a timeout gives a friendly "took too long — narrow the period …" (VALIDATION_ERROR, logged as FAILED).

**Monitoring.** Every run (interactive, dashboard widget, drill, export, delivery) writes a run-log row: duration, rows, status, and slow ≥ 2 s. S&M admins see runs, slow runs, denials, failures and average / max time per dataset on the **Usage** tab (`GET /usage`).

**Measured** (`analytics.performance.test.ts`, opt-in with `ANALYTICS_PERF=1`; sandbox Postgres 16):

The synthetic data:

- 50,000 enquiries (25,000 qualified, 20,000 quoted, 10,000 accepted and converted);
- 50,000 booked orders, 200 customers, 20 reps, two years;
- ~37,500 posted invoices.

| Report | ms |
|---|---|
| Orders total + reconciliation (2 years) | 129 |
| Orders by month vs previous period | 145 |
| Orders by customer × rep (top 500) | 105 |
| Orders by financial quarter | 95 |
| Invoices by customer + reconciliation | 182 |
| Enquiries by owner × month | 186 |
| Funnel, 50k enquiries, all stages | 950 |
| Funnel by owner | 890 |

**Bottleneck found and fixed by measurement.** The first funnel used correlated `EXISTS`, and the invoice check cast `status::text`, which defeats the partial index `sales_invoices(sales_order_id) WHERE status <> 'CANCELLED'`. It **timed out at 8 s** (> 60 s unbounded). A set-based GROUP BY variant was then mis-estimated into a nested loop (also > 60 s). The final form is per-enquiry `LEFT JOIN LATERAL` along index paths, with the invoice join written to match the partial index: **0.95 s**. No pre-aggregation or new index was needed; if volumes grow 10×, the funnel is the first candidate for a nightly summary.

## 12. API (`/api/v1/sales-marketing/analytics`, session + `sales_analytics.<action>`)

| Method & path | Action | Notes |
|---|---|---|
| GET `/catalog` | view | datasets, metrics (definitions, versions, your access), grains, presets, limits, dashboards, your abilities |
| GET `/options?dataset&dimension&search` | view | filter choices (company-scoped names) |
| POST `/run` | view | governed query; `preset` instead of from/to resolves on the server |
| POST `/drill` `{query, keys}` | view | source records of one row |
| POST `/export` `{query, title, format}` | export | file download |
| GET `/dashboards/{key}?preset=` | view | executive / sales / marketing / operations |
| GET, POST `/reports` | view / create | list (own + shared) / save |
| GET, PATCH, DELETE `/reports/{id}` (`?version=` on delete) | view / create | owner-only changes |
| POST `/reports/{id}/run` | view | as you |
| POST `/reports/{id}/send` | edit | owner; per-recipient delivery now |
| GET, POST `/reports/{id}/schedules` | view / edit | owner schedules on Phase 14 |
| GET `/deliveries` | view | yours + the log of reports you own |
| GET `/deliveries/{id}/download` | view | recipient only, until expiry |
| GET `/usage` | `sales_marketing_settings.edit` | usage and slow runs |

Errors use the standard envelope: VALIDATION_ERROR (400), PERMISSION_DENIED (403), NOT_FOUND (404), RECORD_VERSION_CONFLICT / INVALID_STATE_TRANSITION (409).

## 13. Security, privacy, audit

- No free-form SQL, formulas or code. Every identifier comes from the registry; values are bound parameters. A hostile filter value returns 0 rows; tested.
- Permission chain: `sales_analytics.<action>` → dataset module → each metric's extra modules → the dataset's record scope / branches → drill links re-checked by the record's module.
- Run-log rows hold no result data. Files are private storage, recipient-only, expiring and audited.
- Delivery is in-app only: no email attachments, no files to unauthorised recipients.
- Audit: saved report create / update / delete (with sharing and recipient changes), each delivery row, downloads, exports. Schedules have their own Phase 14 audit.
- No financial posting or source modification: the analytics layer only reads.

## 14. Tests and results

| Suite | What | Result |
|---|---|---|
| `analytics.units.test.ts` (16) | registry consistency (every metric implemented, ratio ↔ denominator, dimensions match), dashboards valid, validation (unknown / mixed / retired / bad dimension / range / unknown keys), presets and financial years, 29 Feb, fiscal grains and labels, ratio / n/a, ROI / ROAS / cost per order, freshness statuses, export header / table / formula-safety / XLSX, sharing visibility, definition schema | ✅ 16/16 |
| `analytics.integration.test.ts` (10, real Postgres) | every metric × dimension × grain runs; booked / invoiced values + reconciliation; comparison and change %; drill sum; validation and hostile filter; Analytics / dataset / metric permissions and tenant isolation; funnel once-per-stage and own-vs-all scope; saved reports (private, sharing needs edit, recipients need access, versions, conflict, owner-only, viewer's permissions, run log); delivery (per-recipient, skips with reasons, idempotent, notification, recipient-only download, expiry, purge, owner-only); schedules (owner-only, filter resolution, executeItem); dashboards incl. hidden widget | ✅ 10/10 |
| `analytics.performance.test.ts` (opt-in) | §11 workload, all reconciled | ✅ (timings above) |
| `sm-analytics-screens.test.tsx` (5) | dashboard KPI and hidden widget, builder (disabled dataset, preset sent, reconciliation shown), glossary search, deliveries (download only while valid, owner log), chart (units, n/a) | ✅ 5/5 |
| Regression | dashboard test (now "Planned · Phase 18"), foundation test (`sales_analytics` in the S&M path modules), full suite with the integration database | ✅ 342 files passed, 3 skipped; 4,390 tests passed, 10 skipped (Phase 16: 4,358) |

## 15. Acceptance criteria

| Criterion | Status |
|---|---|
| Existing reporting infrastructure inspected and reused | ✅ §1 (Phase 05 rules, Phase 13 / 05 services, Phase 14 schedules, storage, export helpers, notifications; Report Center unchanged) |
| Governed metric registry for implemented KPIs | ✅ 45 metrics, 11 datasets, versioned |
| Definitions with formulas, sources, limitations | ✅ §3, glossary tab, every export |
| Sales and marketing dashboards accurate and labelled | ✅ 4 dashboards; numbers equal the builder and the source screens (campaigns wrap Phase 13) |
| No double counting across grains | ✅ §4; tested (funnel, invoices vs orders) |
| Revenue / cash / forecast / budget / spend / attribution / profit distinguished | ✅ separate metrics with "not the same as"; profit and forecast explicitly unavailable here |
| Currency and time rules consistent and documented | ✅ §5 |
| Filter, group, compare, drill down | ✅ §7 |
| Saved reports validated and permission-scoped | ✅ §7; tested |
| Scheduled reports / exports on existing infrastructure | ✅ Phase 14 schedules, existing storage / notifications / export helpers |
| Freshness and quality visible | ✅ §10 |
| Expensive queries bounded and monitored | ✅ §11 (limits, timeout, run log, Usage tab) |
| Traceable to canonical records | ✅ drill-down with links; reconciliation |
| Tests: calculations, authorisation, aggregation, reconciliation | ✅ §14 |
| Performance tests document results | ✅ §11 |
| Phases 01–16 still work | ✅ full suite (RELEASE_PLAN) |
| No duplicate modules / no Phase 18 | ✅ read-only layer over existing records; no AI, predictions or rule-based outlier alerts |

**Partially delivered (documented):**

- Contribution % / Pareto columns and deterministic outlier rules are not built.
- Recognised revenue, credit notes, profit and ad-platform spend have no source in the ERP.

## 16. Known limitations

- Live queries only. A company far beyond the measured volume (≫ 50k enquiries in a 2-year range) may need a nightly funnel summary.
- Exports carry the report rows (≤ 500); record-level exports stay on Phase 14 bulk export.
- Quotation values are in the quotation currency (base currency in practice today).
- Payments are counted as receipts, not by allocation to invoices.
- Dashboards use fixed definitions; users can't build their own dashboards (they save reports instead).
- Attribution freshness depends on the nightly calculation; providers are not live-verified (Phase 10/16).
- Target totals across value and count targets are n/a by design.

## 17. Deployment and operations

1. Apply the migration `20261112090000_sm_analytics_phase17` (tables + `sales_analytics` permission rows). Rollback: `prisma/rollback/20261112090000_sm_analytics_phase17.down.sql`.
2. `npx prisma generate`; restart the app and the worker. The worker adds the hourly `sm-analytics.tick` (run-log retention 90 days, expired delivery files). Schedules run on the existing Phase 14 schedule tick.
3. Give roles `sales_analytics` as needed (Settings → Roles). Users also need the source modules for the data they should see.
4. **Troubleshooting:**
   - "took too long" → narrow the range or dimensions; check the Usage tab for slow datasets.
   - A widget says "Not available to you" → the user lacks the dataset's module.
   - A delivery was SKIPPED → see the reason on Deliveries (recipient lost Analytics or the dataset's module).
   - Attribution is STALE / INCOMPLETE → recalculate on Attribution & ROI.
   - Reconciliation "does NOT match" → report it: the analytics SQL and the source table disagree.

## 18. Phase 18 readiness

Suitable governed inputs for AI-assisted insight:

- every metric in the registry, with id, version, formula and limitations;
- the run API, which enforces the caller's permissions, so an assistant can only see what the user sees;
- period comparisons and the funnel;
- freshness statuses, so an assistant can refuse or caveat stale data;
- the run log, which shows which reports matter.

Not suitable without more data:

- profit;
- recognised revenue;
- ad-platform spend not recorded as expenses;
- anything outside the registry.

Phase 18 should call the engine, not write its own SQL.
